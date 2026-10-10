import type { Job } from "bullmq";
import type { SyncAdsJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { syncConnection, syncRates, tickAdsSync } from "../ads/sync";

/** File `sync-ads` : passage horaire sur les comptes publicitaires connectés, taux de change toutes les 6 h. */
export async function processSyncAds(job: Job<SyncAdsJob>): Promise<unknown> {
  const data = job.data ?? { type: "tick" };
  switch (data.type) {
    case "connection":
      return syncConnection(data.connectionId, data.mode);
    case "rates":
      return syncRates().catch((err: Error) => {
        logger.warn({ err: err.message }, "taux de change Link Affi indisponibles");
        return { count: 0 };
      });
    case "tick":
    default:
      return tickAdsSync();
  }
}

export const repeatableSyncAds: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "tick" }, everyMs: 60 * 60 * 1000, jobId: "sync-ads:tick" },
  { data: { type: "rates" }, everyMs: 6 * 60 * 60 * 1000, jobId: "sync-ads:rates" },
];
