/**
 * Tour de l'assistant de conversation côté worker (phase 17, contrat docs/ASSISTANT-CONVERSATION.md §5).
 *
 * Déroulé d'une tâche `chat` `turn` :
 * 1. verrou Redis de la conversation (`chat:lock:<id>`, 90 s, prolongé pendant le tour) ; pris par un autre tour → la
 *    tâche est remise en file 3 s plus tard ;
 * 2. réclamation des messages reçus non traités (transaction, `SELECT … FOR UPDATE` de la conversation) ; rien de
 *    réclamé → relance due ? (réclamée par comparaison-échange sur `nextFollowUpAt`) sinon fin ;
 * 3. contrôles AVANT tout appel au modèle (bot en mode assistant, persona active, activation pour cette personne,
 *    statut BOT, ni /stop ni mineur, bot non bloqué, limite du jour, plafond du mois) ;
 * 4. `runTurn` du moteur (`@linkaffipro/chat`) : Venice, rythme naturel, lien d'offre, relecture avant l'envoi
 *    (reprise par l'équipe, messages arrivés entre-temps), envoi dans l'ordre par `sendDm` ;
 * 5. enregistrement du résultat (étape, événements sans texte, style, faits, résumé, compteurs, relance, nouvel
 *    essai, fermeture) après relecture de la conversation sous verrou de ligne : un /stop, un /reset, une reprise par
 *    l'équipe ou une conversion survenus pendant le tour ne sont jamais défaits ; messages rendus au tour suivant, et
 *    tour suivant mis en file s'il reste des messages.
 * Tour planté (erreur de la base…) sans rien avoir envoyé : messages rendus et repris 30 s plus tard, au plus 2 fois.
 * Les faits d'un envoi (dernier message parti, tour compté, lien envoyé, étape LINK_SENT) sont écrits par l'envoi au
 * moment où le message part ; le résumé roulant est fait APRÈS l'enregistrement du tour (jamais un arrêt du worker
 * pendant le résumé ne fait perdre un lien envoyé). Relance : la personne qui écrit pendant sa préparation l'annule
 * (jamais un message reçu traité comme une relance). Âge déclaré : aussi cherché dans les messages réclamés quand le
 * contrôle avant l'appel échoue (filet de la détection faite à la réception).
 */
import {
  HISTORY_LIMIT,
  clampMaxTokens,
  detectMinorIn,
  estimateCostEur,
  findModel,
  modelSupportsReasoning,
  parisDayKey,
  parisDayStart,
  parisMonthStart,
  parseFacts,
  parseStyleProfile,
  runTurn,
  summarizeAfterTurn,
  type ConversationStage,
  type TurnDeps,
  type TurnInbound,
  type TurnInput,
  type TurnKind,
  type TurnOutcome,
  type TurnResult,
} from "@linkaffipro/chat";
import { isAssistantOnlyUniverse, jsonIds, mergeNeedsHuman } from "@linkaffipro/core";
import { prisma, toJsonValue, type Prisma } from "@linkaffipro/db";
import { enqueueChatTurn, getRedis, RedisLockBusy, withRedisLock } from "@linkaffipro/queue";
import { isAssistantTeamMember } from "@linkaffipro/telegram";
import { logger } from "../logger";
import {
  claimInbound,
  claimMoreInbound,
  countUnclaimed,
  markTurnDone,
  newTurnId,
  parseChatMedia,
  releaseCrashedTurn,
  releaseInbound,
  releaseTurn,
  settleTurnParts,
  type ClaimedInbound,
} from "./claim";
import {
  recordConversationEvent,
  recordConversationEventOncePerDay,
  type ConversationRef,
} from "./events";
import { conversationGuard, countHandovers, countResets, HANDOVER_EVENT_TYPES } from "./guard";
import { createAssistantOfferLink, dropUnsentOfferLink } from "./offer-link";
import {
  CHAT_LOCK_BUSY_RETRY_MS,
  CHAT_LOCK_TTL_MS,
  CRASH_RETRY_DELAY_MS,
  MAX_TURN_CRASHES,
  conversationDailyCostCapEur,
  SUMMARY_MAX_MESSAGES,
  SUMMARY_TRIGGER_MESSAGES,
  chatLockKey,
  followUpDecision,
  followUpRetryCount,
  planTurnPersistence,
  precheck,
  reconcileTurnPlan,
  retryCountSince,
  shouldWaitForRetry,
  summaryPlan,
  toHistoryMessage,
  toPersonaInput,
  type ConversationPatch,
  type HistoryRow,
  type LiveWrites,
  type PrecheckResult,
} from "./rules";
import { chatRuntime } from "./runtime";
import { createWorkerChatSender, type SenderContext, type SentRow } from "./sender";
import { loadAssistantSettings, type AssistantSettings } from "./settings";

export type ChatTurnReport = {
  conversationId: string;
  status:
    | "busy"
    | "missing"
    | "nothing"
    | "waiting_retry"
    | "skipped"
    | "follow_up_cancelled"
    | "follow_up_rescheduled"
    | "done";
  reason?: string;
  kind?: TurnKind;
  outcome?: TurnOutcome;
  claimed?: number;
  sent?: number;
};

