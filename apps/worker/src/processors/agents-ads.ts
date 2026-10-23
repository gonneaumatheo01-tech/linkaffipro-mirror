import type { Job } from "bullmq";
import type { Repeatable } from "./index";
import { logger } from "../logger";

/** File `agents-ads` (prévue pour l'agent Ads, phase 24) : vide en phase 19 ; tout type de tâche est inconnu. */
export async function processAgentsAds(job: Job): Promise<unknown> {
  logger.warn({ queue: "agents-ads", id: job.id, name: job.name }, "type de tâche inconnu");
  return { ok: false, reason: "type de tâche inconnu" };
}

export const repeatableAgentsAds: Repeatable[] = [];
