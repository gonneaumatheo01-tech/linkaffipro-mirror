import { PREVIEW_DRAWN_WIDTH, PREVIEW_SCREEN } from "./phone-preview";

/**
 * Taille de l'aperçu en grand (« Voir la page », fiche d'une page) : le téléphone dessiné le plus grand possible,
 * jusqu'à la taille réelle (390 px de large), sans dépasser la fenêtre. Ordinateur et tablette (≥ 768 px) : les
 * textes à côté du téléphone, qui prend toute la hauteur. Téléphone : les textes au-dessus, le téléphone prend la
 * largeur (la boîte défile s'il le faut) sans jamais être plus haut que l'écran.
 */

/** Largeur à partir de laquelle les textes passent à côté du téléphone (classe `md:` de Tailwind). */
export const LARGE_PREVIEW_SIDE_BY_SIDE = 768;
/** Largeur des textes à côté du téléphone (18rem) et écart entre les deux (1.5rem). */
export const LARGE_PREVIEW_TEXT_WIDTH = 288;
const GAP = 24;
/** Autour de l'écran : marges de la boîte dans la fenêtre (2 × 16), marges intérieures (2 × 20), cadre (2 × 8). */
const CHROME = 32 + 40 + 16;
/** Plus petite largeur dessinée (jamais plus petit que l'aperçu à côté du formulaire, sauf écran minuscule). */
const MIN_WIDTH = 200;

/** Largeur dessinée de l'écran (px) ; sans fenêtre connue (rendu serveur) : la taille de l'aperçu du formulaire. */
export function largePreviewWidth(viewport: { width: number; height: number } | null): number {
  if (!viewport || !(viewport.width > 0) || !(viewport.height > 0)) return PREVIEW_DRAWN_WIDTH;
  const sideBySide = viewport.width >= LARGE_PREVIEW_SIDE_BY_SIDE;
  const byWidth = viewport.width - CHROME - (sideBySide ? LARGE_PREVIEW_TEXT_WIDTH + GAP : 0);
  const byHeight = ((viewport.height - CHROME) * PREVIEW_SCREEN.width) / PREVIEW_SCREEN.height;
  const width = Math.floor(Math.min(PREVIEW_SCREEN.width, byWidth, byHeight));
  return Math.max(MIN_WIDTH, width);
}
