/**
 * Phase 32, chantier B — calibrage à partir des vrais résultats Link Affi (règle 4 : proposé, jamais imposé).
 *
 * Échantillons (`loadSamples`) : un par affilié signé et rattaché, résultats `AffiliateResult` comptés depuis la
 * signature (jours couverts), ramenés à 30 jours ; portée promo de son estimation (`valueEstimate`).
 *
 * Code pur :
 * - coefficients par segment (`coefficientProposals`) : ratio réel ÷ estimé de base (sans coefficient) des clics
 *   (→ `ctr_factor`) et de la conversion clics → premiers dépôts (→ `ftd_factor`), médiane des ratios écrêtés à
 *   [0,25 ; 4], seulement avec ≥ 3 affiliés ayant chacun ≥ 30 jours de données ; segment complet, puis
 *   `verticale|pays|*|*`, puis `verticale|*|*|*` (un groupe large n'est proposé que s'il apporte des affiliés que les
 *   groupes fins ne couvrent pas) ; un coefficient bouge de 50 % au plus par mois (base = valeur du début de la période) ;
 * - attribution des sources (`attribution`) : part des A, des signés et des actifs par provenance et par pays ;
 *   répartition proposée de la recherche de canaux (`proposeShares`, `Setting prospection.discovery_shares`), chaque
 *   part bouge de 20 % au plus par mois, dès 3 signés ;
 * - poids du score (`proposeWeights`) : composante (rapportée à son poids) des signés / actifs contre celle des
 *   contactés sans réponse (≥ 3 de chaque côté) ; écart ≥ 0,15 → ce poids bouge de 20 % au plus, les autres
 *   compensent (somme 100), chacun dans ses 20 %.
 * Écriture (`proposeCalibration`) : propositions `Recommendation` (`teamKey = "prospection"`,
 * `source = "prospection_calibration"`, `target` / `field` explicites), texte rédigé par Opus avec les chiffres du code
 * seulement, vérifiées par le QA Global, présentées par Kevin en choix numérotés ; les propositions du mois d'avant
 * encore ouvertes sont closes (remplacées).
 */
import { agentEvent } from "../../admin/journal";
import { pick } from "../../boss/voice";
import { checkRecommendations } from "../../qa-gates/recommendations";
import type { QaDeps } from "../../qa/contract";
import { PROSPECTION_SETTINGS, PROSPECTION_TEAM_KEY, type ProspectStatus, type ScoreWeights } from "../contract";
import { CALIBRATION_BOUNDS, CALIBRATION_SOURCE, type ProspectSegment, type ValueEstimate } from "../contract-advanced";
import type { ProspectionKevinDeps } from "../kevin-port";
import { medianOf } from "../pipeline/stats";
import { SOURCE_TYPE_LABELS, capitalize, countryName, formatPct, handleOf } from "../score/format";
import { DAY_MS, objectOf, prospectionNow, rawProspectionSetting, stringArray, weightsOf } from "../score/settings";
import { parisDay } from "../../rules/time";
import { loadValueSettings, type ValueSettings } from "../value/index";
import { valueEstimateOf } from "../value/estimate";
import { SEGMENT_LEVELS, segmentKeyAt, segmentLabel, segmentOf, type SegmentLevel } from "../value/segment";
import { writeCalibrationLines } from "./ai";
import { calibrationChoicesMessage, closeCalibrationExperiments } from "./apply";
import { daysInMonth } from "./pull";
import { CALIBRATION_VARIANTS } from "./texts";

type Deps = ProspectionKevinDeps & QaDeps;

// ————— Cibles des propositions —————

export const CALIBRATION_TARGETS = {
  coefficient: "PROSPECTION_CALIBRATION",
  weights: "PROSPECTION_WEIGHTS",
  shares: "PROSPECTION_DISCOVERY",
} as const;
export const DISCOVERY_SHARES_KEY = "prospection.discovery_shares";
export const DISCOVERY_SHARE_SOURCES = ["directories", "web_search", "social", "graph", "analysts"] as const;
export type DiscoveryShareSource = (typeof DISCOVERY_SHARE_SOURCES)[number];
export type DiscoveryShares = Record<DiscoveryShareSource, number>;
export const DEFAULT_DISCOVERY_SHARES: DiscoveryShares = { directories: 0.2, web_search: 0.2, social: 0.2, graph: 0.2, analysts: 0.2 };
/** Provenance d'un prospect → source de découverte (MANUAL et ACCOUNT_SEARCH hors répartition). */
export const SOURCE_TYPE_TO_DISCOVERY: Record<string, DiscoveryShareSource> = {
  DIRECTORY: "directories",
  WEB_SEARCH: "web_search",
  SOCIAL: "social",
  GRAPH_FORWARD: "graph",
  GRAPH_MENTION: "graph",
  FOLDER: "graph",
  ANALYSTS: "analysts",
};
export const DISCOVERY_LABELS: Record<DiscoveryShareSource, string> = {
  directories: "annuaires",
  web_search: "recherche web",
  social: "réseaux sociaux",
  graph: "liens entre canaux",
  analysts: "veille des Analystes",
};
/** Écart minimal d'une composante du score (rapportée à son poids) pour proposer un poids. */
export const WEIGHT_MIN_GAP = 0.15;
/** Propositions de coefficients au plus par mois. */
export const MAX_COEFFICIENT_PROPOSALS = 6;
const EPS = 1e-6;

