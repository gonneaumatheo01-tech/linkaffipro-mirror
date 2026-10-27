/**
 * Phase 31, chantier B — filtres durs (section 3.4, code) : un canal qui tombe dans l'un d'eux est DISQUALIFIED
 * (niveau D) avec une raison lisible. Sans posts lisibles (aperçu fermé), aucun filtre ne s'applique : on ne juge pas
 * ce qu'on n'a pas lu (le score est plafonné ailleurs).
 */
import { PROSPECTION_LIMITS, PROSPECTION_SETTINGS, type ProspectMetrics } from "../contract";

export type HardFilterCode = "ABANDONED" | "NEARLY_DEAD" | "LOW_AUDIENCE" | "REPOST";
export type HardFilterHit = { code: HardFilterCode; reason: string };
export type HardFilterSettings = { minPosts30d: number; minMedianViews: number; now: Date };

export const DEFAULT_HARD_FILTER_SETTINGS = {
  minPosts30d: PROSPECTION_SETTINGS.minPosts30d.value,
  minMedianViews: PROSPECTION_SETTINGS.minMedianViews.value,
} as const;

const DAY = 86_400_000;
const fr = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** Raisons de disqualification, dans l'ordre (la première sert de `tierReason`). */
export function hardFilters(metrics: ProspectMetrics, settings: HardFilterSettings): HardFilterHit[] {
  const hits: HardFilterHit[] = [];
  if (!metrics.postCount) return hits;
  if (metrics.lastPostAt) {
    const days = Math.floor((settings.now.getTime() - metrics.lastPostAt.getTime()) / DAY);
    if (days > PROSPECTION_LIMITS.abandonedAfterDays) hits.push({ code: "ABANDONED", reason: `abandonné : aucun post depuis ${days} jours` });
  }
  if ((metrics.postsPerDay ?? 0) * 30 < settings.minPosts30d)
    hits.push({ code: "NEARLY_DEAD", reason: `quasi mort : ${fr(Math.round((metrics.postsPerDay ?? 0) * 30))} posts en 30 jours (minimum ${settings.minPosts30d})` });
  if (metrics.medianViews !== null && metrics.medianViews < settings.minMedianViews)
    hits.push({ code: "LOW_AUDIENCE", reason: `audience trop faible : ${fr(metrics.medianViews)} vues par post (minimum ${settings.minMedianViews})` });
  if ((metrics.forwardRatio ?? 0) > PROSPECTION_LIMITS.repostForwardRatio)
    hits.push({ code: "REPOST", reason: `ne fait que transférer : ${Math.round((metrics.forwardRatio ?? 0) * 100)} % de posts transférés` });
  return hits;
}
