/**
 * Construction de l'analyse (pur, testé sur un jeu de `DailyStat` connu) :
 * - pub : ligne `DailyStat` `ad:<id>` + impressions et clics de ses `AdCost` ;
 * - groupe de pubs : somme de ses pubs + coûts saisis au niveau du groupe (le recalcul n'a pas de ligne par groupe) ;
 * - campagne : ligne `DailyStat` `campaign:<id>` (part du revenu comprise) + impressions et clics de ses coûts ;
 * - total : ligne sans doublon « toutes campagnes » les jours où elle existe, sinon somme des campagnes (même règle
 *   que la ligne Total du site, lib/dashboard/union-total.ts).
 */
import type { AdsAnalysis, AdsMetrics, AdsPeriod, AdsRow, AdsThresholds } from "../../ads/contracts";
import { addDaysToDay } from "../../rules/time";
import type { AdsDataset } from "./dataset";
import { UNION_DIMENSION } from "./dataset";
import { bottleneckOf, funnelRates, type FunnelRate } from "./funnel";
import { addRaw, EMPTY_RAW, sumRaw, toMetrics, variationsOf, type AdsRaw } from "./metrics";
import { adsRange, daysBetween, type AdsRange } from "./periods";
import { isAdsVertical } from "./thresholds";

export type RowKey = `ad:${string}` | `adset:${string}` | `campaign:${string}` | "total";
export type DailyMap = Map<RowKey, Map<string, AdsRaw>>;

/** Ligne détaillée : celle du contrat + ce qu'il faut aux règles et à la page (âge, groupe, entonnoir). */
export type AdsRowDetail = AdsRow & {
  adSetId: string | null;
  adSetName: string | null;
  campaignName: string | null;
  /** Jours depuis la première dépense (jusqu'à la fin de la période), null sans dépense connue. */
  ageDays: number | null;
  funnel: FunnelRate[];
  /** Pas de pub (ou de groupe) sous cette ligne : c'est elle qui porte les recommandations. */
  leaf: boolean;
};

export type AdsAnalysisDetail = Omit<AdsAnalysis, "rows"> & { rows: AdsRowDetail[]; range: AdsRange };

function bump(map: DailyMap, key: RowKey, day: string, raw: Partial<AdsRaw>) {
  const byDay = map.get(key) ?? new Map<string, AdsRaw>();
  byDay.set(day, addRaw(byDay.get(day) ?? { ...EMPTY_RAW }, raw));
  map.set(key, byDay);
}

/** Séries jour par jour de chaque pub, groupe, campagne et du total. */
export function buildDaily(ds: AdsDataset): DailyMap {
  const map: DailyMap = new Map();
  const adSetOf = new Map(ds.ads.map((a) => [a.id, a.adSetId]));
  const campaignOfSet = new Map(ds.adSets.map((s) => [s.id, s.campaignId]));
  const campaignIds = new Set(ds.campaigns.map((c) => c.id));
  const unionDays = new Map<string, Partial<AdsRaw>>();
  const campaignDays = new Map<string, AdsRaw>();
  for (const s of ds.stats) {
    if (s.dimension === UNION_DIMENSION) {
      unionDays.set(s.day, s.raw);
      continue;
    }
    const [kind, id] = [s.dimension.slice(0, s.dimension.indexOf(":")), s.dimension.slice(s.dimension.indexOf(":") + 1)];
    if (kind === "ad") {
      bump(map, `ad:${id}`, s.day, s.raw);
      const set = adSetOf.get(id);
      if (set) bump(map, `adset:${set}`, s.day, s.raw);
    } else if (kind === "campaign" && campaignIds.has(id)) {
      bump(map, `campaign:${id}`, s.day, s.raw);
      campaignDays.set(s.day, addRaw(campaignDays.get(s.day) ?? { ...EMPTY_RAW }, s.raw));
    }
  }
  for (const c of ds.costs) {
    const setId = c.adSetId ?? (c.adId ? (adSetOf.get(c.adId) ?? null) : null);
    const campaignId = c.campaignId ?? (setId ? (campaignOfSet.get(setId) ?? null) : null);
    const seen = { impressions: c.impressions, adClicks: c.clicks };
    if (c.adId) bump(map, `ad:${c.adId}`, c.day, seen);
    // Dépense d'un coût saisi au niveau du groupe : pas dans les lignes des pubs, ajoutée au groupe.
    if (setId) bump(map, `adset:${setId}`, c.day, c.adId ? seen : { ...seen, spend: c.spend });
    if (campaignId) bump(map, `campaign:${campaignId}`, c.day, seen);
    bump(map, "total", c.day, seen);
  }
  const days = new Set([...unionDays.keys(), ...campaignDays.keys()]);
  for (const d of days) {
    const u = unionDays.get(d);
    bump(map, "total", d, u ?? campaignDays.get(d) ?? {});
  }
  return map;
}

/** Somme d'une série sur des jours. */
export function rawOver(map: DailyMap, key: RowKey, days: readonly string[]): AdsRaw {
  const byDay = map.get(key);
  if (!byDay) return { ...EMPTY_RAW };
  return sumRaw(days.map((d) => byDay.get(d) ?? {}));
}

