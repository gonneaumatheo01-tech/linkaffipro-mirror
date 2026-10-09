import type { Job } from "bullmq";
import { logger } from "../logger";

/** Processeur de la file `scheduler`. À implémenter par le chantier concerné (voir README.md de ce dossier). */
export async function processScheduler(job: Job): Promise<unknown> {
  logger.info({ queue: "scheduler", name: job.name, id: job.id }, "tâche reçue (traitement à venir)");
  return { ok: true };
}

/** Tâches répétitives à planifier au démarrage (laisser vide si aucune). */
export const repeatableScheduler: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [];
