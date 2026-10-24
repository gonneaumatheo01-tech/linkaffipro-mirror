/**
 * Seuils de l'Agent Ads par univers (`Setting` `agents.ads.thresholds`, type `AdsThresholds`). Valeurs de départ
 * tirées des données existantes (valeur du milieu des pubs sur 28 jours) :
 * - coût par inscription au-dessus duquel arrêter = valeur du milieu × 1,5 ;
 * - retour sur dépense minimal pour augmenter = valeur du milieu × 1,5, jamais sous 1,2 (on ne conseille pas
 *   d'augmenter une pub qui rapporte à peine ce qu'elle coûte) ;
 * - pas assez de pubs comparables (3) : valeurs raisonnables 30 € et 1,5, dites comme telles ;
 * - 3 jours d'observation et 20 € de dépense minimale avant toute conclusion.
 */
import type { AdsRow, AdsThresholds } from "../../ads/contracts";
import { median, round2 } from "./metrics";

export const ADS_THRESHOLDS_KEY = "agents.ads.thresholds";
export const ADS_VERTICALS = ["CASINO", "SPORTS", "DATING"] as const;
export type AdsVertical = (typeof ADS_VERTICALS)[number];
export const ADS_VERTICAL_LABELS: Record<AdsVertical, string> = { CASINO: "Casino", SPORTS: "Paris sportifs", DATING: "Rencontres" };

export const DEFAULT_OBSERVATION_DAYS = 3;
export const DEFAULT_MIN_SPEND = 20;
export const FALLBACK_COST_PER_REGISTRATION = 30;
export const FALLBACK_MIN_ROAS = 1.5;
export const MIN_ROAS_FLOOR = 1.2;
export const MEDIAN_MULTIPLIER = 1.5;
/** Pubs comparables minimum pour une valeur du milieu. */
export const MEDIAN_MIN_ADS = 3;

export type AdsMedian = { costPerRegistration: number | null; roas: number | null; ads: number };
export type AdsMedians = Record<AdsVertical | "ALL", AdsMedian>;

export function isAdsVertical(v: unknown): v is AdsVertical {
  return typeof v === "string" && (ADS_VERTICALS as readonly string[]).includes(v);
}

/** Valeurs du milieu par univers et tous univers (pubs avec au moins la dépense minimale). */
export function adsMedians(rows: readonly AdsRow[], minSpend = DEFAULT_MIN_SPEND): AdsMedians {
  const ads = rows.filter((r) => r.level === "ad" && r.current.spend >= minSpend);
  const of = (list: readonly AdsRow[]): AdsMedian => {
    const cpr = list.map((r) => r.current.costPerRegistration).filter((v): v is number => v !== null);
    const roas = list.map((r) => r.current.roas).filter((v): v is number => v !== null);
    return {
      costPerRegistration: cpr.length >= MEDIAN_MIN_ADS ? round2(median(cpr)!) : null,
      roas: roas.length >= MEDIAN_MIN_ADS ? Math.round(median(roas)! * 100) / 100 : null,
      ads: list.length,
    };
  };
  const out = { ALL: of(ads) } as AdsMedians;
  for (const v of ADS_VERTICALS) out[v] = of(ads.filter((r) => r.vertical === v));
  return out;
}

/** Coût par inscription proposé pour un multiplicateur (valeur du milieu de l'univers, sinon tous univers, sinon 30 €). */
export function suggestedCostPerRegistration(m: AdsMedians, v: AdsVertical | "ALL", multiplier = MEDIAN_MULTIPLIER): { value: number; fromData: boolean } {
  const base = m[v].costPerRegistration ?? m.ALL.costPerRegistration;
  if (base === null) return { value: multiplier === MEDIAN_MULTIPLIER ? FALLBACK_COST_PER_REGISTRATION : FALLBACK_COST_PER_REGISTRATION * (multiplier / MEDIAN_MULTIPLIER), fromData: false };
  return { value: Math.max(1, Math.round(base * multiplier)), fromData: true };
}

/** Retour sur dépense minimal proposé (jamais sous 1,2). */
export function suggestedMinRoas(m: AdsMedians, v: AdsVertical | "ALL", multiplier = MEDIAN_MULTIPLIER): { value: number; fromData: boolean } {
  const base = m[v].roas ?? m.ALL.roas;
  if (base === null) return { value: Math.round(FALLBACK_MIN_ROAS * (multiplier / MEDIAN_MULTIPLIER) * 10) / 10, fromData: false };
  return { value: Math.max(MIN_ROAS_FLOOR, Math.round(base * multiplier * 10) / 10), fromData: true };
}

