import type { Job } from "bullmq";
import type { LandingEventsJob } from "@linkaffipro/queue";
import { writeLandingEvent } from "../landing/events";
import { logger } from "../logger";

/**
 * File `landing-events` (phase 15, pages d'atterrissage) : `event` = une visite, un clic ou une ouverture de Telegram
 * envoyé par une page et mis en file par le site (`/j/_e`), écrit dans `LandingEvent` (`apps/worker/src/landing/`).
 * La suppression des visites plus anciennes que la durée de conservation est faite par la purge de nuit
 * (`maintenance/purge.ts` → `deleteLandingEventsBefore`).
 */
export async function processLandingEvents(job: Job<LandingEventsJob>): Promise<unknown> {
  const data = job.data as LandingEventsJob | undefined;
  if (data?.type === "event") return writeLandingEvent(data.event);
  logger.warn(
    { queue: "landing-events", id: job.id, type: (data as { type?: unknown } | undefined)?.type },
    "type de tâche inconnu",
  );
  return { ok: false, reason: "type de tâche inconnu" };
}

export const repeatableLandingEvents: Array<{
  data: Record<string, unknown>;
  everyMs: number;
  jobId: string;
}> = [];
