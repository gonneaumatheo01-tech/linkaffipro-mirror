/**
 * Tour de conversation d'un compte reel sur message prive entrant (phase 18, tache 04).
 * Porte depuis apps/worker/src/assistant/turn.ts le strict necessaire : le worker ne traite pas ces conversations
 * (bot fantome en mode STANDARD), c'est ce process qui tient la session et donc le tour.
 * Hors perimetre pour l'instant : limites du jour, reprise par l'equipe, resume roulant, regroupement des messages
 * arrives pendant la preparation. Relances : seulement « t la ? », une fois, apres le lien de la serie de photos
 * (`startLinkNudges`).
 * Casino / Paris sportifs (gérant du VIP : Mehdi) : tour à part (section « Casino / Paris sportifs », règles dans
 * assistant-rules.ts) avec nouvel essai après une panne, passage à l'équipe, journal et messages repris après un
 * redémarrage. Le tour d'une persona Rencontres (Léa) ne passe jamais par cette section.
 */
import type { FlirtStep } from "@linkaffipro/chat";
import { randomUUID } from "node:crypto";
import { mergeNeedsHuman } from "@linkaffipro/core";
import {
  HISTORY_LIMIT,
  clampMaxTokens,
  createVeniceClient,
  estimateCostEur,
  findModel,
  modelSupportsReasoning,
  parisDayStart,
  parisMonthStart,
  parseFacts,
  parseStyleProfile,
  personaIdentity,
  runTurn,
  type ChatMedia,
  type ChatSender,
  type ConversationStage,
  type HistoryMessage,
  type SendResult,
  type TurnDeps,
  type TurnInbound,
  type TurnInput,
  type TurnResult,
} from "@linkaffipro/chat";
import {
  lastOfferBookmakerKey,
  prisma,
  recordEvent,
  toJsonValue,
  type Prisma,
} from "@linkaffipro/db";
import type { TelegramClient } from "telegram";
import { logger } from "./logger";
import { loadUserbotSettings } from "./settings";
import { createOfferLink, dropUnsentOfferLink } from "./offer-link";
import { createMtprotoTransport, type TransportPeer } from "./transport";
import { loadFlirtPhotos, personaSkipReason, toPersonaInput } from "./persona";
import {
  DEAD_TURN_CHECK_AFTER_START_MS,
  DEAD_TURN_CHECK_EVERY_MS,
  DEAD_TURN_MIN_AGE_MS,
  MAX_TURN_RECOVERIES,
  NOT_OURS_ERROR,
  SWEEP_MAX_AGE_MS,
  SWEEP_MIN_AGE_MS,
  deadInbound,
  eventPayload,
  fixedKeyOf,
  isUniversePersona,
  planUniverseTurn,
  reconcileUniversePlan,
  remainingDelayMs,
  retryCountSince,
  shouldWaitForRetry,
  universeSkipReason,
  type PlannedEvent,
  type UniversePatch,
  type UniversePlan,
} from "./assistant-rules";

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

/** Derniers messages (`HISTORY_LIMIT`) AVANT ce tour, du plus ancien au plus recent. */
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
  bookmakers: {
    select: {
      bookmakerKey: true,
      label: true,
      priority: true,
      affiliateCampaignId: true,
      affiliateCampaign: { select: { isActive: true, trackingUrlTemplate: true } },
      inviteLinkId: true,
      inviteLink: { select: { telegramInviteLink: true } },
    },
    orderBy: { priority: "asc" as const },
  },
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

/** Vrai si la persona reagit aux photos recues : une fille avec serie de photos de chauffe. */
async function reactsToPhotos(
  persona: { id: string; universe: string | null; identityKind: string } | null | undefined,
): Promise<boolean> {
  if (!persona) return false;
  if (personaIdentity({ identity: persona.identityKind, universe: persona.universe }) !== "GIRL")
    return false;
  return (await loadFlirtPhotos(persona.id)).length > 0;
}