export function defaultAdsThresholds(m?: AdsMedians | null): AdsThresholds {
  const out = {} as AdsThresholds;
  for (const v of ADS_VERTICALS)
    out[v] = {
      targetCostPerRegistration: m ? suggestedCostPerRegistration(m, v).value : FALLBACK_COST_PER_REGISTRATION,
      minRoas: m ? suggestedMinRoas(m, v).value : FALLBACK_MIN_ROAS,
      observationDays: DEFAULT_OBSERVATION_DAYS,
      minSpend: DEFAULT_MIN_SPEND,
    };
  return out;
}

export type ThresholdSource = "saved" | "data" | "default";
export type AdsThresholdsView = {
  thresholds: AdsThresholds;
  /** D'où vient chaque valeur : enregistrée, tirée des données (valeur du milieu × 1,5), valeur raisonnable. */
  sources: Record<AdsVertical, Record<keyof AdsThresholds[AdsVertical], ThresholdSource>>;
  medians: AdsMedians | null;
};

const num = (x: unknown, min: number, max: number): number | undefined =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : undefined;

/** Seuils enregistrés complétés par les valeurs de départ (champ absent ou invalide = valeur de départ). */
export function parseAdsThresholds(value: unknown, medians?: AdsMedians | null): AdsThresholdsView {
  const defaults = defaultAdsThresholds(medians);
  const saved = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const thresholds = {} as AdsThresholds;
  const sources = {} as AdsThresholdsView["sources"];
  for (const v of ADS_VERTICALS) {
    const s = saved[v] && typeof saved[v] === "object" ? (saved[v] as Record<string, unknown>) : {};
    const d = defaults[v];
    const cpr = s.targetCostPerRegistration === null ? null : num(s.targetCostPerRegistration, 0.01, 100_000);
    const roas = s.minRoas === null ? null : num(s.minRoas, 0.01, 1000);
    const obs = num(s.observationDays, 1, 28);
    const spend = num(s.minSpend, 0, 100_000);
    const dataSrc: ThresholdSource = medians ? "data" : "default";
    thresholds[v] = {
      targetCostPerRegistration: cpr !== undefined ? cpr : d.targetCostPerRegistration,
      minRoas: roas !== undefined ? roas : d.minRoas,
      observationDays: obs !== undefined ? Math.round(obs) : d.observationDays,
      minSpend: spend !== undefined ? spend : d.minSpend,
    };
    const fromData = (kind: "cpr" | "roas") =>
      medians && (kind === "cpr" ? suggestedCostPerRegistration(medians, v) : suggestedMinRoas(medians, v)).fromData ? dataSrc : "default";
    sources[v] = {
      targetCostPerRegistration: cpr !== undefined ? "saved" : fromData("cpr"),
      minRoas: roas !== undefined ? "saved" : fromData("roas"),
      observationDays: obs !== undefined ? "saved" : "default",
      minSpend: spend !== undefined ? "saved" : "default",
    };
  }
  return { thresholds, sources, medians: medians ?? null };
}

/** Phrase d'explication d'une valeur de départ (page Ads, question du bot). */
export function thresholdExplanation(source: ThresholdSource, kind: "cpr" | "roas"): string {
  if (source === "saved") return "Valeur choisie par l'équipe.";
  if (source === "data")
    return kind === "cpr"
      ? "Valeur de départ : 1,5 fois le coût par inscription du milieu de vos pubs sur 28 jours."
      : "Valeur de départ : 1,5 fois le retour sur dépense du milieu de vos pubs sur 28 jours (jamais sous 1,2).";
  return kind === "cpr"
    ? "Pas encore assez de pubs pour une valeur tirée des chiffres : valeur raisonnable de 30 € par inscription."
    : "Pas encore assez de pubs pour une valeur tirée des chiffres : valeur raisonnable de 1,5.";
}

/** Fusion d'une modification dans les seuils enregistrés (questions du bot). */
export function patchThresholds(saved: unknown, patch: Partial<Record<AdsVertical, Partial<AdsThresholds[AdsVertical]>>>): Record<string, unknown> {
  const base = saved && typeof saved === "object" && !Array.isArray(saved) ? { ...(saved as Record<string, unknown>) } : {};
  for (const v of ADS_VERTICALS) {
    if (!patch[v]) continue;
    const cur = base[v] && typeof base[v] === "object" ? (base[v] as Record<string, unknown>) : {};
    base[v] = { ...cur, ...patch[v] };
  }
  return base;
}
