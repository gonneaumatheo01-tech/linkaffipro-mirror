import type { Job, Processor } from "bullmq";
import type { QueueName } from "@linkaffipro/queue";
import { processApprovals, repeatableApprovals } from "./approvals";
import { processScheduler, repeatableScheduler } from "./scheduler";
import { processTelegramSend, repeatableTelegramSend } from "./telegram-send";
import { processSyncLinkaffi, repeatableSyncLinkaffi } from "./sync-linkaffi";
import { processStats, repeatableStats } from "./stats";
import { processMaintenance, repeatableMaintenance } from "./maintenance";
import { processAutomations, repeatableAutomations } from "./automations";
import { processSyncAds, repeatableSyncAds } from "./sync-ads";
import { processSyncViews, repeatableSyncViews } from "./sync-views";

export type Repeatable = { data: Record<string, unknown>; everyMs: number; jobId: string };

export const PROCESSORS: Record<QueueName, { process: Processor; repeatable: Repeatable[]; concurrency: number }> = {
  approvals: { process: (job: Job) => processApprovals(job), repeatable: repeatableApprovals, concurrency: 1 },
  scheduler: { process: (job: Job) => processScheduler(job), repeatable: repeatableScheduler, concurrency: 1 },
  "telegram-send": { process: (job: Job) => processTelegramSend(job), repeatable: repeatableTelegramSend, concurrency: 4 },
  "sync-linkaffi": { process: (job: Job) => processSyncLinkaffi(job), repeatable: repeatableSyncLinkaffi, concurrency: 1 },
  stats: { process: (job: Job) => processStats(job), repeatable: repeatableStats, concurrency: 1 },
  maintenance: { process: (job: Job) => processMaintenance(job), repeatable: repeatableMaintenance, concurrency: 1 },
  automations: { process: (job: Job) => processAutomations(job), repeatable: repeatableAutomations, concurrency: 2 },
  // Un seul appel externe à la fois : quotas des plateformes et un seul client MTProto.
  "sync-ads": { process: (job: Job) => processSyncAds(job), repeatable: repeatableSyncAds, concurrency: 1 },
  "sync-views": { process: (job: Job) => processSyncViews(job), repeatable: repeatableSyncViews, concurrency: 1 },
};
