import type { Job } from "bullmq";
import type { SyncLinkAffiJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { runSync } from "../sync/linkaffi-sync";

/** File `sync-linkaffi` : un passage incrémental toutes les 2 minutes ; `full: true` force une resynchro complète. */
export async function processSyncLinkaffi(job: Job<SyncLinkAffiJob>): Promise<unknown> {
  const data = job.data ?? { type: "tick" };
  logger.info({ id: job.id, full: data.full === true, tables: data.tables }, "synchro Link Affi : début");
  const results = await runSync({ full: data.full === true, tables: data.tables });
  return { results };
}

export const repeatableSyncLinkaffi: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "tick" }, everyMs: 2 * 60 * 1000, jobId: "sync-linkaffi:tick" },
];
