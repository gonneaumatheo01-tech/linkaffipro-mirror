/**
 * Règles pures du volet latéral (`SidePanel`), testées à part (sans DOM).
 */

/** Éléments qui prennent le focus clavier (contenu « focalisable » au sens d'axe). */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable=false])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * La zone qui défile doit-elle prendre le focus elle-même ? Oui quand elle défile (contenu plus haut qu'elle) et
 * qu'aucun élément à l'intérieur ne prend le focus : sinon, au clavier, on ne pourrait pas lire la suite (contrôle
 * axe `scrollable-region-focusable`). Un pixel de marge pour les arrondis du navigateur.
 */
export function scrollRegionNeedsFocus(m: {
  scrollHeight: number;
  clientHeight: number;
  hasFocusable: boolean;
}): boolean {
  return !m.hasFocusable && m.scrollHeight > m.clientHeight + 1;
}

/** Nom de la zone qui défile, lu quand elle prend le focus : « Contenu : Léa M. » (ou « Contenu du volet »). */
export function scrollRegionLabel(title: unknown): string {
  return typeof title === "string" && title.trim()
    ? `Contenu : ${title.trim()}`
    : "Contenu du volet";
}
