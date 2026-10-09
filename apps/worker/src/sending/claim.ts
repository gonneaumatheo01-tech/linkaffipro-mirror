import { prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";

/**
 * Réclame atomiquement les messages programmés échus (SCHEDULED → SENDING, `FOR UPDATE SKIP LOCKED`)
 * et enfile un job `post` par message (jobId = post:<id>, donc idempotent). Renvoie les identifiants réclamés.
 */
export async function claimDuePosts(now: Date = new Date(), limit = 50): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Post" SET status = 'SENDING', "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM "Post"
      WHERE status = 'SCHEDULED' AND "scheduledAt" IS NOT NULL AND "scheduledAt" <= ${now}
      ORDER BY "scheduledAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  for (const r of rows) {
    await enqueue("telegram-send", { type: "post", postId: r.id }, { jobId: `post:${r.id}`, attempts: 1 });
  }
  return rows.map((r) => r.id);
}
