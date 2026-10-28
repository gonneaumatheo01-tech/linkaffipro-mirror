/**
 * Phase 32, chantier B — Valorisateur : valeur estimée mensuelle en fourchette (code, sans IA), stockée dans
 * `Prospect.valueEstimate`, recalculée chaque matin (tâche `prospection.values`, 06:30), et valeur du pipeline par
 * statut. Calcul pur dans `estimate.ts`, segments dans `segment.ts`, textes dans `format.ts`.
 *
 * Deal retenu : conditions signées du prospect (`dealType` / `dealTerms`) sinon offre appariée (`matchedOfferId`).
 * Coefficients : `ProspectCalibration` du segment calibré le plus précis (`source = "calibrated"`), sinon aucun
 * (« non calibrée »). Rien d'estimable → `valueEstimate` vidé et raison rendue par `explainProspectValue`.
 */
import { Prisma } from "@linkaffipro/db";
import type { ProspectStatus } from "../contract";
import type { ValueEstimate } from "../contract-advanced";
import { VALUE_DEFAULTS } from "../contract-advanced";
import type { ProspectionKevinDeps } from "../kevin-port";
import { PROSPECT_STATUS_LABELS, capitalize, handleOf } from "../score/format";
import { objectOf, prospectionNow, rawProspectionSetting, stringArray } from "../score/settings";
import { pick } from "../../boss/voice";
import {
  dealFromOffer,
  dealFromSigned,
  estimateValue,
  observedPromoShare,
  valueEstimateOf,
  DEFAULT_VALUE_SETTINGS,
  type EstimateInput,
  type SegmentCalibration,
  type ValueSettings,
} from "./estimate";
import { formatRangeSum, VALUE_VARIANTS, type CalibrationState } from "./format";
import { segmentLookupKeys, segmentOf } from "./segment";

export * from "./estimate";
export * from "./segment";
export * from "./format";

type Deps = Pick<ProspectionKevinDeps, "prisma" | "now" | "clock" | "logger">;

/** Statuts dont la valeur est recalculée chaque matin (qualifiés et pipeline du client). */
export const VALUE_STATUSES: readonly ProspectStatus[] = ["QUALIFIED", "CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE"];
/** Prospects recalculés au plus par passage. */
export const VALUE_REFRESH_MAX = 2000;

type ValueRow = {
  id: string;
  username: string | null;
  title: string;
  status: ProspectStatus;
  vertical: string;
  countries: unknown;
  contentType: string | null;
  tier: string | null;
  postsPerDay: number | null;
  medianViews: number | null;
  authenticity: string | null;
  fakeFlags: unknown;
  brands: unknown;
  geoConfidence: number | null;
  matchedOfferId: string | null;
  dealType: string | null;
  dealTerms: unknown;
  valueEstimate?: unknown;
};

const positiveOrNull = (v: unknown, fallback: number | null): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Réglages du Valorisateur (`Setting prospection.value.*`), chaque valeur absente ou invalide remplacée par défaut. */
export async function loadValueSettings(deps: Pick<Deps, "prisma">): Promise<ValueSettings> {
  const [promo, ctr, reg, ftd, arpu] = await Promise.all([
    rawProspectionSetting(deps, VALUE_DEFAULTS.promoShare.key),
    rawProspectionSetting(deps, VALUE_DEFAULTS.ctr.key),
    rawProspectionSetting(deps, VALUE_DEFAULTS.regRate.key),
    rawProspectionSetting(deps, VALUE_DEFAULTS.ftdRate.key),
    rawProspectionSetting(deps, VALUE_DEFAULTS.arpuMonth.key),
  ]);
  const rate = (v: unknown, d: number) => {
    const n = positiveOrNull(v, d)!;
    return n <= 1 ? n : d;
  };
  return {
    promoShare: rate(promo, DEFAULT_VALUE_SETTINGS.promoShare),
    ctr: rate(ctr, DEFAULT_VALUE_SETTINGS.ctr),
    regRate: rate(reg, DEFAULT_VALUE_SETTINGS.regRate),
    ftdRate: rate(ftd, DEFAULT_VALUE_SETTINGS.ftdRate),
    arpuMonth: positiveOrNull(arpu, null),
  };
}

type CalibrationRow = { segment: string; ctrFactor: number; ftdFactor: number; source: string };

