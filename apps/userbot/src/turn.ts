/**
 * Tour de conversation d'un compte reel sur message prive entrant (phase 18, tache 04).
 * Porte depuis apps/worker/src/assistant/turn.ts le strict necessaire : le worker ne traite pas ces conversations
 * (bot fantome en mode STANDARD), c'est ce process qui tient la session et donc le tour.
 * Hors perimetre pour l'instant : relances, limites du jour, reprise par l'equipe, resume roulant,
 * regroupement des messages arrives pendant la preparation.
 */
import type { FlirtStep } from "@linkaffipro/chat";
import { randomUUID } from "node:crypto";
import {
  HISTORY_LIMIT,
  clampMaxTokens,
  createVeniceClient,
  estimateCostEur,
  findModel,
  modelSupportsReasoning,
  parisMonthStart,
  parseFacts,
  parseStyleProfile,
  runTurn,
  type ChatMedia,
  type HistoryMessage,
  type TurnDeps,
  type TurnInput,
  type TurnResult,
} from "@linkaffipro/chat";
import { prisma, toJsonValue, type Prisma } from "@linkaffipro/db";
import type { TelegramClient } from "telegram";
import { logger } from "./logger";
import { loadUserbotSettings } from "./settings";
import { createOfferLink, dropUnsentOfferLink } from "./offer-link";
import { createMtprotoTransport, type TransportPeer } from "./transport";
import { loadFlirtPhotos, personaSkipReason, toPersonaInput } from "./persona";

export type TurnAccount = {
  id: string;
  label: string;
  /** Bot fantome qui porte les conversations du compte (null : pas encore cree, aucun tour possible). */
  botId: string | null;
  /** Persona au demarrage ; relue en base a chaque message (changement sans redemarrer). */
  personaId: string | null;
  client: TelegramClient;
};

export type IncomingPrivate = {
  telegramUserId: bigint;
  telegramMessageId: number;
  text: string;
  /** Media recu (vocal) : le texte peut etre vide quand le vocal n'a pas ete compris. */
  media?: ChatMedia | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  /** Pair GramJS de l'expediteur (deja resolu par l'evenement : evite une resolution de plus). */
  peer: TransportPeer;
};

type Incoming = IncomingPrivate & { at: Date };

/** Message en attente dans le tour, avec son media. */
type PendingInbound = {
  id: string;
  text: string;
  createdAt: Date;
  media: ChatMedia | null;
};

// Conversations dont un tour est en cours dans ce process : jamais deux reponses en meme temps.
// Un Set suffit, la session (donc la reception) n'existe que dans ce process.
const busy = new Set<string>();

// Deux messages coup sur coup partent dans le meme tour.
const GROUP_WINDOW_MS = 1_500;

// ------------------------------------------------------------------
// Expediteur et message entrant
// ------------------------------------------------------------------

async function upsertMember(msg: Incoming) {
  const identity = {
    firstName: msg.firstName,
    lastName: msg.lastName,
    username: msg.username,
    ...(msg.languageCode ? { languageCode: msg.languageCode } : {}),
  };
  const existing = await prisma.member.findUnique({
    where: { telegramUserId: msg.telegramUserId },
    select: { id: true, anonymizedAt: true },
  });
  if (existing) {
    // Membre anonymise a sa demande : jamais son identite reecrite.
    await prisma.member.update({
      where: { id: existing.id },
      data: { lastSeenAt: msg.at, ...(existing.anonymizedAt ? {} : identity) },
    });
    return existing.id;
  }
  const created = await prisma.member.upsert({
    where: { telegramUserId: msg.telegramUserId },
    create: {
      telegramUserId: msg.telegramUserId,
      ...identity,
      firstSeenAt: msg.at,
      lastSeenAt: msg.at,
    },
    update: { lastSeenAt: msg.at },
    select: { id: true },
  });
  return created.id;
}

/**
 * Message entrant enregistre, et compteurs de reception mis a jour dans la meme transaction (comme la reception des
 * bots phase 17 : `lastInboundAt` et `memberMessages` sont ecrits a l'arrivee, le moteur les lit deja comptes).
 * Rend null si Telegram a redonne un message deja enregistre.
 */
