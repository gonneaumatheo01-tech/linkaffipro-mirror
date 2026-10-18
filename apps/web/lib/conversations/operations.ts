/**
 * Reprise en main d'une conversation par l'équipe (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 6) :
 * « Prendre la main », « Rendre à l'assistante », envoi d'un message par l'équipe, « Fermer », « Bloquer ».
 *
 * - Chaque changement se fait sous verrou de la ligne de la conversation (`SELECT … FOR UPDATE`, comme le /reset et
 *   la fin d'un tour de l'assistant) : jamais deux décisions croisées.
 * - L'assistante se tait dès que l'équipe a la main : le worker relit le statut avant chaque envoi.
 * - En rendant la main, les messages reçus pendant la reprise sont marqués traités (`turnId = team-<horodatage>`,
 *   `meta.turnDone`) : l'assistante ne répond jamais à de vieux messages (le balayage ne les reprend pas).
 * - Message de l'équipe : `ConversationMessage` OUT (auteur TEAM, membre de l'équipe) + `OutboundMessage` ASSISTANT
 *   par `enqueueDm` (texte échappé en HTML, même file d'envoi : 1 message/s, 429, blocages) ; l'équipe prend la main
 *   AVANT que le message parte. Refusé après /stop, pour un mineur, une conversation bloquée ou une personne qui a
 *   bloqué le bot.
 * - Chaque événement de conversation (sans texte) est doublé d'un `Event` `conversation.<type>` ; chaque action est
 *   journalisée dans `AuditLog` (`conversation.*`) par l'appelant.
 */
import { nextFollowUpAt } from "@linkaffipro/chat";
import { escapeHtml } from "@linkaffipro/core";
import {
  audit,
  prisma,
  recordEvent,
  toJsonValue,
  type ConversationStage,
  type ConversationStatus,
  type Prisma,
} from "@linkaffipro/db";
import { enqueueDm } from "@linkaffipro/queue";
import { assistantWord, TEAM_CLOSED_REASON } from "./labels";
import { underTurnLock, type TurnLockOutcome } from "./turn-lock";
import {
  busyRefusal,
  checkTeamText,
  conversationActions,
  isReopenableByTeam,
  lastSentAt,
  refusalFor,
  reopenStage,
  teamTurnId,
  type ConversationRuleInput,
} from "./rules";

export type TeamUser = { id: string; name: string };
/** Verrou du tour de l'assistante (remplaçable dans les tests). */
export type TurnLock = <T>(
  conversationId: string,
  fn: () => Promise<T>,
) => Promise<TurnLockOutcome<T>>;

export type OperationResult = { ok: true; message: string } | { ok: false; error: string };

type PendingEvent = {
  type: string;
  fromStage?: ConversationStage | null;
  toStage?: ConversationStage | null;
  payload?: Record<string, unknown>;
};

type Locked = {
  id: string;
  botId: string;
  memberId: string;
  status: ConversationStatus;
  stage: ConversationStage;
  closedReason: string | null;
  stoppedAt: Date | null;
  isMinor: boolean;
  assistantTurns: number;
  followUpCount: number;
  lastAssistantAt: Date | null;
  persona: { gender: string; followUpAfterHours: number; followUpsMax: number } | null;
  bot: { isActive: boolean };
};

const NOT_FOUND =
  "Cette conversation n'existe plus (la personne a peut-être été supprimée à sa demande).";

/** Verrouille la conversation et relit son état (null : introuvable). */
async function lock(tx: Prisma.TransactionClient, id: string): Promise<Locked | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Conversation" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      botId: true,
      memberId: true,
      status: true,
      stage: true,
      closedReason: true,
      stoppedAt: true,
      isMinor: true,
      assistantTurns: true,
      followUpCount: true,
      lastAssistantAt: true,
      persona: { select: { gender: true, followUpAfterHours: true, followUpsMax: true } },
      bot: { select: { isActive: true } },
    },
  });
}

async function ruleInputOf(
  tx: Prisma.TransactionClient,
  c: Locked,
): Promise<ConversationRuleInput> {
  const state = await tx.memberBotState.findUnique({
    where: { memberId_botId: { memberId: c.memberId, botId: c.botId } },
    select: { blockedAt: true },
  });
  return {
    status: c.status,
    stoppedAt: c.stoppedAt,
    isMinor: c.isMinor,
    closedReason: c.closedReason,
    memberBlocked: Boolean(state?.blockedAt),
    botActive: c.bot.isActive,
  };
}

