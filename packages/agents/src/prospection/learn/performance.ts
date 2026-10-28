/**
 * Phase 32, chantier B — résultats réels des affiliés signés et comparaison estimé / réel, pour Kevin (« performance
 * de @x », « mes affiliés », « estimé vs réel ») et le site (`/agents/prospection/affilies`, `/valeur`). Lecture de la
 * base seulement (résultats déjà tirés de Link Affi par `pullAffiliateResults`) ; aucun chiffre inventé : un champ
 * absent de Link Affi reste absent.
 */
import { esc } from "../../admin/journal";
import { pick } from "../../boss/voice";
import { CALIBRATION_BOUNDS, type ValueEstimate } from "../contract-advanced";
import type { ProspectStatus } from "../contract";
import type { ProspectionKevinDeps } from "../kevin-port";
import { medianOf } from "../pipeline/stats";
import { PROSPECT_STATUS_LABELS, formatCount, handleOf } from "../score/format";
import { prospectionNow, stringArray } from "../score/settings";
import { estimatedVolumes, valueEstimateOf } from "../value/estimate";
import { formatEuroAmount, formatValueRange } from "../value/format";
import { segmentKeyAt, segmentLabel, segmentOf } from "../value/segment";
import { coveredDays, loadSamples, type CalibrationSample } from "./calibrate";
import { churnProposals } from "./pull";
import { PERFORMANCE_VARIANTS } from "./texts";

type Deps = Pick<ProspectionKevinDeps, "prisma" | "now" | "clock">;

const NBSP = "\u00a0";

export type MonthResult = { month: string; clicks: number | null; regs: number | null; ftd: number | null; revenueCents: number | null; missing: string[]; days: number };
export type Volumes = { clicks: number | null; ftd: number | null };

export type AffiliatePerformance = {
  prospectId: string;
  handle: string;
  status: ProspectStatus;
  affiliateId: string | null;
  linkedAt: Date | null;
  signedAt: Date | null;
  months: MonthResult[];
  totals: { clicks: number | null; regs: number | null; ftd: number | null; revenueCents: number | null; missing: string[]; days: number };
  estimate: ValueEstimate | null;
  /** Clics et premiers dépôts sur 30 jours : estimés (hypothèses de la valeur) et réels (ramenés à 30 jours). */
  estimatedMonthly: Volumes | null;
  realMonthly: Volumes | null;
  /** Réel ÷ estimé (null si l'un manque). */
  ratio: Volumes | null;
  churnProposed: boolean;
  text: string;
};

type Row = { id: string; username: string | null; title: string; status: ProspectStatus; linkAffiAffiliateId: string | null; linkAffiLinkedAt: Date | null; signedAt: Date | null; valueEstimate: unknown; vertical: string; countries: unknown; contentType: string | null; tier: string | null };
type ResultRow = { month: string; clicks: number | null; regs: number | null; ftd: number | null; revenueCents: number | null; missing: unknown };

const sumOrNull = (vals: Array<number | null>) => (vals.length && vals.every((v) => v !== null) ? vals.reduce<number>((s, v) => s + (v as number), 0) : null);
const per30 = (n: number | null, days: number) => (n === null || days <= 0 ? null : (n / days) * 30);
const ratioOf = (real: number | null, est: number | null) => (real === null || est === null || est <= 0 ? null : Math.round((real / est) * 100) / 100);
const n0 = (n: number | null) => (n === null ? "?" : formatCount(n));
const eurOf = (cents: number | null) => (cents === null ? "?" : `${formatEuroAmount(cents / 100)}${NBSP}€`);
const fr1 = (n: number) => (Math.round(n * 10) / 10).toString().replace(".", ",");

/** Ligne d'un mois : « octobre : 320 clics, 12 inscrits, 4 premiers dépôts, 380 € de revenus ». */
export function monthLine(m: MonthResult): string {
  const [y, mm] = m.month.split("-").map(Number) as [number, number];
  const label = new Date(Date.UTC(y, mm - 1, 15)).toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" });
  return `${label} : ${n0(m.clicks)} clics, ${n0(m.regs)} inscrits, ${n0(m.ftd)} premiers dépôts, ${eurOf(m.revenueCents)} de revenus${m.missing.length ? " (Link Affi ne donne pas tout)" : ""}`;
}