/** Tâche `chat` `turn` : un tour sous le verrou de la conversation (voir l'en-tête). */
export async function processChatTurn(conversationId: string): Promise<ChatTurnReport> {
  try {
    return await withRedisLock(
      getRedis(),
      chatLockKey(conversationId),
      () => runConversationTurn(conversationId),
      { ttlMs: CHAT_LOCK_TTL_MS, owner: "worker:chat" },
    );
  } catch (err) {
    if (err instanceof RedisLockBusy) {
      // Un autre tour de cette conversation est en cours : celui-ci repasse dans 3 s (jamais deux réponses).
      await enqueueChatTurn(conversationId, { delayMs: CHAT_LOCK_BUSY_RETRY_MS });
      return { conversationId, status: "busy" };
    }
    throw err;
  }
}

// ------------------------------------------------------------------
// Lecture du contexte
// ------------------------------------------------------------------

const personaInclude = {
  affiliateCampaign: { select: { isActive: true, trackingUrlTemplate: true } },
  campaign: { select: { channelIds: true } },
} satisfies Prisma.PersonaInclude;

type PersonaWithOffer = Prisma.PersonaGetPayload<{ include: typeof personaInclude }>;

async function loadConversation(conversationId: string) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      bot: {
        select: {
          id: true,
          name: true,
          username: true,
          mode: true,
          isActive: true,
          personaId: true,
        },
      },
      member: { select: { id: true, telegramUserId: true, languageCode: true } },
    },
  });
}

type ConversationRow = NonNullable<Awaited<ReturnType<typeof loadConversation>>>;

type TurnContext = {
  conv: ConversationRow;
  ref: ConversationRef;
  /** Persona de la conversation (celle du bot au premier message), sinon celle du bot. */
  persona: PersonaWithOffer | null;
  settings: AssistantSettings;
  blocked: boolean;
  /** Nombre de /reset de la conversation au début du tour (un /reset pendant le tour est repéré par la différence). */
  resetsAtStart: number;
  /** Nombre de prises / rendus de main au début du tour (même principe). */
  handoversAtStart: number;
};

async function loadTurnContext(
  conversationId: string,
  resetsAtStart: number,
  handoversAtStart: number,
): Promise<TurnContext | null> {
  const conv = await loadConversation(conversationId);
  if (!conv) return null;
  const personaId = conv.personaId ?? conv.bot.personaId;
  const [persona, settings, botState] = await Promise.all([
    personaId
      ? prisma.persona.findUnique({ where: { id: personaId }, include: personaInclude })
      : Promise.resolve(null),
    loadAssistantSettings(),
    prisma.memberBotState.findUnique({
      where: { memberId_botId: { memberId: conv.memberId, botId: conv.botId } },
      select: { blockedAt: true },
    }),
  ]);
  return {
    conv,
    ref: { id: conv.id, botId: conv.botId, memberId: conv.memberId },
    persona,
    settings,
    blocked: Boolean(botState?.blockedAt),
    resetsAtStart,
    handoversAtStart,
  };
}

/** Dépense IA du mois en cours (Paris), en euros. */
export async function monthSpendEur(now: Date): Promise<number> {
  const agg = await prisma.aiConversationUsage.aggregate({
    _sum: { costEur: true },
    where: { createdAt: { gte: parisMonthStart(now) } },
  });
  return Number(agg._sum.costEur ?? 0);
}

/**
 * Messages de l'assistant partis aujourd'hui (Paris) dans cette conversation (une conversation par bot et par personne).
 * Comptés sur les envois (`OutboundMessage` ASSISTANT partis) et non sur les messages de la conversation : un /reset
 * efface ceux-ci, la limite du jour doit lui survivre. Les messages de l'équipe ne comptent pas.
 */
export async function assistantMessagesSentToday(
  botId: string,
  memberId: string,
  now: Date,
): Promise<number> {
  return prisma.outboundMessage.count({
    where: {
      botId,
      memberId,
      kind: "ASSISTANT",
      status: "SENT",
      sentAt: { gte: parisDayStart(now) },
      NOT: { conversationMessage: { is: { author: "TEAM" } } },
    },
  });
}

/** Dépense IA de cette conversation aujourd'hui (Paris), en euros. */
export async function conversationSpendTodayEur(
  conversationId: string,
  now: Date,
): Promise<number> {
  const agg = await prisma.aiConversationUsage.aggregate({
    _sum: { costEur: true },
    where: { conversationId, createdAt: { gte: parisDayStart(now) } },
  });
  return Number(agg._sum.costEur ?? 0);
}

