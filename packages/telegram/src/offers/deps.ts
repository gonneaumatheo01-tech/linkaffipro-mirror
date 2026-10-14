import type { EmitLinkaffiEventInput } from "@linkaffipro/queue";
import type { User } from "grammy/types";

/** Résultat de la résolution d'un lien d'offre. */
export type ResolvedOffer = {
  trackingLinkId: string;
  /** Modèle d'URL Link Affi avec {subid}. */
  destinationTemplate: string;
  postId: string | null;
  channelId: string | null;
  channelLanguage: string | null;
  /**
   * Clé Link Affi de l'offre dont le lien est utilisé (`AffiliateCampaign.campaignKey`, programme Link Affi), ou null
   * si le lien n'est pas un lien d'offre Link Affi : le paramètre `tg` (phase 13) n'est ajouté qu'à un lien Link Affi.
   */
  offerCampaignKey?: string | null;
};

/** Affilié Link Affi du membre (phase 13) : campagne Telegram et fin de l'attribution (null = à vie). */
export type OfferMemberAffiliate = {
  campaignKey: string | null;
  attributionEndsAt: Date | null;
};

export type OfferMediaKind = "photo" | "video" | "animation" | "document";
/** Média de la séquence déjà connu de Telegram pour ce bot (file_id) : envoyé sans upload. */
export type OfferReplyTexts = {
  text: string;
  button: string;
  media?: { fileId: string; kind: OfferMediaKind } | null;
};

/** Dépendances (accès base) du handler d'offres, abstraites pour les tests. */
export interface OfferDeps {
  /** Upsert du membre + canDm = true sur ce bot ; avec son affilié Link Affi s'il en a un (phase 13). */
  memberStarted(
    botId: string,
    from: User,
  ): Promise<{ memberId: string; affiliate?: OfferMemberAffiliate | null }>;
  /** Résout le lien traqué (kind OFFER, actif) et le message par son code. */
  resolveOffer(slug: string, postCode: string | null): Promise<ResolvedOffer | null>;
  /** Enregistre le clic (subId neuf), met à jour les compteurs, journalise. */
  recordOfferClick(input: {
    trackingLinkId: string;
    postId: string | null;
    memberId: string;
    botId: string;
    subId: string;
    destination: string;
    /** Campagne Telegram d'affilié ajoutée au lien (`&tg=`, phase 13), sinon null. */
    linkaffiTelegramCampaignKey?: string | null;
  }): Promise<{ clickId: string }>;
  /** Textes de la séquence OFFER_REPLY du canal pour une langue (null = texte par défaut), avec le média si son file_id est connu pour ce bot. */
  offerReplyTexts(
    channelId: string | null,
    lang: string,
    botId?: string,
  ): Promise<OfferReplyTexts | null>;
  /**
   * Événement `offer_clicked` d'un membre d'affilié à envoyer à Link Affi (`emitLinkaffiEvent`, phase 13). Facultatif
   * (tests anciens) : rien n'est émis.
   */
  emitLinkaffiEvent?(input: EmitLinkaffiEventInput): Promise<unknown>;
  /** Journal (append-only) : repli des emojis animés de la réponse (`dm.custom_emoji_fallback`, phase 12). */
  recordEvent?(input: {
    type: string;
    memberId?: string | null;
    botId?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void>;
}