async function recordInbound(conversationId: string, msg: Incoming): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.conversationMessage.create({
        data: {
          conversationId,
          direction: "IN",
          author: "MEMBER",
          text: msg.text,
          media: toJsonValue(msg.media ?? null),
          telegramMessageId: BigInt(msg.telegramMessageId),
          createdAt: msg.at,
        },
        select: { id: true },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastInboundAt: msg.at, memberMessages: { increment: 1 } },
      });
      return row.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return null;
    throw err;
  }
}

// ------------------------------------------------------------------
// Lecture du contexte
// ------------------------------------------------------------------

function parseMedia(raw: unknown): ChatMedia | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = (raw as { kind?: unknown }).kind;
  return typeof kind === "string" ? (raw as ChatMedia) : null;
}

/** 20 derniers messages AVANT ce tour, du plus ancien au plus recent. */
async function loadHistory(conversationId: string, inboundIds: readonly string[]): Promise<HistoryMessage[]> {
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId, NOT: { id: { in: [...inboundIds] } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT,
    select: { direction: true, author: true, text: true, media: true, createdAt: true },
  });
  return rows.reverse().map((r) => ({
    direction: r.direction,
    author: r.author,
    text: r.text,
    media: parseMedia(r.media),
    at: r.createdAt,
  }));
}

const personaInclude = {
  affiliateCampaign: { select: { isActive: true, trackingUrlTemplate: true } },
} satisfies Prisma.PersonaInclude;

type PersonaRow = Prisma.PersonaGetPayload<{ include: typeof personaInclude }>;

async function monthSpendEur(now: Date): Promise<number> {
  const agg = await prisma.aiConversationUsage.aggregate({
    _sum: { costEur: true },
    where: { createdAt: { gte: parisMonthStart(now) } },
  });
  return Number(agg._sum.costEur ?? 0);
}

// ------------------------------------------------------------------
// Tour
// ------------------------------------------------------------------

/** Point d'entree du handler `NewMessage` : ne jette jamais (une erreur est journalisee). */
export async function handleIncomingPrivate(
  account: TurnAccount,
  incoming: IncomingPrivate,
): Promise<void> {
  const msg: Incoming = { ...incoming, at: new Date() };
  if (!account.botId) {
    logger.warn({ compte: account.label }, "pas de bot fantome : message ignore");
    return;
  }
  try {
    await processIncoming({ ...account, botId: account.botId }, msg);
  } catch (err) {
    logger.error(
      {
        compte: account.label,
        err: err instanceof Error ? err.message : String(err),
      },
      "tour de conversation en erreur",
    );
  }
}

type ReadyAccount = TurnAccount & { botId: string };

async function processIncoming(account: ReadyAccount, msg: Incoming): Promise<void> {
  const memberId = await upsertMember(msg);
  // Persona relue a chaque message : un changement dans Reglages → Comptes s'applique sans redemarrer.
  const accountRow = await prisma.telegramUserAccount.findUnique({
    where: { id: account.id },
    select: { personaId: true, persona: { include: personaInclude } },
  });
  const conv = await prisma.conversation.upsert({
    where: { botId_memberId: { botId: account.botId, memberId } },
    create: { botId: account.botId, memberId, personaId: accountRow?.personaId ?? null },
    update: {},
    select: { id: true },
  });
  const inboundId = await recordInbound(conv.id, msg);
  if (!inboundId) return;

  if (busy.has(conv.id)) {
    // Regroupement hors perimetre : le message reste en base et sera dans l'historique du tour suivant.
    logger.info(
      { compte: account.label, conversation: conv.id },
      "tour deja en cours, message garde",
    );
    return;
  }
  busy.add(conv.id);
  try {
    // Fenetre de regroupement : deux messages coup sur coup partent dans le meme tour.
    // Les messages recus pendant l'attente voient busy et restent en base (turnId null) : ils sont ramasses ici.
    let pending: PendingInbound[] = [];
    for (let pass = 0; pass < 4; pass++) {
      await new Promise((resolve) => setTimeout(resolve, pass === 0 ? GROUP_WINDOW_MS : 400));
      const rows = await prisma.conversationMessage.findMany({
        where: { conversationId: conv.id, direction: "IN", turnId: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, text: true, createdAt: true, media: true },
      });
      const stable = rows.length === pending.length;
      pending = rows.map((r) => ({ ...r, media: parseMedia(r.media) }));
      if (stable) break;
    }
    if (pending.length === 0) return;
    // Un tour, puis on ramasse les messages arrives pendant la preparation (au plus 3 tours d'affilee).
    for (let round = 0; round < 3; round++) {
      await runConversationTurn(account, conv.id, pending, msg.peer, accountRow?.persona ?? null);
      const rest = await prisma.conversationMessage.findMany({
        where: { conversationId: conv.id, direction: "IN", turnId: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, text: true, createdAt: true, media: true },
      });
      if (rest.length === 0) return;
      pending = rest.map((r) => ({ ...r, media: parseMedia(r.media) }));
    }
  } finally {
    busy.delete(conv.id);
  }
}

