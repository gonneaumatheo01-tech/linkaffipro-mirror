/**
 * Alertes de l'Agent Ads (toutes les 30 minutes, file `agents-ads`), une par cible et par 24 h, coupables dans
 * Réglages → Alertes, écrites dans `Alert` et notifiées par le passage d'alertes du worker :
 * - `ads_spend_spike` : dépense d'une campagne (aujourd'hui ou hier) plus de X % au-dessus de sa moyenne des 7 jours ;
 * - `ads_conversion_drop` : inscriptions d'une campagne en baisse de plus de X % sur 7 jours alors que la pub dépense
 *   toujours (au moins la moitié de la dépense d'avant) ;
 * - `ads_cost_over_threshold` : coût par inscription au-dessus du seuil depuis N jours (même règle que « Arrêter ») ;
 * - `ads_budget_exhausted` : budget du jour de la campagne (`Campaign.budgetDaily`) atteint aujourd'hui.
 * Réglages : `Setting` `agents.ads.alerts` `{ spikePct, dropPct, minDailySpend, minRegistrations }`.
 */
import { ALERT_SETTINGS_KEY, parseAlertSwitches, type SwitchableAlertKind } from "@linkaffipro/core";
import { syncDropAlerts, type DropCandidate } from "../../algo/alerts";
import { nowOf } from "../../admin/journal";
import { enoughAdsData, overCostThreshold, type AdsRuleInput } from "../../rules/ads";
import { addDaysToDay } from "../../rules/time";
import type { AdsThresholds } from "../../ads/contracts";
import type { AgentsDeps } from "../../types";
import { analysisOf, loadAdsContext, type AdsContext } from "./analysis";
import { rawOver } from "./build";
import { ruleInputs } from "./inputs";
import { daysBetween } from "./periods";
import { isAdsVertical } from "./thresholds";

export const ADS_SPEND_SPIKE = "ads_spend_spike";
export const ADS_CONVERSION_DROP = "ads_conversion_drop";
export const ADS_COST_OVER_THRESHOLD = "ads_cost_over_threshold";
export const ADS_BUDGET_EXHAUSTED = "ads_budget_exhausted";
export const ADS_ALERT_KINDS = [ADS_SPEND_SPIKE, ADS_CONVERSION_DROP, ADS_COST_OVER_THRESHOLD, ADS_BUDGET_EXHAUSTED] as const;

export const ADS_ALERT_SETTINGS_KEY = "agents.ads.alerts";
export type AdsAlertSettings = { spikePct: number; dropPct: number; minDailySpend: number; minRegistrations: number };
export const DEFAULT_ADS_ALERT_SETTINGS: AdsAlertSettings = { spikePct: 50, dropPct: 50, minDailySpend: 10, minRegistrations: 5 };

export function parseAdsAlertSettings(v: unknown): AdsAlertSettings {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const n = (x: unknown, d: number, min: number, max: number) => (typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : d);
  const d = DEFAULT_ADS_ALERT_SETTINGS;
  return { spikePct: n(o.spikePct, d.spikePct, 1, 1000), dropPct: n(o.dropPct, d.dropPct, 1, 100), minDailySpend: n(o.minDailySpend, d.minDailySpend, 0, 100_000), minRegistrations: n(o.minRegistrations, d.minRegistrations, 1, 10_000) };
}

const eur = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const LINK = "Regardez Agents → Ads.";

/** Chiffres d'une campagne pour les alertes (pur). */
export type CampaignAlertFigures = {
  id: string;
  name: string;
  today: string;
  spendToday: number;
  spendYesterday: number;
  /** Moyenne par jour des 7 jours avant hier. */
  avg7: number;
  budgetDaily: number | null;
  registrations7: number;
  prevRegistrations7: number;
  spend7: number;
  prevSpend7: number;
};

export function spendSpikes(rows: readonly CampaignAlertFigures[], s: AdsAlertSettings): DropCandidate[] {
  const out: DropCandidate[] = [];
  for (const r of rows) {
    if (r.avg7 < s.minDailySpend) continue;
    const limit = r.avg7 * (1 + s.spikePct / 100);
    const [which, spend] = r.spendToday > limit ? (["aujourd'hui", r.spendToday] as const) : r.spendYesterday > limit ? (["hier", r.spendYesterday] as const) : [null, 0];
    if (!which) continue;
    const up = Math.round(((spend - r.avg7) / r.avg7) * 100);
    out.push({
      kind: ADS_SPEND_SPIKE,
      key: `campaign:${r.id}`,
      message: `Dépense anormale sur « ${r.name} » : ${eur(spend)} ${which}, soit ${up} % de plus que la moyenne des 7 jours (${eur(r.avg7)} par jour). ${LINK}`,
      payload: { campaignId: r.id, spend, average7: r.avg7, upPct: up, day: which === "hier" ? addDaysToDay(r.today, -1) : r.today },
    });
  }
  return out;
}

export function conversionDrops(rows: readonly CampaignAlertFigures[], s: AdsAlertSettings): DropCandidate[] {
  const out: DropCandidate[] = [];
  for (const r of rows) {
    if (r.prevRegistrations7 < s.minRegistrations || r.spend7 <= 0 || r.spend7 < r.prevSpend7 * 0.5) continue;
    const drop = Math.round(((r.prevRegistrations7 - r.registrations7) / r.prevRegistrations7) * 100);
    if (drop <= s.dropPct) continue;
    out.push({
      kind: ADS_CONVERSION_DROP,
      key: `campaign:${r.id}`,
      message: `Les inscriptions de « ${r.name} » chutent : ${r.registrations7} sur 7 jours contre ${r.prevRegistrations7} les 7 jours d'avant (−${drop} %), alors que la pub dépense toujours (${eur(r.spend7)}). ${LINK}`,
      payload: { campaignId: r.id, registrations7: r.registrations7, previous7: r.prevRegistrations7, dropPct: drop, spend7: r.spend7 },
    });
  }
  return out;
}