/** Coefficients calibrés (tous segments), lus une fois par passage. */
export async function loadCalibrations(deps: Pick<Deps, "prisma">): Promise<Map<string, CalibrationRow>> {
  const rows = (await deps.prisma.prospectCalibration.findMany({ where: { source: "calibrated" } })) as unknown as CalibrationRow[];
  return new Map(rows.map((r) => [r.segment, r]));
}

/** Calibrage du segment calibré le plus précis, ou null (non calibrée). */
export function calibrationFor(p: Pick<ValueRow, "vertical" | "countries" | "contentType" | "tier">, calibrations: ReadonlyMap<string, CalibrationRow>): SegmentCalibration {
  for (const key of segmentLookupKeys(segmentOf(p))) {
    const c = calibrations.get(key);
    if (c && c.source === "calibrated") return { segment: c.segment, ctrFactor: c.ctrFactor, ftdFactor: c.ftdFactor, source: c.source };
  }
  return null;
}

/** Posts lus à la dernière lecture (`ProspectEvent ENRICHED.payload.posts`). */
async function postsReadOf(deps: Pick<Deps, "prisma">, prospectId: string): Promise<number | null> {
  const ev = (await deps.prisma.prospectEvent.findFirst({ where: { prospectId, type: "ENRICHED" }, orderBy: { createdAt: "desc" } })) as { payload: unknown } | null;
  const n = objectOf(ev?.payload).posts;
  return typeof n === "number" && n >= 0 ? n : null;
}

type OfferRow = { id: string; dealTypes: unknown; isActive?: boolean };

/** Entrée du calcul à partir de la ligne en base (pur). */
export function estimateInputOf(p: ValueRow, offer: OfferRow | null, postsRead: number | null): EstimateInput {
  const signed = dealFromSigned(p.dealType, p.dealTerms);
  const deal = signed ?? (offer ? dealFromOffer(offer.dealTypes) : null);
  return {
    postsPerDay: p.postsPerDay,
    medianViews: p.medianViews,
    promoShareObserved: observedPromoShare(p.brands, postsRead),
    authenticity: p.authenticity,
    fakeFlags: stringArray(p.fakeFlags),
    postsRead,
    geoConfidence: p.geoConfidence,
    deal,
    offerId: signed ? null : (offer?.id ?? null),
  };
}

export type ValueExplanation = { prospectId: string; handle: string; estimate: ValueEstimate | null; reason: string | null; missing: string[] };

type Ctx = { settings: ValueSettings; calibrations: ReadonlyMap<string, CalibrationRow>; offers: Map<string, OfferRow> };

async function loadCtx(deps: Pick<Deps, "prisma">): Promise<Ctx> {
  const [settings, calibrations, offers] = await Promise.all([
    loadValueSettings(deps),
    loadCalibrations(deps),
    deps.prisma.affiliateOffer.findMany({}) as unknown as Promise<OfferRow[]>,
  ]);
  return { settings, calibrations, offers: new Map(offers.map((o) => [o.id, o])) };
}

async function explainRow(deps: Deps, p: ValueRow, ctx: Ctx): Promise<ValueExplanation> {
  const offer = p.matchedOfferId ? (ctx.offers.get(p.matchedOfferId) ?? null) : null;
  const input = estimateInputOf(p, offer, await postsReadOf(deps, p.id));
  const r = estimateValue(input, ctx.settings, calibrationFor(p, ctx.calibrations), prospectionNow(deps));
  return { prospectId: p.id, handle: handleOf(p), estimate: r.ok ? r.estimate : null, reason: r.ok ? null : r.reason, missing: r.ok ? r.estimate.assumptions.missing : r.missing };
}

/** Estimation détaillée (sans écriture) : valeur, ou raison de son absence. Null si le prospect n'existe pas. */
export async function explainProspectValue(deps: Deps, prospectId: string): Promise<ValueExplanation | null> {
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as unknown as ValueRow | null;
  if (!p) return null;
  return explainRow(deps, p, await loadCtx(deps));
}

async function store(deps: Deps, prospectId: string, estimate: ValueEstimate | null): Promise<void> {
  await deps.prisma.prospect.update({ where: { id: prospectId }, data: { valueEstimate: estimate ? JSON.parse(JSON.stringify(estimate)) : Prisma.DbNull } });
}

/** Calcule et enregistre `Prospect.valueEstimate` ; null si rien d'estimable (pas de mesure, pas d'offre). */
export async function estimateProspectValue(deps: ProspectionKevinDeps, prospectId: string): Promise<ValueEstimate | null> {
  const r = await explainProspectValue(deps, prospectId);
  if (!r) return null;
  await store(deps, prospectId, r.estimate);
  return r.estimate;
}

