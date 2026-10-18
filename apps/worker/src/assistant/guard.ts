/**
 * Relecture de la conversation pendant un tour de l'assistant (contrat §4 et §5) : avant chaque message envoyé, l'assistant
 * vérifie qu'il a encore la parole (statut BOT, ni /stop ni mineur) et qu'aucun /reset n'a tout effacé depuis le début
 * du tour. Le /reset est repéré par le nombre d'événements `reset` de la conversation (jamais supprimés), sans comparer
 * des heures de deux machines différentes.
 */
import { prisma } from "@linkaffipro/db";
import { guardVerdict, type GuardVerdict } from "./rules";

/** Nombre de /reset reçus par la conversation depuis sa création. */
export async function countResets(conversationId: string): Promise<number> {
  return prisma.conversationEvent.count({ where: { conversationId, type: "reset" } });
}

/** L'assistant peut-il encore envoyer dans ce tour ? (`resetsAtStart` null : pas de contrôle du /reset). */
export async function conversationGuard(
  conversationId: string,
  resetsAtStart: number | null,
): Promise<GuardVerdict> {
  const [conv, resets] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { status: true, stoppedAt: true, isMinor: true },
    }),
    resetsAtStart === null ? Promise.resolve(0) : countResets(conversationId),
  ]);
  return guardVerdict(conv, resets, resetsAtStart);
}
