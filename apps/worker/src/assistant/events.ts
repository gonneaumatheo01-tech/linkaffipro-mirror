/**
 * Événements d'une conversation de l'assistant (contrat §6, « Journal ») : chaque `ConversationEvent` (statistiques du
 * parcours, survit à /reset) est doublé d'un `Event` `conversation.<type>` (membre, bot, famille « Assistant de
 * conversation » du journal). JAMAIS de texte de conversation dans ces événements : seulement des codes, des étapes, des
 * nombres et des identifiants.
 */
import type { ConversationStage } from "@linkaffipro/chat";
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { logger } from "../logger";

export type ConversationRef = { id: string; botId: string; memberId: string };

export type ConversationEventInput = {
  type: string;
  fromStage?: ConversationStage | null;
  toStage?: ConversationStage | null;
  payload?: Record<string, unknown>;
  at?: Date;
};

/** Clés de payload refusées (garde-fou : aucun texte de conversation ne doit finir dans le journal). */
const TEXT_KEYS = new Set([
  "text",
  "texts",
  "message",
  "messages",
  "caption",
  "summary",
  "facts",
  "note",
]);

/** Payload sans texte de conversation (les clés de texte sont retirées). */
export function eventPayload(payload: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload))
    if (!TEXT_KEYS.has(k) && v !== undefined) out[k] = v;
  return out;
}

/** Enregistre un événement de conversation et son double dans le journal. Ne lève jamais. */
export async function recordConversationEvent(
  conv: ConversationRef,
  input: ConversationEventInput,
): Promise<void> {
  const payload = eventPayload(input.payload);
  const at = input.at ?? new Date();
  try {
    await prisma.conversationEvent.create({
      data: {
        conversationId: conv.id,
        type: input.type,
        fromStage: input.fromStage ?? null,
        toStage: input.toStage ?? null,
        payload: toJsonValue(payload),
        createdAt: at,
      },
    });
  } catch (err) {
    logger.warn(
      { conversationId: conv.id, type: input.type, err: (err as Error).message },
      "assistant : événement de conversation non enregistré",
    );
  }
  await recordEvent({
    type: `conversation.${input.type}`,
    occurredAt: at,
    memberId: conv.memberId,
    botId: conv.botId,
    payload: toJsonValue({
      conversationId: conv.id,
      ...(input.fromStage ? { fromStage: input.fromStage } : {}),
      ...(input.toStage ? { toStage: input.toStage } : {}),
      ...payload,
    }),
  });
}

/**
 * Enregistre l'événement au plus une fois par jour (Paris) pour cette conversation (`daily_limit`, `cap_reached` :
 * jamais un événement par message reçu). Renvoie vrai s'il a été enregistré.
 */
export async function recordConversationEventOncePerDay(
  conv: ConversationRef,
  input: ConversationEventInput & { dayStart: Date },
): Promise<boolean> {
  const already = await prisma.conversationEvent.findFirst({
    where: { conversationId: conv.id, type: input.type, createdAt: { gte: input.dayStart } },
    select: { id: true },
  });
  if (already) return false;
  await recordConversationEvent(conv, input);
  return true;
}
