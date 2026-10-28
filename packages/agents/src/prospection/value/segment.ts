/**
 * Phase 32, chantier B — segments du Valorisateur (pur).
 *
 * Segment = verticale | premier pays | type de contenu | niveau (`segmentKey` du contrat, ex. `SPORTS|FR|tips_free|A`).
 * Trois finesses, de la plus précise à la plus large, pour trouver un calibrage même quand un segment exact n'a pas
 * assez d'affiliés : segment complet, puis `verticale|pays|*|*`, puis `verticale|*|*|*` (« * » = tous). Un coefficient
 * est lu au segment calibré le plus précis ; sans coefficient calibré, l'estimation est « non calibrée » (`default`).
 */
import { segmentKey, type ProspectSegment } from "../contract-advanced";
import type { ProspectTier, ProspectVertical } from "../contract";
import { stringArray } from "../score/settings";

export const SEGMENT_ANY = "*";

export type SegmentLevel = "full" | "country" | "vertical";
export const SEGMENT_LEVELS: readonly SegmentLevel[] = ["full", "country", "vertical"];

const TIERS = new Set(["A", "B", "C", "D"]);

/** Segment d'un prospect (lecture prudente des colonnes). */
export function segmentOf(p: { vertical: ProspectVertical | string; countries?: unknown; contentType?: string | null; tier?: string | null }): ProspectSegment {
  const vertical = (["SPORTS", "CASINO", "BOTH", "OTHER"].includes(String(p.vertical)) ? p.vertical : "OTHER") as ProspectVertical;
  const country = stringArray(p.countries)[0]?.trim().toUpperCase() || "?";
  const contentType = p.contentType?.trim() || "?";
  const tier = (p.tier && TIERS.has(p.tier) ? p.tier : "?") as ProspectTier | "?";
  return { vertical, country, contentType, tier };
}

/** Clé d'un segment à une finesse donnée. */
export function segmentKeyAt(s: ProspectSegment, level: SegmentLevel): string {
  if (level === "full") return segmentKey(s);
  if (level === "country") return `${s.vertical}|${s.country || "?"}|${SEGMENT_ANY}|${SEGMENT_ANY}`;
  return `${s.vertical}|${SEGMENT_ANY}|${SEGMENT_ANY}|${SEGMENT_ANY}`;
}

/** Clés à essayer pour lire un calibrage, de la plus précise à la plus large. */
export function segmentLookupKeys(s: ProspectSegment): string[] {
  return [...new Set(SEGMENT_LEVELS.map((l) => segmentKeyAt(s, l)))];
}

/** Libellé français d'une clé de segment (« Paris sportifs, France, niveau A »). */
export function segmentLabel(key: string): string {
  const [vertical, country, contentType, tier] = key.split("|");
  const parts: string[] = [];
  parts.push(vertical === "SPORTS" ? "paris sportifs" : vertical === "CASINO" ? "casino" : vertical === "BOTH" ? "paris et casino" : "autre univers");
  if (country && country !== SEGMENT_ANY && country !== "?") parts.push(country);
  if (contentType && contentType !== SEGMENT_ANY && contentType !== "?") parts.push(CONTENT_LABELS[contentType] ?? contentType);
  if (tier && tier !== SEGMENT_ANY && tier !== "?") parts.push(`niveau ${tier}`);
  return parts.join(", ");
}

const CONTENT_LABELS: Record<string, string> = {
  tips_free: "pronos gratuits",
  vip_sales: "vente de VIP",
  bonus_pushing: "bonus",
  streams_clips: "lives et extraits",
  news: "actus",
  mixed: "contenu mixte",
};
