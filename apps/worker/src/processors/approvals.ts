import type { Job } from "bullmq";
import { logger } from "../logger";

/** Processeur de la file `approvals`. À implémenter par le chantier concerné (voir README.md de ce dossier). */
export async function processApprovals(job: Job): Promise<unknown> {
  logger.info({ queue: "approvals", name: job.name, id: job.id }, "tâche reçue (traitement à venir)");
  return { ok: true };
}

/** Tâches répétitives à planifier au démarrage (laisser vide si aucune). */
export const repeatableApprovals: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [];
