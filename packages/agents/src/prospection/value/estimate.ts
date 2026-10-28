/**
 * Phase 32, chantier B — valeur estimée mensuelle d'un prospect (code pur, aucune IA ; section 3 du prompt).
 *
 * - portée promo = posts/jour × 30 × vues médianes × part de posts promotionnels (observée chez le canal : liens vers
 *   des marques ÷ posts lus ; sinon réglage `prospection.value.promo_share` = 0,25) ;
 * - clics = portée × taux de clic (réglage de base 0,015 × coefficient `ctr_factor` du segment) ;
 * - inscriptions = clics × 0,10 ; premiers dépôts = inscriptions × 0,30 × coefficient `ftd_factor` du segment ;
 * - CPA : premiers dépôts × CPA ; revshare : premiers dépôts × ARPU mensuel × % (ARPU absent → part revshare absente,
 *   notée dans `missing`, jamais inventée) ; hybride : somme ; type d'offre sans montant (`pending`) → pas de valeur ;
 * - fourchette = base × [0,4 ; 1 ; 2,2], réduite par l'authenticité (canal générique × 0,6) et chaque signal de faux
 *   (× 0,8) ; confiance = posts lus, confiance du pays, calibrage du segment (jamais « haute » sans calibrage).
 * Montants arrondis (aucune fausse précision) ; une estimation reste une fourchette avec ses hypothèses.
 */
import { VALUE_DEFAULTS, VALUE_RANGE, type ValueEstimate } from "../contract-advanced";
import { FAKE_FLAG_LABELS } from "../score/format";
import { objectOf, stringArray } from "../score/settings";
import type { FakeFlag } from "../contract";

export type ValueSettings = { promoShare: number; ctr: number; regRate: number; ftdRate: number; arpuMonth: number | null };

export const DEFAULT_VALUE_SETTINGS: ValueSettings = {
  promoShare: VALUE_DEFAULTS.promoShare.value,
  ctr: VALUE_DEFAULTS.ctr.value,
  regRate: VALUE_DEFAULTS.regRate.value,
  ftdRate: VALUE_DEFAULTS.ftdRate.value,
  arpuMonth: VALUE_DEFAULTS.arpuMonth.value,
};

/** Coefficients lus pour le segment (null : non calibrée). */
export type SegmentCalibration = { segment: string; ctrFactor: number; ftdFactor: number; source: string } | null;

/** Deal retenu : offre appariée, ou conditions signées avec le prospect (prioritaires). */
export type DealTerms =
  | { kind: "cpa"; cpa: number }
  | { kind: "revshare"; revsharePct: number }
  | { kind: "hybrid"; cpa: number; revsharePct: number }
  | { kind: "pending"; type: string };

export type EstimateInput = {
  postsPerDay: number | null;
  medianViews: number | null;
  /** Part de posts promotionnels observée (0-1), null si inconnue. */
  promoShareObserved: number | null;
  authenticity: string | null;
  fakeFlags: readonly string[];
  /** Posts lus à la dernière lecture (confiance). */
  postsRead: number | null;
  geoConfidence: number | null;
  deal: DealTerms | null;
  offerId: string | null;
};

export type EstimateOutcome = { ok: true; estimate: ValueEstimate } | { ok: false; reason: string; missing: string[] };

/** Raisons d'une valeur absente (texte court, montré par Kevin et le site). */
export const NO_VALUE_REASONS = {
  measures: "pas assez de mesures (posts par jour ou vues médianes)",
  offer: "aucune offre ne colle à ce canal",
  pending: "offre sans montant : donne le montant pour estimer",
  arpu: "offre en revshare sans revenu mensuel par joueur : donne-le pour estimer",
} as const;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

/**
 * Conditions d'une offre (`AffiliateOffer.dealTypes`) : `{ cpa }`, `{ revshare }`, `{ hybrid: { cpa, revshare } }`,
 * `{ pending: "HYBRID" }` (type sans montant). Hybride d'abord, puis CPA, puis revshare. Null si rien de lisible.
 */
