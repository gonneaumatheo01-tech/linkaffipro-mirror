/**
 * Lecture d'une conversation (fiche `/conversations/[id]`) et de ses nouveaux messages (fil en direct, GET
 * /api/conversations/[id]/messages) : fil (200 derniers messages), personne, persona, bot, source, étape, statut,
 * langue, faits retenus, résumé, coût de l'IA, liens de l'offre envoyés et ouverts, inscription et premier dépôt
 * rattachés, état qui décide des actions (/stop, mineur, blocage), et si l'assistante répondra vraiment à cette
 * personne (`replyBlock`, même règle que le webhook). Aucun repère interne n'est renvoyé (refus de l'IA, modèle, tour).
 */
import { parseFacts } from "@linkaffipro/chat";
import { prisma, type ConversationStage, type ConversationStatus } from "@linkaffipro/db";
import { isAssistantTeamMember } from "@linkaffipro/telegram";
import { loadAssistantConfig } from "@/lib/assistant/config";
import { replyBlock, type ReplyBlock } from "./reply-state";
import { conversationActions, type ConversationActions, type ConversationRuleInput } from "./rules";
import {
  THREAD_LIMIT,
  threadCursor,
  threadSince,
  threadStateKey,
  threadWindowStart,
  toThreadMessages,
  type OfferState,
  type ThreadMessage,
  type ThreadMessageRow,
  type ThreadPersona,
  type ThreadState,
  type ThreadUpdate,
} from "./thread";

const messageSelect = {
  id: true,
  direction: true,
  author: true,
  text: true,
  media: true,
  meta: true,
  createdAt: true,
  teamUser: { select: { name: true } },
  outboundMessage: { select: { status: true, error: true } },
} as const;

const stateSelect = {
  id: true,
  botId: true,
  memberId: true,
  status: true,
  stage: true,
  closedReason: true,
  stoppedAt: true,
  isMinor: true,
  takenOverById: true,
  persona: { select: { name: true, gender: true } },
  bot: { select: { isActive: true } },
} as const;

type StateRow = {
  botId: string;
  memberId: string;
  status: ConversationStatus;
  stage: ConversationStage;
  closedReason: string | null;
  stoppedAt: Date | null;
  isMinor: boolean;
  takenOverById: string | null;
  bot: { isActive: boolean };
};

/** La personne a-t-elle bloqué le bot ? */
async function memberBlockedBot(memberId: string, botId: string): Promise<boolean> {
  const s = await prisma.memberBotState.findUnique({
    where: { memberId_botId: { memberId, botId } },
    select: { blockedAt: true },
  });
  return Boolean(s?.blockedAt);
}

function ruleInput(c: StateRow, memberBlocked: boolean): ConversationRuleInput {
  return {
    status: c.status,
    stoppedAt: c.stoppedAt,
    isMinor: c.isMinor,
    closedReason: c.closedReason,
    memberBlocked,
    botActive: c.bot.isActive,
  };
}

function stateOf(c: StateRow, memberBlocked: boolean, resets: number): ThreadState {
  return {
    status: c.status,
    stage: c.stage,
    closedReason: c.closedReason,
    stopped: Boolean(c.stoppedAt),
    minor: c.isMinor,
    memberBlocked,
    takenOverById: c.takenOverById,
    resets,
  };
}

async function offersOf(conversationId: string): Promise<Record<string, OfferState>> {
  const links = await prisma.assistantOfferLink.findMany({
    where: { conversationId },
    select: { subId: true, firstOpenedAt: true, opens: true },
  });
  return Object.fromEntries(
    links.map((l) => [
      l.subId,
      { openedAt: l.firstOpenedAt?.toISOString() ?? null, opens: l.opens },
    ]),
  );
}

const countResets = (conversationId: string) =>
  prisma.conversationEvent.count({ where: { conversationId, type: "reset" } });

