import type { Job } from "bullmq";
import type { ApprovalsJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { runApprovalsTick, runExpirations, runReminderFor, runReminders } from "../approvals/jobs";
import { runGateBackfill, runGateSweep } from "../approvals/gate-sweep";

/**
 * Processeur de la file `approvals` : approbations échues, rappels, expirations ; depuis la phase 14, filet de la
 * validation automatique des canaux obligatoires (2 minutes), rappel d'une demande à l'heure (tâche différée) et
 * rattrapage unique des demandes en attente des canaux. Type inconnu (site déployé avant le worker) : signalé dans
 * les journaux, jamais terminé en silence comme une tâche réussie.
 */
export async function processApprovals(job: Job<ApprovalsJob>): Promise<unknown> {
  const data = (job.data ?? { type: "tick" }) as ApprovalsJob;
  const type = data.type ?? "tick";
  try {
    if (type === "tick") return await runApprovalsTick();
    if (type === "reminders") return { sent: await runReminders() };
    if (type === "expirations") return { expired: await runExpirations() };
    if (data.type === "reminder") return { sent: await runReminderFor(data.membershipId) };
    if (type === "gate-sweep") return await runGateSweep();
    if (data.type === "gate-backfill") return await runGateBackfill({ force: data.force === true });
    logger.warn({ queue: "approvals", id: job.id, data }, "type de tâche inconnu");
    return { ok: false };
  } catch (err) {
    logger.error({ type, err: (err as Error).message }, "approvals : erreur");
    throw err;
  }
}

/** Balayages périodiques. */
export const repeatableApprovals: Array<{
  data: Record<string, unknown>;
  everyMs: number;
  jobId: string;
}> = [
  { data: { type: "tick" }, everyMs: 20_000, jobId: "approvals-tick" },
  { data: { type: "reminders" }, everyMs: 5 * 60_000, jobId: "approvals-reminders" },
  { data: { type: "expirations" }, everyMs: 5 * 60_000, jobId: "approvals-expirations" },
  // Filet de la validation automatique (phase 14) : demandes en attente des canaux de moins de 7 jours.
  { data: { type: "gate-sweep" }, everyMs: 2 * 60_000, jobId: "approvals-gate-sweep" },
];
