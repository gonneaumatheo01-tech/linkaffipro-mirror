import { prisma } from "@linkaffipro/db";
import { enqueue } from "@linkaffipro/queue";
import { agentPostDecision } from "./agent-hold";

/**
 * Réclame atomiquement les messages programmés échus (SCHEDULED → SENDING, `FOR UPDATE SKIP LOCKED`)
 * et enfile un job `post` par message (jobId = post:<id>, donc idempotent). Renvoie les identifiants réclamés.
 * Un message déjà essayé (`attempts` > 0 : échec puis reprogrammé, ou reprise après une attente imposée par Telegram)
 * reçoit le jobId post:<id>:<attempts> : BullMQ garde les 1000 dernières tâches terminées et ignorerait sinon le nouvel
 * ajout (même identifiant), laissant le message « en cours d'envoi » pour toujours.
 */
export async function claimDuePosts(now: Date = new Date(), limit = 50): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; attempts?: number | null; agentMissionId?: string | null; channelId: string; botId?: string | null }>>`
    UPDATE "Post" SET status = 'SENDING', "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM "Post"
      WHERE status = 'SCHEDULED' AND "scheduledAt" IS NOT NULL AND "scheduledAt" <= ${now}
      ORDER BY "scheduledAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, attempts, "agentMissionId", "channelId", "botId"`;
  const claimed: string[] = [];
  for (const r of rows) {
    // Message d'agent : équipe en pause → retenu ; équipe repassée en simulation → annulé (jamais envoyé).
    if ((await agentPostDecision(r, now)) !== "send") continue;
    claimed.push(r.id);
    const jobId = r.attempts && r.attempts > 0 ? `post:${r.id}:${r.attempts}` : `post:${r.id}`;
    await enqueue("telegram-send", { type: "post", postId: r.id }, { jobId, attempts: 1 });
  }
  return claimed;
}
