import type { Job } from "bullmq";
import type { MaintenanceJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { runPurge } from "../maintenance/purge";
import { runAlerts } from "../maintenance/alerts";

/** Processeur de la file `maintenance` : purge de rétention (nocturne) et alertes (toutes les 5 minutes). */
export async function processMaintenance(job: Job<MaintenanceJob>): Promise<unknown> {
  const data = job.data;
  switch (data.type) {
    case "purge":
      return runPurge();
    case "alerts":
      return runAlerts();
    case "tick":
    default:
      logger.info({ queue: "maintenance", id: job.id }, "tick");
      return { ok: true };
  }
}

export const repeatableMaintenance: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "purge" }, everyMs: 24 * 60 * 60 * 1000, jobId: "maintenance-purge" },
  { data: { type: "alerts" }, everyMs: 5 * 60 * 1000, jobId: "maintenance-alerts" },
];