async function processIncoming(account: ReadyAccount, msg: Incoming): Promise<void> {
  // Persona relue a chaque message : un changement dans Reglages → Comptes s'applique sans redemarrer.
  const accountRow = await prisma.telegramUserAccount.findUnique({
    where: { id: account.id },
    select: { personaId: true, persona: { include: personaInclude } },
  });
  // Photo : seule une fille avec serie de photos y reagit (« t'es mignon hihi », moteur). Casino / Paris : gardée comme
  // photo (souvent la capture d'un dépôt : jamais ignorée). Ailleurs, comme avant : photo seule ignoree, legende lue
  // comme un simple texte.
  const universe = isUniversePersona(accountRow?.persona);
  if (msg.media?.kind === "photo" && !universe && !(await reactsToPhotos(accountRow?.persona))) {
    if (!msg.text) return;
    msg = { ...msg, media: null };
  }
  const memberId = await upsertMember(msg);
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
    // Casino / Paris sportifs (Mehdi) : tour à part, avec nouvel essai, passage à l'équipe et journal.
    if (universe) {
      await processUniverseConversation(account, conv.id, msg.peer);
      return;
    }
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
    // Délai de réponse persona (ex. Mehdi : 2-3 min) : le moteur renvoie openingDelay=0 quand ce champ est posé
    // (conçu pour BullMQ), donc on dort ici. Les messages arrivés pendant le délai sont ramassés par la boucle.
    const persona = accountRow?.persona ?? null;
    const delay = personaResponseDelay(persona);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      // Ramasser les messages arrivés pendant le délai.
      const fresh = await prisma.conversationMessage.findMany({
        where: { conversationId: conv.id, direction: "IN", turnId: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, text: true, createdAt: true, media: true },
      });
      if (fresh.length > 0) pending = fresh.map((r) => ({ ...r, media: parseMedia(r.media) }));
    }
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
  kind: "reply" | "follow_up" = "reply",
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
    kind,
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
    createOfferLink: (bookmakerKey?: string) =>
      createOfferLink({
        conversationId: conv.id,
        personaId: persona.id,
        botId: account.botId,
        memberId: conv.memberId,
        source: conv.source,
        bookmakerKey,
      }).catch((err: unknown) => {
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
    resolveVipLink: async (bookmakerKey: string) => {
      const pb = persona.bookmakers?.find((b: { bookmakerKey: string }) => b.bookmakerKey === bookmakerKey);
      if (!pb?.inviteLinkId || !pb.inviteLink?.telegramInviteLink) return null;
      return { url: pb.inviteLink.telegramInviteLink, bookmakerKey };
    },
    // Messages arrives pendant la preparation : rendus au moteur, qui refait sa reponse UNE fois en les incluant.
    // Sans ca, le tour suivant les reprend et elle repond deux fois (avec une question repetee).
    // Ils sont marques avec ce turnId pour que la boucle de `processIncoming` ne les reprenne pas.
    beforeSend: async () => {
      // Relance : un message arrive entre-temps → elle n'a plus lieu d'etre ; il reste a traiter par un vrai tour.
      if (kind === "follow_up") {
        const waiting = await prisma.conversationMessage.count({
          where: { conversationId: conv.id, direction: "IN", turnId: null },
        });
        return { abort: waiting > 0, newInbound: [] };
      }
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
export function turnPatch(result: TurnResult, now: Date): Prisma.ConversationUpdateInput {
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
  // Relance : seulement « t la ? » quand le lien de la serie vient de partir (prevue par le moteur) ; toute autre
  // reponse l'efface.
  if (replied) {
    data.followUpCount = result.followUpCount;
    data.nextFollowUpAt =
      result.offerSent && result.newFlirtStep === "LINKED" ? result.nextFollowUpAt : null;
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

// ------------------------------------------------------------------
// Relance « t la ? » apres le lien
// ------------------------------------------------------------------

const NUDGE_SWEEP_MS = 60_000;

/**
 * Relances dues de ce compte, verifiees chaque minute : seulement « t la ? », une fois, quand le lien de la serie
 * vient de partir et qu'il n'a rien ecrit depuis. Rend la fonction d'arret.
 */
export function startLinkNudges(account: TurnAccount): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running || !account.botId) return;
    running = true;
    void sweepLinkNudges({ ...account, botId: account.botId })
      .catch((err: unknown) =>
        logger.error(
          { compte: account.label, err: err instanceof Error ? err.message : String(err) },
          "relances en erreur",
        ),
      )
      .finally(() => {
        running = false;
      });
  }, NUDGE_SWEEP_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function sweepLinkNudges(account: ReadyAccount): Promise<void> {
  const due = await prisma.conversation.findMany({
    where: {
      botId: account.botId,
      status: "BOT",
      stoppedAt: null,
      isMinor: false,
      flirtStep: "LINKED",
      followUpCount: 0,
      offerSends: { gt: 0 },
      nextFollowUpAt: { lte: new Date() },
    },
    select: {
      id: true,
      nextFollowUpAt: true,
      lastInboundAt: true,
      lastAssistantAt: true,
      member: { select: { telegramUserId: true, username: true } },
    },
    orderBy: { nextFollowUpAt: "asc" },
    take: 10,
  });
  for (const c of due) {
    if (busy.has(c.id)) continue;
    // Reclamee une seule fois (effacee avant l'envoi) : jamais deux « t la ? ».
    const claimed = await prisma.conversation.updateMany({
      where: { id: c.id, nextFollowUpAt: c.nextFollowUpAt },
      data: { nextFollowUpAt: null },
    });
    if (claimed.count === 0) continue;
    // Il a ecrit depuis le dernier message : plus de relance.
    if (c.lastInboundAt && (!c.lastAssistantAt || c.lastInboundAt > c.lastAssistantAt)) continue;
    const waiting = await prisma.conversationMessage.count({
      where: { conversationId: c.id, direction: "IN", turnId: null },
    });
    if (waiting > 0) continue;
    const peer = await resolvePeer(account.client, c.member);
    if (!peer) {
      logger.warn(
        { compte: account.label, conversation: c.id },
        "relance : destinataire introuvable",
      );
      continue;
    }
    busy.add(c.id);
    try {
      const row = await prisma.telegramUserAccount.findUnique({
        where: { id: account.id },
        select: { persona: { include: personaInclude } },
      });
      const persona = row?.persona ?? null;
      await runConversationTurn(account, c.id, [], peer, persona, "follow_up");
      // Messages arrives pendant la relance (gardes en base, tour occupe) : traites maintenant, comme `processIncoming`.
      for (let round = 0; round < 3; round++) {
        const rest = await prisma.conversationMessage.findMany({
          where: { conversationId: c.id, direction: "IN", turnId: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, text: true, createdAt: true, media: true },
        });
        if (rest.length === 0) break;
        const pending = rest.map((r) => ({ ...r, media: parseMedia(r.media) }));
        await runConversationTurn(account, c.id, pending, peer, persona);
      }
    } finally {
      busy.delete(c.id);
    }
  }
}

/** Pair GramJS d'un membre hors evenement : cache de la session, puis son @, puis les discussions recentes. */
async function resolvePeer(
  client: TelegramClient,
  member: { telegramUserId: bigint; username: string | null },
): Promise<TransportPeer | null> {
  const id = Number(member.telegramUserId);
  try {
    return await client.getInputEntity(id);
  } catch {
    // pas dans le cache de la session (redemarrage)
  }
  if (member.username) {
    try {
      return await client.getInputEntity(member.username);
    } catch {
      // @ change ou supprime
    }
  }
  try {
    await client.getDialogs({ limit: 100 });
    return await client.getInputEntity(id);
  } catch {
    return null;
  }
}

/** Délai aléatoire entre min et max (secondes → ms). 0 si la persona n'a pas de délai configuré. */
function personaResponseDelay(p: PersonaRow | null): number {
  if (!p?.responseDelayMinSec || !p.responseDelayMaxSec) return 0;
  const minMs = p.responseDelayMinSec * 1000;
  const maxMs = p.responseDelayMaxSec * 1000;
  return minMs + Math.random() * (maxMs - minMs);
}

// ------------------------------------------------------------------
// Casino / Paris sportifs (gérant du VIP : Mehdi)
// ------------------------------------------------------------------
//
// Tour à part de celui d'une persona Rencontres (série de photos), règles dans assistant-rules.ts :
// - panne de l'IA ou envoi refusé sans raison définitive : aucun message d'attente, ses messages sont rendus et repris à
//   l'heure du nouvel essai (minuterie, balayage en filet) ; après 3 passages le moteur passe la main à l'équipe ;
// - passage à l'équipe, lien du VIP parti (conversion), fermeture et événements enregistrés comme par le worker ;
// - aucun message perdu : reçu pendant un redémarrage (balayage toutes les 30 s), ou pris par le tour d'un process
//   arrêté (rendu après 2 min s'il n'a eu aucune vraie réponse depuis, 2 fois au plus) ;
// - jamais de `claimedAt` (le balayage du worker prendrait ces tours pour les siens et les perdrait) : `turnId` préfixé
//   par le process, `meta.turnDone` en fin de tour.

/** Préfixe des tours de ce process : un tour d'un autre préfixe jamais terminé vient d'un process arrêté. */
const OWN_TURN_PREFIX = `ub_${randomUUID().slice(0, 8)}_`;
const STARTED_AT = Date.now();
const HANDOVER_EVENT_TYPES = ["taken_over", "released"];
/** Destinataire introuvable : la conversation n'est retentée par le balayage que 10 min plus tard. */
const PEER_RETRY_MS = 10 * 60_000;

/** Faux pendant l'arrêt du service : aucun nouveau tour, attentes écourtées. */
let accepting = true;
/** Tours en cours (messages pris) : attendus à l'arrêt. */
const inflightTurns = new Set<string>();
/** Attentes en cours (délai de la persona, rythme des envois) : écourtées à l'arrêt. */
const sleepers = new Set<() => void>();
/** Nouvel essai programmé, par conversation. */
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Attente écourtée par l'arrêt du service : vrai si elle est allée à son terme. */
function pause(ms: number): Promise<boolean> {
  if (!accepting) return Promise.resolve(false);
  if (ms <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      sleepers.delete(wake);
      resolve(false);
    };
    const timer = setTimeout(() => {
      sleepers.delete(wake);
      resolve(true);
    }, ms);
    sleepers.add(wake);
  });
}

function loadUniverseConversation(conversationId: string) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { member: { select: { languageCode: true } } },
  });
}

