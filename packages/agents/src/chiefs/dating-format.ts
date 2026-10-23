/**
 * Formats des posts du Chef Dating (règles pures) : format tiré du mélange du jour du canal, puis replis
 * vidéo → photo → texte (source manquante, plafond atteint, échec du fournisseur). Les étapes de la chaîne restent
 * les mêmes ; une étape sans objet pour le format est « sautée » (Médiathèque pour une photo, Média IA pour un texte).
 */
import { chooseFormat, type MediaFormat, type Mix } from "../agents/mediatheque/pick";

/** Mélange par défaut d'un canal Dating : 1 vidéo, 2 photos, 1 texte par jour. */
export const DATING_DEFAULT_MIX: Mix = Object.freeze({ video: 1, photo: 2, text: 1 });

export type DatingFallback = { from: MediaFormat; to: MediaFormat; reason: string; at: string };

/** Format du prochain post : celui qui manque le plus au mélange, compte tenu des formats VOULUS des posts du jour. */
export function dayFormat(mix: Mix | null | undefined, plannedToday: readonly MediaFormat[]): MediaFormat {
  const m = mix && mix.video + mix.photo + mix.text > 0 ? mix : DATING_DEFAULT_MIX;
  return chooseFormat(m, plannedToday);
}

/** Format de repli : vidéo → photo → texte ; un texte n'a pas de repli. */
export function fallbackFormat(format: MediaFormat): MediaFormat | null {
  return format === "video" ? "photo" : format === "photo" ? "text" : null;
}

/** Nombre de replis par format d'origine (rapport du matin). */
export function countFallbacks(list: ReadonlyArray<Pick<DatingFallback, "from">>): { video: number; photo: number } {
  return { video: list.filter((f) => f.from === "video").length, photo: list.filter((f) => f.from === "photo").length };
}
