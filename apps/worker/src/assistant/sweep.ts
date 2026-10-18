/**
 * Balayage de l'assistant de conversation (tâche `chat` `sweep`, toutes les 30 s ; contrat §5) :
 * - tours bloqués (worker arrêté en plein tour) : messages réclamés depuis plus de 3 min, tour pas terminé, aucune partie
 *   envoyée → rendus et nouveau tour (sous le verrou de la conversation : jamais pendant un tour en cours), au plus
 *   2 fois par message (compteur partagé avec les tours plantés) ;
 * - conversions : une inscription (joueur Link Affi) rattachée à un clic d'une conversation → étape CONVERTED, une
 *   seule fois, événement `converted` ;
 * - seulement si l'assistant est activé : messages reçus non traités depuis plus de 60 s (tâche perdue ; jamais au-delà
 *   de 24 h), heure du nouvel essai après une panne passée, relances dues → tour mis en file (le tour vérifie tout
 *   de nouveau, réclame la relance par comparaison-échange et respecte les heures calmes).
 * Chaque règle traite au plus 50 conversations par passage.
 */
import { prisma } from "@linkaffipro/db";
import { enqueueChatTurn, getRedis, RedisLockBusy, withRedisLock } from "@linkaffipro/queue";
import { isAssistantTeamMember } from "@linkaffipro/telegram";
import { logger } from "../logger";
import { recordConversationEvent } from "./events";
import {
  MAX_TURN_CRASHES,
  STUCK_TURN_AFTER_MS,
  STUCK_TURN_LOOKBACK_MS,
  SWEEP_BATCH,
  UNCLAIMED_AFTER_MS,
  UNCLAIMED_MAX_AGE_MS,
  chatLockKey,
} from "./rules";
import { chatRuntime } from "./runtime";
import { loadAssistantSettings } from "./settings";
import { markTurnDone, releaseCrashedTurn } from "./claim";

export type ChatSweepReport = {
  stuckReleased: number;
  converted: number;
  unclaimed: number;
  retries: number;
  followUps: number;
};

const assistantBot = { mode: "ASSISTANT" as const, isActive: true };

/** Tours bloqués : rendus (aucune partie envoyée) ou marqués terminés (une partie est déjà partie : jamais deux fois). */
export async function releaseStuckTurns(now: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ conversationId: string; turnId: string }>>`
    SELECT DISTINCT m."conversationId", m."turnId"
      FROM "ConversationMessage" m
     WHERE m."direction" = 'IN' AND m."turnId" IS NOT NULL
       AND (m."meta" ->> 'turnDone') IS NULL
       AND m."createdAt" < ${new Date(now.getTime() - STUCK_TURN_AFTER_MS)}
       AND m."createdAt" > ${new Date(now.getTime() - STUCK_TURN_LOOKBACK_MS)}
     LIMIT ${SWEEP_BATCH}`;
  let released = 0;
  for (const r of rows) {
    try {
      await withRedisLock(
        getRedis(),
        chatLockKey(r.conversationId),
        async () => {
          const sent = await prisma.conversationMessage.count({
            where: { turnId: r.turnId, direction: "OUT" },
          });
          if (sent > 0) {
            await markTurnDone(r.turnId);
            return;
          }
          const { released: n } = await releaseCrashedTurn(r.turnId, MAX_TURN_CRASHES);
          if (n > 0) {
            released++;
            await enqueueChatTurn(r.conversationId);
          }
        },
        { ttlMs: 15_000, owner: "worker:chat-sweep" },
      );
    } catch (err) {
      // Tour en cours (verrou pris) : ce n'est pas un tour bloqué.
      if (!(err instanceof RedisLockBusy)) throw err;
    }
  }
  return released;
}

/** Conversions : inscription rattachée à un clic d'une conversation (une seule fois par conversation). */
export async function markConversions(now: Date): Promise<number> {
  const rows = await prisma.conversation.findMany({
    where: { convertedAt: null, clicks: { some: { players: { some: {} } } } },
    select: { id: true, botId: true, memberId: true, stage: true },
    take: SWEEP_BATCH,
  });
  let converted = 0;
  for (const c of rows) {
    const toStage = c.stage === "CLOSED" ? "CLOSED" : "CONVERTED";
    const cas = await prisma.conversation.updateMany({
      where: { id: c.id, convertedAt: null },
      data: {
        convertedAt: now,
        ...(toStage === "CONVERTED" ? { stage: "CONVERTED", nextFollowUpAt: null } : {}),
      },
    });
    if (cas.count === 0) continue;
    converted++;
    const ref = { id: c.id, botId: c.botId, memberId: c.memberId };
    if (toStage !== c.stage)
      await recordConversationEvent(ref, {
        type: "stage_changed",
        fromStage: c.stage,
        toStage,
        at: now,
      });
    await recordConversationEvent(ref, { type: "converted", payload: {}, at: now });
  }
  return converted;
}

/** Conversations à reprendre (activation « équipe » : seulement les comptes de l'équipe). */
async function enqueueAll(
  rows: Array<{ id: string; member: { telegramUserId: bigint } }>,
  teamOnly: boolean,
  seen: Set<string>,
): Promise<number> {
  let n = 0;
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    if (teamOnly && !(await isAssistantTeamMember(r.member.telegramUserId))) continue;
    seen.add(r.id);
    await enqueueChatTurn(r.id);
    n++;
  }
  return n;
}

export async function runChatSweep(now: Date = chatRuntime().now()): Promise<ChatSweepReport> {
  const report: ChatSweepReport = {
    stuckReleased: 0,
    converted: 0,
    unclaimed: 0,
    retries: 0,
    followUps: 0,
  };
  report.stuckReleased = await releaseStuckTurns(now);
  report.converted = await markConversions(now);

  const { config } = await loadAssistantSettings();
  if (config.activation !== "off") {
    const teamOnly = config.activation === "team";
    const open = { status: "BOT" as const, stoppedAt: null, isMinor: false, bot: assistantBot };
    const select = { id: true, member: { select: { telegramUserId: true } } } as const;
    const seen = new Set<string>();
    const unclaimed = await prisma.conversation.findMany({
      where: {
        ...open,
        OR: [{ retryAt: null }, { retryAt: { lte: now } }],
        messages: {
          some: {
            direction: "IN",
            turnId: null,
            createdAt: {
              lt: new Date(now.getTime() - UNCLAIMED_AFTER_MS),
              gt: new Date(now.getTime() - UNCLAIMED_MAX_AGE_MS),
            },
          },
        },
      },
      select,
      take: SWEEP_BATCH,
    });
    report.unclaimed = await enqueueAll(unclaimed, teamOnly, seen);
    const retries = await prisma.conversation.findMany({
      where: { ...open, retryAt: { lte: now } },
      select,
      take: SWEEP_BATCH,
    });
    report.retries = await enqueueAll(retries, teamOnly, seen);
    const followUps = await prisma.conversation.findMany({
      where: { ...open, nextFollowUpAt: { lte: now }, followUpCount: { lt: 2 } },
      select,
      orderBy: { nextFollowUpAt: "asc" },
      take: SWEEP_BATCH,
    });
    // Relances : pas de filtre « équipe » ici, le tour annule lui-même une relance qui ne peut plus partir.
    report.followUps = await enqueueAll(followUps, false, seen);
  }
  if (Object.values(report).some((n) => n > 0)) logger.info(report, "assistant : balayage");
  return report;
}
