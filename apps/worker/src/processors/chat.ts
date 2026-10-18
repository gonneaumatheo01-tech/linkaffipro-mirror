import type { Job } from "bullmq";
import type { ChatJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { logger } from "../logger";

/**
 * File `chat` (phase 17, assistant de conversation) : branchée à l'étape 3 (`apps/worker/src/assistant/*`). Tant que
 * l'assistant n'est pas branché, une tâche reçue est ignorée (l'assistant est de toute façon désactivé par défaut).
 */
export async function processChat(job: Job<ChatJob>): Promise<{ ok: boolean }> {
  logger.warn({ jobId: job.id, type: job.data.type }, "chat : assistant pas encore branché, tâche ignorée");
  return { ok: false };
}

export const repeatableChat: Repeatable[] = [];
