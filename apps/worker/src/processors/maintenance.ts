import type { Job } from "bullmq";
import type { MaintenanceJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { runPurge } from "../maintenance/purge";
import { runAlerts } from "../maintenance/alerts";
import { cleanOldFailedJobs } from "../maintenance/clean-failed";
import { runBackupIfDue } from "../backups/run";
import { runLegacyGateRevocation } from "../maintenance/legacy-gate-links";
import { runLandingChatRefresh, runLandingLinkRepair } from "../maintenance/landing";
import { runWebhookRepairWithDb } from "@linkaffipro/telegram";

/**
 * Processeur de la file `maintenance` : purge de rétention (nocturne), alertes (toutes les 5 minutes)
 * purge des tâches échouées de plus de 7 jours (toutes les 24 h), sauvegarde quotidienne (vérifiée toutes les 10 min, faite à 4 h Paris)
 * et révocation des anciens liens des canaux à rejoindre à entrée directe (toutes les heures, 7 jours après la phase 11).
 * Pages d'atterrissage (phase 15) : relecture des titres et photos des canaux (toutes les 5 minutes) et reprise des
 * liens d'invitation des sources (toutes les 10 minutes), voir `../maintenance/landing.ts`.
 * Phase 26 : contrôle des connexions Telegram (webhooks) de nos bots et réparation automatique (toutes les 10 minutes,
 * production seulement), voir `runWebhookRepairWithDb` (`@linkaffipro/telegram`).
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
    case "landing-chats":
      return runLandingChatRefresh();
    case "landing-links":
      return runLandingLinkRepair();
    case "webhook-repair":
      return runWebhookRepairWithDb();
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
  { data: { type: "landing-chats" }, everyMs: 5 * 60 * 1000, jobId: "maintenance-landing-chats" },
  { data: { type: "landing-links" }, everyMs: 10 * 60 * 1000, jobId: "maintenance-landing-links" },
  { data: { type: "webhook-repair" }, everyMs: 10 * 60 * 1000, jobId: "maintenance-webhook-repair" },
];
