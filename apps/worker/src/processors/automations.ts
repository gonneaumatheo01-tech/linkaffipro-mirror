import type { Job } from "bullmq";
import { logger } from "../logger";

/** Processeur de la file `automations` (règles « si… alors… »). Chantier automatisations de la phase 3. */
export async function processAutomations(job: Job): Promise<unknown> {
  logger.info({ queue: "automations", name: job.name, id: job.id }, "tâche reçue (traitement à venir)");
  return { ok: true };
}

export const repeatableAutomations: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [];
