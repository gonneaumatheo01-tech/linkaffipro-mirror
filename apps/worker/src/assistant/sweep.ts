/**
 * Balayage de l'assistant de conversation (tâche `chat` `sweep`, toutes les 30 s ; contrat §5) :
 * - tours bloqués (worker arrêté en plein tour) : messages réclamés depuis plus de 3 min (`claimedAt`, indexé), tour pas
 *   terminé ; parties restées « en file » passées en échec (jamais renvoyées) ; aucune partie réellement partie →
 *   messages rendus et nouveau tour (sous le verrou de la conversation : jamais pendant un tour en cours), au plus
 *   2 fois par message (compteur partagé avec les tours plantés) ;
 * - parties de l'assistant restées « en file » plus de 10 min (relance interrompue…) : passées en échec, texte vidé ;
 * - conversions : une inscription (joueur Link Affi) rattachée à un clic d'une conversation → étape CONVERTED, une
 *   seule fois, événement `converted` ;
 * - seulement si l'assistant est activé : messages reçus non traités depuis plus de 60 s (tâche perdue ; jamais au-delà
 *   de 24 h), heure du nouvel essai après une panne passée, relances dues → tour mis en file (le tour vérifie tout
 *   de nouveau, réclame la relance par comparaison-échange et respecte les heures calmes). Activation « équipe » : le
 *   filtre des comptes de l'équipe est fait par la base (jamais 50 prospects lus puis écartés à chaque passage), les plus
 *   anciennes d'abord.
 * - conversations à traiter (Casino / Paris, phase 25) : alerte Telegram groupée, au plus toutes les 30 minutes
 *   (`needs-human-digest.ts`).
 * Chaque règle traite au plus 50 conversations par passage.
 */
import { prisma } from "@linkaffipro/db";
import { enqueueChatTurn, getRedis, RedisLockBusy, withRedisLock } from "@linkaffipro/queue";
import { assistantTeamTelegramIds } from "@linkaffipro/telegram";
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
import { runNeedsHumanDigest } from "./needs-human-digest";
import { loadAssistantSettings } from "./settings";
import { INTERRUPTED_PART_ERROR, markTurnDone, releaseCrashedTurn, settleTurnParts } from "./claim";

export type ChatSweepReport = {
  stuckReleased: number;
  interruptedParts: number;
  converted: number;
  unclaimed: number;
  retries: number;
  followUps: number;
};

const assistantBot = { mode: "ASSISTANT" as const, isActive: true };

/**
 * Tours bloqués : rendus (aucune partie réellement partie) ou marqués terminés (une partie est déjà partie : jamais deux
 * fois). Lecture par l'index de `claimedAt` (seuls les messages d'un tour en cours en ont une).
 */