// ————— Échantillons —————

export type CalibrationSample = {
  prospectId: string;
  handle: string;
  segment: ProspectSegment;
  sourceType: string;
  days: number;
  realClicks: number | null;
  realRegs: number | null;
  realFtd: number | null;
  revenueCents: number | null;
  /** Portée promo mensuelle (vues), null sans estimation. */
  promoReach: number | null;
  estimate: ValueEstimate | null;
  missing: string[];
};

type ResultRow = { prospectId: string; month: string; clicks: number | null; regs: number | null; ftd: number | null; revenueCents: number | null; missing: unknown };
type SampleProspect = {
  id: string;
  username: string | null;
  title: string;
  status: ProspectStatus;
  vertical: string;
  countries: unknown;
  contentType: string | null;
  tier: string | null;
  sourceType: string;
  signedAt: Date | null;
  linkAffiLinkedAt: Date | null;
  valueEstimate: unknown;
};

/** Jours d'un mois couverts entre la signature et maintenant (pur). */
export function coveredDays(month: string, signedAt: Date | null, now: Date): number {
  const start = Date.parse(`${month}-01T00:00:00Z`);
  const end = start + daysInMonth(month) * DAY_MS;
  const from = Math.max(start, signedAt ? signedAt.getTime() : start);
  const to = Math.min(end, now.getTime());
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

const sumOrNull = (vals: Array<number | null>) => (vals.length && vals.every((v) => v !== null) ? vals.reduce<number>((s, v) => s + (v as number), 0) : null);

/** Échantillons des affiliés signés et rattachés (résultats depuis la signature). */
export async function loadSamples(deps: Pick<Deps, "prisma" | "now" | "clock">, now: Date = prospectionNow(deps)): Promise<CalibrationSample[]> {
  const prospects = (await deps.prisma.prospect.findMany({ where: { linkAffiAffiliateId: { not: null } } })) as unknown as SampleProspect[];
  if (!prospects.length) return [];
  const results = (await deps.prisma.affiliateResult.findMany({ where: { prospectId: { in: prospects.map((p) => p.id) } } })) as unknown as ResultRow[];
  const out: CalibrationSample[] = [];
  for (const p of prospects) {
    const rows = results.filter((r) => r.prospectId === p.id && coveredDays(r.month, p.signedAt, now) > 0);
    const days = rows.reduce((s, r) => s + coveredDays(r.month, p.signedAt, now), 0);
    const estimate = valueEstimateOf(p.valueEstimate);
    out.push({
      prospectId: p.id,
      handle: handleOf(p),
      segment: segmentOf(p),
      sourceType: p.sourceType,
      days,
      realClicks: sumOrNull(rows.map((r) => r.clicks)),
      realRegs: sumOrNull(rows.map((r) => r.regs)),
      realFtd: sumOrNull(rows.map((r) => r.ftd)),
      revenueCents: sumOrNull(rows.map((r) => r.revenueCents)),
      promoReach: estimate?.assumptions.promoReach ?? null,
      estimate,
      missing: [...new Set(rows.flatMap((r) => stringArray(r.missing)))],
    });
  }
  return out;
}

// ————— Coefficients (pur) —————

export const clipRatio = (r: number) => Math.min(CALIBRATION_BOUNDS.ratioMax, Math.max(CALIBRATION_BOUNDS.ratioMin, r));

/** Médiane des ratios écrêtés à [0,25 ; 4] (null si vide). */
export function clippedMedian(ratios: readonly number[]): number | null {
  const ok = ratios.filter((r) => Number.isFinite(r) && r >= 0).map(clipRatio);
  const m = medianOf(ok);
  return m === null ? null : clipRatio(m);
}

/** Valeur bornée : ± `maxChange` autour de la base du mois, et dans [0,25 ; 4]. */
export function boundedFactor(monthBase: number, target: number, maxChange: number = CALIBRATION_BOUNDS.coefficientMaxChange): number {
  const lo = Math.max(CALIBRATION_BOUNDS.ratioMin, monthBase * (1 - maxChange));
  const hi = Math.min(CALIBRATION_BOUNDS.ratioMax, monthBase * (1 + maxChange));
  return Math.round(Math.min(hi, Math.max(lo, target)) * 1000) / 1000;
}

/** Le coefficient reste-t-il dans les bornes (base du mois ± 50 %, [0,25 ; 4]) ? */
export function withinCoefficientBounds(monthBase: number, after: number): boolean {
  return after >= CALIBRATION_BOUNDS.ratioMin - EPS && after <= CALIBRATION_BOUNDS.ratioMax + EPS && Math.abs(after - monthBase) <= monthBase * CALIBRATION_BOUNDS.coefficientMaxChange + EPS;
}

/** Ratio réel ÷ estimé de base des clics (null si inutilisable). */
export function ctrRatioOf(s: CalibrationSample, settings: ValueSettings): number | null {
  if (s.realClicks === null || !s.promoReach || s.promoReach <= 0 || s.days <= 0) return null;
  const est = s.promoReach * settings.ctr;
  return est > 0 ? (s.realClicks / s.days) * 30 / est : null;
}

/** Ratio réel ÷ estimé de base de la conversion clics → premiers dépôts (null si inutilisable). */
export function ftdRatioOf(s: CalibrationSample, settings: ValueSettings): number | null {
  if (s.realFtd === null || s.realClicks === null || s.realClicks <= 0) return null;
  const est = settings.regRate * settings.ftdRate;
  return est > 0 ? s.realFtd / s.realClicks / est : null;
}

export type CoefficientField = "ctrFactor" | "ftdFactor";
export type CoefficientProposal = {
  segment: string;
  level: SegmentLevel;
  field: CoefficientField;
  before: number;
  monthBase: number;
  target: number;
  after: number;
  median: number;
  affiliates: number;
  days: number;
  capped: boolean;
  prospectIds: string[];
};

/** Propositions de coefficients (pur). `current(segment, field)` : valeur actuelle et base du mois. */
export function coefficientProposals(
  samples: readonly CalibrationSample[],
  settings: ValueSettings,
  current: (segment: string, field: CoefficientField) => { value: number; monthBase: number },
): CoefficientProposal[] {
  const usable = samples.filter((s) => s.days >= CALIBRATION_BOUNDS.minDays);
  const out: CoefficientProposal[] = [];
  for (const field of ["ctrFactor", "ftdFactor"] as const) {
    const ratioOf = field === "ctrFactor" ? ctrRatioOf : ftdRatioOf;
    const covered = new Set<string>();
    for (const level of SEGMENT_LEVELS) {
      const groups = new Map<string, Array<{ s: CalibrationSample; r: number }>>();
      for (const s of usable) {
        const r = ratioOf(s, settings);
        if (r === null) continue;
        const key = segmentKeyAt(s.segment, level);
        const g = groups.get(key) ?? [];
        g.push({ s, r });
        groups.set(key, g);
      }
      for (const [segment, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const ids = [...new Set(list.map((x) => x.s.prospectId))];
        if (ids.length < CALIBRATION_BOUNDS.minAffiliates) continue;
        if (ids.every((id) => covered.has(id))) continue;
        const median = clippedMedian(list.map((x) => x.r));
        if (median === null) continue;
        const cur = current(segment, field);
        const after = boundedFactor(cur.monthBase, median);
        for (const id of ids) covered.add(id);
        if (Math.abs(after - cur.value) < 0.05 * Math.max(cur.value, EPS)) continue;
        out.push({
          segment,
          level,
          field,
          before: cur.value,
          monthBase: cur.monthBase,
          target: Math.round(median * 1000) / 1000,
          after,
          median: Math.round(median * 100) / 100,
          affiliates: ids.length,
          days: Math.min(...list.map((x) => x.s.days)),
          capped: Math.abs(after - median) > 0.001,
          prospectIds: ids,
        });
      }
    }
  }
  return out.sort((a, b) => b.affiliates - a.affiliates || a.segment.localeCompare(b.segment)).slice(0, MAX_COEFFICIENT_PROPOSALS);
}

// ————— Attribution (pur) —————

export type AttributionRow = { key: string; label: string; total: number; tierA: number; signed: number; active: number; aRate: number | null; signedRate: number | null; activeRate: number | null };
type AttributionProspect = { status: ProspectStatus | string; tier: string | null; sourceType: string; countries: unknown };

const SIGNED_SET = new Set(["SIGNED", "ACTIVE", "CHURNED"]);
const SKIP_ATTRIBUTION = new Set(["DISCOVERED", "ENRICHING", "UNREADABLE", "ENRICH_FAILED"]);

/** Part des A, des signés et des actifs par clé (provenance ou pays). Les prospects pas encore lus ne comptent pas. */
export function attribution(prospects: readonly AttributionProspect[], by: "source" | "country"): AttributionRow[] {
  const map = new Map<string, AttributionRow>();
  for (const p of prospects) {
    if (SKIP_ATTRIBUTION.has(String(p.status))) continue;
    const key = by === "source" ? p.sourceType || "?" : stringArray(p.countries)[0]?.toUpperCase() || "?";
    const row = map.get(key) ?? { key, label: by === "source" ? (SOURCE_TYPE_LABELS[key] ?? "autre") : key === "?" ? "pays inconnu" : capitalize(countryName(key)), total: 0, tierA: 0, signed: 0, active: 0, aRate: null, signedRate: null, activeRate: null };
    row.total++;
    if (p.tier === "A") row.tierA++;
    if (SIGNED_SET.has(String(p.status))) row.signed++;
    if (p.status === "ACTIVE") row.active++;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, aRate: r.total ? r.tierA / r.total : null, signedRate: r.total ? r.signed / r.total : null, activeRate: r.total ? r.active / r.total : null }))
    .sort((a, b) => b.signed - a.signed || b.tierA - a.tierA || b.total - a.total || a.key.localeCompare(b.key));
}