async function runPrecheck(ctx: TurnContext, now: Date): Promise<PrecheckResult> {
  const { config } = ctx.settings;
  const isTeamMember =
    config.activation === "team"
      ? await isAssistantTeamMember(ctx.conv.member.telegramUserId)
      : false;
  const [assistantMessagesToday, monthSpend, conversationSpend] = await Promise.all([
    assistantMessagesSentToday(ctx.conv.botId, ctx.conv.memberId, now),
    monthSpendEur(now),
    conversationSpendTodayEur(ctx.conv.id, now),
  ]);
  return precheck({
    bot: ctx.conv.bot,
    persona: ctx.persona,
    activation: config.activation,
    isTeamMember,
    conversation: ctx.conv,
    blocked: ctx.blocked,
    assistantMessagesToday,
    dailyLimit: config.perConversationDailyLimit,
    monthSpendEur: monthSpend,
    monthlyCapEur: config.monthlyCapEur,
    conversationSpendTodayEur: conversationSpend,
  });
}

/** Contrôle échoué : événement (une fois par jour au plus) et journal technique. */
async function onPrecheckFailure(
  ctx: TurnContext,
  check: Extract<PrecheckResult, { ok: false }>,
  now: Date,
): Promise<void> {
  if (check.event)
    await recordConversationEventOncePerDay(ctx.ref, {
      type: check.event,
      dayStart: parisDayStart(now),
      payload:
        check.reason === "daily_cost"
          ? {
              costCapEur: conversationDailyCostCapEur(ctx.settings.config.monthlyCapEur),
              day: parisDayKey(now),
            }
          : check.event === "daily_limit"
            ? { limit: ctx.settings.config.perConversationDailyLimit, day: parisDayKey(now) }
            : { capEur: ctx.settings.config.monthlyCapEur, day: parisDayKey(now) },
      at: now,
    });
  logger.info(
    { conversationId: ctx.conv.id, reason: check.reason },
    "assistant : pas de réponse (contrôle avant l'appel)",
  );
}

/** Titre du canal dont la persona est l'assistante : canaux de sa campagne, sinon un canal administré par le bot. */
async function personaChannelTitle(
  persona: PersonaWithOffer,
  botId: string,
): Promise<string | null> {
  const ids = jsonIds(persona.campaign?.channelIds);
  if (ids.length > 0) {
    const channels = await prisma.channel.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
    });
    for (const id of ids) {
      const c = channels.find((x) => x.id === id);
      if (c?.title) return c.title;
    }
  }
  const admin = await prisma.channelBotAdmin.findFirst({
    where: { botId, revokedAt: null, channel: { isActive: true } },
    orderBy: { detectedAt: "asc" },
    select: { channel: { select: { title: true } } },
  });
  return admin?.channel.title ?? null;
}

const historySelect = {
  id: true,
  direction: true,
  author: true,
  text: true,
  media: true,
  meta: true,
  createdAt: true,
} as const;

/** Parties interrompues écartées de l'historique au plus (marge de lecture). */
const INTERRUPTED_MARGIN = 5;

/** Partie de l'assistant dont l'envoi a été interrompu (`meta.interrupted`) ? */
function notInterrupted(r: { direction: string; meta: unknown }): boolean {
  if (r.direction !== "OUT" || !r.meta || typeof r.meta !== "object") return true;
  return (r.meta as { interrupted?: unknown }).interrupted !== true;
}

type HistorySelected = {
  id: string;
  direction: "IN" | "OUT";
  author: "MEMBER" | "ASSISTANT" | "TEAM" | "SYSTEM";
  text: string;
  media: unknown;
  meta?: unknown;
  createdAt: Date;
};

function toHistoryRow(r: HistorySelected): HistoryRow {
  return {
    id: r.id,
    direction: r.direction,
    author: r.author,
    text: r.text,
    media: parseChatMedia(r.media),
    createdAt: r.createdAt,
  };
}

/**
 * Historique AVANT ce tour (sans les messages réclamés par ce tour ni ceux pas encore traités) : 20 derniers messages,
 * et résumé roulant à faire au-delà de 30 messages hors du résumé (repère `meta.summarized` sur le dernier message
 * déjà résumé).
 */
