import type { User } from "grammy/types";

/** Résultat de la résolution d'un lien d'offre. */
export type ResolvedOffer = {
  trackingLinkId: string;
  /** Modèle d'URL Link Affi avec {subid}. */
  destinationTemplate: string;
  postId: string | null;
  channelId: string | null;
  channelLanguage: string | null;
};

export type OfferMediaKind = "photo" | "video" | "animation" | "document";
/** Média de la séquence déjà connu de Telegram pour ce bot (file_id) : envoyé sans upload. */
export type OfferReplyTexts = { text: string; button: string; media?: { fileId: string; kind: OfferMediaKind } | null };

/** Dépendances (accès base) du handler d'offres, abstraites pour les tests. */
export interface OfferDeps {
  /** Upsert du membre + canDm = true sur ce bot. */
  memberStarted(botId: string, from: User): Promise<{ memberId: string }>;
  /** Résout le lien traqué (kind OFFER, actif) et le message par son code. */
  resolveOffer(slug: string, postCode: string | null): Promise<ResolvedOffer | null>;
  /** Enregistre le clic (subId neuf), met à jour les compteurs, journalise. */
  recordOfferClick(input: { trackingLinkId: string; postId: string | null; memberId: string; botId: string; subId: string; destination: string }): Promise<{ clickId: string }>;
  /** Textes de la séquence OFFER_REPLY du canal pour une langue (null = texte par défaut), avec le média si son file_id est connu pour ce bot. */
  offerReplyTexts(channelId: string | null, lang: string, botId?: string): Promise<OfferReplyTexts | null>;
}
