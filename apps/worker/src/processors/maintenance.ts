import type { Job } from "bullmq";
import type { MaintenanceJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { runPurge } from "../maintenance/purge";
import { runAlerts } from "../maintenance/alerts";
import { cleanOldFailedJobs } from "../maintenance/clean-failed";
import { runBackupIfDue } from "../backups/run";
import { runLegacyGateRevocation } from "../maintenance/legacy-gate-links";

/**
 * Processeur de la file `maintenance` : purge de rétention (nocturne), alertes (toutes les 5 minutes)
 * purge des tâches échouées de plus de 7 jours (toutes les 24 h), sauvegarde quotidienne (vérifiée toutes les 10 min, faite à 4 h Paris)
 * et révocation des anciens liens des canaux à rejoindre à entrée directe (toutes les heures, 7 jours après la phase 11).
 */
export async function processMaintenance(job: Job<MaintenanceJob>): Promise<unknown> {
  const data = job.data;
  switch (data.type) {
    case "purge":
      return runPurge();
    case "alerts":
      return runAlerts();
    case "clean-failed":
      return cleanOldFailedJobs();
    case "backup":
      return runBackupIfDue();
    case "legacy-gate-links":
      return runLegacyGateRevocation();
    case "tick":
    default:
      logger.info({ queue: "maintenance", id: job.id }, "tick");
      return { ok: true };
  }
}

export const repeatableMaintenance: Array<{
  data: Record<string, unknown>;
  everyMs: number;
  jobId: string;
}> = [
  { data: { type: "purge" }, everyMs: 24 * 60 * 60 * 1000, jobId: "maintenance-purge" },
  { data: { type: "alerts" }, everyMs: 5 * 60 * 1000, jobId: "maintenance-alerts" },
  {
    data: { type: "clean-failed" },
    everyMs: 24 * 60 * 60 * 1000,
    jobId: "maintenance-clean-failed",
  },
  { data: { type: "backup" }, everyMs: 10 * 60 * 1000, jobId: "maintenance-backup" },
  {
    data: { type: "legacy-gate-links" },
    everyMs: 60 * 60 * 1000,
    jobId: "maintenance-legacy-gate-links",
  },
];
