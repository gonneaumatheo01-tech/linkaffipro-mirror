/**
 * Entrées des règles (pur) : pour chaque ligne de l'analyse, ses chiffres sur la fenêtre d'observation de son univers,
 * sur 7 jours et les 7 d'avant, sa dépense d'hier et le budget du jour de sa campagne.
 */
import type { AdsThresholds } from "../../ads/contracts";
import type { AdsRuleInput } from "../../rules/ads";
import { addDaysToDay } from "../../rules/time";
import { rowKeyOf, windowRaw, type AdsRowDetail, type DailyMap } from "./build";
import type { AdsDataset } from "./dataset";
import { toMetrics } from "./metrics";
import { adsRange } from "./periods";
import { DEFAULT_OBSERVATION_DAYS, isAdsVertical } from "./thresholds";

export function ruleInputs(rows: readonly AdsRowDetail[], daily: DailyMap, ds: AdsDataset, thresholds: AdsThresholds, now: Date): AdsRuleInput[] {
  const yesterday = adsRange("yesterday", now).to;
  const budgets = new Map(ds.campaigns.map((c) => [c.id, c.budgetDaily]));
  return rows.map((r) => {
    const key = rowKeyOf(r);
    const n = isAdsVertical(r.vertical) ? thresholds[r.vertical].observationDays : DEFAULT_OBSERVATION_DAYS;
    const campaignKey = r.campaignId ? (`campaign:${r.campaignId}` as const) : null;
    return {
      level: r.level,
      id: r.id,
      name: r.name,
      vertical: r.vertical,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      adSetId: r.adSetId,
      adSetName: r.adSetName,
      ageDays: r.ageDays,
      window: toMetrics(windowRaw(daily, key, now, n)),
      windowFrom: addDaysToDay(yesterday, -(n - 1)),
      windowTo: yesterday,
      last7: toMetrics(windowRaw(daily, key, now, 7)),
      prev7: toMetrics(windowRaw(daily, key, now, 7, 7)),
      spendYesterday: windowRaw(daily, key, now, 1).spend,
      budget: campaignKey ? { daily: budgets.get(r.campaignId!) ?? null, spentYesterday: windowRaw(daily, campaignKey, now, 1).spend } : null,
    };
  });
}