/** Répartition actuelle (réglage lu, normalisée ; défaut : parts égales). */
export function sharesOf(v: unknown): DiscoveryShares {
  const o = objectOf(v);
  const raw = DISCOVERY_SHARE_SOURCES.map((s) => (typeof o[s] === "number" && Number.isFinite(o[s] as number) && (o[s] as number) >= 0 ? (o[s] as number) : DEFAULT_DISCOVERY_SHARES[s]));
  const sum = raw.reduce((a, b) => a + b, 0);
  return Object.fromEntries(DISCOVERY_SHARE_SOURCES.map((s, i) => [s, sum > 0 ? raw[i]! / sum : DEFAULT_DISCOVERY_SHARES[s]])) as DiscoveryShares;
}

/** Chaque part reste-t-elle à ± 20 % de la base du mois, somme 1 ? */
export function withinShareBounds(monthBase: DiscoveryShares, after: DiscoveryShares): boolean {
  const sum = DISCOVERY_SHARE_SOURCES.reduce((s, k) => s + after[k], 0);
  if (Math.abs(sum - 1) > 0.002) return false;
  return DISCOVERY_SHARE_SOURCES.every((k) => Math.abs(after[k] - monthBase[k]) <= monthBase[k] * CALIBRATION_BOUNDS.weightMaxChange + 0.0015);
}

