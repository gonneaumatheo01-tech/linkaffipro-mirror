import type { Job } from "bullmq";
import { logger } from "../logger";

/** Processeur de la file `maintenance` (purge 24 mois, alertes). Chantier E de la phase 2. */
export async function processMaintenance(job: Job): Promise<unknown> {
  logger.info({ queue: "maintenance", name: job.name, id: job.id }, "tâche reçue (traitement à venir)");
  return { ok: true };
}

export const repeatableMaintenance: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [];