export function dealFromOffer(dealTypes: unknown): DealTerms | null {
  const d = objectOf(dealTypes);
  const h = objectOf(d.hybrid);
  const hc = positive(h.cpa);
  const hr = positive(h.revshare);
  if (hc !== null && hr !== null) return { kind: "hybrid", cpa: hc, revsharePct: hr };
  const cpa = positive(d.cpa);
  if (cpa !== null) return { kind: "cpa", cpa };
  const rs = positive(d.revshare);
  if (rs !== null) return { kind: "revshare", revsharePct: rs };
  if (hc !== null) return { kind: "cpa", cpa: hc };
  if (typeof d.pending === "string" && d.pending.trim()) return { kind: "pending", type: d.pending.trim().toUpperCase() };
  return null;
}

/** Conditions signées (`Prospect.dealType` / `dealTerms` : `{ cpa?, revshare? }`). Null si absentes ou illisibles. */
export function dealFromSigned(dealType: string | null | undefined, dealTerms: unknown): DealTerms | null {
  if (!dealType) return null;
  const t = objectOf(dealTerms);
  const cpa = positive(t.cpa);
  const rs = positive(t.revshare);
  if (dealType === "HYBRID") return cpa !== null && rs !== null ? { kind: "hybrid", cpa, revsharePct: rs } : { kind: "pending", type: "HYBRID" };
  if (dealType === "CPA") return cpa !== null ? { kind: "cpa", cpa } : { kind: "pending", type: "CPA" };
  if (dealType === "REVSHARE") return rs !== null ? { kind: "revshare", revsharePct: rs } : { kind: "pending", type: "REVSHARE" };
  return null;
}

/** Part de posts promotionnels observée : liens vers des marques ÷ posts lus (bornée 0,05-0,8), null sans données. */
export function observedPromoShare(brands: unknown, postsRead: number | null): number | null {
  if (!postsRead || postsRead <= 0 || !Array.isArray(brands) || !brands.length) return null;
  const links = (brands as unknown[]).reduce<number>((s, b) => s + Math.max(0, num(objectOf(b).links) ?? 0), 0);
  if (links <= 0) return null;
  return Math.min(0.8, Math.max(0.05, links / postsRead));
}

/** Arrondi lisible : à l'euro sous 100, à 10 € sous 1 000, à 50 € au-delà. */
export function roundEuros(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 100) return Math.round(n);
  if (n < 1000) return Math.round(n / 10) * 10;
  return Math.round(n / 50) * 50;
}

const frNum = (n: number) => String(n).replace(".", ",");
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** Confiance : posts lus, confiance du pays, calibrage (sans calibrage : « moyenne » au mieux). */
export function confidenceOf(postsRead: number | null, geoConfidence: number | null, calibrated: boolean): ValueEstimate["confidence"] {
  let pts = 0;
  if ((postsRead ?? 0) >= 30) pts += 1;
  else if ((postsRead ?? 0) >= 10) pts += 0.5;
  if ((geoConfidence ?? 0) >= 0.8) pts += 1;
  else if ((geoConfidence ?? 0) >= 0.6) pts += 0.5;
  if (calibrated) pts += 1;
  return pts >= 2.5 ? "high" : pts >= 1.5 ? "medium" : "low";
}

