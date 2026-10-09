import { prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";

/** Réclame les envois groupés programmés échus (SCHEDULED → SENDING, `FOR UPDATE SKIP LOCKED`) et enfile leur développement. */
export async function claimDueBroadcasts(now: Date = new Date(), limit = 20): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Broadcast" SET status = 'SENDING', "startedAt" = COALESCE("startedAt", now()), "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM "Broadcast"
      WHERE status = 'SCHEDULED' AND "scheduledAt" IS NOT NULL AND "scheduledAt" <= ${now}
      ORDER BY "scheduledAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  for (const r of rows) {
    await enqueue("scheduler", { type: "broadcast", broadcastId: r.id }, { jobId: `broadcast-${r.id}`, attempts: 3, backoff: { type: "exponential", delay: 5000 } });
  }
  return rows.map((r) => r.id);
}
