/**
 * Bibliothèque des emojis animés (phase 12) : règles pures partagées par la page Messages → Emojis animés, le
 * sélecteur de l'éditeur et l'import d'un pack (sans base ni réseau, testées dans library.test.ts).
 */
import { isValidCustomEmojiId } from "@linkaffipro/core";
import { fmtNum } from "@/lib/format";

/** Format d'un fichier Telegram d'emoji animé : Lottie compressé, vidéo, ou image fixe. */
export type CustomEmojiFormat = "tgs" | "webm" | "webp";

/** Format d'un autocollant Telegram (`is_animated` → .tgs, `is_video` → .webm, sinon .webp). */
export function stickerFormat(s: { is_animated?: boolean; is_video?: boolean }): CustomEmojiFormat {
  if (s.is_animated) return "tgs";
  if (s.is_video) return "webm";
  return "webp";
}

/** Types MIME des aperçus enregistrés par le worker (`CustomEmoji.previewMime`). */
export const PREVIEW_MIME: Record<CustomEmojiFormat, string> = {
  tgs: "application/x-tgsticker",
  webm: "video/webm",
  webp: "image/webp",
};

/** Emoji de la bibliothèque, tel que le sélecteur de l'éditeur le reçoit (`GET /api/custom-emoji`). */
export type PickerEmoji = {
  /** Identifiant Telegram (`customEmojiId`), celui de la balise `<tg-emoji emoji-id>`. */
  id: string;
  fallback: string;
  setName: string | null;
  setTitle: string | null;
  format: string | null;
  hasPreview: boolean;
  useCount: number;
  /** Dernière utilisation dans un texte enregistré (ISO), null si jamais utilisé. */
  lastUsedAt: string | null;
};

/** Nom affiché d'un pack (titre Telegram, sinon nom court, sinon « Autres emojis »). */
export function packLabel(e: { setTitle: string | null; setName: string | null }): string {
  return e.setTitle?.trim() || e.setName?.trim() || "Autres emojis";
}

/** Clé de regroupement par pack (« » : sans pack connu). */
export function packKey(e: { setName: string | null }): string {
  return e.setName?.trim().toLowerCase() || "";
}

export type EmojiGroup<T> = { key: string; label: string; setName: string | null; items: T[] };

/**
 * Regroupe par pack, dans l'ordre alphabétique des noms affichés (français) ; les emojis sans pack connu viennent en
 * dernier. Dans un pack, l'ordre reçu est gardé (celui du pack Telegram, ou d'ajout).
 */
export function groupByPack<T extends { setTitle: string | null; setName: string | null }>(
  items: readonly T[],
): EmojiGroup<T>[] {
  const map = new Map<string, EmojiGroup<T>>();
  for (const it of items) {
    const key = packKey(it);
    let g = map.get(key);
    if (!g) {
      g = { key, label: packLabel(it), setName: it.setName?.trim() || null, items: [] };
      map.set(key, g);
    } else if (g.label === "Autres emojis" && it.setTitle) g.label = packLabel(it);
    g.items.push(it);
  }
  return [...map.values()].sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1;
    return a.label.localeCompare(b.label, "fr", { sensitivity: "base" });
  });
}

/** Texte comparable : minuscules, sans accents ni ponctuation. */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[\s_\-.,;:!?'"()]+/g, " ")
    .trim();
}

/** Retire les sélecteurs de variation et liants invisibles (« ❤️ » et « ❤ » se valent pour la recherche). */
function bareEmoji(s: string): string {
  return s.replace(/[︎️‍]/g, "");
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/**
 * Recherche dans la bibliothèque : un emoji tapé ou collé (« 🔥 ») cherche l'emoji de remplacement ; des mots
 * cherchent le nom du pack (accents et majuscules ignorés). Requête vide : tout.
 */
export function searchEmojis<
  T extends { fallback: string; setTitle: string | null; setName: string | null },
>(items: readonly T[], query: string): T[] {
  const q = query.trim();
  if (!q) return [...items];
  if (PICTOGRAPHIC.test(q)) {
    const wanted = bareEmoji(q.replace(/\s+/g, ""));
    return items.filter((it) => bareEmoji(it.fallback).includes(wanted));
  }
  const words = normalizeSearch(q).split(" ").filter(Boolean);
  return items.filter((it) => {
    const hay = normalizeSearch(`${it.setTitle ?? ""} ${it.setName ?? ""}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Emojis récents de l'équipe : les derniers utilisés dans un texte enregistré, du plus récent au plus ancien. */
export function recentEmojis<T extends { lastUsedAt: string | Date | null; useCount: number }>(
  items: readonly T[],
  limit = 24,
): T[] {
  const time = (v: string | Date | null) => (v ? new Date(v).getTime() : 0);
  return items
    .filter((it) => it.lastUsedAt)
    .sort((a, b) => time(b.lastUsedAt) - time(a.lastUsedAt) || b.useCount - a.useCount)
    .slice(0, limit);
}

/** « 1 emoji animé », « 12 emojis animés ». */
export function emojiCount(n: number): string {
  return `${fmtNum(n)} emoji${n > 1 ? "s" : ""} animé${n > 1 ? "s" : ""}`;
}

/** Phrase de retour après un ajout (lien de pack, import du compte) : nouveaux, et déjà présents. */
export function addedSummary(added: number, already: number): string {
  if (added === 0 && already === 0) return "Aucun emoji animé trouvé.";
  if (added === 0)
    return `Rien de nouveau : ${already > 1 ? `les ${emojiCount(already)} étaient` : "cet emoji animé était"} déjà dans la bibliothèque.`;
  const head = `${emojiCount(added)} ${added > 1 ? "ajoutés" : "ajouté"} ✅`;
  return already > 0 ? `${head} (${already} déjà dans la bibliothèque).` : `${head}.`;
}

/** Sticker d'un pack Telegram (champs utiles du Bot API, `getStickerSet`). */
export type PackSticker = {
  custom_emoji_id?: string;
  emoji?: string;
  is_animated?: boolean;
  is_video?: boolean;
};

/** Ligne à enregistrer pour un emoji d'un pack. */
export type PackEmojiRow = {
  customEmojiId: string;
  fallback: string;
  format: CustomEmojiFormat;
};

/** Emojis exploitables d'un pack, sans doublon, dans l'ordre du pack (identifiant invalide : ignoré). */
export function packRows(stickers: readonly PackSticker[]): PackEmojiRow[] {
  const seen = new Set<string>();
  const out: PackEmojiRow[] = [];
  for (const s of stickers) {
    const id = String(s.custom_emoji_id ?? "").trim();
    if (!isValidCustomEmojiId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ customEmojiId: id, fallback: s.emoji?.trim() || "⭐", format: stickerFormat(s) });
  }
  return out;
}

/** Retour d'une action de la bibliothèque (phrase affichée sous le bouton). */
export type EmojiActionState = { ok?: string; error?: string } | null;