/** Résultats réels d'un affilié signé et comparaison avec son estimation. Null si le prospect n'existe pas. */
export async function affiliatePerformance(deps: Deps, prospectId: string, opts: { chatKey?: string | null } = {}): Promise<AffiliatePerformance | null> {
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId } })) as unknown as Row | null;
  if (!p) return null;
  const now = prospectionNow(deps);
  const handle = handleOf(p);
  const rows = (await deps.prisma.affiliateResult.findMany({ where: { prospectId }, orderBy: { month: "asc" } })) as unknown as ResultRow[];
  const months: MonthResult[] = rows.map((r) => ({ month: r.month, clicks: r.clicks, regs: r.regs, ftd: r.ftd, revenueCents: r.revenueCents, missing: stringArray(r.missing), days: coveredDays(r.month, p.signedAt, now) }));
  const counted = months.filter((m) => m.days > 0);
  const totals = {
    clicks: sumOrNull(counted.map((m) => m.clicks)),
    regs: sumOrNull(counted.map((m) => m.regs)),
    ftd: sumOrNull(counted.map((m) => m.ftd)),
    revenueCents: sumOrNull(counted.map((m) => m.revenueCents)),
    missing: [...new Set(counted.flatMap((m) => m.missing))],
    days: counted.reduce((s, m) => s + m.days, 0),
  };
  const estimate = valueEstimateOf(p.valueEstimate);
  const est = estimate ? estimatedVolumes(estimate) : null;
  const estimatedMonthly = est ? { clicks: Math.round(est.clicks), ftd: Math.round(est.ftd * 10) / 10 } : null;
  const realMonthly = totals.days > 0 ? { clicks: per30(totals.clicks, totals.days), ftd: per30(totals.ftd, totals.days) } : null;
  const ratio = estimatedMonthly && realMonthly ? { clicks: ratioOf(realMonthly.clicks, estimatedMonthly.clicks), ftd: ratioOf(realMonthly.ftd, estimatedMonthly.ftd) } : null;
  const churnProposed = (await churnProposals(deps)).some((c) => c.prospectId === prospectId);

  const h = esc(handle);
  const lines: string[] = [];
  if (!p.linkAffiAffiliateId) lines.push(pick(PERFORMANCE_VARIANTS.notLinked({ handle: h }), "prospection.perf.notLinked", opts.chatKey));
  else if (!months.length) lines.push(pick(PERFORMANCE_VARIANTS.noResults({ handle: h }), "prospection.perf.noResults", opts.chatKey));
  else {
    lines.push(`${h}, affilié ${esc(p.linkAffiAffiliateId)} (${PROSPECT_STATUS_LABELS[p.status]}) :`);
    for (const m of months.slice(-3)) lines.push(monthLine(m));
    if (estimate && realMonthly && estimatedMonthly)
      lines.push(
        `Sur 30 jours : ${n0(realMonthly.clicks)} clics pour ${n0(estimatedMonthly.clicks)} estimés, ${realMonthly.ftd === null ? "?" : fr1(realMonthly.ftd)} premiers dépôts pour ${fr1(estimatedMonthly.ftd ?? 0)} estimés.`,
      );
    if (estimate) lines.push(`Valeur estimée : ${formatValueRange(estimate)}.`);
    if (churnProposed) lines.push("Aucun clic depuis 60 jours : je te propose de le passer en arrêté.");
  }
  return { prospectId, handle, status: p.status, affiliateId: p.linkAffiAffiliateId, linkedAt: p.linkAffiLinkedAt, signedAt: p.signedAt, months, totals, estimate, estimatedMonthly, realMonthly, ratio, churnProposed, text: lines.join("\n") };
}

// ————— Estimé vs réel —————

export type EstimatedVsRealRow = {
  prospectId: string;
  handle: string;
  segment: string;
  segmentLabel: string;
  days: number;
  estimated: Volumes | null;
  real: Volumes | null;
  ratio: Volumes | null;
  calibratedBy: string | null;
};
export type EstimatedVsRealSegment = { segment: string; label: string; affiliates: number; withEnoughData: number; medianRatio: Volumes };
export type EstimatedVsReal = { rows: EstimatedVsRealRow[]; segments: EstimatedVsRealSegment[]; overall: Volumes & { affiliates: number }; hasResults: boolean; text: string };

