/**
 * Caractéristiques et vues d'un post (règles pures de l'agent Posts) : format d'après les médias, longueur visible,
 * emojis, heure et jour de Paris (changement d'heure compris), vues à 1 h / 2 h / 24 h interpolées depuis les relevés.
 */
import { decodeEntities, stripHtml, textLength } from "@linkaffipro/core";
import { parisParts, parisWeekday } from "../../rules/time";

export type PostFormat = "VIDEO" | "PHOTO" | "ALBUM" | "TEXT";

export type AssetInfo = { id: string; mimeType: string; kind?: string | null };

/** Format : plusieurs médias = album ; un média vidéo ou image ; aucun média = texte. */
export function postFormat(mediaAssetIds: readonly string[], assets: ReadonlyMap<string, AssetInfo>): PostFormat {
  if (mediaAssetIds.length > 1) return "ALBUM";
  if (mediaAssetIds.length === 0) return "TEXT";
  const a = assets.get(mediaAssetIds[0]!);
  if (!a) return "PHOTO";
  if (a.mimeType.startsWith("video/")) return "VIDEO";
  if (a.mimeType.startsWith("image/")) return "PHOTO";
  // Type inconnu : la nature de la médiathèque tranche (une source est toujours une vidéo).
  return a.kind === "SOURCE" ? "VIDEO" : "PHOTO";
}

/** Format du mélange (`ChannelAgentPlan.mix`) correspondant ; un album compte comme une photo. */
export function mixKeyOf(format: string): "video" | "photo" | "text" {
  return format === "VIDEO" ? "video" : format === "TEXT" ? "text" : "photo";
}

const PICTO = /\p{Extended_Pictographic}/u;
const segmenter = new Intl.Segmenter("fr", { granularity: "grapheme" });

/** Nombre d'emojis visibles (un emoji composé « 👨‍👩‍👧 » compte pour un ; un emoji animé compte par son repli). */
export function countEmojis(html: string): number {
  const text = decodeEntities(stripHtml(html ?? ""));
  let n = 0;
  for (const { segment } of segmenter.segment(text)) if (PICTO.test(segment)) n++;
  return n;
}

/** Longueur du texte visible (sans balises). */
export function visibleLength(html: string): number {
  return textLength(html ?? "");
}

/** Tranche de longueur des classements. */
export function lengthBucket(len: number): string {
  if (len < 80) return "court (< 80)";
  if (len < 200) return "moyen (80-199)";
  if (len < 500) return "long (200-499)";
  return "très long (500 et +)";
}

/** Heure (0-23) et jour (1 = lundi … 7 = dimanche) de Paris à cet instant. */
export function parisHourDay(at: Date): { hour: number; weekday: number } {
  return { hour: parisParts(at).hour % 24, weekday: parisWeekday(at) };
}

/** Le post a-t-il des boutons (lignes non vides) ? */
export function hasButtons(buttons: unknown): boolean {
  return Array.isArray(buttons) && buttons.some((row) => Array.isArray(row) && row.length > 0);
}

export type ViewSample = { at: Date; views: number };

/** Tolérance d'un relevé un peu avant l'heure visée quand il n'y en a plus après (relevés toutes les 15 min). */
export const VIEWS_TOLERANCE_MS = 20 * 60_000;

/**
 * Vues `hours` heures après l'envoi : interpolation linéaire entre les relevés qui encadrent l'instant (l'envoi compte
 * pour 0 vue). Aucun relevé après l'instant visé (ni juste avant) → null : on ne devine pas.
 */
export function viewsAt(sentAt: Date, samples: readonly ViewSample[], hours: number): number | null {
  const target = sentAt.getTime() + hours * 3_600_000;
  const list = samples.filter((s) => s.at.getTime() >= sentAt.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!list.length) return null;
  let prev: ViewSample = { at: sentAt, views: 0 };
  let next: ViewSample | null = null;
  for (const s of list) {
    if (s.at.getTime() <= target) prev = s;
    else {
      next = s;
      break;
    }
  }
  if (prev.at.getTime() === target) return Math.max(0, Math.round(prev.views));
  if (!next) return target - prev.at.getTime() > VIEWS_TOLERANCE_MS ? null : Math.max(0, Math.round(prev.views));
  const span = next.at.getTime() - prev.at.getTime();
  const v = prev.views + ((next.views - prev.views) * (target - prev.at.getTime())) / span;
  return Math.max(0, Math.round(v));
}
