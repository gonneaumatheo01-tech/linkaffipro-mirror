/**
 * Formats des posts du Chef Dating (règles pures) : format tiré du mélange du jour du canal, puis repli photo → texte
 * (persona sans LoRA, plafond atteint, échec du fournisseur). Les vidéos IA ont été retirées le 29 octobre 2026
 * (décision du client) : la part de vidéos d'un mélange enregistré est ignorée. Les étapes de la chaîne restent les
 * mêmes ; une étape sans objet pour le format est « sautée » (Médiathèque pour une photo, Média IA pour un texte).
 */
import { chooseFormat, type MediaFormat, type Mix } from "../agents/mediatheque/pick";

/** Mélange par défaut d'un canal Dating : 3 photos pour 1 texte. */
export const DATING_DEFAULT_MIX: Mix = Object.freeze({ video: 0, photo: 3, text: 1 });

export type DatingFallback = { from: MediaFormat; to: MediaFormat; reason: string; at: string };

/** Mélange Dating effectif : sans vidéo ; rien de voulu → mélange par défaut (pur). */
export function datingMix(mix: Mix | null | undefined): Mix {
  const m = mix ? { video: 0, photo: Math.max(0, mix.photo), text: Math.max(0, mix.text) } : null;
  return m && m.photo + m.text > 0 ? m : DATING_DEFAULT_MIX;
}

/** Format du prochain post : celui qui manque le plus au mélange, compte tenu des formats VOULUS des posts du jour. */
export function dayFormat(mix: Mix | null | undefined, plannedToday: readonly MediaFormat[]): MediaFormat {
  return chooseFormat(datingMix(mix), plannedToday.map((f) => (f === "video" ? "photo" : f)));
}

/** Format de repli : photo → texte ; un texte n'a pas de repli. */
export function fallbackFormat(format: MediaFormat): MediaFormat | null {
  return format === "photo" || format === "video" ? "text" : null;
}

/** Nombre de replis photo → texte (rapport du matin). */
export function countFallbacks(list: ReadonlyArray<Pick<DatingFallback, "from">>): { photo: number } {
  return { photo: list.filter((f) => f.from === "photo" || f.from === "video").length };
}
