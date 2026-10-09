import type { Job } from "bullmq";
import type { TelegramSendJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { sendDm } from "../sending/send-dm";
import { deletePost, sendPost } from "../sending/send-post";

/** File `telegram-send` : tout envoi vers Telegram (messages de canal, messages privés, suppressions). */
export async function processTelegramSend(job: Job<TelegramSendJob>): Promise<unknown> {
  const data = job.data;
  switch (data.type) {
    case "post":
      await sendPost(data.postId);
      return { ok: true };
    case "dm":
      await sendDm(data.outboundMessageId);
      return { ok: true };
    case "delete-post":
      await deletePost(data.postId);
      return { ok: true };
    case "approve":
    case "decline":
      // Les approbations sont traitées par la file `approvals` (chantier A).
      logger.info({ queue: "telegram-send", id: job.id, type: data.type }, "tâche d'approbation reçue : traitée par la file approvals");
      return { ok: true, skipped: true };
    default:
      logger.warn({ queue: "telegram-send", id: job.id, data }, "type de tâche inconnu");
      return { ok: false };
  }
}

export const repeatableTelegramSend: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [];