export type ConversationDetail = {
  id: string;
  createdAt: Date;
  stage: ConversationStage;
  status: ConversationStatus;
  source: string | null;
  language: string | null;
  summary: string | null;
  facts: string[];
  closedReason: string | null;
  closedAt: Date | null;
  stoppedAt: Date | null;
  isMinor: boolean;
  convertedAt: Date | null;
  /** Phase 25 : « à traiter » depuis (null : rien à traiter) et motif brut du moteur (`needsHumanReasonLabel`). */
  needsHumanAt: Date | null;
  needsHumanReason: string | null;
  takenOverAt: Date | null;
  takenOverBy: { id: string; name: string } | null;
  memberMessages: number;
  member: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    languageCode: string | null;
    anonymizedAt: Date | null;
  };
  bot: { id: string; username: string; name: string; isActive: boolean; mode: string };
  persona: { id: string; name: string; gender: string; isActive: boolean } | null;
  memberBlocked: boolean;
  costEur: number;
  links: Array<{ subId: string; sentAt: Date; firstOpenedAt: Date | null; opens: number }>;
  players: Array<{
    id: string;
    registeredAt: Date | null;
    ftdAt: Date | null;
    ftdAmount: number | null;
    currency: string;
    offerName: string;
  }>;
  messages: ThreadMessage[];
  /** Le fil ne montre que les 200 derniers messages. */
  truncated: boolean;
  offers: Record<string, OfferState>;
  stateKey: string;
  cursor: string;
  resets: number;
  actions: ConversationActions;
  /**
   * Pourquoi l'assistante ne répondrait pas à cette personne si la conversation lui est laissée (activation, mode du
   * bot, persona, essai réservé à l'équipe) ; null : elle répond.
   */
  replyBlock: ReplyBlock | null;
};

/** Tout ce que montre la fiche d'une conversation ; null si elle n'existe pas (ou plus). */
export async function loadConversationDetail(id: string): Promise<ConversationDetail | null> {
  const c = await prisma.conversation.findUnique({
    where: { id },
    select: {
      ...stateSelect,
      createdAt: true,
      source: true,
      language: true,
      summary: true,
      facts: true,
      closedAt: true,
      convertedAt: true,
      takenOverAt: true,
      memberMessages: true,
      needsHumanAt: true,
      needsHumanReason: true,
      takenOverBy: { select: { id: true, name: true } },
      member: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          languageCode: true,
          anonymizedAt: true,
          telegramUserId: true,
        },
      },
      bot: {
        select: {
          id: true,
          username: true,
          name: true,
          isActive: true,
          mode: true,
          persona: { select: { isActive: true } },
        },
      },
      persona: { select: { id: true, name: true, gender: true, isActive: true } },
    },
  });
  if (!c) return null;
  const persona: ThreadPersona = c.persona
    ? { name: c.persona.name, gender: c.persona.gender }
    : null;
  const [memberBlocked, rows, total, offers, links, cost, players, resets, block] =
    await Promise.all([
      memberBlockedBot(c.memberId, c.botId),
      prisma.conversationMessage.findMany({
        where: { conversationId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: THREAD_LIMIT,
        select: messageSelect,
      }),
      prisma.conversationMessage.count({ where: { conversationId: id } }),
      offersOf(id),
      prisma.assistantOfferLink.findMany({
        where: { conversationId: id },
        orderBy: { sentAt: "asc" },
        select: { subId: true, sentAt: true, firstOpenedAt: true, opens: true },
      }),
      prisma.aiConversationUsage.aggregate({
        where: { conversationId: id, purpose: { not: "TEST" } },
        _sum: { costEur: true },
      }),
      prisma.player.findMany({
        where: { click: { conversationId: id } },
        orderBy: { registeredAt: "asc" },
        select: {
          id: true,
          registeredAt: true,
          ftdAt: true,
          ftdAmount: true,
          currency: true,
          affiliateCampaign: { select: { name: true } },
        },
      }),
      countResets(id),
      replyBlockOf(c),
    ]);
  const messages = toThreadMessages((rows as ThreadMessageRow[]).reverse(), persona);
  const state = stateOf(c, memberBlocked, resets);
  const { telegramUserId: _telegramUserId, ...member } = c.member;
  const { persona: _botPersona, ...bot } = c.bot;
  return {
    id: c.id,
    createdAt: c.createdAt,
    stage: c.stage,
    status: c.status,
    source: c.source,
    language: c.language,
    summary: c.summary,
    facts: parseFacts(c.facts),
    closedReason: c.closedReason,
    closedAt: c.closedAt,
    stoppedAt: c.stoppedAt,
    isMinor: c.isMinor,
    convertedAt: c.convertedAt,
    needsHumanAt: c.needsHumanAt,
    needsHumanReason: c.needsHumanReason,
    takenOverAt: c.takenOverAt,
    takenOverBy: c.takenOverBy,
    memberMessages: c.memberMessages,
    member,
    bot,
    persona: c.persona,
    memberBlocked,
    costEur: Math.round(Number(cost._sum.costEur ?? 0) * 10_000) / 10_000,
    links,
    players: players.map((p) => ({
      id: p.id,
      registeredAt: p.registeredAt,
      ftdAt: p.ftdAt,
      ftdAmount: p.ftdAmount === null ? null : Number(p.ftdAmount),
      currency: p.currency,
      offerName: p.affiliateCampaign.name,
    })),
    messages,
    truncated: total > rows.length,
    offers,
    stateKey: threadStateKey(state),
    cursor: threadCursor(messages, c.createdAt.toISOString()),
    resets,
    actions: conversationActions(ruleInput(c, memberBlocked)),
    replyBlock: block,
  };
}

