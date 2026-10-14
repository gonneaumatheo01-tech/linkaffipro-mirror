import type { Job } from "bullmq";
import type { LinkaffiEventsJob } from "@linkaffipro/queue";
import { logger } from "../logger";

/**
 * File `linkaffi-events` (phase 13) : envoi signé des événements des membres d'affiliés à Link Affi
 * (`telegram-events`). Squelette du coordinateur : l'envoi et le passage périodique sont branchés par le lot moteur
 * de la phase 13 (`apps/worker/src/linkaffi-events/`).
 */
export async function processLinkaffiEvents(job: Job<LinkaffiEventsJob>): Promise<unknown> {
  const data = job.data ?? { type: "tick" };
  logger.info({ type: data.type }, "tâche linkaffi-events pas encore branchée");
  return { skipped: data.type };
}

export const repeatableLinkaffiEvents: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "tick" }, everyMs: 60 * 1000, jobId: "linkaffi-events:tick" },
];