async function loadHistory(conversationId: string, turnId: string) {
  const notThisTurn: Prisma.ConversationMessageWhereInput = {
    conversationId,
    NOT: [
      { direction: "IN", turnId },
      { direction: "IN", turnId: null },
    ],
  };
  // Partie dont l'envoi a été interrompu (peut-être jamais reçue) : jamais présentée à l'IA comme dite. Écartée ici
  // (un filtre JSON dans NOT écarterait aussi les lignes sans ce repère : NULL en SQL).
  const recent = (
    await prisma.conversationMessage.findMany({
      where: notThisTurn,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_LIMIT + INTERRUPTED_MARGIN,
      select: historySelect,
    })
  )
    .filter(notInterrupted)
    .slice(0, HISTORY_LIMIT)
    .reverse()
    .map(toHistoryRow);
  const mark = await prisma.conversationMessage.findFirst({
    where: { conversationId, meta: { path: ["summarized"], equals: true } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  const afterMark: Prisma.ConversationMessageWhereInput = {
    AND: [notThisTurn, ...(mark ? [{ createdAt: { gt: mark.createdAt } }] : [])],
  };
  const count = await prisma.conversationMessage.count({ where: afterMark });
  let plan = summaryPlan([]);
  if (count > SUMMARY_TRIGGER_MESSAGES) {
    const rows = (
      await prisma.conversationMessage.findMany({
        where: afterMark,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: SUMMARY_MAX_MESSAGES + HISTORY_LIMIT,
        select: historySelect,
      })
    )
      .filter(notInterrupted)
      .reverse()
      .map(toHistoryRow);
    plan = summaryPlan(rows);
  }
  return { history: recent.map(toHistoryMessage), plan };
}

function toTurnInbound(m: ClaimedInbound): TurnInbound {
  return { id: m.id, text: m.text, media: m.media, at: m.createdAt };
}

// ------------------------------------------------------------------
// Tour
// ------------------------------------------------------------------

async function runConversationTurn(conversationId: string): Promise<ChatTurnReport> {
  const now = chatRuntime().now();
  const turnId = newTurnId(now);
  let crashed = false;
  try {
    // Comptés AVANT la réclamation : un /reset ou un passage de main qui tombe ensuite est toujours vu par la relecture
    // avant l'envoi.
    const [resetsAtStart, handoversAtStart] = await Promise.all([
      countResets(conversationId),
      countHandovers(conversationId),
    ]);
    const claimed = await claimInbound(conversationId, turnId);
    if (claimed === null) return { conversationId, status: "missing" };
    const ctx = await loadTurnContext(conversationId, resetsAtStart, handoversAtStart);
    if (!ctx) return { conversationId, status: "missing" };
    if (claimed.length === 0) return await followUpPath(ctx, turnId, now);
    return await replyPath(ctx, turnId, claimed, now);
  } catch (err) {
    crashed = true;
    await recoverCrashedTurn(conversationId, turnId, err);
    throw err;
  } finally {
    // Fin normale du tour (avec ou sans réponse) : ses messages ne seront jamais pris pour un tour bloqué.
    if (!crashed)
      await markTurnDone(turnId).catch((err: Error) =>
        logger.warn({ conversationId, err: err.message }, "assistant : fin de tour non marquée"),
      );
  }
}

/**
 * Tour planté (erreur de la base, du réseau…) : une partie déjà partie → tour marqué terminé (jamais deux réponses) ;
 * sinon ses messages sont rendus et repris 30 s plus tard, au plus `MAX_TURN_CRASHES` fois (puis marqués traités).
 * Une erreur ici laisse les messages au balayage (tour bloqué, rendu après 3 min).
 */
async function recoverCrashedTurn(conversationId: string, turnId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  try {
    // Parties restées « en file » : passées en échec (jamais renvoyées) ; seules les parties parties comptent.
    const { sent } = await settleTurnParts(turnId);
    if (sent > 0) {
      await markTurnDone(turnId);
      logger.warn(
        { conversationId, turnId, err: message },
        "assistant : tour planté après un envoi",
      );
      return;
    }
    const r = await releaseCrashedTurn(turnId, MAX_TURN_CRASHES);
    if (r.released > 0) await enqueueChatTurn(conversationId, { delayMs: CRASH_RETRY_DELAY_MS });
    logger.warn(
      { conversationId, turnId, err: message, released: r.released, gaveUp: r.gaveUp },
      "assistant : tour planté avant tout envoi, messages rendus",
    );
  } catch (e) {
    logger.warn(
      { conversationId, turnId, err: message, recoverErr: (e as Error).message },
      "assistant : tour planté, reprise laissée au balayage",
    );
  }
}

async function failureInfo(conversationId: string, lastInboundAt: Date | null) {
  const [lastFailure, sinceInbound, lastNeutral] = await Promise.all([
    prisma.conversationEvent.findFirst({
      where: { conversationId, type: "ai_failed" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.conversationEvent.findMany({
      where: {
        conversationId,
        type: "ai_failed",
        ...(lastInboundAt ? { createdAt: { gt: lastInboundAt } } : {}),
      },
      select: { createdAt: true },
    }),
    prisma.conversationEvent.findFirst({
      where: { conversationId, type: "ai_failed", payload: { path: ["neutral"], equals: true } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    lastFailureAt: lastFailure?.createdAt ?? null,
    retryCount: retryCountSince(sinceInbound, lastInboundAt),
    lastNeutralAt: lastNeutral?.createdAt ?? null,
  };
}

async function replyPath(
  ctx: TurnContext,
  turnId: string,
  claimed: ClaimedInbound[],
  now: Date,
): Promise<ChatTurnReport> {
  const { conv } = ctx;
  const failures = await failureInfo(conv.id, conv.lastInboundAt);
  // Nouvel essai prévu plus tard (panne de l'IA) et aucun nouveau message : on attend l'heure prévue.
  if (
    shouldWaitForRetry({
      retryAt: conv.retryAt,
      now,
      lastFailureAt: failures.lastFailureAt,
      claimedAt: claimed.map((m) => m.createdAt),
    })
  ) {
    await releaseInbound(
      turnId,
      claimed.map((m) => m.id),
    );
    await enqueueChatTurn(conv.id, {
      delayMs: Math.max(0, (conv.retryAt?.getTime() ?? now.getTime()) - now.getTime()),
    });
    return { conversationId: conv.id, status: "waiting_retry", claimed: claimed.length };
  }
  const check = await runPrecheck(ctx, now);
  if (!check.ok) {
    // Filet de la règle 3 : ces messages ne passeront pas par le moteur (limite du jour, plafond, persona désactivée…) ;
    // un âge déclaré y est quand même cherché, la conversation est fermée (aucun message).
    const minor = ctx.conv.isMinor ? null : detectMinorIn(claimed.map((m) => m.text));
    if (minor?.minor) {
      await closeForMinor(ctx, minor.age, now);
      return {
        conversationId: conv.id,
        status: "skipped",
        reason: "minor",
        claimed: claimed.length,
      };
    }
    if (check.release)
      await releaseInbound(
        turnId,
        claimed.map((m) => m.id),
      );
    await onPrecheckFailure(ctx, check, now);
    return {
      conversationId: conv.id,
      status: "skipped",
      reason: check.reason,
      claimed: claimed.length,
    };
  }
  return runAndPersist(ctx, {
    kind: "reply",
    turnId,
    claimed,
    retryCount: failures.retryCount,
    lastNeutralAt: failures.lastNeutralAt,
    followUpCountBefore: conv.followUpCount,
  });
}

/**
 * Âge déclaré trouvé par le filet du worker : conversation marquée mineure et fermée (raison MINOR, sauf fermeture déjà
 * faite), relance et nouvel essai annulés, événements `minor` et `stage_changed`. Aucun message (l'assistante n'avait
 * pas la parole pour ce tour).
 */
async function closeForMinor(ctx: TurnContext, age: number | null, now: Date): Promise<void> {
  const fromStage = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${ctx.conv.id} FOR UPDATE`;
    const cur = await tx.conversation.findUnique({
      where: { id: ctx.conv.id },
      select: {
        status: true,
        stage: true,
        isMinor: true,
        closedAt: true,
        closedReason: true,
        needsHumanAt: true,
        needsHumanReason: true,
      },
    });
    if (!cur || cur.isMinor) return null;
    const alreadyClosed = cur.status === "CLOSED";
    // Casino / Paris : la conversation est aussi signalée à l'équipe (phase 25).
    const flag =
      isAssistantOnlyUniverse(ctx.persona?.universe) && cur.status !== "HUMAN"
        ? mergeNeedsHuman({ at: cur.needsHumanAt, reason: cur.needsHumanReason }, "minor", now)
        : null;
    await tx.conversation.update({
      where: { id: ctx.conv.id },
      data: {
        isMinor: true,
        status: "CLOSED",
        stage: "CLOSED",
        closedAt: alreadyClosed && cur.closedAt ? cur.closedAt : now,
        closedReason: alreadyClosed && cur.closedReason ? cur.closedReason : "MINOR",
        nextFollowUpAt: null,
        retryAt: null,
        takenOverById: null,
        takenOverAt: null,
        ...(flag ? { needsHumanAt: flag.at, needsHumanReason: flag.reason } : {}),
      },
    });
    return { stage: cur.stage as ConversationStage, flagged: Boolean(flag) };
  });
  if (!fromStage) return;
  await recordConversationEvent(ctx.ref, {
    type: "minor",
    payload: { source: "worker", age },
    at: now,
  });
  if (fromStage.flagged)
    await recordConversationEvent(ctx.ref, {
      type: "needs_human",
      payload: { reason: "minor", source: "code" },
      at: now,
    });
  if (fromStage.stage !== "CLOSED")
    await recordConversationEvent(ctx.ref, {
      type: "stage_changed",
      fromStage: fromStage.stage,
      toStage: "CLOSED",
      at: now,
    });
}

async function followUpPath(ctx: TurnContext, turnId: string, now: Date): Promise<ChatTurnReport> {
  const { conv } = ctx;
  // Heure du nouvel essai passée sans message à reprendre : consommée (le balayage ne repasse plus).
  if (conv.retryAt && conv.retryAt.getTime() <= now.getTime())
    await prisma.conversation.updateMany({
      where: { id: conv.id, retryAt: conv.retryAt },
      data: { retryAt: null },
    });
  const decision = followUpDecision({
    now,
    status: conv.status,
    stoppedAt: conv.stoppedAt,
    isMinor: conv.isMinor,
    stage: conv.stage,
    nextFollowUpAt: conv.nextFollowUpAt,
    followUpCount: conv.followUpCount,
    lastAssistantAt: conv.lastAssistantAt,
    lastInboundAt: conv.lastInboundAt,
    followUpsMax: ctx.persona?.followUpsMax ?? 0,
  });
  if (decision.action === "none") return { conversationId: conv.id, status: "nothing" };
  if (decision.action === "cancel" || decision.action === "reschedule") {
    await prisma.conversation.updateMany({
      where: { id: conv.id, nextFollowUpAt: conv.nextFollowUpAt },
      data: { nextFollowUpAt: decision.action === "reschedule" ? decision.at : null },
    });
    return {
      conversationId: conv.id,
      status: decision.action === "cancel" ? "follow_up_cancelled" : "follow_up_rescheduled",
      reason: decision.reason,
    };
  }
  const check = await runPrecheck(ctx, now);
  if (!check.ok) {
    // Relance impossible maintenant (assistant désactivé, plafond, bot bloqué…) : annulée, jamais rattrapée en rafale.
    await prisma.conversation.updateMany({
      where: { id: conv.id, nextFollowUpAt: conv.nextFollowUpAt },
      data: { nextFollowUpAt: null },
    });
    await onPrecheckFailure(ctx, check, now);
    return { conversationId: conv.id, status: "follow_up_cancelled", reason: check.reason };
  }
  // Réclamation par comparaison-échange : une seule relance part, même si deux tâches passent en même temps.
  const cas = await prisma.conversation.updateMany({
    where: {
      id: conv.id,
      status: "BOT",
      stoppedAt: null,
      isMinor: false,
      nextFollowUpAt: { lte: now },
      followUpCount: { equals: conv.followUpCount, lt: 2 },
    },
    data: { followUpCount: { increment: 1 }, nextFollowUpAt: null },
  });
  if (cas.count === 0) return { conversationId: conv.id, status: "nothing" };
  // Nouveaux essais de CETTE relance (pannes de l'IA depuis le dernier message parti) : au plus 3 passages en tout.
  const failures = conv.lastAssistantAt
    ? await prisma.conversationEvent.findMany({
        where: {
          conversationId: conv.id,
          type: "ai_failed",
          createdAt: { gt: conv.lastAssistantAt },
        },
        select: { createdAt: true, payload: true },
      })
    : [];
  return runAndPersist(ctx, {
    kind: "follow_up",
    turnId,
    claimed: [],
    retryCount: followUpRetryCount(failures, conv.lastAssistantAt),
    lastNeutralAt: null,
    followUpCountBefore: conv.followUpCount,
  });
}

type RunArgs = {
  kind: TurnKind;
  turnId: string;
  claimed: ClaimedInbound[];
  retryCount: number;
  lastNeutralAt: Date | null;
  /** Compteur de relances AVANT ce tour (une relance réclamée l'a déjà augmenté en base). */
  followUpCountBefore: number;
};

async function runAndPersist(ctx: TurnContext, args: RunArgs): Promise<ChatTurnReport> {
  const rt = chatRuntime();
  const { conv, settings } = ctx;
  const persona = ctx.persona!;
  const cfg = settings.config;
  if (!conv.personaId)
    await prisma.conversation.update({ where: { id: conv.id }, data: { personaId: persona.id } });
  const offerUsable = Boolean(
    persona.affiliateCampaign?.isActive && persona.affiliateCampaign.trackingUrlTemplate.trim(),
  );
  const [channelTitle, { history, plan }] = await Promise.all([
    personaChannelTitle(persona, conv.botId),
    loadHistory(conv.id, args.turnId),
  ]);
  const modelId = persona.model?.trim() || cfg.defaultModel;
  const input: TurnInput = {
    kind: args.kind,
    persona: toPersonaInput(persona, { offerUsable, channelTitle, botName: conv.bot.name }),
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
      followUpCount: args.followUpCountBefore,
      isMinor: conv.isMinor,
      isFirstAssistantTurn: conv.assistantTurns === 0,
      memberLanguageCode: conv.member.languageCode,
      lastInboundAt: conv.lastInboundAt,
      lastAssistantAt: conv.lastAssistantAt,
      lastNeutralAt: args.lastNeutralAt,
    },
    history,
    inbound: args.claimed.map(toTurnInbound),
    needsSummary: plan.needsSummary,
    summaryMessages: plan.summaryMessages,
    retryCount: args.retryCount,
    // Résumé fait après l'enregistrement du tour (voir plus bas).
    deferSummary: true,
  };
  const sendCtx: SenderContext = {
    conversationId: conv.id,
    botId: conv.botId,
    memberId: conv.memberId,
    chatId: conv.member.telegramUserId,
    turnId: args.turnId,
    pendingOffer: null,
    offerSendsBefore: conv.offerSends,
    resetsAtStart: ctx.resetsAtStart,
    handoversAtStart: ctx.handoversAtStart,
  };
  // Reprise par l'équipe (même rendue depuis), /stop, mineur ou /reset pendant le tour : relu avant le premier envoi ET
  // avant chaque partie.
  const guard = () => conversationGuard(conv.id, ctx.resetsAtStart, ctx.handoversAtStart);
  const sender = createWorkerChatSender(sendCtx, { now: () => rt.now(), guard });
  const deps: TurnDeps = {
    llm: rt.llmFactory(settings.apiKey ?? ""),
    sender,
    now: () => rt.now(),
    sleep: (ms) => rt.sleep(ms),
    random: () => rt.random(),
    createOfferLink: async () => {
      const link = await createAssistantOfferLink({
        conversationId: conv.id,
        personaId: persona.id,
        botId: conv.botId,
        memberId: conv.memberId,
        source: conv.source,
      });
      if (!link) return null;
      sendCtx.pendingOffer = { subId: link.subId, url: link.url };
      return { url: link.url, subId: link.subId };
    },
    beforeSend: async () => {
      // Reprise par l'équipe, /stop, mineur ou /reset pendant la préparation : rien ne part.
      if (!(await guard()).ok) return { abort: true, newInbound: [] };
      // Relance : jamais un message reçu absorbé (il serait traité comme une relance, sans aveu exigé). La personne a
      // écrit pendant la préparation → la relance n'a plus lieu d'être ; un vrai tour de réponse suit.
      if (args.kind === "follow_up")
        return { abort: (await countUnclaimed(conv.id)) > 0, newInbound: [] };
      const more = await claimMoreInbound(conv.id, args.turnId);
      return { abort: false, newInbound: more.map(toTurnInbound) };
    },
    recordUsage: async (u) => {
      await prisma.aiConversationUsage.create({
        data: {
          personaId: persona.id,
          conversationId: conv.id,
          // Copie de la source : le coût reste rattaché à sa source après la suppression de la conversation.
          source: conv.source,
          purpose: u.purpose,
          model: u.model.slice(0, 200),
          inputTokens: Math.max(0, Math.round(u.inputTokens)),
          outputTokens: Math.max(0, Math.round(u.outputTokens)),
          costEur: u.costEur,
          ok: u.ok,
          error: u.error?.slice(0, 200) ?? null,
          attempt: u.attempt,
          requestId: u.requestId?.slice(0, 200) ?? null,
        },
      });
    },
    capReached: async () => (await monthSpendEur(rt.now())) >= cfg.monthlyCapEur,
    costEur: (model, usage, costUsd) => estimateCostEur(model, usage, costUsd, cfg.models),
  };

  const result = await runTurn(input, deps);
  const persisted = await persistTurn(ctx, args, result, sender, plan.markId);
  // Résumé roulant APRÈS l'enregistrement (lien, compteurs, relance déjà écrits) : un échec ou un arrêt ici est sans
  // conséquence.
  if (persisted && result.outcome === "replied" && !result.sendError && plan.needsSummary)
    await summarizeAndStore(ctx, input, deps, plan.markId).catch((err: Error) =>
      logger.warn({ conversationId: conv.id, err: err.message }, "assistant : résumé non fait"),
    );
  return {
    conversationId: conv.id,
    status: "done",
    kind: args.kind,
    outcome: result.outcome,
    claimed: result.inboundUsed.length,
    sent: result.sent.length,
  };
}

// ------------------------------------------------------------------
// Enregistrement du résultat
// ------------------------------------------------------------------

function toConversationUpdate(p: ConversationPatch): Prisma.ConversationUpdateInput {
  const data: Prisma.ConversationUpdateInput = {};
  if (p.stage !== undefined) data.stage = p.stage;
  if (p.styleProfile !== undefined) data.styleProfile = toJsonValue(p.styleProfile);
  if (p.facts !== undefined) data.facts = toJsonValue(p.facts);
  if (p.summary !== undefined) data.summary = p.summary;
  if (p.language !== undefined) data.language = p.language;
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

/** Informations des parties envoyées (modèle, texte fixe, refus, relance, lien) : jamais montrées à la personne. */
function partMeta(
  result: TurnResult,
  kind: TurnKind,
  part: { fixedKey: string | null; offerSubId: string | null },
): Record<string, unknown> {
  return {
    ...(part.fixedKey ? { fixedKey: part.fixedKey } : result.model ? { model: result.model } : {}),
    ...(part.offerSubId ? { offerSubId: part.offerSubId } : {}),
    ...(result.rejected.length > 0 ? { rejected: result.rejected } : {}),
    ...(kind === "follow_up" ? { followUp: true } : {}),
    ...(part.fixedKey === "retryLater" ? { neutral: true } : {}),
  };
}

/** Résumé roulant fait après le tour ; gardé seulement si aucun /reset n'a tout effacé depuis le début du tour. */
async function summarizeAndStore(
  ctx: TurnContext,
  input: TurnInput,
  deps: TurnDeps,
  summaryMarkId: string | null,
): Promise<void> {
  const summary = await summarizeAfterTurn(input, deps);
  if (!summary) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${ctx.conv.id} FOR UPDATE`;
    const resets = await tx.conversationEvent.count({
      where: { conversationId: ctx.conv.id, type: "reset" },
    });
    if (resets > ctx.resetsAtStart) return;
    await tx.conversation.updateMany({ where: { id: ctx.conv.id }, data: { summary } });
    if (summaryMarkId)
      await tx.$executeRaw`
        UPDATE "ConversationMessage" SET "meta" = "meta" || '{"summarized": true}'::jsonb WHERE id = ${summaryMarkId}`;
  });
}

async function persistTurn(
  ctx: TurnContext,
  args: RunArgs,
  result: TurnResult,
  sender: { sentRows: SentRow[]; live: LiveWrites },
  summaryMarkId: string | null,
): Promise<boolean> {
  const rt = chatRuntime();
  const now = rt.now();
  const { conv } = ctx;
  const { sentRows, live } = sender;
  // Étape après l'envoi du lien (déjà écrite par l'envoi) : point de départ de ce qui reste à écrire.
  const before = {
    stage: live.stage?.to ?? conv.stage,
    followUpCount: args.followUpCountBefore,
  };
  const planned = planTurnPersistence({ kind: args.kind, before, result, now, live });
  // Relecture sous verrou de ligne (le /reset et la reprise par l'équipe verrouillent la même ligne) : ce qui a changé
  // pendant le tour n'est jamais défait (voir `reconcileTurnPlan`).
  const applied = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conv.id} FOR UPDATE`;
    const cur = await tx.conversation.findUnique({
      where: { id: conv.id },
      select: {
        status: true,
        stoppedAt: true,
        stage: true,
        lastInboundAt: true,
        needsHumanAt: true,
        needsHumanReason: true,
      },
    });
    if (!cur) return null;
    const [resets, handovers] = await Promise.all([
      tx.conversationEvent.count({ where: { conversationId: conv.id, type: "reset" } }),
      tx.conversationEvent.count({
        where: { conversationId: conv.id, type: { in: [...HANDOVER_EVENT_TYPES] } },
      }),
    ]);
    const reset = resets > ctx.resetsAtStart;
    const memberWrote =
      cur.lastInboundAt !== null &&
      (conv.lastInboundAt === null || cur.lastInboundAt.getTime() > conv.lastInboundAt.getTime());
    const plan = reconcileTurnPlan(
      planned,
      before,
      {
        status: cur.status,
        stoppedAt: cur.stoppedAt,
        stage: cur.stage as ConversationStage,
        reset,
        handedOver: handovers > ctx.handoversAtStart,
        memberWrote,
      },
      args.kind,
    );
    const data = toConversationUpdate(plan.patch);
    // Passage à un humain : heure du premier passage gardée, motif le plus grave retenu (relus sous verrou).
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
    return { plan, reset };
  });
  // Conversation supprimée pendant le tour (membre supprimé à sa demande) : plus rien à écrire.
  if (!applied) {
    if (result.unsentOfferSubId) await dropUnsentOfferLink(result.unsentOfferSubId);
    return false;
  }
  const { plan, reset } = applied;
  for (const e of plan.events) {
    // Plafond atteint pendant le tour : comme avant l'appel, un seul événement par jour.
    if (e.type === "cap_reached")
      await recordConversationEventOncePerDay(ctx.ref, {
        ...e,
        at: now,
        dayStart: parisDayStart(now),
      });
    else await recordConversationEvent(ctx.ref, { ...e, at: now });
  }
  if (plan.releaseIds.length > 0) await releaseInbound(args.turnId, plan.releaseIds);
  // /reset pendant le tour : les messages réclamés d'avant le /reset ont été effacés ; ceux qui restent (écrits après)
  // sont rendus au tour suivant, qui repart d'une conversation vide.
  if (reset) await releaseTurn(args.turnId);
  if (result.unsentOfferSubId) await dropUnsentOfferLink(result.unsentOfferSubId);

  // Parties envoyées : n-ième envoi réussi ↔ n-ième partie du résultat.
  for (let i = 0; i < sentRows.length; i++) {
    const row = sentRows[i]!;
    const part = result.sent[i];
    const meta = partMeta(result, args.kind, {
      fixedKey: part?.fixedKey ?? null,
      offerSubId: row.offerSubId ?? part?.offerSubId ?? null,
    });
    await prisma.conversationMessage
      .update({ where: { id: row.conversationMessageId }, data: { meta: toJsonValue(meta) } })
      .catch(() => undefined);
  }
  // Résumé roulant fait dans le tour (appelant sans `deferSummary`) et gardé : repère sur le dernier message résumé.
  if (result.summary && summaryMarkId && !reset)
    await prisma.$executeRaw`
      UPDATE "ConversationMessage" SET "meta" = "meta" || '{"summarized": true}'::jsonb WHERE id = ${summaryMarkId}`.catch(
      () => undefined,
    );
  await scheduleNext(conv.id, now);
  return !reset;
}

/** Tour suivant : à l'heure du nouvel essai, ou tout de suite s'il reste des messages reçus non traités. */
async function scheduleNext(conversationId: string, now: Date): Promise<void> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { status: true, stoppedAt: true, isMinor: true, retryAt: true },
  });
  if (!c || c.status !== "BOT" || c.stoppedAt || c.isMinor) return;
  if (c.retryAt && c.retryAt.getTime() > now.getTime()) {
    await enqueueChatTurn(conversationId, { delayMs: c.retryAt.getTime() - now.getTime() });
    return;
  }
  if ((await countUnclaimed(conversationId)) > 0) await enqueueChatTurn(conversationId);
}
