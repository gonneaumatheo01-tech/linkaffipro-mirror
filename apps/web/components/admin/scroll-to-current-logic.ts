/** Position et taille vues à l'écran (`getBoundingClientRect`), plus le défilement de la liste. */
export type ScrollBox = { left: number; width: number; scrollLeft: number; scrollWidth: number };

/**
 * Défilement horizontal qui met l'élément courant au centre de sa liste, borné entre le début et la fin de la liste
 * (une liste qui tient dans l'écran ne bouge pas). Règle pure, testée dans scroll-to-current-logic.test.ts.
 */
export function centeredScrollLeft(list: ScrollBox, item: { left: number; width: number }): number {
  const max = Math.max(0, list.scrollWidth - list.width);
  const target = list.scrollLeft + (item.left + item.width / 2) - (list.left + list.width / 2);
  return Math.round(Math.min(max, Math.max(0, target)));
}
