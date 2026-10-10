/**
 * Règles pures du défilement horizontal des tableaux (`Table`), testées à part (sans DOM).
 */

export type ScrollMetrics = { scrollLeft: number; scrollWidth: number; clientWidth: number };
export type ScrollState = { overflowing: boolean; atStart: boolean; atEnd: boolean };

/** Tableau qui tient dans sa largeur : ni zone focalisable, ni dégradé. */
export const NO_SCROLL: ScrollState = { overflowing: false, atStart: true, atEnd: true };

/**
 * État de défilement d'un conteneur : déborde-t-il, est-il au début, à la fin ?
 * Tolérance d'un pixel (arrondis des navigateurs) ; `scrollLeft` négatif (sens de lecture inversé) accepté.
 */
export function horizontalScrollState(m: ScrollMetrics, tolerance = 1): ScrollState {
  const max = m.scrollWidth - m.clientWidth;
  if (!(max > tolerance)) return NO_SCROLL;
  const left = Math.abs(m.scrollLeft);
  return { overflowing: true, atStart: left <= tolerance, atEnd: left >= max - tolerance };
}

export function sameScrollState(a: ScrollState, b: ScrollState): boolean {
  return a.overflowing === b.overflowing && a.atStart === b.atStart && a.atEnd === b.atEnd;
}

/** Nom de la zone défilante annoncé au clavier : la légende du tableau si elle existe. */
export function scrollRegionLabel(label?: string | null): string {
  const name = label?.trim();
  return `${name || "Tableau"} (faites défiler horizontalement)`;
}
