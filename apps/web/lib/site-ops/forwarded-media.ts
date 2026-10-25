/**
 * Phase 34 — médias d'un message transféré à Kevin (règle 6 : le contenu reste fidèle, médias compris). Le déroulé
 * de Kevin les range dans la médiathèque AVANT l'essai à blanc et donne `mediaAssetId` (le premier) et
 * `mediaAssetIds` (tous, dans l'ordre). Les cœurs vérifient qu'ils existent, et l'aperçu dit ce qui part (« avec une
 * photo ») et ce qui n'est pas gardé quand l'écran n'accepte qu'un média (« 1 photo sur 3 gardée »), jamais en silence.
 */
import { prisma } from "@linkaffipro/db";

type Media = { kind?: unknown; fileId?: unknown };

/** Médias d'un message transféré (`content`, ou `forwarded` pour les envois), ou aucun (pur). */
export function forwardedMediaList(input: Record<string, unknown>): Media[] {
  const c = (input.content ?? input.forwarded) as { media?: unknown } | undefined;
  return c && typeof c === "object" && Array.isArray(c.media) ? (c.media as Media[]).filter((m) => m && typeof m === "object") : [];
}

/** Identifiants fournis par le déroulé de Kevin : `mediaAssetIds`, sinon `mediaAssetId` (pur). */
export function providedAssetIds(input: Record<string, unknown>): string[] {
  const many = Array.isArray(input.mediaAssetIds) ? input.mediaAssetIds.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  if (many.length) return [...new Set(many)];
  return typeof input.mediaAssetId === "string" && input.mediaAssetId ? [input.mediaAssetId] : [];
}

export type ForwardedAsset = { id: string; mimeType: string };

/** Les médias existent-ils tous ? Rend leur type, dans l'ordre donné ; null si un manque. */
export async function existingAssets(ids: string[]): Promise<ForwardedAsset[] | null> {
  if (ids.length === 0) return [];
  const rows = await prisma.mediaAsset.findMany({ where: { id: { in: ids } }, select: { id: true, mimeType: true } });
  const out = ids.map((id) => rows.find((r) => r.id === id) ?? null);
  return out.some((x) => x === null) ? null : (out as ForwardedAsset[]);
}

type Word = { one: string; many: string; fem: boolean };
const WORDS: Record<string, Word> = {
  photo: { one: "photo", many: "photos", fem: true },
  video: { one: "vidéo", many: "vidéos", fem: true },
  file: { one: "fichier", many: "fichiers", fem: false },
  media: { one: "média", many: "médias", fem: false },
};

function wordOf(mimeType: string): Word {
  if (mimeType.startsWith("image/") && mimeType !== "image/gif") return WORDS.photo!;
  if (mimeType.startsWith("video/") || mimeType === "image/gif") return WORDS.video!;
  return WORDS.file!;
}

/** « une photo », « 2 photos », « 1 photo et 1 vidéo », « un fichier » (pur). */
export function mediaPhrase(mimeTypes: string[]): string {
  if (mimeTypes.length === 0) return "";
  const counts = new Map<Word, number>();
  for (const m of mimeTypes) counts.set(wordOf(m), (counts.get(wordOf(m)) ?? 0) + 1);
  const parts = [...counts].map(([w, n]) => (n === 1 && counts.size === 1 ? `${w.fem ? "une" : "un"} ${w.one}` : `${n} ${n > 1 ? w.many : w.one}`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}` : parts[0]!;
}

/**
 * Phrase d'aperçu : « Avec une photo. » ; si l'écran n'en garde qu'une partie, « Avec une photo (1 photo sur 3
 * gardée : <raison>). » (pur). `total` : médias du message transféré ; `kept` : types des médias joints.
 */
export function mediaSentence(kept: string[], total: number, reason: string): string {
  if (kept.length === 0) return "";
  const head = `Avec ${mediaPhrase(kept)}`;
  if (total <= kept.length) return ` ${head}.`;
  const same = kept.every((m) => wordOf(m) === wordOf(kept[0]!));
  const w = same ? wordOf(kept[0]!) : WORDS.media!;
  return ` ${head} (${kept.length} ${kept.length > 1 ? w.many : w.one} sur ${total} ${kept.length > 1 ? "gardé" + (w.fem ? "es" : "s") : "gardé" + (w.fem ? "e" : "")} : ${reason}).`;
}
