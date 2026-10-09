/** Logique pure du flux « offre personnalisée » (`/start o<slug>_<code post>`). */

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

export const DEFAULT_OFFER_REPLY: Record<string, { text: string; button: string }> = {
  fr: { text: "Voici ton lien personnel, {prenom} 👇", button: "Ouvrir l'offre" },
  en: { text: "Here is your personal link, {prenom} 👇", button: "Open the offer" },
};

export const INVALID_OFFER_REPLY: Record<string, string> = {
  fr: "Ce lien n'est plus valable.",
  en: "This link is no longer valid.",
};

/** Remplace les placeholders d'un texte de séquence. */
export function fillPlaceholders(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "");
}