/**
 * L'assistante répondrait-elle à cette personne ? Persona de la conversation, sinon celle du bot (comme le webhook) ;
 * le compte de l'équipe n'est cherché qu'avec l'activation « Seulement l'équipe ».
 */
async function replyBlockOf(c: {
  member: { telegramUserId: bigint };
  bot: { isActive: boolean; mode: string; persona: { isActive: boolean } | null };
  persona: { isActive: boolean } | null;
}): Promise<ReplyBlock | null> {
  const { activation } = await loadAssistantConfig();
  const personaActive = (c.persona ?? c.bot.persona)?.isActive ?? null;
  const isTeamMember =
    activation === "team" ? await isAssistantTeamMember(c.member.telegramUserId) : false;
  return replyBlock({
    activation,
    botActive: c.bot.isActive,
    botMode: c.bot.mode,
    personaActive,
    isTeamMember,
  });
}

/**
 * Nouveaux messages depuis le curseur (avec une minute de marge, dédupliquée par le fil), état des liens de l'offre et
 * repère d'état. null si la conversation n'existe plus. Sans curseur lisible : les 200 derniers messages.
 * `windowStart` : à partir de ce moment, la réponse contient tous les messages qui existent encore (le fil retire ceux
 * qui ont disparu, comme le message d'un envoi raté retiré par le worker).
 */
export async function loadThreadUpdate(
  id: string,
  after: string | null,
): Promise<ThreadUpdate | null> {
  const c = await prisma.conversation.findUnique({ where: { id }, select: stateSelect });
  if (!c) return null;
  const since = threadSince(after);
  const persona: ThreadPersona = c.persona
    ? { name: c.persona.name, gender: c.persona.gender }
    : null;
  const [memberBlocked, rows, offers, resets] = await Promise.all([
    memberBlockedBot(c.memberId, c.botId),
    prisma.conversationMessage.findMany({
      where: { conversationId: id, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: THREAD_LIMIT,
      select: messageSelect,
    }),
    offersOf(id),
    countResets(id),
  ]);
  // Avant `reverse()` (qui retourne la liste en place) : lecture du plus récent au plus ancien.
  const windowStart = threadWindowStart(since, rows);
  const messages = toThreadMessages((rows as ThreadMessageRow[]).reverse(), persona);
  return {
    messages,
    offers,
    stateKey: threadStateKey(stateOf(c, memberBlocked, resets)),
    cursor: threadCursor(messages, after && since ? after : new Date(0).toISOString()),
    windowStart,
  };
}
