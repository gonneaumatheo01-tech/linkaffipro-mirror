import type { Job } from "bullmq";
import { logger } from "../logger";

/** Processeur de la file `telegram-send`. À implémenter par le chantier concerné (voir README.md de ce dossier). */
export async function processTelegramSend(job: Job): Promise<unknown> {
  logger.info({ queue: "telegram-send", name: job.name, id: job.id }, "tâche reçue (traitement à venir)");
  return { ok: true };
}

/** Tâches répétitives à planifier au démarrage (laisser vide si aucune). */
export const repeatableTelegramSend: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [];
