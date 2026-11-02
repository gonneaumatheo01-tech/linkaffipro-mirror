/**
 * Gérant du VIP (Paris sportifs) : bookmaker du dernier lien d'inscription envoyé dans une conversation. Sert au moteur
 * (`ConversationState.lastOfferBookKey`) pour donner le lien du canal VIP de CE bookmaker quand ni le modèle ni la
 * personne ne le nomment au moment du dépôt.
 */
import type { Db } from "./client";

export type OfferBookDb = Pick<Db, "conversationEvent" | "assistantOfferLink" | "personaBookmaker">;

/**
 * Clé du bookmaker du dernier lien parti : celle notée dans le dernier événement `offer_sent` (compte réel ; l'événement
 * est écrit après la création du lien), sinon celle du bookmaker de la persona dont l'offre Link Affi porte le dernier
 * lien d'offre de la conversation. Null si aucun lien n'est parti, ou si l'offre n'appartient à aucun bookmaker de la
 * persona (ou à plusieurs : jamais de choix au hasard).
 */
export async function lastOfferBookmakerKey(
  db: OfferBookDb,
  conversationId: string,
  personaId: string,
): Promise<string | null> {
  const [event, link] = await Promise.all([
    db.conversationEvent.findFirst({
      where: { conversationId, type: "offer_sent" },
      orderBy: { createdAt: "desc" },
      select: { payload: true, createdAt: true },
    }),
    db.assistantOfferLink.findFirst({
      where: { conversationId },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true, trackingLink: { select: { affiliateCampaignId: true } } },
    }),
  ]);
  const noted = event ? bookmakerKeyOf(event.payload) : null;
  // Aucun lien plus récent que l'événement : sa clé est exacte.
  if (noted && (!link || event!.createdAt.getTime() >= link.sentAt.getTime())) return noted;
  const campaignId = link?.trackingLink.affiliateCampaignId;
  if (!campaignId) return noted;
  const books = await db.personaBookmaker.findMany({
    where: { personaId, affiliateCampaignId: campaignId },
    select: { bookmakerKey: true },
    take: 2,
  });
  return books.length === 1 ? books[0]!.bookmakerKey : noted;
}

function bookmakerKeyOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const key = (payload as { bookmakerKey?: unknown }).bookmakerKey;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}