export async function releaseStuckTurns(now: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ conversationId: string; turnId: string }>>`
    SELECT DISTINCT m."conversationId", m."turnId"
      FROM "ConversationMessage" m
     WHERE m."claimedAt" IS NOT NULL
       AND m."claimedAt" < ${new Date(now.getTime() - STUCK_TURN_AFTER_MS)}
       AND m."claimedAt" > ${new Date(now.getTime() - STUCK_TURN_LOOKBACK_MS)}
       AND m."direction" = 'IN' AND m."turnId" IS NOT NULL
       AND (m."meta" ->> 'turnDone') IS NULL
     LIMIT ${SWEEP_BATCH}`;
  let released = 0;
  for (const r of rows) {
    try {
      await withRedisLock(
        getRedis(),
        chatLockKey(r.conversationId),
        async () => {
          const { sent } = await settleTurnParts(r.turnId);
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

/** Partie « en file » depuis plus de 10 min : jamais une partie en cours d'envoi (le débit attend quelques secondes). */
export const INTERRUPTED_PART_AFTER_MS = 10 * 60_000;

/**
 * Parties de l'assistant restées « en file » (envoi interrompu, par exemple pendant une relance qui n'a pas de message
 * reçu à rendre) : passées en échec, texte vidé, marquées interrompues (hors de l'historique envoyé à l'IA). Les
 * messages de l'équipe (file d'envoi, qui peut attendre) ne sont jamais touchés.
 */
export async function settleInterruptedParts(now: Date): Promise<number> {
  const rows = await prisma.outboundMessage.findMany({
    where: {
      status: "QUEUED",
      kind: "ASSISTANT",
      queuedAt: { lt: new Date(now.getTime() - INTERRUPTED_PART_AFTER_MS) },
      conversationMessage: { is: { author: "ASSISTANT" } },
    },
    select: { id: true, conversationMessage: { select: { id: true } } },
    take: SWEEP_BATCH,
  });
  if (rows.length === 0) return 0;
  const cmIds = rows
    .map((r) => r.conversationMessage?.id)
    .filter((id): id is string => Boolean(id));
  const { count } = await prisma.outboundMessage.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, status: "QUEUED" },
    data: { status: "FAILED", error: INTERRUPTED_PART_ERROR, text: "", buttons: [] },
  });
  if (cmIds.length > 0)
    await prisma.$executeRaw`
      UPDATE "ConversationMessage" SET "meta" = "meta" || '{"interrupted": true}'::jsonb
       WHERE id = ANY(${cmIds}::text[])`;
  return count;
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

/** Conversations à reprendre (une seule mise en file par conversation et par passage). */
async function enqueueAll(rows: Array<{ id: string }>, seen: Set<string>): Promise<number> {
  let n = 0;
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    await enqueueChatTurn(r.id);
    n++;
  }
  return n;
}

export async function runChatSweep(now: Date = chatRuntime().now()): Promise<ChatSweepReport> {
  const report: ChatSweepReport = {
    stuckReleased: 0,
    interruptedParts: 0,
    converted: 0,
    unclaimed: 0,
    retries: 0,
    followUps: 0,
  };
  report.stuckReleased = await releaseStuckTurns(now);
  report.interruptedParts = await settleInterruptedParts(now);
  report.converted = await markConversions(now);
  // Conversations à traiter (Casino / Paris, phase 25) : alerte groupée, au plus toutes les 30 min. Jamais bloquante.
  await runNeedsHumanDigest(now).catch((err: Error) =>
    logger.warn({ err: err.message }, "assistant : alerte des conversations à traiter en échec"),
  );

  const { config } = await loadAssistantSettings();
  if (config.activation !== "off") {
    // « Seulement l'équipe » : filtre fait par la base (jamais les mêmes 50 prospects lus et écartés à chaque passage).
    const team = config.activation === "team" ? await assistantTeamTelegramIds() : null;
    if (team && team.length === 0) {
      if (Object.values(report).some((n) => n > 0)) logger.info(report, "assistant : balayage");
      return report;
    }
    const open = {
      status: "BOT" as const,
      stoppedAt: null,
      isMinor: false,
      bot: assistantBot,
      ...(team ? { member: { telegramUserId: { in: team } } } : {}),
    };
    const select = { id: true } as const;
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
      orderBy: { lastInboundAt: "asc" },
      take: SWEEP_BATCH,
    });
    report.unclaimed = await enqueueAll(unclaimed, seen);
    const retries = await prisma.conversation.findMany({
      where: { ...open, retryAt: { lte: now } },
      select,
      orderBy: { retryAt: "asc" },
      take: SWEEP_BATCH,
    });
    report.retries = await enqueueAll(retries, seen);
    // Relances : sans filtre « équipe », le tour annule lui-même une relance qui ne peut plus partir.
    const followUps = await prisma.conversation.findMany({
      where: { ...open, member: undefined, nextFollowUpAt: { lte: now }, followUpCount: { lt: 2 } },
      select,
      orderBy: { nextFollowUpAt: "asc" },
      take: SWEEP_BATCH,
    });
    report.followUps = await enqueueAll(followUps, seen);
  }
  if (Object.values(report).some((n) => n > 0)) logger.info(report, "assistant : balayage");
  return report;
}
