/**
 * Analyse complète de l'Agent Ads (lecture seule) : données lues une fois, séries jour par jour, analyse de la
 * période, cohortes, seuils (enregistrés, sinon tirés des valeurs du milieu sur 28 jours).
 */
import type { AdsAnalysis, AdsPeriod, AdsThresholds } from "../../ads/contracts";
import type { AgentsPrisma } from "../../types";
import { analysisFor, buildDaily, type AdsAnalysisDetail, type DailyMap } from "./build";
import { adCohorts } from "./cohorts";
import { loadAdsCohortInputs, loadAdsDataset, type AdsDataset } from "./dataset";
import { ADS_THRESHOLDS_KEY, adsMedians, defaultAdsThresholds, parseAdsThresholds, type AdsThresholdsView } from "./thresholds";

/** Jours lus : 28 jours, les 28 d'avant, et aujourd'hui (alertes). */
export const ADS_DATASET_DAYS = 56;

export type AdsContext = {
  now: Date;
  dataset: AdsDataset;
  daily: DailyMap;
  thresholds: AdsThresholdsView;
  cohorts: AdsAnalysis["cohorts"];
};

/** Lit tout ce qu'il faut une fois (seuils compris). `cohorts: false` : sans les cohortes (alertes horaires). */
export async function loadAdsContext(prisma: AgentsPrisma, now: Date, opts: { cohorts?: boolean } = {}): Promise<AdsContext> {
  const dataset = await loadAdsDataset(prisma, now, ADS_DATASET_DAYS);
  const daily = buildDaily(dataset);
  const saved = (await prisma.setting.findUnique({ where: { key: ADS_THRESHOLDS_KEY } }))?.value;
  // Valeurs du milieu sur 28 jours (règles de « assez de données » : jours et dépense enregistrés ou par défaut).
  const base = parseAdsThresholds(saved, null).thresholds;
  const medians = adsMedians(analysisFor(dataset, daily, "28d", base, { now }).rows);
  const thresholds = parseAdsThresholds(saved, medians);
  let cohorts: AdsAnalysis["cohorts"] = [];
  if (opts.cohorts !== false) {
    const inputs = await loadAdsCohortInputs(prisma, now);
    cohorts = adCohorts(inputs.members, inputs.commissions, new Map(dataset.ads.map((a) => [a.id, a.name])));
  }
  return { now, dataset, daily, thresholds, cohorts };
}

export function analysisOf(ctx: AdsContext, period: AdsPeriod, thresholds: AdsThresholds = ctx.thresholds.thresholds): AdsAnalysisDetail {
  return analysisFor(ctx.dataset, ctx.daily, period, thresholds, { now: ctx.now, cohorts: ctx.cohorts });
}

export async function computeAdsAnalysisImpl(prisma: AgentsPrisma, q: { period: AdsPeriod; now?: Date }): Promise<AdsAnalysisDetail> {
  const ctx = await loadAdsContext(prisma, q.now ?? new Date());
  return analysisOf(ctx, q.period);
}

/** Seuils et leur explication (page Ads, question du bot). */
export async function loadAdsThresholdsView(prisma: AgentsPrisma, now = new Date()): Promise<AdsThresholdsView> {
  return (await loadAdsContext(prisma, now, { cohorts: false })).thresholds;
}

export { defaultAdsThresholds };
