import type { Job } from "bullmq";
import type { ChatJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { refreshAssistantModels } from "../assistant/settings";
import { runChatSweep } from "../assistant/sweep";
import { processChatTurn } from "../assistant/turn";
import { logger } from "../logger";

/**
 * File `chat` (phase 17, assistant de conversation, contrat docs/ASSISTANT-CONVERSATION.md §5) :
 * - `turn` : un tour d'une conversation (réponse aux messages reçus, ou relance due), sous le verrou de la conversation
 *   (`apps/worker/src/assistant/turn.ts`) ;
 * - `sweep` : balayage toutes les 30 s (messages non traités, tours bloqués, nouvel essai après une panne de l'IA,
 *   relances dues, conversions) ;
 * - `refresh-models` : liste des modèles Venice et leurs prix, toutes les 24 h (cache du réglage `assistant.venice`).
 * L'assistant est désactivé par défaut : tant qu'un ADMIN ne l'a pas activé, aucun tour n'appelle l'IA.
 */
export async function processChat(job: Job<ChatJob>): Promise<unknown> {
  const data = job.data as ChatJob | undefined;
  switch (data?.type) {
    case "turn":
      return processChatTurn(data.conversationId);
    case "sweep":
      return runChatSweep();
    case "refresh-models":
      return refreshAssistantModels();
    default:
      logger.warn(
        { queue: "chat", id: job.id, type: (data as { type?: unknown } | undefined)?.type },
        "type de tâche inconnu",
      );
      return { ok: false, reason: "type de tâche inconnu" };
  }
}

export const repeatableChat: Repeatable[] = [
  { data: { type: "sweep" }, everyMs: 30_000, jobId: "chat-sweep" },
  { data: { type: "refresh-models" }, everyMs: 24 * 60 * 60 * 1000, jobId: "chat-refresh-models" },
];