function rowOf(s: CalibrationSample): EstimatedVsRealRow {
  const est = s.estimate ? estimatedVolumes(s.estimate) : null;
  const estimated = est ? { clicks: Math.round(est.clicks), ftd: Math.round(est.ftd * 10) / 10 } : null;
  const real = s.days > 0 ? { clicks: per30(s.realClicks, s.days), ftd: per30(s.realFtd, s.days) } : null;
  const ratio = estimated && real ? { clicks: ratioOf(real.clicks, estimated.clicks), ftd: ratioOf(real.ftd, estimated.ftd) } : null;
  const segment = segmentKeyAt(s.segment, "country");
  return { prospectId: s.prospectId, handle: s.handle, segment, segmentLabel: segmentLabel(segment), days: s.days, estimated, real, ratio, calibratedBy: s.estimate ? s.estimate.calibratedBy : null };
}

const med = (vals: Array<number | null | undefined>) => {
  const m = medianOf(vals.filter((v): v is number => typeof v === "number"));
  return m === null ? null : Math.round(m * 100) / 100;
};

/** Estimé contre réel pour chaque affilié rattaché, par groupe (univers, pays) et en tout. */
export async function estimatedVsReal(deps: Deps, opts: { chatKey?: string | null } = {}): Promise<EstimatedVsReal> {
  const samples = await loadSamples(deps, prospectionNow(deps));
  const rows = samples.map(rowOf).sort((a, b) => a.segment.localeCompare(b.segment) || a.handle.localeCompare(b.handle));
  const bySeg = new Map<string, EstimatedVsRealRow[]>();
  for (const r of rows) bySeg.set(r.segment, [...(bySeg.get(r.segment) ?? []), r]);
  const segments: EstimatedVsRealSegment[] = [...bySeg.entries()].map(([segment, list]) => {
    const enough = list.filter((r) => r.days >= CALIBRATION_BOUNDS.minDays);
    return { segment, label: segmentLabel(segment), affiliates: list.length, withEnoughData: enough.length, medianRatio: { clicks: med(enough.map((r) => r.ratio?.clicks)), ftd: med(enough.map((r) => r.ratio?.ftd)) } };
  });
  const enough = rows.filter((r) => r.days >= CALIBRATION_BOUNDS.minDays);
  const overall = { affiliates: rows.length, clicks: med(enough.map((r) => r.ratio?.clicks)), ftd: med(enough.map((r) => r.ratio?.ftd)) };
  const hasResults = samples.some((s) => s.days > 0);
  const lines: string[] = [];
  if (!rows.length) lines.push(pick(PERFORMANCE_VARIANTS.noAffiliates, "prospection.evr.none", opts.chatKey));
  else {
    lines.push(`Estimé contre réel, ${rows.length} affiliés rattachés (${enough.length} avec au moins ${CALIBRATION_BOUNDS.minDays} jours de résultats) :`);
    for (const s of segments.slice(0, 6))
      lines.push(`${s.label} : ${s.affiliates} affiliés, réel ÷ estimé ${s.medianRatio.clicks === null ? "?" : fr1(s.medianRatio.clicks)} pour les clics, ${s.medianRatio.ftd === null ? "?" : fr1(s.medianRatio.ftd)} pour les premiers dépôts`);
    lines.push("Au-dessus de 1, le réel dépasse l'estimation ; en dessous, l'estimation était trop haute.");
  }
  return { rows, segments, overall, hasResults, text: lines.join("\n") };
}

/** Affiliés signés et actifs (site, Kevin « mes affiliés ») : performance de chacun, les rattachés d'abord. */
export async function signedAffiliates(deps: Deps): Promise<AffiliatePerformance[]> {
  const rows = (await deps.prisma.prospect.findMany({ where: { status: { in: ["SIGNED", "ACTIVE", "CHURNED"] } }, orderBy: { signedAt: "desc" } })) as unknown as Array<{ id: string; linkAffiAffiliateId: string | null }>;
  const out: AffiliatePerformance[] = [];
  for (const r of [...rows.filter((x) => x.linkAffiAffiliateId), ...rows.filter((x) => !x.linkAffiAffiliateId)]) {
    const perf = await affiliatePerformance(deps, r.id);
    if (perf) out.push(perf);
  }
  return out;
}

/** Segment (univers, pays) d'un prospect pour la comparaison (même clé que `estimatedVsReal`). */
export function comparisonSegmentOf(p: Pick<Row, "vertical" | "countries" | "contentType" | "tier">): string {
  return segmentKeyAt(segmentOf(p), "country");
}
