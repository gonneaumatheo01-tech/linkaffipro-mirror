/**
 * Emoji animé dans l'éditeur (phase 12) : une « puce » atomique, sans DOM (testable en Node).
 *
 * Dans le HTML Telegram, un emoji animé s'écrit `<tg-emoji emoji-id="ID">👍</tg-emoji>` (le contenu est l'emoji de
 * remplacement). Dans l'éditeur, il devient une image (`<img class="lap-ce">`) : une image est un caractère indivisible
 * pour tous les navigateurs (un retour arrière la supprime, le gras l'entoure, la sélection et le copier-coller la
 * gardent à sa place), ce que Firefox ne garantit pas pour un élément non modifiable. L'image dessine l'emoji de
 * remplacement (SVG en ligne) ; l'animation est posée par-dessus, hors du texte (components/custom-emoji/chip-overlay.ts).
 * L'identifiant et l'emoji de remplacement sont dans ses attributs : c'est eux que relit `htmlToTelegram`.
 */

import { CUSTOM_EMOJI_TAG_RE, decodeEntities, isValidCustomEmojiId } from "@linkaffipro/core";

/** Classe de la puce (rich-text.css). */
export const CUSTOM_EMOJI_CHIP_CLASS = "lap-ce";
/** Sélecteur des puces d'un texte affiché (éditeur, aperçus). */
export const CUSTOM_EMOJI_CHIP_SELECTOR = `img.${CUSTOM_EMOJI_CHIP_CLASS}[data-ce-id]`;

/** Emoji de remplacement d'une balise vide (Telegram exige un emoji ; même valeur que `customEmojiTag`). */
export const DEFAULT_FALLBACK = "⭐";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Image de l'emoji de remplacement (SVG en ligne : police d'emojis du système, aucune requête). */
export function fallbackImageSrc(fallback: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="54" font-size="78" text-anchor="middle" dominant-baseline="central">${escapeXml(fallback)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** HTML d'une puce d'emoji animé (identifiant déjà validé). */
export function customEmojiChipHtml(id: string, fallback: string): string {
  const fb = fallback || DEFAULT_FALLBACK;
  return `<img class="${CUSTOM_EMOJI_CHIP_CLASS}" data-ce-id="${escapeAttr(id)}" data-ce-fallback="${escapeAttr(fb)}" alt="${escapeAttr(fb)}" title="Emoji animé" draggable="false" src="${fallbackImageSrc(fb)}">`;
}

/**
 * HTML Telegram déjà validé (aperçu « tel que les membres le verront ») : chaque `<tg-emoji>` devient une puce, le reste
 * ne bouge pas. À afficher dans un conteneur animé par `useCustomEmojiChips` (components/custom-emoji/emoji-chips.ts),
 * avec la feuille `components/editor/rich-text.css` (taille de la puce).
 */
export function telegramHtmlWithChips(telegramHtml: string): string {
  return telegramHtml.replace(
    new RegExp(CUSTOM_EMOJI_TAG_RE.source, "gi"),
    (all, a: string | undefined, b: string | undefined, inner: string) => {
      const id = a ?? b ?? "";
      return isValidCustomEmojiId(id) ? customEmojiChipHtml(id, decodeEntities(inner).trim()) : all;
    },
  );
}
