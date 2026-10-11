import type { Job } from "bullmq";
import type { CustomEmojiJob } from "@linkaffipro/queue";
import { logger } from "../logger";

/**
 * File `custom-emoji` (phase 12) : aperçus des emojis animés (Bot API), packs installés et état du compte Telegram
 * connecté (MTProto, un seul client à la fois). Squelette du coordinateur : chaque tâche est branchée par les lots de
 * la phase 12 (`apps/worker/src/custom-emoji/`).
 */
export async function processCustomEmoji(job: Job<CustomEmojiJob>): Promise<unknown> {
  const data = job.data ?? { type: "tick" };
  logger.info({ type: data.type }, "tâche custom-emoji pas encore branchée");
  return { skipped: data.type };
}

export const repeatableCustomEmoji: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "tick" }, everyMs: 10 * 60 * 1000, jobId: "custom-emoji:tick" },
];
