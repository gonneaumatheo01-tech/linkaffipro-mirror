/**
 * Chiffres de l'Agent Ads (pur). Les compteurs viennent tels quels de `DailyStat` (recalcul du worker, attribution
 * existante) et de `AdCost` (impressions, clics chez la plateforme) ; gains et retour sur dépense passent par les
 * fonctions uniques de `@linkaffipro/core` (`gainsOf`, `commissionsRoas`), coûts par résultat comme le site
 * (`derive` de lib/dashboard/metrics.ts : dépense ÷ résultat, au centime).
 */
import { commissionsRoas, comparableVariation, gainsOf } from "@linkaffipro/core";
import type { AdsMetrics } from "../../ads/contracts";

/** Compteurs bruts d'une cible sur un jour (ou une période). */
export type AdsRaw = {
  spend: number;
  impressions: number;
  adClicks: number;
  /** `DailyStat.entryClicks` : clics sur le lien goolink de la pub + visites de ses pages d'atterrissage. */
  landingVisits: number;
  /** `DailyStat.requests` : demandes d'adhésion (entrée dans Telegram). */
  telegramJoins: number;
  /** `DailyStat.joined` : membres entrés. */
  members: number;
  offerClicks: number;
  registrations: number;
  ftds: number;
  deposits: number;
  commissions: number;
};

export const RAW_KEYS = [
  "spend",
  "impressions",
  "adClicks",
  "landingVisits",
  "telegramJoins",
  "members",
  "offerClicks",
  "registrations",
  "ftds",
  "deposits",
  "commissions",
] as const satisfies readonly (keyof AdsRaw)[];

export const EMPTY_RAW: Readonly<AdsRaw> = Object.freeze({
  spend: 0,
  impressions: 0,
  adClicks: 0,
  landingVisits: 0,
  telegramJoins: 0,
  members: 0,
  offerClicks: 0,
  registrations: 0,
  ftds: 0,
  deposits: 0,
  commissions: 0,
});

export const round2 = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
};

export function addRaw(a: AdsRaw, b: Partial<AdsRaw>): AdsRaw {
  const out = { ...a };
  for (const k of RAW_KEYS) out[k] = round2(out[k] + Number(b[k] ?? 0));
  return out;
}

export function sumRaw(rows: Iterable<Partial<AdsRaw>>): AdsRaw {
  let t: AdsRaw = { ...EMPTY_RAW };
  for (const r of rows) t = addRaw(t, r);
  return t;
}

const ratio = (num: number, den: number) => (den > 0 ? round2(num / den) : null);

/** Chiffres complets (gains, retour sur dépense, coûts par résultat). */
export function toMetrics(r: AdsRaw): AdsMetrics {
  return {
    ...r,
    gains: gainsOf(r.commissions, r.spend),
    roas: commissionsRoas(r.commissions, r.spend),
    costPerMember: ratio(r.spend, r.members),
    costPerRegistration: ratio(r.spend, r.registrations),
    costPerFtd: ratio(r.spend, r.ftds),
  };
}

export const EMPTY_METRICS: Readonly<AdsMetrics> = Object.freeze(toMetrics(EMPTY_RAW));

/** Variations de chaque chiffre (règle unique `comparableVariation`). */
export function variationsOf(cur: AdsMetrics, prev: AdsMetrics): Record<keyof AdsMetrics, ReturnType<typeof comparableVariation>> {
  const out = {} as Record<keyof AdsMetrics, ReturnType<typeof comparableVariation>>;
  for (const k of Object.keys(cur) as (keyof AdsMetrics)[]) out[k] = comparableVariation(cur[k], prev[k]);
  return out;
}

/** Valeur du milieu (null sur une liste vide). */
export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}