export type SharesProposal = { before: DiscoveryShares; after: DiscoveryShares; perf: Record<DiscoveryShareSource, { total: number; tierA: number; signed: number; active: number }>; signed: number };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Répartition proposée (pur) : performance (A + 3 × signés + 5 × actifs par canal trouvé), mélangée à moitié avec l'actuelle, bornée. */
export function proposeShares(prospects: readonly AttributionProspect[], current: DiscoveryShares, monthBase: DiscoveryShares): SharesProposal | null {
  const perf = Object.fromEntries(DISCOVERY_SHARE_SOURCES.map((s) => [s, { total: 0, tierA: 0, signed: 0, active: 0 }])) as SharesProposal["perf"];
  for (const p of prospects) {
    if (SKIP_ATTRIBUTION.has(String(p.status))) continue;
    const src = SOURCE_TYPE_TO_DISCOVERY[p.sourceType];
    if (!src) continue;
    const row = perf[src];
    row.total++;
    if (p.tier === "A") row.tierA++;
    if (SIGNED_SET.has(String(p.status))) row.signed++;
    if (p.status === "ACTIVE") row.active++;
  }
  const signed = DISCOVERY_SHARE_SOURCES.reduce((s, k) => s + perf[k].signed, 0);
  if (signed < CALIBRATION_BOUNDS.minAffiliates) return null;
  const score = DISCOVERY_SHARE_SOURCES.map((k) => (perf[k].total ? (perf[k].tierA + 3 * perf[k].signed + 5 * perf[k].active) / perf[k].total : 0));
  const sum = score.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  const target = DISCOVERY_SHARE_SOURCES.map((k, i) => 0.5 * current[k] + 0.5 * (score[i]! / sum));
  // Plus grand pas α ∈ [0 ; 1] vers la cible qui garde chaque part à ± 20 % de la base du mois (la somme reste 1).
  let alpha = 1;
  DISCOVERY_SHARE_SOURCES.forEach((k, i) => {
    const d = target[i]! - current[k];
    if (Math.abs(d) < EPS) return;
    const room = d > 0 ? monthBase[k] * (1 + CALIBRATION_BOUNDS.weightMaxChange) - current[k] : current[k] - monthBase[k] * (1 - CALIBRATION_BOUNDS.weightMaxChange);
    alpha = Math.min(alpha, Math.max(0, room / Math.abs(d)));
  });
  const after = Object.fromEntries(DISCOVERY_SHARE_SOURCES.map((k, i) => [k, round3(current[k] + alpha * (target[i]! - current[k]))])) as DiscoveryShares;
  // Arrondi : l'écart à 1 va à la plus grande part.
  const drift = round3(1 - DISCOVERY_SHARE_SOURCES.reduce((s, k) => s + after[k], 0));
  if (drift !== 0) {
    const big = [...DISCOVERY_SHARE_SOURCES].sort((a, b) => after[b] - after[a])[0]!;
    after[big] = round3(after[big] + drift);
  }
  const moved = Math.max(...DISCOVERY_SHARE_SOURCES.map((k) => Math.abs(after[k] - current[k])));
  if (moved < 0.02) return null;
  return { before: current, after, perf, signed };
}