/** Calcul complet (pur). */
export function estimateValue(input: EstimateInput, settings: ValueSettings, calibration: SegmentCalibration, now: Date): EstimateOutcome {
  const missing: string[] = [];
  const ppd = input.postsPerDay;
  const views = input.medianViews;
  if (ppd === null || views === null || ppd <= 0 || views <= 0) return { ok: false, reason: NO_VALUE_REASONS.measures, missing: ["postsPerDay", "medianViews"].filter((k) => (k === "postsPerDay" ? !ppd : !views)) };
  if (!input.deal) return { ok: false, reason: NO_VALUE_REASONS.offer, missing: ["offer"] };
  if (input.deal.kind === "pending") return { ok: false, reason: NO_VALUE_REASONS.pending, missing: ["dealAmount"] };

  const calibrated = !!calibration && calibration.source === "calibrated";
  const ctrFactor = calibrated ? calibration!.ctrFactor : 1;
  const ftdFactor = calibrated ? calibration!.ftdFactor : 1;
  const promoShare = input.promoShareObserved ?? settings.promoShare;
  const promoReach = ppd * 30 * views * promoShare;
  const ctr = settings.ctr * ctrFactor;
  const clicks = promoReach * ctr;
  const regs = clicks * settings.regRate;
  const ftdRate = settings.ftdRate * ftdFactor;
  const ftd = regs * ftdRate;

  let cpa: number | null = null;
  let revsharePct: number | null = null;
  let value = 0;
  const deal = input.deal;
  if (deal.kind === "cpa" || deal.kind === "hybrid") {
    cpa = deal.cpa;
    value += ftd * deal.cpa;
  }
  if (deal.kind === "revshare" || deal.kind === "hybrid") {
    revsharePct = deal.revsharePct;
    if (settings.arpuMonth !== null && settings.arpuMonth > 0) value += ftd * settings.arpuMonth * (deal.revsharePct / 100);
    else missing.push("arpu_month");
  }
  if (deal.kind === "revshare" && missing.includes("arpu_month")) return { ok: false, reason: NO_VALUE_REASONS.arpu, missing };

  const reductions: string[] = [];
  let factor = 1;
  if (input.authenticity === "SUSPECT_GENERIC") {
    factor *= VALUE_RANGE.suspectGeneric;
    reductions.push(`canal générique × ${frNum(VALUE_RANGE.suspectGeneric)}`);
  }
  const fakes = [...new Set(input.fakeFlags)];
  for (const f of fakes) {
    factor *= VALUE_RANGE.perFakeFlag;
    reductions.push(`${FAKE_FLAG_LABELS[f as FakeFlag] ?? "signal de faux"} × ${frNum(VALUE_RANGE.perFakeFlag)}`);
  }
  const base = value * factor;
  const estimate: ValueEstimate = {
    low: roundEuros(base * VALUE_RANGE.low),
    base: roundEuros(base * VALUE_RANGE.base),
    high: roundEuros(base * VALUE_RANGE.high),
    currency: "EUR",
    assumptions: {
      promoReach: Math.round(promoReach),
      promoShare: round(promoShare),
      ctr: round(ctr, 5),
      regRate: round(settings.regRate),
      ftdRate: round(ftdRate),
      cpa,
      revsharePct,
      arpuMonth: settings.arpuMonth,
      reductions,
      missing,
    },
    calibratedBy: calibrated ? calibration!.segment : "default",
    confidence: confidenceOf(input.postsRead, input.geoConfidence, calibrated),
    computedAt: now.toISOString(),
    offerId: input.offerId,
  };
  return { ok: true, estimate };
}

/** Clics et premiers dépôts mensuels estimés (comparaison avec le réel). */
export function estimatedVolumes(v: ValueEstimate): { clicks: number; ftd: number } {
  const clicks = v.assumptions.promoReach * v.assumptions.ctr;
  return { clicks, ftd: clicks * v.assumptions.regRate * v.assumptions.ftdRate };
}

/** Lecture prudente de `Prospect.valueEstimate` (null si absente ou illisible). */
export function valueEstimateOf(v: unknown): ValueEstimate | null {
  const o = objectOf(v);
  const a = objectOf(o.assumptions);
  if (typeof o.low !== "number" || typeof o.base !== "number" || typeof o.high !== "number" || typeof a.promoReach !== "number") return null;
  return {
    low: o.low,
    base: o.base,
    high: o.high,
    currency: "EUR",
    assumptions: {
      promoReach: a.promoReach,
      promoShare: num(a.promoShare) ?? DEFAULT_VALUE_SETTINGS.promoShare,
      ctr: num(a.ctr) ?? DEFAULT_VALUE_SETTINGS.ctr,
      regRate: num(a.regRate) ?? DEFAULT_VALUE_SETTINGS.regRate,
      ftdRate: num(a.ftdRate) ?? DEFAULT_VALUE_SETTINGS.ftdRate,
      cpa: num(a.cpa),
      revsharePct: num(a.revsharePct),
      arpuMonth: num(a.arpuMonth),
      reductions: stringArray(a.reductions),
      missing: stringArray(a.missing),
    },
    calibratedBy: typeof o.calibratedBy === "string" ? o.calibratedBy : "default",
    confidence: o.confidence === "high" || o.confidence === "medium" ? o.confidence : "low",
    computedAt: typeof o.computedAt === "string" ? o.computedAt : "",
    offerId: typeof o.offerId === "string" ? o.offerId : null,
  };
}
