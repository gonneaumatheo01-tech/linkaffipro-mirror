/**
 * Phase 31, chantier B — contrôle local de l'enrichissement (section 3.12, code) : champs obligatoires, chiffres
 * plausibles (vues ≤ abonnés × 5, ratios entre 0 et 1), dates cohérentes, lecture IA valide quand des posts ont été
 * lus. Un problème → `ENRICH_FAILED` avec la raison, un nouvel essai 6 h plus tard (`enrich.ts`).
 */
import type { ChannelAnalysis, ProspectMetrics } from "../contract";

export type QcInput = {
  username: string | null;
  title: string;
  subscribers: number | null;
  metrics: ProspectMetrics;
  /** Lecture IA (null si aucun post lisible, ou si la lecture n'a pas été demandée). */
  analysis: ChannelAnalysis | null;
  /** Des posts ont été lus : la lecture IA est alors obligatoire. */
  hasPosts: boolean;
  now: Date;
};

export type QcResult = { ok: boolean; problems: string[] };

/** Telegram ouvre les canaux publics en 2015 : une date antérieure est une lecture fausse. */
const TELEGRAM_CHANNELS_START = Date.UTC(2015, 8, 1);
const MAX_VIEWS_PER_SUB = 5;
const MAX_POSTS_PER_DAY = 300;

export function qcEnrichment(input: QcInput): QcResult {
  const problems: string[] = [];
  const m = input.metrics;
  if (!input.username) problems.push("nom public absent");
  if (!input.title.trim()) problems.push("titre absent");
  if (input.subscribers === null) problems.push("nombre d'abonnés absent");
  else if (!Number.isInteger(input.subscribers) || input.subscribers < 0) problems.push("nombre d'abonnés invalide");

  if (input.hasPosts) {
    if (!input.analysis) problems.push("lecture de l'IA absente ou invalide");
    if (input.subscribers !== null && input.subscribers > 0) {
      if ((m.medianViews ?? 0) > input.subscribers * MAX_VIEWS_PER_SUB) problems.push("vues médianes plus de 5 fois supérieures aux abonnés");
      if ((m.avgViews ?? 0) > input.subscribers * MAX_VIEWS_PER_SUB * 2) problems.push("vues moyennes invraisemblables");
    }
    for (const [name, v] of [
      ["part de transferts", m.forwardRatio],
      ["densité de liens", m.linkDensity],
    ] as const)
      if (v !== null && (v < 0 || v > 1)) problems.push(`${name} hors de 0 à 1`);
    if (m.postsPerDay !== null && (m.postsPerDay < 0 || m.postsPerDay > MAX_POSTS_PER_DAY)) problems.push("rythme de publication invraisemblable");
    if (m.lastPostAt && m.lastPostAt.getTime() > input.now.getTime() + 86_400_000) problems.push("dernier post dans le futur");
    if (m.firstSeenPostAt && m.firstSeenPostAt.getTime() < TELEGRAM_CHANNELS_START) problems.push("premier post avant l'ouverture des canaux Telegram");
    if (m.firstSeenPostAt && m.lastPostAt && m.firstSeenPostAt.getTime() > m.lastPostAt.getTime()) problems.push("dates des posts incohérentes");
    if (m.postingHours && (m.postingHours.length !== 24 || m.postingHours.reduce((a, b) => a + b, 0) !== m.posts30d)) problems.push("horaires de publication incohérents");
  }
  return { ok: problems.length === 0, problems };
}