async function runConversationTurn(
  account: ReadyAccount,
  conversationId: string,
  inbound: ReadonlyArray<PendingInbound>,
  peer: TransportPeer,
  persona: PersonaRow | null,
): Promise<void> {
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { member: { select: { languageCode: true } } },
  });
  const skip = (reason: string) =>
    logger.info({ compte: account.label, conversation: conv.id, reason }, "pas de reponse");
  // Jamais de reponse apres un /stop, a un mineur, ni dans une conversation reprise ou fermee.
  if (conv.status !== "BOT" || conv.stoppedAt || conv.isMinor) return skip("conversation_fermee");
  // Persona absente, inactive, ou d'un autre univers que Rencontres (un compte réel ne parle qu'en Rencontres).
  const blocked = personaSkipReason(persona);
  if (blocked || !persona) return skip(blocked ?? "no_persona");
  const { config: cfg, apiKey } = await loadUserbotSettings();
  if (!apiKey) return skip("no_api_key");

  const turnId = `ub_${randomUUID()}`;
  const inboundIds = inbound.map((m) => m.id);
  await prisma.conversationMessage.updateMany({ where: { id: { in: inboundIds } }, data: { turnId } });
  if (!conv.personaId)
    await prisma.conversation.update({ where: { id: conv.id }, data: { personaId: persona.id } });

  const history = await loadHistory(conv.id, inboundIds);
  const modelId = persona.model?.trim() || cfg.defaultModel;
  const input: TurnInput = {
    kind: "reply",
    persona: {
      ...toPersonaInput(persona, account.label),
      flirtPhotos: await loadFlirtPhotos(persona.id),
    },
    settings: {
      defaultModel: cfg.defaultModel,
      fallbackModel: cfg.fallbackModel,
      temperature: cfg.temperature,
      maxTokens: clampMaxTokens(cfg.maxTokens, findModel(modelId, cfg.models)),
      modelSupportsReasoning: (id) => modelSupportsReasoning(id, cfg.models),
    },
    conversation: {
      stage: conv.stage,
      style: parseStyleProfile(conv.styleProfile),
      summary: conv.summary,
      facts: parseFacts(conv.facts),
      memberMessages: conv.memberMessages,
      assistantTurns: conv.assistantTurns,
      offerSends: conv.offerSends,
      followUpCount: conv.followUpCount,
      isMinor: conv.isMinor,
      appRefused: conv.appRefusedAt !== null,
      flirt: { step: conv.flirtStep as FlirtStep, teases: conv.flirtTeases },
      isFirstAssistantTurn: conv.assistantTurns === 0,
      memberLanguageCode: conv.member.languageCode,
      lastInboundAt: conv.lastInboundAt,
      lastAssistantAt: conv.lastAssistantAt,
    },
    history,
    inbound: inbound.map((m) => ({ id: m.id, text: m.text, at: m.createdAt, media: m.media })),
  };

  const deps: TurnDeps = {
    llm: createVeniceClient(apiKey),
    sender: createMtprotoTransport({
      client: account.client,
      peer,
      conversationId: conv.id,
      memberId: conv.memberId,
      turnId,
    }),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: () => Math.random(),
    createOfferLink: () =>
      createOfferLink({
        conversationId: conv.id,
        personaId: persona.id,
        botId: account.botId,
        memberId: conv.memberId,
        source: conv.source,
      }).catch((err: unknown) => {
        // Le moteur avale l'erreur (message parti sans lien) : on garde une trace.
        logger.error(
          {
            compte: account.label,
            conversation: conv.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "creation du lien d'offre en erreur",
        );
        return null;
      }),
    // Messages arrives pendant la preparation : rendus au moteur, qui refait sa reponse UNE fois en les incluant.
    // Sans ca, le tour suivant les reprend et elle repond deux fois (avec une question repetee).
    // Ils sont marques avec ce turnId pour que la boucle de `processIncoming` ne les reprenne pas.
    beforeSend: async () => {
      const rows = await prisma.conversationMessage.findMany({
        where: { conversationId: conv.id, direction: "IN", turnId: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, text: true, createdAt: true, media: true },
      });
      if (rows.length === 0) return { abort: false, newInbound: [] };
      await prisma.conversationMessage.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { turnId },
      });
      return {
        abort: false,
        newInbound: rows.map((r) => ({
          id: r.id,
          text: r.text,
          at: r.createdAt,
          media: parseMedia(r.media),
        })),
      };
    },
    recordUsage: async (u) => {
      await prisma.aiConversationUsage.create({
        data: {
          personaId: persona.id,
          conversationId: conv.id,
          source: conv.source,
          purpose: u.purpose,
          model: u.model.slice(0, 200),
          inputTokens: Math.max(0, Math.round(u.inputTokens)),
          outputTokens: Math.max(0, Math.round(u.outputTokens)),
          costEur: u.costEur,
          ok: u.ok,
          error: u.error?.slice(0, 500) ?? null,
          attempt: u.attempt,
          requestId: u.requestId?.slice(0, 200) ?? null,
        },
      });
    },
    capReached: async () => (await monthSpendEur(new Date())) >= cfg.monthlyCapEur,
    costEur: (model, usage, costUsd) => estimateCostEur(model, usage, costUsd, cfg.models),
  };

  const result = await runTurn(input, deps);
  await persistTurn(conv.id, result, new Date());
  // Lien cree mais pas parti (envoi en echec, tour abandonne) : retire, il ne compterait jamais de clic.
  if (result.unsentOfferSubId) await dropUnsentOfferLink(result.unsentOfferSubId);
  logger.info(
    {
      compte: account.label,
      de: conv.memberId,
      conversation: conv.id,
      entrants: result.inboundUsed.length,
      outcome: result.outcome,
      partis: result.sent.length,
    },
    "tour termine",
  );
}

