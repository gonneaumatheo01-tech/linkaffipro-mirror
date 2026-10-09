import { prisma, type OutboundKind, type Prisma } from "@linkaffipro/db";
import { enqueue } from "./client";

export type DmButton = { text: string; url?: string; callbackData?: string };

export type EnqueueDmInput = {
  botId: string;
  memberId: string;
  /** Chat privé à utiliser si différent du telegramUserId (user_chat_id d'une demande d'adhésion). */
  chatId?: bigint | null;
  kind: OutboundKind;
  /** Texte en HTML Telegram. */
  text: string;
  /** Lignes de boutons (JSON : DmButton[][]). */
  buttons?: DmButton[][];
  sequenceStepId?: string | null;
  postId?: string | null;
  /** Délai avant envoi (ms). */
  delayMs?: number;
};

/**
 * Enregistre un message privé sortant (`OutboundMessage` QUEUED) et l'enfile dans `telegram-send`.
 * Tout message privé passe ici : jamais d'appel direct à sendMessage depuis le site.
 */
export async function enqueueDm(input: EnqueueDmInput): Promise<{ outboundMessageId: string }> {
  const om = await prisma.outboundMessage.create({
    data: {
      botId: input.botId,
      memberId: input.memberId,
      chatId: input.chatId ?? null,
      kind: input.kind,
      text: input.text,
      buttons: (input.buttons ?? []) as unknown as Prisma.InputJsonValue,
      sequenceStepId: input.sequenceStepId ?? null,
      postId: input.postId ?? null,
    },
    select: { id: true },
  });
  await enqueue("telegram-send", { type: "dm", outboundMessageId: om.id }, { jobId: `dm:${om.id}`, delay: input.delayMs ?? 0, attempts: 3, backoff: { type: "exponential", delay: 2000 } });
  return { outboundMessageId: om.id };
}
