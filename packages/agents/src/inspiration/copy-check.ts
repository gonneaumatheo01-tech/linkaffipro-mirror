/**
 * Phase 27 — contrôle « jamais de copie » (règle 1) : un texte produit ne partage jamais 8 mots consécutifs avec un post
 * de référence. Les suites de 8 mots des posts de référence sont gardées HACHÉES (`ReferencePost.shingles`) : le
 * contrôle marche encore après l'effacement du texte brut (30 jours). Fonctions pures.
 */
import { createHash } from "node:crypto";

/** Longueur de la suite de mots interdite. */
export const COPY_SHINGLE_WORDS = 8;
/** Une citation dans un rapport fait 10 mots au plus. */
export const MAX_QUOTE_WORDS = 10;

/** Mots normalisés (minuscules, sans accents, sans ponctuation ni emojis ; liens et mentions retirés). */
export function copyWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+|t\.me\/\S+|@\w+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Empreintes des suites de `n` mots d'un texte (sans doublon). */
export function shingleHashes(text: string, n = COPY_SHINGLE_WORDS): string[] {
  const w = copyWords(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(hash(w.slice(i, i + n).join(" ")));
  return [...out];
}

/** Empreinte du texte entier (normalisé). */
export function textHash(text: string): string {
  return hash(copyWords(text).join(" "));
}

/**
 * Le texte copie-t-il un post de référence ? Rend la suite de 8 mots fautive (pour le journal, 8 mots < 10), ou null.
 * `referenceShingles` : empreintes déjà gardées (`ReferencePost.shingles`) de tous les posts des références liées.
 */
export function copiedSequence(text: string, referenceShingles: Iterable<string>, n = COPY_SHINGLE_WORDS): string | null {
  const refs = referenceShingles instanceof Set ? (referenceShingles as Set<string>) : new Set(referenceShingles);
  if (refs.size === 0) return null;
  const w = copyWords(text);
  for (let i = 0; i + n <= w.length; i++) {
    const seq = w.slice(i, i + n).join(" ");
    if (refs.has(hash(seq))) return seq;
  }
  return null;
}

/** Coupe une citation à 10 mots au plus (« … » si coupée). */
export function shortQuote(text: string, max = MAX_QUOTE_WORDS): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.length <= max ? words.join(" ") : `${words.slice(0, max).join(" ")} …`;
}