/** Etat de la conversation apres le tour (les messages sortants sont deja ecrits par le transport). */
function turnPatch(result: TurnResult, now: Date): Prisma.ConversationUpdateInput {
  const replied = result.sent.length > 0;
  const data: Prisma.ConversationUpdateInput = {
    stage: result.newStage,
    styleProfile: toJsonValue(result.style),
    facts: toJsonValue(result.facts),
    language: result.language,
  };
  if (replied) {
    data.assistantTurns = { increment: 1 };
    data.lastAssistantAt = now;
  }
  if (result.offerSent) data.offerSends = { increment: 1 };
  // Série de photos : l'étape n'avance que si quelque chose est réellement parti.
  if (replied && result.newFlirtStep) {
    data.flirtStep = result.newFlirtStep;
    data.flirtTeases = result.flirtTeases ?? 0;
  }
  // Mineur, compte bloque ou injoignable : conversation fermee, plus aucune reponse.
  if (result.closeReason) {
    data.status = "CLOSED";
    data.stage = "CLOSED";
    data.closedAt = now;
    data.closedReason = result.closeReason;
    if (result.closeReason === "MINOR") data.isMinor = true;
    if (result.appRefused) data.appRefusedAt = now;
  }
  return data;
}

async function persistTurn(conversationId: string, result: TurnResult, now: Date): Promise<void> {
  await prisma.conversation.update({ where: { id: conversationId }, data: turnPatch(result, now) });
}