/** Recalcule les valeurs des prospects qualifiés et en pipeline (passage quotidien). */
export async function refreshValues(deps: ProspectionKevinDeps, _now: Date): Promise<{ updated: number; cleared: number }> {
  const ctx = await loadCtx(deps);
  const rows = (await deps.prisma.prospect.findMany({ where: { status: { in: [...VALUE_STATUSES] } }, orderBy: { updatedAt: "asc" }, take: VALUE_REFRESH_MAX })) as unknown as ValueRow[];
  let updated = 0;
  let cleared = 0;
  for (const p of rows) {
    try {
      const r = await explainRow(deps, p, ctx);
      if (!r.estimate && valueEstimateOf(p.valueEstimate) === null) continue;
      await store(deps, p.id, r.estimate);
      if (r.estimate) updated++;
      else cleared++;
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, prospectId: p.id }, "[prospection] valeur non calculée");
    }
  }
  return { updated, cleared };
}

// ————— Valeur du pipeline —————

export type PipelineValueLine = { status: ProspectStatus; label: string; count: number; estimated: number; low: number; base: number; high: number; calibration: CalibrationState };
export type PipelineValue = { byStatus: PipelineValueLine[]; total: Omit<PipelineValueLine, "status" | "label">; text: string };

const stateOf = (calibrated: number, estimated: number): CalibrationState => (estimated === 0 || calibrated === 0 ? "none" : calibrated === estimated ? "all" : "partial");

/** Libellés du pipeline (« En négociation ») : statut en français, majuscule. */
const PIPELINE_LABELS: Partial<Record<ProspectStatus, string>> = {
  QUALIFIED: "À contacter",
  CONTACTED: "Contactés",
  RESPONDED: "Ont répondu",
  NEGOTIATING: "En négociation",
  SIGNED: "Signés",
  ACTIVE: "Actifs",
};

/** Somme des fourchettes stockées par statut (« ce qui est en négo vaut 2 100 – 11 000 €/mois estimés »). */
export async function pipelineValue(deps: Pick<Deps, "prisma">, opts: { chatKey?: string | null } = {}): Promise<PipelineValue> {
  const rows = (await deps.prisma.prospect.findMany({ where: { status: { in: [...VALUE_STATUSES] } } })) as unknown as Array<{ status: ProspectStatus; valueEstimate: unknown }>;
  const byStatus: PipelineValueLine[] = [];
  const total = { count: 0, estimated: 0, low: 0, base: 0, high: 0, calibrated: 0 };
  for (const status of VALUE_STATUSES) {
    const list = rows.filter((r) => r.status === status);
    const line = { count: list.length, estimated: 0, low: 0, base: 0, high: 0, calibrated: 0 };
    for (const r of list) {
      const v = valueEstimateOf(r.valueEstimate);
      if (!v) continue;
      line.estimated++;
      line.low += v.low;
      line.base += v.base;
      line.high += v.high;
      if (v.calibratedBy !== "default") line.calibrated++;
    }
    for (const k of ["count", "estimated", "low", "base", "high", "calibrated"] as const) total[k] += line[k];
    if (line.count)
      byStatus.push({
        status,
        label: PIPELINE_LABELS[status] ?? capitalize(PROSPECT_STATUS_LABELS[status]),
        count: line.count,
        estimated: line.estimated,
        low: line.low,
        base: line.base,
        high: line.high,
        calibration: stateOf(line.calibrated, line.estimated),
      });
  }
  const totalOut = { count: total.count, estimated: total.estimated, low: total.low, base: total.base, high: total.high, calibration: stateOf(total.calibrated, total.estimated) };
  const lines: string[] = [];
  if (!total.estimated) lines.push(pick(VALUE_VARIANTS.pipelineEmpty, "prospection.value.pipelineEmpty", opts.chatKey));
  else {
    lines.push(pick(VALUE_VARIANTS.pipelineTitle({ range: formatRangeSum(total.low, total.high, totalOut.calibration) }), "prospection.value.pipelineTitle", opts.chatKey));
    for (const l of byStatus.filter((x) => x.estimated > 0))
      lines.push(pick(VALUE_VARIANTS.pipeline({ label: l.label, n: l.estimated, range: formatRangeSum(l.low, l.high, l.calibration) }), "prospection.value.pipeline", opts.chatKey));
  }
  return { byStatus, total: totalOut, text: lines.join("\n") };
}
