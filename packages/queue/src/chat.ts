import { enqueue } from "./client";

/** Anti-rebond d'un tour : les messages reçus à la suite (moins de 1,5 s d'écart) sont traités dans le même tour. */
export const CHAT_TURN_DEBOUNCE_MS = 1500;

/**
 * Met en file un tour de l'assistant pour une conversation (phase 17). Déduplication BullMQ `turn-<id>` : une tâche
 * différée est remplacée (minuteur relancé à chaque nouveau message : anti-rebond) ; pendant qu'un tour est en cours,
 * une seule tâche « suivante » est gardée et créée à la fin (`keepLastIfActive`) : jamais deux tours en parallèle pour
 * une conversation. La tâche ne porte que l'identifiant : le worker relit la base (messages entrants non traités,
 * relance due), qui fait foi.
 */
export async function enqueueChatTurn(conversationId: string, opts: { delayMs?: number } = {}): Promise<void> {
  const delay = opts.delayMs ?? CHAT_TURN_DEBOUNCE_MS;
  await enqueue(
    "chat",
    { type: "turn", conversationId },
    { delay, deduplication: { id: `turn-${conversationId}`, extend: true, replace: true, keepLastIfActive: true } },
  );
}