// ————— Poids du score (pur) —————

export const WEIGHT_KEYS: ReadonlyArray<keyof ScoreWeights> = ["audience", "engagement", "fit", "openness", "competition", "reach"];
export const WEIGHT_LABELS: Record<keyof ScoreWeights, string> = {
  audience: "audience",
  engagement: "engagement",
  fit: "adéquation à l'offre",
  openness: "ouverture aux deals",
  competition: "concurrence",
  reach: "joignabilité",
};

/** Chaque poids reste-t-il à ± 20 % de la base du mois, somme inchangée ? */
export function withinWeightBounds(monthBase: ScoreWeights, after: ScoreWeights): boolean {
  const sb = WEIGHT_KEYS.reduce((s, k) => s + monthBase[k], 0);
  const sa = WEIGHT_KEYS.reduce((s, k) => s + after[k], 0);
  if (Math.abs(sa - sb) > 0.11) return false;
  return WEIGHT_KEYS.every((k) => after[k] >= 0 && Math.abs(after[k] - monthBase[k]) <= monthBase[k] * CALIBRATION_BOUNDS.weightMaxChange + 0.051);
}

export type WeightsProposal = { component: keyof ScoreWeights; gap: number; signedMean: number; otherMean: number; signedCount: number; otherCount: number; before: ScoreWeights; after: ScoreWeights };

type Breakdown = Partial<Record<keyof ScoreWeights, number>>;

