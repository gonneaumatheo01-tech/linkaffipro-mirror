/**
 * Relecture de la conversation pendant un tour de l'assistant (contrat §4 et §5) : avant chaque message envoyé, l'assistant
 * vérifie qu'il a encore la parole (statut BOT, ni /stop ni mineur), qu'aucun /reset n'a tout effacé depuis le début
 * du tour, et que l'équipe n'a pas pris puis rendu la main entre-temps (la réponse préparée doublerait son message).
 * /reset et passages de main sont repérés par le nombre d'événements de la conversation (jamais supprimés), sans
 * comparer des heures de deux machines différentes.
 */
import { prisma } from "@linkaffipro/db";
import { guardVerdict, type GuardVerdict } from "./rules";

/** Événements de passage de main entre l'équipe et l'assistante. */
export const HANDOVER_EVENT_TYPES = ["taken_over", "released"] as const;

/** Nombre de /reset reçus par la conversation depuis sa création. */
export async function countResets(conversationId: string): Promise<number> {
  return prisma.conversationEvent.count({ where: { conversationId, type: "reset" } });
}

/** Nombre de prises et de rendus de main par l'équipe depuis la création de la conversation. */
export async function countHandovers(conversationId: string): Promise<number> {
  return prisma.conversationEvent.count({
    where: { conversationId, type: { in: [...HANDOVER_EVENT_TYPES] } },
  });
}

/**
 * L'assistant peut-il encore envoyer dans ce tour ? (`resetsAtStart` null : pas de contrôle du /reset ;
 * `handoversAtStart` null ou absent : pas de contrôle des passages de main).
 */
export async function conversationGuard(
  conversationId: string,
  resetsAtStart: number | null,
  handoversAtStart: number | null = null,
): Promise<GuardVerdict> {
  const [conv, resets, handovers] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { status: true, stoppedAt: true, isMinor: true },
    }),
    resetsAtStart === null ? Promise.resolve(0) : countResets(conversationId),
    handoversAtStart === null ? Promise.resolve(0) : countHandovers(conversationId),
  ]);
  return guardVerdict(conv, resets, resetsAtStart, {
    now: handovers,
    atStart: handoversAtStart,
  });
}
