/**
 * Offre ajoutée comme lien dans le texte d'un message de canal (phase 12, D10) : un message publié par le compte
 * Telegram connecté n'a pas de boutons, l'offre de la campagne devient un lien goolink traqué (`TrackingLink` de type
 * BUTTON, rattaché à la campagne et à l'offre Link Affi) : clics comptés, sans identifiant de suivi par membre.
 *
 * Création en deux temps :
 * 1. « Ajouter l'offre comme lien dans le texte » crée le lien (campagne et offre vérifiées comme un bouton Offre) et
 *    le formulaire l'ajoute à la fin du texte ;
 * 2. à l'enregistrement, chaque lien d'offre du texte est rattaché au message (`attachTextOfferLinks`) ; un lien qui
 *    appartient déjà à un autre message (copie, plusieurs canaux, version B, modèle) est dupliqué pour celui-ci, pour
 *    que les clics restent comptés message par message.
 *
 * Ici : règles pures (navigateur et serveur, testées dans offer-link.test.ts) ; écritures en base dans offer-link-db.ts.
 */
import { escapeHtml } from "@linkaffipro/core";

/** Libellé du lien en base (liste des liens, journal) : distingue un lien d'offre dans le texte d'un bouton. */
export const TEXT_OFFER_LINK_SUFFIX = " (lien dans le texte)";
/** Texte du lien proposé par défaut. */
export const DEFAULT_TEXT_OFFER_LABEL = "👉 Profiter de l'offre";
export const TEXT_OFFER_LABEL_MAX = 64;

const PLACEHOLDER_ONLY = /^(?:\{(?:subid|click_id|member_id|post_id)\})+$/;

/**
 * Adresse de l'offre sans les repères propres à un membre : un lien dans le texte est le même pour tous les membres,
 * il ne porte pas d'identifiant de suivi (`?sub_id={subid}` retiré, comme les autres repères seuls dans un paramètre).
 */
export function textOfferDestination(template: string): string {
  const q = template.indexOf("?");
  if (q < 0) return template;
  const hashAt = template.indexOf("#", q);
  const base = template.slice(0, q);
  const query = template.slice(q + 1, hashAt < 0 ? undefined : hashAt);
  const hash = hashAt < 0 ? "" : template.slice(hashAt);
  const kept = query
    .split("&")
    .filter((part) => part !== "" && !PLACEHOLDER_ONLY.test(part.split("=").slice(1).join("=")));
  return `${base}${kept.length ? `?${kept.join("&")}` : ""}${hash}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Adresses de liens traqués (`<base>/<slug>`) présentes dans un texte HTML Telegram (sans doublon, dans l'ordre). */
export function trackedLinkSlugs(html: string, trackingBaseUrl: string): string[] {
  const base = trackingBaseUrl.replace(/\/$/, "");
  const re = new RegExp(`<a\\s+href="${escapeRe(base)}/([0-9A-Za-z]{6,10})"`, "g");
  const out: string[] = [];
  for (const m of html.matchAll(re)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** Remplace l'adresse d'un lien traqué par une autre dans un texte HTML Telegram (toutes ses occurrences). */
export function replaceTrackedSlug(
  html: string,
  trackingBaseUrl: string,
  from: string,
  to: string,
): string {
  const base = trackingBaseUrl.replace(/\/$/, "");
  return html.replace(
    new RegExp(`(<a\\s+href=")${escapeRe(base)}/${escapeRe(from)}(")`, "g"),
    `$1${base}/${to}$2`,
  );
}

/** Lien HTML Telegram d'une offre (texte échappé). */
export function textOfferLinkHtml(url: string, label: string): string {
  return `<a href="${url.replace(/"/g, "&quot;")}">${escapeHtml(label)}</a>`;
}

/** Ajoute un morceau de HTML Telegram à la fin d'un texte, sur une nouvelle ligne (paragraphe à part). */
export function appendToText(html: string, fragment: string): string {
  const t = html.replace(/\s+$/, "");
  return t ? `${t}\n\n${fragment}` : fragment;
}

/** Libellé du lien : refus en français (null si valable). */
export function textOfferLabelError(label: string): string | null {
  const t = label.trim();
  if (!t) return "Écrivez le texte du lien (par exemple « Profiter de l'offre »).";
  if (t.length > TEXT_OFFER_LABEL_MAX)
    return `Le texte du lien ne peut pas dépasser ${TEXT_OFFER_LABEL_MAX} caractères.`;
  return null;
}
