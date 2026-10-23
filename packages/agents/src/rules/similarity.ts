/**
 * Doublons : similarité de Jaccard sur les trigrammes de caractères du texte visible normalisé (sans balises, accents,
 * casse, ponctuation, emojis, en-tête de simulation). Seuil réglable par équipe. Fonctions pures.
 */
import { stripHtml } from "@linkaffipro/core";
import { normalizeWords } from "./content";

export const DEFAULT_SIMILARITY_THRESHOLD = 0.6;

/** En-tête ajouté en simulation (« [SIMULATION équipe Dating → Canal] »), retiré avant toute comparaison. */
export function stripSimulationHeader(text: string): string {
  return text.replace(/^\s*\[SIMULATION[^\]\n]*\]\s*/i, "");
}

export function trigrams(text: string): Set<string> {
  const norm = normalizeWords(stripSimulationHeader(stripHtml(text)));
  const out = new Set<string>();
  if (!norm) return out;
  const s = ` ${norm} `;
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Jaccard des trigrammes, entre 0 (rien en commun) et 1 (identiques). Deux textes vides : 0. */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export type DuplicateMatch = { index: number; score: number };

/** Texte le plus proche parmi les précédents, s'il dépasse le seuil ; sinon null. */
export function findDuplicate(
  text: string,
  previous: readonly string[],
  threshold = DEFAULT_SIMILARITY_THRESHOLD,
): DuplicateMatch | null {
  let best: DuplicateMatch | null = null;
  previous.forEach((p, index) => {
    const score = similarity(text, p);
    if (score >= threshold && (!best || score > best.score)) best = { index, score };
  });
  return best;
}