type UniverseConversation = NonNullable<Awaited<ReturnType<typeof loadUniverseConversation>>>;

async function loadAccountPersona(accountId: string): Promise<PersonaRow | null> {
  const row = await prisma.telegramUserAccount.findUnique({
    where: { id: accountId },
    select: { persona: { include: personaInclude } },
  });
  return row?.persona ?? null;
}

/** Messages reçus pas encore pris par un tour, du plus ancien au plus récent. */
function unclaimedInbound(conversationId: string) {
  return prisma.conversationMessage.findMany({
    where: { conversationId, direction: "IN", turnId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, createdAt: true },
  });
}

/** Prise des messages reçus non traités par ce tour (une mise à jour : jamais deux tours sur les mêmes messages). */
async function claimUniverseInbound(
  conversationId: string,
  turnId: string,
): Promise<PendingInbound[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; text: string | null; media: unknown; createdAt: Date }>
  >`
    UPDATE "ConversationMessage" SET "turnId" = ${turnId}
     WHERE "conversationId" = ${conversationId} AND "direction" = 'IN' AND "turnId" IS NULL
    RETURNING id, text, media, "createdAt"`;
  return rows
    .map((r) => ({
      id: r.id,
      text: r.text ?? "",
      createdAt: new Date(r.createdAt),
      media: parseMedia(r.media),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

function toTurnInbound(m: PendingInbound): TurnInbound {
  return { id: m.id, text: m.text, media: m.media, at: m.createdAt };
}

/** Rend des messages du tour au tour suivant (`turnId` NULL) ; sans liste, tous ceux du tour. */
async function releaseUniverseInbound(turnId: string, ids?: readonly string[]): Promise<void> {
  await prisma.conversationMessage.updateMany({
    where: { turnId, direction: "IN", ...(ids ? { id: { in: [...ids] } } : {}) },
    data: { turnId: null },
  });
}

/** Fin d'un tour : ses messages sont marqués traités (jamais repris comme ceux d'un tour interrompu). */
async function markUniverseTurnDone(turnId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ConversationMessage" SET "meta" = "meta" || '{"turnDone": true}'::jsonb
     WHERE "turnId" = ${turnId} AND "direction" = 'IN'`;
}

/**
 * Messages d'un tour interrompu rendus au tour suivant, avec un compteur `meta.crashes` ; un message déjà rendu
 * `MAX_TURN_RECOVERIES` fois est marqué traité à la place (jamais de boucle sur une erreur qui se reproduit).
 */
async function releaseCounted(ids: readonly string[]): Promise<{ released: number; gaveUp: number }> {
  if (ids.length === 0) return { released: 0, gaveUp: 0 };
  const list = [...ids];
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "ConversationMessage"
         SET "meta" = ("meta" - 'turnDone') || jsonb_build_object(
               'crashes',
               COALESCE(CASE WHEN jsonb_typeof("meta" -> 'crashes') = 'number'
                             THEN ("meta" ->> 'crashes')::numeric::int END, 0) + 1)
       WHERE id = ANY(${list}::text[]) AND "direction" = 'IN'`;
    const gaveUp = await tx.$executeRaw`
      UPDATE "ConversationMessage" SET "meta" = "meta" || '{"turnDone": true}'::jsonb
       WHERE id = ANY(${list}::text[]) AND "direction" = 'IN'
         AND ("meta" ->> 'crashes')::numeric::int > ${MAX_TURN_RECOVERIES}`;
    const released = await tx.$executeRaw`
      UPDATE "ConversationMessage" SET "turnId" = NULL
       WHERE id = ANY(${list}::text[]) AND "direction" = 'IN' AND ("meta" ->> 'turnDone') IS NULL`;
    return { released, gaveUp };
  });
}

/** Prises et rendus de main par l'équipe depuis la création de la conversation. */
function countHandovers(conversationId: string): Promise<number> {
  return prisma.conversationEvent.count({
    where: { conversationId, type: { in: HANDOVER_EVENT_TYPES } },
  });
}

/**
 * A-t-il encore la parole ? Statut BOT, ni /stop ni mineur, pas passée à l'équipe pour un motif qui le fait taire, et
 * l'équipe n'a ni pris ni rendu la main depuis le début du tour (sa réponse doublerait celle de l'équipe).
 */
async function universeGuard(conversationId: string, handoversAtStart: number): Promise<boolean> {
  const [c, handovers] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        status: true,
        stoppedAt: true,
        isMinor: true,
        needsHumanAt: true,
        needsHumanReason: true,
      },
    }),
    countHandovers(conversationId),
  ]);
  return Boolean(c) && universeSkipReason(c!) === null && handovers === handoversAtStart;
}

