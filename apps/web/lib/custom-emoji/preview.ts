/**
 * Aperçu d'un emoji animé pour le navigateur (route `GET /api/custom-emoji/<id>`), sans base (testé dans
 * preview.test.ts). Le worker enregistre le fichier Telegram tel quel (`CustomEmoji.previewBytes`, ≤ 512 Ko) :
 * - `.tgs` (Lottie compressé) : décompressé ici et renvoyé en JSON, lu par le lecteur d'animation du navigateur ;
 * - `.webm` (vidéo) et `.webp` (image) : renvoyés tels quels.
 */
import { gunzipSync } from "node:zlib";

/** Taille maximale d'une animation décompressée (un emoji Telegram fait quelques dizaines de Ko). */
export const MAX_LOTTIE_BYTES = 4 * 1024 * 1024;

export type PreviewPayload = { body: Uint8Array; contentType: string };

const PASS_THROUGH: Record<string, string> = {
  "video/webm": "video/webm",
  "image/webp": "image/webp",
  "image/png": "image/png",
};

/**
 * Corps et type de la réponse, ou null si l'aperçu est absent, d'un type inconnu ou illisible (animation
 * corrompue, trop grosse une fois décompressée).
 */
export function previewPayload(
  bytes: Uint8Array | null | undefined,
  mime: string | null | undefined,
): PreviewPayload | null {
  if (!bytes || bytes.length === 0 || !mime) return null;
  if (mime === "application/x-tgsticker" || mime === "application/gzip") {
    let raw: Buffer;
    try {
      raw = gunzipSync(bytes, { maxOutputLength: MAX_LOTTIE_BYTES });
    } catch {
      return null;
    }
    const text = raw.toString("utf8");
    try {
      const data: unknown = JSON.parse(text);
      if (
        !data ||
        typeof data !== "object" ||
        !Array.isArray((data as { layers?: unknown }).layers)
      )
        return null;
    } catch {
      return null;
    }
    return { body: new Uint8Array(raw), contentType: "application/json; charset=utf-8" };
  }
  const type = PASS_THROUGH[mime];
  return type ? { body: new Uint8Array(bytes), contentType: type } : null;
}

/** Étiquette de cache : change dès que le worker récupère un nouvel aperçu. */
export function previewEtag(customEmojiId: string, previewAt: Date | null | undefined): string {
  return `"ce-${customEmojiId}-${previewAt ? previewAt.getTime().toString(36) : "0"}"`;
}
