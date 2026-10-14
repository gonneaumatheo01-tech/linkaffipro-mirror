import type { Job } from "bullmq";
import type { LinkaffiEventsJob } from "@linkaffipro/queue";
import { deliverLinkaffiEvent, runLinkaffiEventsTick } from "../linkaffi-events/delivery";

/**
 * File `linkaffi-events` (phase 13) : envoi signé des événements des membres d'affiliés à Link Affi
 * (`telegram-events`). `deliver` : un événement, juste après son enregistrement ; `tick` (chaque minute) : abandon après
 * 24 h, nouveaux essais et événements dont l'ajout à la file a échoué (`apps/worker/src/linkaffi-events/`).
 */
export async function processLinkaffiEvents(job: Job<LinkaffiEventsJob>): Promise<unknown> {
  const data = job.data ?? { type: "tick" };
  switch (data.type) {
    case "deliver":
      return deliverLinkaffiEvent(data.eventId);
    case "tick":
    default:
      return runLinkaffiEventsTick();
  }
}

export const repeatableLinkaffiEvents: Array<{
  data: Record<string, unknown>;
  everyMs: number;
  jobId: string;
}> = [{ data: { type: "tick" }, everyMs: 60 * 1000, jobId: "linkaffi-events:tick" }];
