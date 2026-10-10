import type { Job } from "bullmq";
import type { SyncViewsJob } from "@linkaffipro/queue";
import { runViewsSync, syncPostViews } from "../views/sync";

/** File `sync-views` : relevé des vues des messages de canal via le compte Telegram connecté (un seul client, jamais en parallèle). */
export async function processSyncViews(job: Job<SyncViewsJob>): Promise<unknown> {
  const data = job.data ?? { type: "tick" };
  if (data.type === "post") return syncPostViews(data.postId);
  return runViewsSync();
}

export const repeatableSyncViews: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "tick" }, everyMs: 15 * 60 * 1000, jobId: "sync-views:tick" },
];
