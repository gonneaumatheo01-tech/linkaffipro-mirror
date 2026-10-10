/**
 * Contrôles communs des tests de rendu des pages de Réglages (rendu serveur, sans DOM) : un seul titre `<h1>`, un seul
 * bouton orange, texte visible sans jargon (docs/REFONTE-UX.md, table « Vocabulaire »). Le terme technique lu par les
 * lecteurs d'écran (`Term`, texte masqué « (FTD) ») et les attributs (`title`) ne comptent pas comme texte visible.
 */

/** Nombre de titres `<h1>` (un seul par page : celui du `PageHeader`). */
export function h1Count(html: string): number {
  return (html.match(/<h1[\s>]/g) ?? []).length;
}

/** Nombre de boutons ou liens-boutons orange (variante `default` de `Button` / `buttonVariants()`). */
export function primaryButtonCount(html: string): number {
  return (html.match(/bg-brand text-brand-foreground/g) ?? []).length;
}

/** Adresses des liens marqués comme page ouverte (`aria-current="page"`), dans l'ordre. */
export function currentLinks(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('aria-current="page"'))
    .map((tag) => /href="([^"]*)"/.exec(tag)?.[1] ?? "");
}

/** Texte visible : sans balises, sans les textes réservés aux lecteurs d'écran, entités décodées. */
export function visibleText(html: string): string {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jargon interdit en surface (le mot du client est affiché, le terme exact reste au survol). */
export const JARGON =
  /\bFTD\b|\bNGR\b|\bROAS\b|\bCPL\b|\bCPA\b|sub-?ID|webhook|postback|segment|cohorte|entonnoir|automatisation|envois? groupés?/i;

/** Mots de jargon trouvés dans le texte visible (liste vide si tout va bien). */
export function jargonIn(text: string): string[] {
  const re = new RegExp(JARGON.source, "gi");
  return [...text.matchAll(re)].map((m) => m[0]);
}
