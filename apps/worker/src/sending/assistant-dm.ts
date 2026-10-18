/**
 * Messages privés de l'assistant de conversation et de l'équipe dans une conversation (`OutboundMessage` kind ASSISTANT,
 * phase 17) : contrôles faits par l'envoi JUSTE AVANT l'appel à Telegram (après l'attente du débit, qui peut durer), car
 * un message de l'équipe attend dans la file d'envoi :
 * - /stop, âge déclaré de moins de 18 ans ou « Bloquer » par l'équipe pendant l'attente → rien ne part (FAILED, raison
 *   en français) ;
 * - /reset pendant l'attente → message déjà annulé par le /reset (rien ne part) ;
 * - /reset pendant l'envoi lui-même → texte vidé juste après (rien ne survit à « j'ai tout oublié »).
 */
import { prisma } from "@linkaffipro/db";

export type AssistantDmConversation = {
  id: string;
  status: string;
  stoppedAt: Date | null;
  isMinor: boolean;
  closedReason: string | null;
} | null;

/** Pourquoi un message de conversation ne doit plus partir (phrase en français), ou null s'il peut partir. */
export function assistantDmRefusal(conv: AssistantDmConversation): string | null {
  if (!conv) return "Non envoyé : la conversation n'existe plus.";
  if (conv.stoppedAt) return "Non envoyé : la personne a demandé l'arrêt (/stop).";
  if (conv.isMinor) return "Non envoyé : la personne a dit avoir moins de 18 ans.";
  if (conv.status === "CLOSED" && conv.closedReason === "TEAM")
    return "Non envoyé : la conversation a été bloquée par l'équipe.";
  return null;
}

/** Conversation (une par bot et par membre) d'un message de l'assistant ou de l'équipe. */
export async function assistantDmConversation(
  botId: string,
  memberId: string,
): Promise<AssistantDmConversation> {
  return prisma.conversation.findUnique({
    where: { botId_memberId: { botId, memberId } },
    select: { id: true, status: true, stoppedAt: true, isMinor: true, closedReason: true },
  });
}

/** Message encore « en file » (pas annulé par un /reset entre-temps) ? */
export async function stillQueued(outboundMessageId: string): Promise<boolean> {
  const row = await prisma.outboundMessage.findUnique({
    where: { id: outboundMessageId },
    select: { status: true },
  });
  return row?.status === "QUEUED";
}

/** /reset reçu pendant l'envoi : texte et boutons du message parti vidés (jamais gardés après « tout effacer »). */
export async function clearIfResetSince(
  conversationId: string,
  outboundMessageId: string,
  queuedAt: Date,
): Promise<boolean> {
  const reset = await prisma.conversationEvent.findFirst({
    where: { conversationId, type: "reset", createdAt: { gt: queuedAt } },
    select: { id: true },
  });
  if (!reset) return false;
  await prisma.outboundMessage.update({
    where: { id: outboundMessageId },
    data: { text: "", buttons: [] },
  });
  return true;
}