/** Envoi relu avant CHAQUE partie : la conversation reprise entre deux parties, plus rien ne part. */
function guardedSender(inner: ChatSender, guard: () => Promise<boolean>): ChatSender {
  const stopped = async (): Promise<SendResult | null> =>
    (await guard()) ? null : { ok: false, blocked: false, unreachable: false, error: NOT_OURS_ERROR };
  return {
    ...inner,
    async sendText(text, opts) {
      return (await stopped()) ?? inner.sendText(text, opts);
    },
    async sendMedia(media, caption, opts) {
      return (await stopped()) ?? inner.sendMedia(media, caption, opts);
    },
  };
}

/**
 * Historique AVANT ce tour (ni les messages de ce tour ni ceux pas encore pris). « Attends je reviens 2 sec » (ancien
 * message d'attente) n'y est jamais : le modèle ne doit pas l'imiter.
 */
async function loadUniverseHistory(conversationId: string, turnId: string): Promise<HistoryMessage[]> {
  const rows = await prisma.conversationMessage.findMany({
    where: {
      conversationId,
      NOT: [
        { direction: "IN", turnId },
        { direction: "IN", turnId: null },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT + 10,
    select: { direction: true, author: true, text: true, media: true, meta: true, createdAt: true },
  });
  return rows
    .filter((r) => !(r.direction === "OUT" && fixedKeyOf(r.meta) === "retryLater"))
    .slice(0, HISTORY_LIMIT)
    .reverse()
    .map((r) => ({
      direction: r.direction,
      author: r.author,
      text: r.text,
      media: parseMedia(r.media),
      at: r.createdAt,
    }));
}

/** Pannes depuis le dernier message de la personne : IA (nouveaux essais du moteur) et envois refusés. */
async function universeFailures(conversationId: string, lastInboundAt: Date | null) {
  const since = lastInboundAt ? { createdAt: { gt: lastInboundAt } } : {};
  const [aiFailures, sendFailures, lastNeutral] = await Promise.all([
    prisma.conversationEvent.findMany({
      where: { conversationId, type: "ai_failed", ...since },
      select: { createdAt: true },
    }),
    prisma.conversationEvent.findMany({
      where: { conversationId, type: "send_failed", ...since },
      select: { createdAt: true },
    }),
    prisma.conversationEvent.findFirst({
      where: { conversationId, type: "ai_failed", payload: { path: ["neutral"], equals: true } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const times = [...aiFailures, ...sendFailures].map((f) => f.createdAt.getTime());
  return {
    lastFailureAt: times.length > 0 ? new Date(Math.max(...times)) : null,
    retryCount: retryCountSince(aiFailures, lastInboundAt),
    sendFailures: sendFailures.length,
    lastNeutralAt: lastNeutral?.createdAt ?? null,
  };
}

/**
 * Tours d'une conversation Casino / Paris (appelant : `busy` déjà pris) : regroupement des messages, délai de la persona
 * compté depuis le plus ancien message en attente (jamais attendu deux fois après un redémarrage ou un nouvel essai),
 * puis au plus 3 tours d'affilée pour les messages arrivés pendant un tour.
 */
async function processUniverseConversation(
  account: ReadyAccount,
  conversationId: string,
  peer: TransportPeer,
): Promise<void> {
  let pending = await unclaimedInbound(conversationId);
  for (let pass = 0; pass < 4 && pending.length > 0; pass++) {
    if (!(await pause(pass === 0 ? GROUP_WINDOW_MS : 400))) return;
    const rows = await unclaimedInbound(conversationId);
    const stable = rows.length === pending.length;
    pending = rows;
    if (stable) break;
  }
  for (let round = 0; round < 3 && pending.length > 0; round++) {
    const persona = await loadAccountPersona(account.id);
    const wait = remainingDelayMs(personaResponseDelay(persona), pending[0]!.createdAt, new Date());
    // Arrêt du service pendant l'attente : les messages, jamais pris, restent au process suivant.
    if (!(await pause(wait))) return;
    if ((await runUniverseTurn(account, conversationId, peer)) !== "done") return;
    pending = await unclaimedInbound(conversationId);
  }
}

/**
 * Un tour : contrôles, prise des messages, moteur, enregistrement. « stop » : plus de tour maintenant (nouvel essai
 * programmé, réponse non permise, arrêt du service, persona changée…).
 */
async function runUniverseTurn(
  account: ReadyAccount,
  conversationId: string,
  peer: TransportPeer,
): Promise<"done" | "stop"> {
  if (!accepting) return "stop";
  const now = new Date();
  const [conv, persona] = await Promise.all([
    loadUniverseConversation(conversationId),
    loadAccountPersona(account.id),
  ]);
  // Persona changée pour une persona Rencontres : ses messages restent au tour habituel (au prochain message).
  if (!conv || !persona || !isUniversePersona(persona)) return "stop";
  const failures = await universeFailures(conv.id, conv.lastInboundAt);
  const pending = await unclaimedInbound(conv.id);
  if (pending.length === 0) return "stop";
  // Nouvel essai prévu plus tard et aucun nouveau message depuis la panne : on attend l'heure prévue.
  if (
    conv.retryAt &&
    shouldWaitForRetry({
      retryAt: conv.retryAt,
      now,
      lastFailureAt: failures.lastFailureAt,
      claimedAt: pending.map((m) => m.createdAt),
    })
  ) {
    scheduleRetry(account, conv.id, peer, conv.retryAt);
    return "stop";
  }
  const turnId = `${OWN_TURN_PREFIX}${randomUUID()}`;
  const handoversAtStart = await countHandovers(conv.id);
  const claimed = await claimUniverseInbound(conv.id, turnId);
  if (claimed.length === 0) return "stop";
  inflightTurns.add(turnId);
  try {
    const { config: cfg, apiKey } = await loadUserbotSettings();
    // Jamais de réponse à une conversation reprise par l'équipe, fermée, après /stop, à un mineur, ni passée à l'équipe
    // pour un motif qui le fait taire : ses messages sont traités (l'équipe les lit), jamais repris plus tard.
    const skip = universeSkipReason(conv) ?? personaSkipReason(persona) ?? (apiKey ? null : "no_api_key");
    if (skip) {
      await markUniverseTurnDone(turnId);
      logger.info({ compte: account.label, conversation: conv.id, reason: skip }, "pas de reponse");
      return "stop";
    }
    if (!conv.personaId)
      await prisma.conversation.update({ where: { id: conv.id }, data: { personaId: persona.id } });
    const [history, lastOfferBookKey] = await Promise.all([
      loadUniverseHistory(conv.id, turnId),
      lastOfferBookmakerKey(prisma, conv.id, persona.id),
    ]);
    const modelId = persona.model?.trim() || cfg.defaultModel;
    const input: TurnInput = {
      kind: "reply",
      // Jamais la série de photos (Rencontres) : aucune photo de chauffe pour une persona Casino / Paris.
      persona: { ...toPersonaInput(persona, account.label), flirtPhotos: [] },
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
        isFirstAssistantTurn: conv.assistantTurns === 0,
        memberLanguageCode: conv.member.languageCode,
        lastInboundAt: conv.lastInboundAt,
        lastAssistantAt: conv.lastAssistantAt,
        lastNeutralAt: failures.lastNeutralAt,
        lastOfferBookKey,
      },
      history,
      inbound: claimed.map(toTurnInbound),
      retryCount: failures.retryCount,
    };
    const guard = () => universeGuard(conv.id, handoversAtStart);
    const deps: TurnDeps = {
      llm: createVeniceClient(apiKey!),
      sender: guardedSender(
        createMtprotoTransport({
          client: account.client,
          peer,
          conversationId: conv.id,
          memberId: conv.memberId,
          turnId,
        }),
        guard,
      ),
      now: () => new Date(),
      // Arrêt du service : le rythme des envois est écourté (le tour finit d'envoyer au lieu d'être coupé).
      sleep: (ms) => pause(ms).then(() => undefined),
      random: () => Math.random(),
      createOfferLink: (bookmakerKey?: string) =>
        createOfferLink({
          conversationId: conv.id,
          personaId: persona.id,
          botId: account.botId,
          memberId: conv.memberId,
          source: conv.source,
          bookmakerKey,
        }).catch((err: unknown) => {
          logger.error(
            { compte: account.label, conversation: conv.id, err: errMessage(err) },
            "creation du lien d'offre en erreur",
          );
          return null;
        }),
      resolveVipLink: async (bookmakerKey: string) => {
        const pb = persona.bookmakers.find((b) => b.bookmakerKey === bookmakerKey);
        if (!pb?.inviteLinkId || !pb.inviteLink?.telegramInviteLink) return null;
        return { url: pb.inviteLink.telegramInviteLink, bookmakerKey };
      },
      beforeSend: async () => {
        // Arrêt du service, reprise par l'équipe, /stop, passage à l'équipe : rien ne part.
        if (!accepting || !(await guard())) return { abort: true, newInbound: [] };
        // Messages arrivés pendant la préparation : pris par ce tour, le moteur refait sa réponse en les incluant.
        const more = await claimUniverseInbound(conv.id, turnId);
        return { abort: false, newInbound: more.map(toTurnInbound) };
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
    if (result.unsentOfferSubId) await dropUnsentOfferLink(result.unsentOfferSubId);
    // Arrêt du service avant tout envoi : messages rendus, repris par le process suivant.
    if (!accepting && result.outcome === "aborted" && result.sent.length === 0) {
      await releaseUniverseInbound(turnId);
      return "stop";
    }
    const plan = await persistUniverseTurn({
      conv,
      turnId,
      result,
      handoversAtStart,
      sendFailuresBefore: failures.sendFailures,
    });
    await markUniverseTurnDone(turnId);
    logger.info(
      {
        compte: account.label,
        de: conv.memberId,
        conversation: conv.id,
        entrants: result.inboundUsed.length,
        outcome: result.outcome,
        partis: result.sent.length,
        ...(plan?.patch.retryAt ? { nouvelEssai: plan.patch.retryAt.toISOString() } : {}),
        ...(plan?.patch.needsHuman ? { equipe: plan.patch.needsHuman } : {}),
      },
      "tour termine",
    );
    if (plan?.patch.retryAt) {
      scheduleRetry(account, conv.id, peer, plan.patch.retryAt);
      return "stop";
    }
    return "done";
  } catch (err) {
    await recoverCrashedTurn(conv.id, turnId, err);
    throw err;
  } finally {
    inflightTurns.delete(turnId);
  }
}

/**
 * Tour planté (erreur de la base, du réseau…) : une partie déjà partie → tour marqué terminé (jamais deux réponses) ;
 * sinon ses messages sont rendus (repris par le balayage), au plus `MAX_TURN_RECOVERIES` fois. Ne jette jamais.
 */
async function recoverCrashedTurn(conversationId: string, turnId: string, err: unknown): Promise<void> {
  const message = errMessage(err);
  try {
    const sent = await prisma.conversationMessage.count({ where: { turnId, direction: "OUT" } });
    if (sent > 0) {
      await markUniverseTurnDone(turnId);
      logger.warn({ conversation: conversationId, err: message }, "tour plante apres un envoi");
      return;
    }
    const rows = await prisma.conversationMessage.findMany({
      where: { turnId, direction: "IN" },
      select: { id: true },
    });
    const r = await releaseCounted(rows.map((m) => m.id));
    logger.warn(
      { conversation: conversationId, err: message, ...r },
      "tour plante avant tout envoi, messages rendus",
    );
  } catch (e) {
    logger.warn(
      { conversation: conversationId, err: message, reprise: errMessage(e) },
      "tour plante, reprise laissee au balayage",
    );
  }
}

function toConversationUpdate(p: UniversePatch): Prisma.ConversationUpdateInput {
  const data: Prisma.ConversationUpdateInput = {
    styleProfile: toJsonValue(p.styleProfile),
    facts: toJsonValue(p.facts),
    language: p.language,
  };
  if (p.stage !== undefined) data.stage = p.stage;
  if (p.assistantTurnsIncrement) data.assistantTurns = { increment: p.assistantTurnsIncrement };
  if (p.offerSendsIncrement) data.offerSends = { increment: p.offerSendsIncrement };
  if (p.lastAssistantAt !== undefined) data.lastAssistantAt = p.lastAssistantAt;
  if (p.followUpCount !== undefined) data.followUpCount = p.followUpCount;
  if (p.nextFollowUpAt !== undefined) data.nextFollowUpAt = p.nextFollowUpAt;
  if (p.retryAt !== undefined) data.retryAt = p.retryAt;
  if (p.isMinor !== undefined) data.isMinor = p.isMinor;
  if (p.status !== undefined) data.status = p.status;
  if (p.closedAt !== undefined) data.closedAt = p.closedAt;
  if (p.closedReason !== undefined) data.closedReason = p.closedReason;
  return data;
}

/**
 * Événement de conversation et son double dans le journal (`Event` `conversation.<type>`), jamais de texte de la
 * conversation (comme le worker). Le plafond du mois n'est noté qu'une fois par jour. Ne jette jamais.
 */
async function recordUniverseEvent(
  ref: { id: string; botId: string; memberId: string },
  e: PlannedEvent,
  at: Date,
): Promise<void> {
  const payload = eventPayload(e.payload);
  try {
    if (e.type === "cap_reached") {
      const already = await prisma.conversationEvent.findFirst({
        where: { conversationId: ref.id, type: e.type, createdAt: { gte: parisDayStart(at) } },
        select: { id: true },
      });
      if (already) return;
    }
    await prisma.conversationEvent.create({
      data: {
        conversationId: ref.id,
        type: e.type,
        fromStage: e.fromStage ?? null,
        toStage: e.toStage ?? null,
        payload: toJsonValue(payload),
        createdAt: at,
      },
    });
  } catch (err) {
    logger.warn(
      { conversation: ref.id, type: e.type, err: errMessage(err) },
      "evenement de conversation non enregistre",
    );
  }
  await recordEvent({
    type: `conversation.${e.type}`,
    occurredAt: at,
    memberId: ref.memberId,
    botId: ref.botId,
    payload: toJsonValue({
      conversationId: ref.id,
      ...(e.fromStage ? { fromStage: e.fromStage } : {}),
      ...(e.toStage ? { toStage: e.toStage } : {}),
      ...payload,
    }),
  });
}

/**
 * Résultat du tour enregistré (`planUniverseTurn`) après relecture de la conversation sous verrou de ligne : une reprise
 * par l'équipe, un /stop ou une conversion survenus pendant le tour ne sont jamais défaits (`reconcileUniversePlan`).
 */
async function persistUniverseTurn(args: {
  conv: UniverseConversation;
  turnId: string;
  result: TurnResult;
  handoversAtStart: number;
  sendFailuresBefore: number;
}): Promise<UniversePlan | null> {
  const { conv, result } = args;
  const now = new Date();
  const before = { stage: conv.stage as ConversationStage };
  const planned = planUniverseTurn({
    stage: before.stage,
    result,
    now,
    sendFailuresBefore: args.sendFailuresBefore,
  });
  const applied = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conv.id} FOR UPDATE`;
    const cur = await tx.conversation.findUnique({
      where: { id: conv.id },
      select: {
        status: true,
        stoppedAt: true,
        stage: true,
        needsHumanAt: true,
        needsHumanReason: true,
      },
    });
    if (!cur) return null;
    const handovers = await tx.conversationEvent.count({
      where: { conversationId: conv.id, type: { in: HANDOVER_EVENT_TYPES } },
    });
    const plan = reconcileUniversePlan(planned, before, {
      status: cur.status,
      stoppedAt: cur.stoppedAt,
      stage: cur.stage as ConversationStage,
      handedOver: handovers > args.handoversAtStart,
    });
    const data = toConversationUpdate(plan.patch);
    // Passage à l'équipe : heure du premier passage gardée, motif le plus grave retenu (relus sous verrou).
    if (plan.patch.needsHuman) {
      const merged = mergeNeedsHuman(
        { at: cur.needsHumanAt, reason: cur.needsHumanReason },
        plan.patch.needsHuman,
        now,
      );
      data.needsHumanAt = merged.at;
      data.needsHumanReason = merged.reason;
    }
    await tx.conversation.update({ where: { id: conv.id }, data });
    return plan;
  });
  // Conversation supprimée pendant le tour (membre supprimé à sa demande) : plus rien à écrire.
  if (!applied) return null;
  const ref = { id: conv.id, botId: conv.botId, memberId: conv.memberId };
  for (const e of applied.events) await recordUniverseEvent(ref, e, now);
  if (applied.releaseIds.length > 0) await releaseUniverseInbound(args.turnId, applied.releaseIds);
  return applied;
}

/** Nouvel essai à l'heure prévue (le balayage reste le filet si ce process s'arrête avant). */
function scheduleRetry(
  account: ReadyAccount,
  conversationId: string,
  peer: TransportPeer,
  at: Date,
): void {
  if (!accepting) return;
  const previous = retryTimers.get(conversationId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(
    () => {
      retryTimers.delete(conversationId);
      startUniverseConversation(account, conversationId, peer);
    },
    Math.max(1_000, at.getTime() - Date.now() + 500),
  );
  timer.unref?.();
  retryTimers.set(conversationId, timer);
}

/** Tours d'une conversation lancés en arrière-plan (jamais deux à la fois pour une conversation). */
function startUniverseConversation(
  account: ReadyAccount,
  conversationId: string,
  peer: TransportPeer,
): void {
  if (!accepting || busy.has(conversationId)) return;
  busy.add(conversationId);
  void processUniverseConversation(account, conversationId, peer)
    .catch((err: unknown) =>
      logger.error(
        { compte: account.label, conversation: conversationId, err: errMessage(err) },
        "tour de conversation en erreur",
      ),
    )
    .finally(() => busy.delete(conversationId));
}

type SweepState = { running: boolean; lastDeadCheck: number; peerMisses: Map<string, number> };

const newSweepState = (): SweepState => ({ running: false, lastDeadCheck: 0, peerMisses: new Map() });

/** Un passage du balayage, tout de suite (tests d'intégration ; le service le lance par `startUniverseSweep`). */
export async function sweepUniverseNow(account: TurnAccount): Promise<void> {
  if (!accepting || !account.botId) return;
  await sweepUniverse({ ...account, botId: account.botId }, newSweepState());
}

/**
 * Filet du compte réel Casino / Paris, toutes les 30 s (rien pour une persona Rencontres) : messages reçus restés sans
 * tour (redémarrage, nouvel essai dû) et, 1 min après le démarrage puis toutes les 2 min, messages pris par le tour d'un
 * process arrêté. Rend la fonction d'arrêt.
 */
export function startUniverseSweep(account: TurnAccount): () => void {
  const state = newSweepState();
  const tick = () => {
    if (state.running || !accepting || !account.botId) return;
    state.running = true;
    void sweepUniverse({ ...account, botId: account.botId }, state)
      .catch((err: unknown) =>
        logger.error(
          { compte: account.label, err: errMessage(err) },
          "reprise des messages en erreur",
        ),
      )
      .finally(() => {
        state.running = false;
      });
  };
  const first = setTimeout(tick, 15_000);
  const timer = setInterval(tick, 30_000);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

async function sweepUniverse(account: ReadyAccount, state: SweepState): Promise<void> {
  const row = await prisma.telegramUserAccount.findUnique({
    where: { id: account.id },
    select: { persona: { select: { universe: true, isActive: true } } },
  });
  // Persona Rencontres (Léa), désactivée ou absente : rien à faire ici.
  if (!row?.persona?.isActive || !isUniversePersona(row.persona)) return;
  const now = new Date();
  if (
    now.getTime() - STARTED_AT >= DEAD_TURN_CHECK_AFTER_START_MS &&
    now.getTime() - state.lastDeadCheck >= DEAD_TURN_CHECK_EVERY_MS
  ) {
    state.lastDeadCheck = now.getTime();
    await recoverDeadTurns(account, now);
  }
  const due = await prisma.conversation.findMany({
    where: {
      botId: account.botId,
      status: "BOT",
      stoppedAt: null,
      isMinor: false,
      OR: [{ retryAt: null }, { retryAt: { lte: now } }],
      messages: {
        some: {
          direction: "IN",
          turnId: null,
          createdAt: {
            lte: new Date(now.getTime() - SWEEP_MIN_AGE_MS),
            gte: new Date(now.getTime() - SWEEP_MAX_AGE_MS),
          },
        },
      },
    },
    select: { id: true, member: { select: { telegramUserId: true, username: true } } },
    orderBy: { lastInboundAt: "asc" },
    take: 5,
  });
  for (const c of due) {
    if (!accepting) return;
    if (busy.has(c.id) || (state.peerMisses.get(c.id) ?? 0) > now.getTime()) continue;
    const peer = await resolvePeer(account.client, c.member);
    if (!peer) {
      state.peerMisses.set(c.id, now.getTime() + PEER_RETRY_MS);
      logger.warn(
        { compte: account.label, conversation: c.id },
        "message sans reponse : destinataire introuvable",
      );
      continue;
    }
    state.peerMisses.delete(c.id);
    logger.info({ compte: account.label, conversation: c.id }, "message sans reponse : repris");
    startUniverseConversation(account, c.id, peer);
  }
}

/**
 * Messages pris par le tour d'un process arrêté (redémarrage pendant le délai de réponse, ou ancienne version qui
 * gardait les messages après « attends je reviens 2 sec ») : rendus au tour suivant s'ils sont arrivés après la
 * dernière vraie réponse, sinon marqués traités (`deadInbound`). Conversations au statut BOT seulement.
 */
async function recoverDeadTurns(account: ReadyAccount, now: Date): Promise<void> {
  const candidates = await prisma.$queryRaw<Array<{ conversationId: string }>>`
    SELECT DISTINCT m."conversationId"
      FROM "ConversationMessage" m
      JOIN "Conversation" c ON c.id = m."conversationId"
     WHERE c."botId" = ${account.botId} AND c."status" = 'BOT' AND c."stoppedAt" IS NULL
       AND c."isMinor" = false
       AND m."direction" = 'IN' AND m."turnId" IS NOT NULL
       AND starts_with(m."turnId", 'ub_') AND NOT starts_with(m."turnId", ${OWN_TURN_PREFIX})
       AND (m."meta" ->> 'turnDone') IS NULL
       AND m."createdAt" > ${new Date(now.getTime() - SWEEP_MAX_AGE_MS)}
       AND m."createdAt" < ${new Date(now.getTime() - DEAD_TURN_MIN_AGE_MS)}
     LIMIT 20`;
  for (const { conversationId } of candidates) {
    if (!accepting) return;
    if (busy.has(conversationId)) continue;
    const rows = await prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 60,
      select: { id: true, direction: true, turnId: true, meta: true, createdAt: true },
    });
    const { release, answeredBefore } = deadInbound(rows.reverse(), {
      ownTurnPrefix: OWN_TURN_PREFIX,
      now,
    });
    if (answeredBefore)
      await prisma.$executeRaw`
        UPDATE "ConversationMessage" SET "meta" = "meta" || '{"turnDone": true}'::jsonb
         WHERE "conversationId" = ${conversationId} AND "direction" = 'IN' AND "turnId" IS NOT NULL
           AND starts_with("turnId", 'ub_') AND NOT starts_with("turnId", ${OWN_TURN_PREFIX})
           AND ("meta" ->> 'turnDone') IS NULL AND "createdAt" <= ${answeredBefore}`;
    if (release.length > 0) {
      const r = await releaseCounted(release);
      logger.info(
        { compte: account.label, conversation: conversationId, ...r },
        "messages d'un tour interrompu rendus",
      );
    }
  }
}

/**
 * Arrêt du service : plus aucun tour Casino / Paris, attentes écourtées, tours en cours attendus `maxMs` au plus (un
 * tour qui a commencé à envoyer finit d'envoyer). Ce qui reste est repris au démarrage suivant (balayage).
 */
export async function drainUniverseTurns(maxMs: number): Promise<void> {
  accepting = false;
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  for (const wake of [...sleepers]) wake();
  const until = Date.now() + maxMs;
  while (inflightTurns.size > 0 && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 200));
  if (inflightTurns.size > 0)
    logger.warn({ tours: inflightTurns.size }, "arret : tours encore en cours, repris au redemarrage");
}