/** Poids proposé (pur) : composante qui sépare le plus les signés / actifs des contactés sans réponse. */
export function proposeWeights(signed: readonly Breakdown[], others: readonly Breakdown[], current: ScoreWeights, monthBase: ScoreWeights): WeightsProposal | null {
  if (signed.length < CALIBRATION_BOUNDS.minAffiliates || others.length < CALIBRATION_BOUNDS.minAffiliates) return null;
  const mean = (list: readonly Breakdown[], k: keyof ScoreWeights) => {
    const w = current[k] > 0 ? current[k] : 1;
    const vals = list.map((b) => (typeof b[k] === "number" ? (b[k] as number) / w : null)).filter((x): x is number => x !== null && Number.isFinite(x));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  let best: { k: keyof ScoreWeights; gap: number; s: number; o: number } | null = null;
  for (const k of WEIGHT_KEYS) {
    const s = mean(signed, k);
    const o = mean(others, k);
    if (s === null || o === null) continue;
    const gap = s - o;
    if (!best || Math.abs(gap) > Math.abs(best.gap)) best = { k, gap, s, o };
  }
  if (!best || Math.abs(best.gap) < WEIGHT_MIN_GAP) return null;
  const k = best.k;
  const max = CALIBRATION_BOUNDS.weightMaxChange;
  // Nouveau poids : ± min(20 %, écart) de la base du mois, sans quitter les 20 % du mois.
  const wanted = monthBase[k] * (1 + Math.sign(best.gap) * Math.min(max, Math.abs(best.gap)));
  const newK = Math.min(monthBase[k] * (1 + max), Math.max(monthBase[k] * (1 - max), wanted));
  const delta = newK - current[k];
  if (Math.abs(delta) < 0.5) return null;
  const others0 = WEIGHT_KEYS.filter((x) => x !== k);
  const otherSum = others0.reduce((s, x) => s + current[x], 0);
  if (otherSum <= 0) return null;
  const after = { ...current };
  after[k] = Math.round(newK * 10) / 10;
  for (const x of others0) after[x] = Math.round((current[x] - (delta * current[x]) / otherSum) * 10) / 10;
  const sumBefore = WEIGHT_KEYS.reduce((s, x) => s + current[x], 0);
  const drift = Math.round((sumBefore - WEIGHT_KEYS.reduce((s, x) => s + after[x], 0)) * 10) / 10;
  if (drift !== 0) {
    const big = [...others0].sort((a, b) => after[b] - after[a])[0]!;
    after[big] = Math.round((after[big] + drift) * 10) / 10;
  }
  if (!withinWeightBounds(monthBase, after)) return null;
  return { component: k, gap: Math.round(best.gap * 100) / 100, signedMean: Math.round(best.s * 100) / 100, otherMean: Math.round(best.o * 100) / 100, signedCount: signed.length, otherCount: others.length, before: current, after };
}

// ————— Base du mois et valeurs actuelles —————

type RecRow = { id: string; target: string; targetId: string; field: string; before: unknown; after: unknown; status: string; appliedAt: Date | null; createdAt: Date; evidence: unknown; expectedGain: string | null; source: string };

/** Valeur d'avant la première application de la période (30 jours) pour cette cible, sinon la valeur actuelle. */
export async function monthBaseOf<T>(deps: Pick<Deps, "prisma">, target: string, targetId: string, field: string, currentValue: T, now: Date): Promise<T> {
  const first = (await deps.prisma.recommendation.findFirst({
    where: { source: CALIBRATION_SOURCE, target, targetId, field, status: "APPLIED", appliedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
    orderBy: { appliedAt: "asc" },
  })) as RecRow | null;
  return first ? (first.before as T) : currentValue;
}

export async function currentCoefficient(deps: Pick<Deps, "prisma">, segment: string, field: CoefficientField): Promise<number> {
  const row = (await deps.prisma.prospectCalibration.findUnique({ where: { segment } })) as { ctrFactor: number; ftdFactor: number } | null;
  const v = row?.[field];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1;
}

export async function currentWeights(deps: Pick<Deps, "prisma">): Promise<ScoreWeights> {
  return weightsOf(await rawProspectionSetting(deps, PROSPECTION_SETTINGS.weights.key));
}

export async function currentShares(deps: Pick<Deps, "prisma">): Promise<DiscoveryShares> {
  return sharesOf(await rawProspectionSetting(deps, DISCOVERY_SHARES_KEY));
}

// ————— Textes du code (preuves) —————

const fr = (n: number, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d).replace(".", ",");
const pctText = (n: number) => formatPct(n);

function coefficientFacts(p: CoefficientProposal): { facts: Record<string, unknown>; code: string } {
  const what = p.field === "ctrFactor" ? "taux de clic" : "taux de premiers dépôts";
  const label = segmentLabel(p.segment);
  const facts = { reglage: what, groupe: label, avant: p.before, apres: p.after, ratioReelSurEstime: p.median, affilies: p.affiliates, joursMinimum: p.days, plafondDuMois: p.capped ? "50 %" : null };
  const code = `Coefficient du ${what} pour ${label} : ${fr(p.before)} → ${fr(p.after)} (${p.affiliates} affiliés, au moins ${p.days} jours ; réel ÷ estimé : ${fr(p.median)}${p.capped ? ", limité à 50 % ce mois-ci" : ""}).`;
  return { facts, code };
}

function weightsFacts(p: WeightsProposal): { facts: Record<string, unknown>; code: string } {
  const changes = WEIGHT_KEYS.filter((k) => Math.abs(p.after[k] - p.before[k]) >= 0.05).map((k) => `${WEIGHT_LABELS[k]} ${fr(p.before[k], 1)} → ${fr(p.after[k], 1)}`);
  const facts = {
    reglage: "poids du score",
    composante: WEIGHT_LABELS[p.component],
    avant: p.before,
    apres: p.after,
    moyenneSignes: p.signedMean,
    moyenneSansReponse: p.otherMean,
    signes: p.signedCount,
    sansReponse: p.otherCount,
  };
  const code = `Poids du score : ${changes.join(", ")} (${WEIGHT_LABELS[p.component]} : ${fr(p.signedMean)} chez les ${p.signedCount} signés contre ${fr(p.otherMean)} chez les ${p.otherCount} sans réponse).`;
  return { facts, code };
}

function sharesFacts(p: SharesProposal): { facts: Record<string, unknown>; code: string } {
  const moved = DISCOVERY_SHARE_SOURCES.filter((k) => Math.abs(p.after[k] - p.before[k]) >= 0.005);
  const facts = {
    reglage: "répartition de la recherche de canaux",
    avant: Object.fromEntries(DISCOVERY_SHARE_SOURCES.map((k) => [DISCOVERY_LABELS[k], pctText(p.before[k])])),
    apres: Object.fromEntries(DISCOVERY_SHARE_SOURCES.map((k) => [DISCOVERY_LABELS[k], pctText(p.after[k])])),
    signesParSource: Object.fromEntries(DISCOVERY_SHARE_SOURCES.map((k) => [DISCOVERY_LABELS[k], `${p.perf[k].signed} sur ${p.perf[k].total}`])),
    signes: p.signed,
  };
  const proofs = DISCOVERY_SHARE_SOURCES.filter((k) => p.perf[k].total > 0).map((k) => `${DISCOVERY_LABELS[k]} ${p.perf[k].signed} sur ${p.perf[k].total}`);
  const code = `Recherche de canaux : ${moved.map((k) => `${DISCOVERY_LABELS[k]} ${pctText(p.before[k])} → ${pctText(p.after[k])}`).join(", ")} (signés : ${proofs.join(", ")}).`;
  return { facts, code };
}

// ————— Écriture des propositions —————

type NewRec = { target: string; targetId: string; field: string; before: unknown; after: unknown; size: "SMALL" | "BIG"; kind: string; facts: Record<string, unknown>; code: string; extra?: Record<string, unknown> };

export type ProposeResult = { proposed: number; approved: number; inReview: number; sent: boolean; reason?: string | null; writtenBy?: "ai" | "code" };

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

/** Calibrage mensuel : propositions `Recommendation` en choix numérotés, dans les bornes. */
export async function proposeCalibration(deps: Deps, now: Date, opts: { send?: boolean } = {}): Promise<ProposeResult> {
  await closeCalibrationExperiments(deps, now).catch((err) => deps.logger?.warn({ err: (err as Error).message }, "[prospection] suivi du calibrage non clos"));
  const settings = await loadValueSettings(deps);
  const samples = await loadSamples(deps, now);
  const recs: NewRec[] = [];

  // 1. Coefficients par segment.
  const currents = new Map<string, { value: number; monthBase: number }>();
  for (const s of samples)
    for (const level of SEGMENT_LEVELS)
      for (const field of ["ctrFactor", "ftdFactor"] as const) {
        const segment = segmentKeyAt(s.segment, level);
        const key = `${segment}#${field}`;
        if (currents.has(key)) continue;
        const value = await currentCoefficient(deps, segment, field);
        currents.set(key, { value, monthBase: await monthBaseOf(deps, CALIBRATION_TARGETS.coefficient, segment, field, value, now) });
      }
  for (const p of coefficientProposals(samples, settings, (segment, field) => currents.get(`${segment}#${field}`) ?? { value: 1, monthBase: 1 })) {
    const t = coefficientFacts(p);
    recs.push({ target: CALIBRATION_TARGETS.coefficient, targetId: p.segment, field: p.field, before: p.before, after: p.after, size: "SMALL", kind: "coefficient", ...t, extra: { level: p.level, affiliates: p.affiliates, days: p.days, median: p.median, monthBase: p.monthBase } });
  }

  // 2. Attribution des sources → répartition de la recherche de canaux.
  const all = (await deps.prisma.prospect.findMany({ where: { status: { notIn: ["DISCOVERED", "ENRICHING", "UNREADABLE", "ENRICH_FAILED"] } } })) as unknown as Array<AttributionProspect & { discoveredAt: Date }>;
  const oldest = all.reduce<number | null>((m, p) => (m === null || p.discoveredAt.getTime() < m ? p.discoveredAt.getTime() : m), null);
  if (oldest !== null && now.getTime() - oldest >= CALIBRATION_BOUNDS.minDays * DAY_MS) {
    const cur = await currentShares(deps);
    const base = await monthBaseOf(deps, CALIBRATION_TARGETS.shares, DISCOVERY_SHARES_KEY, "shares", cur, now);
    const sp = proposeShares(all, cur, sharesOf(base));
    if (sp) recs.push({ target: CALIBRATION_TARGETS.shares, targetId: DISCOVERY_SHARES_KEY, field: "shares", before: sp.before, after: sp.after, size: "BIG", kind: "shares", ...sharesFacts(sp), extra: { signed: sp.signed } });
  }

  // 3. Poids du score : signés / actifs contre contactés sans réponse.
  const contacted = (await deps.prisma.prospect.findMany({ where: { contactedAt: { not: null } } })) as unknown as Array<{ status: string; respondedAt: Date | null; contactedAt: Date; scoreBreakdown: unknown }>;
  const firstContact = contacted.reduce<number | null>((m, p) => (m === null || p.contactedAt.getTime() < m ? p.contactedAt.getTime() : m), null);
  if (firstContact !== null && now.getTime() - firstContact >= CALIBRATION_BOUNDS.minDays * DAY_MS) {
    const signedB = contacted.filter((p) => p.status === "SIGNED" || p.status === "ACTIVE").map((p) => objectOf(p.scoreBreakdown) as Breakdown);
    const othersB = contacted.filter((p) => !p.respondedAt && (p.status === "CONTACTED" || p.status === "SKIPPED")).map((p) => objectOf(p.scoreBreakdown) as Breakdown);
    const cur = await currentWeights(deps);
    const base = weightsOf(await monthBaseOf(deps, CALIBRATION_TARGETS.weights, PROSPECTION_SETTINGS.weights.key, "weights", cur, now));
    const wp = proposeWeights(signedB, othersB, cur, base);
    if (wp) recs.push({ target: CALIBRATION_TARGETS.weights, targetId: PROSPECTION_SETTINGS.weights.key, field: "weights", before: wp.before, after: wp.after, size: "BIG", kind: "weights", ...weightsFacts(wp), extra: { component: wp.component, gap: wp.gap } });
  }

  // Les propositions encore ouvertes du mois d'avant sont remplacées.
  await deps.prisma.recommendation.updateMany({ where: { source: CALIBRATION_SOURCE, status: "PROPOSED" }, data: { status: "REJECTED", rejectedAt: now, comment: "Remplacée par le calibrage suivant." } });

  if (!recs.length) {
    const reason = samples.length ? `il faut ${CALIBRATION_BOUNDS.minAffiliates} affiliés avec ${CALIBRATION_BOUNDS.minDays} jours de résultats dans un même groupe` : deps.linkAffiReader ? "aucun affilié signé n'est encore rattaché à Link Affi" : "Link Affi n'est pas branché";
    await agentEvent(deps, "prospection.calibration.none", { samples: samples.length });
    return { proposed: 0, approved: 0, inReview: 0, sent: false, reason };
  }

  const { lines, writtenBy } = await writeCalibrationLines(deps, recs.map((r) => ({ facts: r.facts, code: r.code })));
  const ids: string[] = [];
  for (const [i, r] of recs.entries()) {
    const row = (await deps.prisma.recommendation.create({
      data: {
        teamKey: PROSPECTION_TEAM_KEY,
        source: CALIBRATION_SOURCE,
        target: r.target,
        targetId: r.targetId,
        field: r.field,
        before: json(r.before),
        after: json(r.after),
        size: r.size,
        status: "PROPOSED",
        expectedGain: lines[i]!.slice(0, 400),
        evidence: json({ agent: "valorisateur", kind: r.kind, facts: r.facts, code: r.code, writtenBy, period: parisDay(now), ...(r.extra ?? {}) }),
        createdAt: new Date(now.getTime() + i),
      },
    })) as { id: string };
    ids.push(row.id);
  }
  const rows = (await deps.prisma.recommendation.findMany({ where: { id: { in: ids } } })) as never[];
  const qa = await checkRecommendations(deps, rows, 10);
  await agentEvent(deps, "prospection.calibration.proposed", { proposed: ids.length, approved: qa.approved.length, rejected: qa.rejected.length, pending: qa.pending.length, writtenBy });

  let sent = false;
  if (opts.send !== false && deps.admin && qa.approved.length) {
    const msg = await calibrationChoicesMessage(deps);
    if (msg) sent = !!(await deps.admin.send(msg));
  }
  return { proposed: ids.length, approved: qa.approved.length, inReview: qa.pending.length, sent, reason: null, writtenBy };
}

/** Texte « pas de calibrage ce mois-ci : … ». */
export function noCalibrationText(reason: string, chatKey?: string | null): string {
  return pick(CALIBRATION_VARIANTS.none({ reason }), "prospection.calibration.none", chatKey);
}

export type { RecRow as CalibrationRecRow, AttributionProspect };