/** Premier jour de dépense de chaque pub, groupe et campagne (le plus ancien de ses niveaux). */
export function firstSpendDays(ds: AdsDataset): Map<RowKey, string> {
  const out = new Map<RowKey, string>();
  const adSetOf = new Map(ds.ads.map((a) => [a.id, a.adSetId]));
  const campaignOfSet = new Map(ds.adSets.map((s) => [s.id, s.campaignId]));
  const keep = (k: RowKey, day: string) => {
    const cur = out.get(k);
    if (!cur || day < cur) out.set(k, day);
  };
  for (const f of ds.firstSpend) {
    const setId = f.adSetId ?? (f.adId ? (adSetOf.get(f.adId) ?? null) : null);
    const campaignId = f.campaignId ?? (setId ? (campaignOfSet.get(setId) ?? null) : null);
    if (f.adId) keep(`ad:${f.adId}`, f.day);
    if (setId) keep(`adset:${setId}`, f.day);
    if (campaignId) keep(`campaign:${campaignId}`, f.day);
  }
  return out;
}

export function ageInDays(first: string | undefined, to: string): number | null {
  if (!first) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;
}

const active = (m: AdsMetrics) => m.spend > 0 || m.landingVisits > 0 || m.telegramJoins > 0 || m.registrations > 0 || m.commissions !== 0;

/** Analyse d'une période à partir des séries (pur). */
export function analysisFor(
  ds: AdsDataset,
  daily: DailyMap,
  period: AdsPeriod,
  thresholds: AdsThresholds,
  opts: { now: Date; cohorts?: AdsAnalysis["cohorts"] },
): AdsAnalysisDetail {
  const range = adsRange(period, opts.now);
  const cur = daysBetween(range.from, range.to);
  const prev = daysBetween(range.prevFrom, range.prevTo);
  const firsts = firstSpendDays(ds);
  const campaigns = new Map(ds.campaigns.map((c) => [c.id, c]));
  const sets = new Map(ds.adSets.map((s) => [s.id, s]));
  const setsWithAds = new Set(ds.ads.map((a) => a.adSetId));
  const campaignsWithSets = new Set(ds.adSets.map((s) => s.campaignId));
  const rows: AdsRowDetail[] = [];
  const push = (r: Omit<AdsRowDetail, "current" | "previous" | "variations" | "funnel" | "ageDays" | "enoughData" | "bottleneck">, key: RowKey) => {
    const current = toMetrics(rawOver(daily, key, cur));
    const previous = toMetrics(rawOver(daily, key, prev));
    if (!active(current) && !active(previous)) return;
    const ageDays = ageInDays(firsts.get(key), range.to);
    const t = isAdsVertical(r.vertical) ? thresholds[r.vertical] : null;
    const obs = t?.observationDays ?? 3;
    const minSpend = t?.minSpend ?? 20;
    rows.push({
      ...r,
      current,
      previous,
      variations: variationsOf(current, previous),
      funnel: funnelRates(current),
      ageDays,
      enoughData: ageDays !== null && ageDays >= obs && current.spend >= minSpend,
      bottleneck: null,
    });
  };
  for (const c of ds.campaigns)
    push({ level: "campaign", id: c.id, name: c.name, vertical: c.vertical, campaignId: c.id, campaignName: c.name, adSetId: null, adSetName: null, leaf: !campaignsWithSets.has(c.id) }, `campaign:${c.id}`);
  for (const s of ds.adSets) {
    const c = campaigns.get(s.campaignId);
    push({ level: "adset", id: s.id, name: s.name, vertical: c?.vertical ?? null, campaignId: s.campaignId, campaignName: c?.name ?? null, adSetId: s.id, adSetName: s.name, leaf: !setsWithAds.has(s.id) }, `adset:${s.id}`);
  }
  for (const a of ds.ads) {
    const s = sets.get(a.adSetId);
    const c = s ? campaigns.get(s.campaignId) : undefined;
    push({ level: "ad", id: a.id, name: a.name, vertical: c?.vertical ?? null, campaignId: c?.id ?? null, campaignName: c?.name ?? null, adSetId: a.adSetId, adSetName: s?.name ?? null, leaf: true }, `ad:${a.id}`);
  }
  // Goulot : par niveau et univers, parmi les lignes qui ont dépensé.
  for (const r of rows) {
    if (!r.enoughData) continue;
    const peers = rows.filter((p) => p.level === r.level && p.vertical === r.vertical && p.current.spend > 0).map((p) => p.current);
    const key = bottleneckOf(r.current, peers);
    r.bottleneck = key;
  }
  const totals = toMetrics(rawOver(daily, "total", cur));
  return {
    period,
    from: range.from,
    to: range.to,
    connectorsMissing: ds.activeConnections === 0,
    totals,
    rows,
    cohorts: opts.cohorts ?? [],
    range,
  };
}

/** Chiffres d'une ligne sur les `n` derniers jours complets (fenêtre d'observation des règles). */
export function windowRaw(daily: DailyMap, key: RowKey, now: Date, n: number, endOffset = 0): AdsRaw {
  const to = addDaysToDay(adsRange("yesterday", now).to, -endOffset);
  return rawOver(daily, key, daysBetween(addDaysToDay(to, -(n - 1)), to));
}

export const rowKeyOf = (r: Pick<AdsRow, "level" | "id">): RowKey => (r.level === "ad" ? `ad:${r.id}` : r.level === "adset" ? `adset:${r.id}` : `campaign:${r.id}`);