/** Étape d'une conversation fermée par l'équipe, à sa réouverture (avant le dernier passage vers « Fermée »). */
async function stageOnReopen(tx: Prisma.TransactionClient, c: Locked): Promise<ConversationStage> {
  if (c.stage !== "CLOSED") return c.stage;
  const lastClose = await tx.conversationEvent.findFirst({
    where: { conversationId: c.id, type: "stage_changed", toStage: "CLOSED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { fromStage: true },
  });
  return reopenStage({
    stageBeforeClose: lastClose?.fromStage ?? null,
    assistantTurns: c.assistantTurns,
  });
}

/** Écrit les événements de conversation dans la transaction. */
async function writeEvents(
  tx: Prisma.TransactionClient,
  conversationId: string,
  events: PendingEvent[],
  at: Date,
): Promise<void> {
  for (const e of events)
    await tx.conversationEvent.create({
      data: {
        conversationId,
        type: e.type,
        fromStage: e.fromStage ?? null,
        toStage: e.toStage ?? null,
        payload: toJsonValue(e.payload ?? {}),
        createdAt: at,
      },
    });
}

/** Doubles des événements dans le journal (`conversation.<type>`, sans aucun texte), après la transaction. */
async function journal(
  c: { id: string; botId: string; memberId: string },
  events: PendingEvent[],
  at: Date,
): Promise<void> {
  for (const e of events)
    await recordEvent({
      type: `conversation.${e.type}`,
      occurredAt: at,
      memberId: c.memberId,
      botId: c.botId,
      payload: toJsonValue({
        conversationId: c.id,
        ...(e.fromStage ? { fromStage: e.fromStage } : {}),
        ...(e.toStage ? { toStage: e.toStage } : {}),
        ...(e.payload ?? {}),
      }),
    });
}

/** Passage à l'équipe (statut HUMAN), en rouvrant une conversation fermée par l'équipe. */
async function becomeHuman(
  tx: Prisma.TransactionClient,
  c: Locked,
  user: TeamUser,
  now: Date,
  via: "button" | "message",
): Promise<PendingEvent[]> {
  const reopen = isReopenableByTeam(c);
  const stage = reopen ? await stageOnReopen(tx, c) : c.stage;
  await tx.conversation.update({
    where: { id: c.id },
    data: {
      status: "HUMAN",
      takenOverById: user.id,
      takenOverAt: now,
      nextFollowUpAt: null,
      retryAt: null,
      ...(reopen ? { closedAt: null, closedReason: null } : {}),
      ...(stage !== c.stage ? { stage } : {}),
    },
  });
  const events: PendingEvent[] = [
    { type: "taken_over", payload: { fromStatus: c.status, via, teamUserId: user.id } },
  ];
  if (stage !== c.stage) events.push({ type: "stage_changed", fromStage: c.stage, toStage: stage });
  return events;
}

type Outcome<T> =
  { ok: true; conv: Locked; events: PendingEvent[]; extra: T } | { ok: false; error: string };

/** Exécute une décision sous verrou ; les événements sont écrits dans la même transaction. */
async function decide<T>(
  id: string,
  now: Date,
  run: (
    tx: Prisma.TransactionClient,
    c: Locked,
    rules: ConversationRuleInput,
  ) => Promise<{ ok: true; events: PendingEvent[]; extra: T } | { ok: false; error: string }>,
): Promise<Outcome<T>> {
  return prisma.$transaction(async (tx) => {
    const c = await lock(tx, id);
    if (!c) return { ok: false as const, error: NOT_FOUND };
    const rules = await ruleInputOf(tx, c);
    const r = await run(tx, c, rules);
    if (!r.ok) return r;
    await writeEvents(tx, c.id, r.events, now);
    return { ok: true as const, conv: c, events: r.events, extra: r.extra };
  });
}

/** « Prendre la main » : l'assistante se tait pour cette conversation, l'équipe écrit elle-même. */
export async function takeOverConversation(
  id: string,
  user: TeamUser,
  now = new Date(),
): Promise<OperationResult> {
  const r = await decide(id, now, async (tx, c, rules) => {
    if (!conversationActions(rules).takeOver)
      return { ok: false, error: refusalFor("takeOver", rules, assistantWord(c.persona?.gender)) };
    return { ok: true, events: await becomeHuman(tx, c, user, now, "button"), extra: null };
  });
  if (!r.ok) return r;
  await journal(r.conv, r.events, now);
  await audit({
    userId: user.id,
    action: "conversation.taken_over",
    entityType: "Conversation",
    entityId: id,
    metadata: { fromStatus: r.conv.status },
  });
  return {
    ok: true,
    message: `Vous avez la main : ${assistantWord(r.conv.persona?.gender)} ne répond plus dans cette conversation.`,
  };
}

/**
 * « Rendre à l'assistante » : statut BOT ; les messages reçus pendant la reprise sont marqués traités (aucune réponse
 * en retard) ; la prochaine relance repart de maintenant (jamais une relance immédiate en rendant la main), et seulement
 * si le dernier message est parti vers la personne (un message de la personne resté sans réponse : pas de relance).
 * Ce dernier message parti (souvent celui de l'équipe) devient le « dernier message de l'assistante » pour le worker
 * (`lastAssistantAt`) : sans lui, la relance serait annulée à l'échéance (« la personne a écrit depuis »).
 *
 * Sous le verrou du tour (`underTurnLock`) : un tour commencé avant la prise de main se termine d'abord (il voit
 * l'équipe aux commandes et se tait), jamais une réponse préparée qui partirait après le message de l'équipe.
 */
export async function releaseConversation(
  id: string,
  user: TeamUser,
  now = new Date(),
  opts: { lock?: TurnLock } = {},
): Promise<OperationResult> {
  const lock = opts.lock ?? underTurnLock;
  const locked = await lock(id, () => releaseUnderLock(id, user, now));
  if (locked.busy) {
    const c = await prisma.conversation.findUnique({
      where: { id },
      select: { persona: { select: { gender: true } } },
    });
    return { ok: false, error: busyRefusal(c?.persona?.gender) };
  }
  return locked.value;
}

async function releaseUnderLock(id: string, user: TeamUser, now: Date): Promise<OperationResult> {
  const r = await decide(id, now, async (tx, c, rules) => {
    const word = assistantWord(c.persona?.gender);
    if (!conversationActions(rules).release)
      return { ok: false, error: refusalFor("release", rules, word) };
    const turnId = teamTurnId(now);
    const marked = await tx.$executeRaw`
      UPDATE "ConversationMessage"
         SET "turnId" = ${turnId}, "meta" = "meta" || '{"turnDone": true}'::jsonb
       WHERE "conversationId" = ${c.id} AND "direction" = 'IN' AND "turnId" IS NULL`;
    const reopen = isReopenableByTeam(c);
    const stage = reopen ? await stageOnReopen(tx, c) : c.stage;
    // Relance seulement si la personne se tait après le dernier message parti (l'équipe ou l'assistante) ; si son
    // message attend encore une réponse, aucune relance n'est programmée : l'assistante attend qu'elle réécrive.
    const last = await tx.conversationMessage.findFirst({
      where: { conversationId: c.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { direction: true, createdAt: true },
    });
    const lastOutAt =
      last?.direction === "OUT" ? lastSentAt(c.lastAssistantAt, last.createdAt) : null;
    const followUp =
      c.persona && lastOutAt
        ? nextFollowUpAt(
            {
              status: "BOT",
              stage,
              isMinor: c.isMinor,
              stoppedAt: c.stoppedAt,
              followUpCount: c.followUpCount,
              lastAssistantAt: now,
            },
            {
              followUpAfterHours: c.persona.followUpAfterHours,
              followUpsMax: c.persona.followUpsMax,
            },
          )
        : null;
    await tx.conversation.update({
      where: { id: c.id },
      data: {
        status: "BOT",
        takenOverById: null,
        takenOverAt: null,
        retryAt: null,
        nextFollowUpAt: followUp,
        ...(lastOutAt ? { lastAssistantAt: lastOutAt } : {}),
        ...(reopen ? { closedAt: null, closedReason: null } : {}),
        ...(stage !== c.stage ? { stage } : {}),
      },
    });
    const events: PendingEvent[] = [
      {
        type: "released",
        payload: { fromStatus: c.status, markedInbound: marked, teamUserId: user.id },
      },
    ];
    if (stage !== c.stage)
      events.push({ type: "stage_changed", fromStage: c.stage, toStage: stage });
    return {
      ok: true,
      events,
      extra: { marked, word, pronoun: c.persona?.gender === "M" ? "il" : "elle" },
    };
  });
  if (!r.ok) return r;
  await journal(r.conv, r.events, now);
  await audit({
    userId: user.id,
    action: "conversation.released",
    entityType: "Conversation",
    entityId: id,
    metadata: { fromStatus: r.conv.status, markedInbound: r.extra.marked },
  });
  const { word, pronoun } = r.extra;
  return {
    ok: true,
    message:
      r.extra.marked > 0
        ? `Conversation rendue à ${word} : ${pronoun} répondra aux prochains messages, pas à ceux reçus pendant que vous aviez la main.`
        : `Conversation rendue à ${word} : ${pronoun} répondra aux prochains messages.`,
  };
}

/** Fermeture par l'équipe : « Fermer » (TEAM_CLOSED, réversible) ou « Bloquer » (TEAM, définitif). */
async function closeAs(
  id: string,
  user: TeamUser,
  now: Date,
  kind: "close" | "block",
): Promise<OperationResult> {
  const r = await decide(id, now, async (tx, c, rules) => {
    if (!conversationActions(rules)[kind])
      return { ok: false, error: refusalFor(kind, rules, assistantWord(c.persona?.gender)) };
    await tx.conversation.update({
      where: { id: c.id },
      data: {
        status: "CLOSED",
        closedAt: now,
        closedReason: kind === "block" ? "TEAM" : TEAM_CLOSED_REASON,
        stage: "CLOSED",
        nextFollowUpAt: null,
        retryAt: null,
        takenOverById: null,
        takenOverAt: null,
      },
    });
    const events: PendingEvent[] = [];
    if (c.stage !== "CLOSED")
      events.push({ type: "stage_changed", fromStage: c.stage, toStage: "CLOSED" });
    events.push({
      type: kind === "block" ? "blocked" : "closed",
      payload: { byTeam: true, fromStatus: c.status, teamUserId: user.id },
    });
    return { ok: true, events, extra: null };
  });
  if (!r.ok) return r;
  await journal(r.conv, r.events, now);
  await audit({
    userId: user.id,
    action: kind === "block" ? "conversation.blocked" : "conversation.closed",
    entityType: "Conversation",
    entityId: id,
    metadata: { fromStatus: r.conv.status, fromStage: r.conv.stage },
  });
  return {
    ok: true,
    message:
      kind === "block"
        ? "Conversation bloquée : plus aucun message ne partira vers cette personne."
        : "Conversation fermée. Vous pouvez la rouvrir en prenant la main ou en écrivant.",
  };
}

/** « Fermer » : la conversation est terminée (ni réponse ni relance) ; l'équipe peut la rouvrir. */
export function closeConversation(id: string, user: TeamUser, now = new Date()) {
  return closeAs(id, user, now, "close");
}

/** « Bloquer » : plus aucun message ne part vers cette personne, définitivement. */
export function blockConversation(id: string, user: TeamUser, now = new Date()) {
  return closeAs(id, user, now, "block");
}

/**
 * Message écrit par l'équipe : l'équipe prend la main d'abord (si l'assistante l'avait), puis le message part par la
 * file d'envoi des messages privés et apparaît dans le fil (et dans l'historique envoyé à l'IA ensuite).
 */
export async function sendTeamMessage(
  id: string,
  user: TeamUser,
  rawText: unknown,
  now = new Date(),
): Promise<OperationResult & { tookOver?: boolean }> {
  const checked = checkTeamText(rawText);
  if (!checked.ok) return checked;
  const text = checked.text;
  const r = await decide(id, now, async (tx, c, rules) => {
    if (!conversationActions(rules).send)
      return { ok: false, error: refusalFor("send", rules, assistantWord(c.persona?.gender)) };
    const events = c.status === "HUMAN" ? [] : await becomeHuman(tx, c, user, now, "message");
    return { ok: true, events, extra: { tookOver: c.status !== "HUMAN" } };
  });
  if (!r.ok) return r;
  await journal(r.conv, r.events, now);
  let outboundMessageId: string;
  try {
    ({ outboundMessageId } = await enqueueDm({
      botId: r.conv.botId,
      memberId: r.conv.memberId,
      kind: "ASSISTANT",
      text: escapeHtml(text),
    }));
  } catch (err) {
    console.error("[conversations] message de l'équipe non mis en file", err);
    return {
      ok: false,
      error: r.extra.tookOver
        ? "Vous avez la main, mais le message n'a pas pu partir. Réessayez dans un instant."
        : "Le message n'a pas pu partir. Réessayez dans un instant.",
    };
  }
  try {
    await prisma.conversationMessage.create({
      data: {
        conversationId: r.conv.id,
        direction: "OUT",
        author: "TEAM",
        teamUserId: user.id,
        text,
        outboundMessageId,
        createdAt: now,
      },
    });
  } catch (err) {
    // Conversation supprimée entre-temps (membre supprimé à sa demande) : le message part quand même, sans fil.
    console.error("[conversations] message de l'équipe non gardé dans le fil", err);
  }
  await audit({
    userId: user.id,
    action: "conversation.message_sent",
    entityType: "Conversation",
    entityId: id,
    metadata: { length: [...text].length, outboundMessageId, tookOver: r.extra.tookOver },
  });
  return {
    ok: true,
    tookOver: r.extra.tookOver,
    message: r.extra.tookOver
      ? `Message envoyé. Vous avez maintenant la main : ${assistantWord(r.conv.persona?.gender)} ne répond plus dans cette conversation.`
      : "Message envoyé.",
  };
}
