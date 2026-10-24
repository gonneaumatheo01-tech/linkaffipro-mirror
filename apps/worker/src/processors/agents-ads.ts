import type { Job } from "bullmq";
import { runAdsReportNow, runAdsTick } from "@linkaffipro/agents";
import type { AgentsAdsJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { logger } from "../logger";
import { workerAgentsDeps } from "../agents/deps";

/**
 * File `agents-ads` (Agent Ads, phase 24) : il recommande, il n'agit jamais chez Meta / TikTok.
 * - `tick` toutes les 30 minutes : alertes (dépense anormale, chute des inscriptions, coût trop élevé, budget atteint),
 *   puis rapport du jour (à partir de 9 h Paris, après celui du Grand Chef) et, le lundi, celui de la semaine ;
 * - `report-now` : rapport tout de suite (`pnpm agents:report-now --team ads --queue`).
 */
export async function processAgentsAds(job: Job<AgentsAdsJob>): Promise<unknown> {
  const data = job.data as AgentsAdsJob | undefined;
  if (data?.type === "tick") return runAdsTick(workerAgentsDeps());
  if (data?.type === "report-now") return runAdsReportNow(workerAgentsDeps(), { kind: data.kind ?? "daily", send: data.send !== false });
  logger.warn({ queue: "agents-ads", id: job.id, name: job.name }, "type de tâche inconnu");
  return { ok: false, reason: "type de tâche inconnu" };
}

export const repeatableAgentsAds: Repeatable[] = [{ data: { type: "tick" }, everyMs: 30 * 60_000, jobId: "agents-ads-tick" }];