export function budgetsExhausted(rows: readonly CampaignAlertFigures[]): DropCandidate[] {
  return rows
    .filter((r) => r.budgetDaily !== null && r.budgetDaily > 0 && r.spendToday >= r.budgetDaily)
    .map((r) => ({
      kind: ADS_BUDGET_EXHAUSTED,
      key: `campaign:${r.id}:${r.today}`,
      message: `Budget du jour atteint sur « ${r.name} » : ${eur(r.spendToday)} dépensés pour un budget de ${eur(r.budgetDaily!)}. ${LINK}`,
      payload: { campaignId: r.id, spendToday: r.spendToday, budgetDaily: r.budgetDaily, day: r.today },
    }));
}

export function costsOverThreshold(inputs: readonly AdsRuleInput[], thresholds: AdsThresholds): DropCandidate[] {
  const out: DropCandidate[] = [];
  for (const i of inputs) {
    if (!isAdsVertical(i.vertical)) continue;
    const t = thresholds[i.vertical];
    if (!enoughAdsData(i, t) || i.spendYesterday <= 0 || !overCostThreshold(i.window, t.targetCostPerRegistration)) continue;
    const w = i.window;
    const what = w.registrations === 0 ? `${eur(w.spend)} dépensés sans inscription` : `${eur(w.costPerRegistration!)} par inscription`;
    out.push({
      kind: ADS_COST_OVER_THRESHOLD,
      key: `${i.level}:${i.id}`,
      message: `« ${i.name} » coûte trop cher depuis ${t.observationDays} jours : ${what} (seuil : ${eur(t.targetCostPerRegistration!)}). ${LINK}`,
      payload: { level: i.level, id: i.id, spend: w.spend, registrations: w.registrations, costPerRegistration: w.costPerRegistration, threshold: t.targetCostPerRegistration },
    });
  }
  return out;
}

/** Chiffres des campagnes (pur, depuis les séries). */
export function campaignAlertFigures(ctx: AdsContext): CampaignAlertFigures[] {
  const today = ctx.dataset.today;
  const yesterday = addDaysToDay(today, -1);
  const last7 = daysBetween(addDaysToDay(today, -7), yesterday);
  const prev7 = daysBetween(addDaysToDay(today, -14), addDaysToDay(today, -8));
  const before = daysBetween(addDaysToDay(today, -8), addDaysToDay(today, -2));
  return ctx.dataset.campaigns.map((c) => {
    const k = `campaign:${c.id}` as const;
    const cur = rawOver(ctx.daily, k, last7);
    const prev = rawOver(ctx.daily, k, prev7);
    return {
      id: c.id,
      name: c.name,
      today,
      spendToday: rawOver(ctx.daily, k, [today]).spend,
      spendYesterday: rawOver(ctx.daily, k, [yesterday]).spend,
      avg7: Math.round((rawOver(ctx.daily, k, before).spend / 7) * 100) / 100,
      budgetDaily: c.budgetDaily,
      registrations7: cur.registrations,
      prevRegistrations7: prev.registrations,
      spend7: cur.spend,
      prevSpend7: prev.spend,
    };
  });
}

export type AdsAlertsResult = Record<string, { created: number; resolved: number; detected: number } | { skipped: string } | { error: string }>;

export async function runAdsAlerts(deps: AgentsDeps, ctx?: AdsContext): Promise<AdsAlertsResult> {
  const now = nowOf(deps);
  const c = ctx ?? (await loadAdsContext(deps.prisma, now, { cohorts: false }));
  const switches = parseAlertSwitches((await deps.prisma.setting.findUnique({ where: { key: ALERT_SETTINGS_KEY } }))?.value);
  const settings = parseAdsAlertSettings((await deps.prisma.setting.findUnique({ where: { key: ADS_ALERT_SETTINGS_KEY } }))?.value);
  const figures = campaignAlertFigures(c);
  const analysis = analysisOf(c, "7d");
  const inputs = ruleInputs(analysis.rows.filter((r) => r.leaf), c.daily, c.dataset, c.thresholds.thresholds, now);
  const parts: Array<[SwitchableAlertKind, () => DropCandidate[]]> = [
    [ADS_SPEND_SPIKE, () => spendSpikes(figures, settings)],
    [ADS_CONVERSION_DROP, () => conversionDrops(figures, settings)],
    [ADS_COST_OVER_THRESHOLD, () => costsOverThreshold(inputs, c.thresholds.thresholds)],
    [ADS_BUDGET_EXHAUSTED, () => budgetsExhausted(figures)],
  ];
  const out: AdsAlertsResult = {};
  for (const [kind, detect] of parts) {
    try {
      // Coupée : rien n'est évalué, et une alerte ouverte de ce type se ferme.
      const found = switches[kind] ? detect() : [];
      const r = await syncDropAlerts(deps, kind, found, now);
      out[kind] = switches[kind] ? { ...r, detected: found.length } : { skipped: "alerte désactivée" };
    } catch (err) {
      out[kind] = { error: (err as Error).message };
      deps.logger?.warn({ kind, err: (err as Error).message }, "[agents] alerte pub impossible à évaluer");
    }
  }
  return out;
}
