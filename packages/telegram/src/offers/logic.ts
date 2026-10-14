/** Logique pure du flux « offre personnalisée » (`/start o<slug>_<code post>`). */
import {
  fillUrlTemplate,
  isAffiliateAttributionActive,
  withTelegramCampaignParam,
} from "@linkaffipro/core";
import { LANGS, t, type Lang } from "../i18n";

const SLUG_RE = /^[0-9A-Za-z]{6,10}$/;
const CODE_RE = /^[0-9A-Za-z]{8}$/;

export type OfferPayload = { slug: string; postCode: string | null };

/**
 * Analyse la charge utile d'un lien profond d'offre. Forme : `o<slug>` ou `o<slug>_<code post>`.
 * Alphabet Telegram autorisé : A-Z a-z 0-9 _ - (≤ 64 caractères).
 */
export function parseOfferPayload(payload: string | undefined): OfferPayload | null {
  if (!payload || payload.length > 64 || !payload.startsWith("o")) return null;
  const body = payload.slice(1);
  const [slug, postCode, ...rest] = body.split("_");
  if (rest.length > 0 || !slug || !SLUG_RE.test(slug)) return null;
  if (postCode !== undefined && !CODE_RE.test(postCode)) return null;
  return { slug, postCode: postCode ?? null };
}

/** Construit la charge utile d'un bouton d'offre pour un message. */
export function buildOfferPayload(slug: string, postCode?: string | null): string {
  return postCode ? `o${slug}_${postCode}` : `o${slug}`;
}

export function offerDeepLink(botUsername: string, slug: string, postCode?: string | null): string {
  return `https://t.me/${botUsername}?start=${buildOfferPayload(slug, postCode)}`;
}

/** Réponse d'offre par défaut (texte + libellé du bouton) dans les six langues du bot. */
export const DEFAULT_OFFER_REPLY: Record<Lang, { text: string; button: string }> =
  Object.fromEntries(
    LANGS.map((l) => [l, { text: t(l, "offerReply"), button: t(l, "offerButton") }]),
  ) as Record<Lang, { text: string; button: string }>;

export const INVALID_OFFER_REPLY: Record<Lang, string> = Object.fromEntries(
  LANGS.map((l) => [l, t(l, "offerInvalid")]),
) as Record<Lang, string>;

/** Remplace les placeholders d'un texte de séquence. */
export function fillPlaceholders(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "");
}

/**
 * Offre à utiliser pour un bouton rattaché à une campagne (la nôtre) : celle du bouton si elle fait toujours partie
 * de la campagne et reste active ; sinon la première offre active de la campagne (dans l'ordre de la campagne).
 * Retourne null si la campagne n'a aucune offre active : on garde alors le lien d'origine du bouton.
 */
export function pickCampaignOffer(
  linkOfferId: string | null,
  campaignOfferIds: readonly string[],
  offers: ReadonlyArray<{ id: string; trackingUrlTemplate: string; isActive: boolean }>,
): { offerId: string; template: string; replaced: boolean } | null {
  const byId = new Map(offers.map((o) => [o.id, o]));
  const current = linkOfferId ? byId.get(linkOfferId) : undefined;
  if (current && current.isActive && campaignOfferIds.includes(current.id))
    return { offerId: current.id, template: current.trackingUrlTemplate, replaced: false };
  for (const id of campaignOfferIds) {
    const o = byId.get(id);
    if (o && o.isActive && o.trackingUrlTemplate)
      return { offerId: o.id, template: o.trackingUrlTemplate, replaced: true };
  }
  return null;
}

/**
 * Lien d'offre Link Affi `https://<domaine>/go/<clé de l'offre>` (celui qui passe par le suivi des clics de Link Affi) ?
 * Jamais un lien court, une page d'atterrissage ni une autre adresse (docs/LINKAFFI-SUBID.md).
 */
export function isLinkaffiOfferUrl(url: string, offerCampaignKey: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const path = u.pathname.replace(/\/+$/, "");
    return (
      path === `/go/${offerCampaignKey}` || path === `/go/${encodeURIComponent(offerCampaignKey)}`
    );
  } catch {
    return false;
  }
}

/**
 * Adresse finale d'un clic d'offre : modèle de l'offre rempli (sub-ID neuf), puis, pour un membre rattaché à une
 * campagne Telegram d'affilié Link Affi dont l'attribution est en cours, `&tg=<clé de cette campagne>` (contrat
 * `docs/LINKAFFI-PARTENAIRES.md` § 3) — seulement sur un lien d'offre Link Affi, jamais sur une autre adresse.
 */
export function offerDestination(input: {
  template: string;
  subId: string;
  memberId: string;
  postId: string | null;
  offerCampaignKey: string | null | undefined;
  affiliate: { campaignKey: string | null; attributionEndsAt: Date | null } | null | undefined;
  now: Date;
}): { destination: string; telegramCampaignKey: string | null } {
  const destination = fillUrlTemplate(input.template, {
    subid: input.subId,
    member_id: input.memberId,
    post_id: input.postId ?? "",
  });
  const tg = input.affiliate?.campaignKey ?? null;
  if (
    !tg ||
    !input.offerCampaignKey ||
    !isAffiliateAttributionActive(
      {
        linkaffiCampaignKey: tg,
        affiliateAttributionEndsAt: input.affiliate?.attributionEndsAt ?? null,
      },
      input.now,
    ) ||
    !isLinkaffiOfferUrl(destination, input.offerCampaignKey)
  )
    return { destination, telegramCampaignKey: null };
  return { destination: withTelegramCampaignParam(destination, tg), telegramCampaignKey: tg };
}
