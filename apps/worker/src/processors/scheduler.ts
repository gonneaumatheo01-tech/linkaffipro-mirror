import type { Job } from "bullmq";
import type { SchedulerJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { claimDuePosts } from "../sending/claim";
import { claimDueBroadcasts } from "../broadcasts/claim";
import { expandBroadcast } from "../broadcasts/expand";
import { closeFinishedBroadcasts } from "../broadcasts/progress";

/**
 * File `scheduler` : toutes les 30 s, réclame les messages programmés échus et les enfile dans `telegram-send`,
 * réclame les envois groupés échus (développés par un job `broadcast`), et clôture les envois terminés.
 */
export async function processScheduler(job: Job<SchedulerJob>): Promise<unknown> {
  if (job.data?.type === "broadcast") {
    const r = await expandBroadcast(job.data.broadcastId);
    return { broadcast: job.data.broadcastId, ...r };
  }
  const ids = await claimDuePosts();
  if (ids.length > 0) logger.info({ queue: "scheduler", id: job.id, posts: ids }, "messages réclamés");
  const broadcasts = await claimDueBroadcasts().catch((err: Error) => {
    logger.error({ err: err.message }, "réclamation des envois groupés impossible");
    return [] as string[];
  });
  if (broadcasts.length > 0) logger.info({ queue: "scheduler", id: job.id, broadcasts }, "envois groupés réclamés");
  const closed = await closeFinishedBroadcasts().catch(() => [] as string[]);
  if (closed.length > 0) logger.info({ queue: "scheduler", closed }, "envois groupés clôturés");
  return { claimed: ids.length, broadcasts: broadcasts.length, closed: closed.length };
}

export const repeatableScheduler: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "tick" }, everyMs: 30_000, jobId: "scheduler-tick" },
];
