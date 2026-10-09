import type { Job } from "bullmq";
import { logger } from "../logger";
import { claimDuePosts } from "../sending/claim";

/** File `scheduler` : toutes les 30 s, réclame les messages programmés échus et les enfile dans `telegram-send`. */
export async function processScheduler(job: Job): Promise<unknown> {
  const ids = await claimDuePosts();
  if (ids.length > 0) logger.info({ queue: "scheduler", id: job.id, posts: ids }, "messages réclamés");
  return { claimed: ids.length };
}

export const repeatableScheduler: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "tick" }, everyMs: 30_000, jobId: "scheduler-tick" },
];
