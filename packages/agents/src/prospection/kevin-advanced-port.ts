/**
 * Phase 32, chantier C — port de Kevin vers les fonctions métier des chantiers A (Veilleur, Réseaux) et B
 * (Valorisateur, Boucle Link Affi) qui ne sont PAS dans `advanced-port.ts` (le socle). Remplaçable en test par
 * `deps.prospectionAdvancedKevin`.
 *
 * Les fonctions sont prises par leur nom dans les index des chantiers (`watch/index.ts`, `network/index.ts`,
 * `value/index.ts`, `learn/index.ts`), écrits en parallèle : un nom encore absent laisse Kevin répondre « pas encore
 * prêt » pour une action, ou lire la base lui-même pour une lecture (alertes, réseau, valeur, résultats). Les formes
 * rendues sont normalisées ici (une seule place à réconcilier).
 */
import type { ValueEstimate } from "./contract-advanced";
import type { ProspectionKevinDeps } from "./kevin-port";
import * as watch from "./watch/index";
import * as network from "./network/index";
import * as value from "./value/index";
import * as learn from "./learn/index";

export type AlertRow = {
  id: string;
  prospectId: string;
  kind: string;
  family: string;
  strength: number;
  data: Record<string, unknown>;
  evidence: string | null;
  status: string;
  createdAt: Date;
  sentAt: Date | null;
};
export type ActionResult = { ok: boolean; message?: string | null };
export type NetworkView = {
  id: string;
  name: string;
  mainContact: string | null;
  totalReach: number;
  countries: string[];
  members: Array<{ id: string; username: string | null; title: string | null; medianViews: number | null; status: string }>;
  evidence: Array<{ a: string; b: string; kind: string; points: number; detail: string }>;
};
export type PipelineValue = {
  byStatus: Array<{ status: string; count: number; low: number; base: number; high: number }>;
  total: { low: number; base: number; high: number; count: number };
  calibrated: boolean;
  /** Texte prêt du Valorisateur (chantier B), si fourni. */
  text?: string | null;
};
export type AffiliateMonth = { month: string; clicks: number | null; regs: number | null; ftd: number | null; revenueCents: number | null; missing: string[] };
export type AffiliatePerformance = { months: AffiliateMonth[]; estimate: ValueEstimate | null; text?: string | null };
export type EstimatedVsRealRow = { prospectId: string; name: string; low: number | null; base: number | null; high: number | null; realCents: number | null; month: string | null };
export type CalibrationChoice = { n: number; text: string; recommendationId?: string | null };

export type ProspectionAdvancedKevinPort = {
  listAlerts(deps: ProspectionKevinDeps, opts: { kinds?: string[]; status?: string[]; limit?: number }): Promise<AlertRow[]>;
  muteAlertKind(deps: ProspectionKevinDeps, kind: string, by: "client" | "system"): Promise<ActionResult | null>;
  unmuteAlertKind(deps: ProspectionKevinDeps, kind: string, by: "client" | "system"): Promise<ActionResult | null>;
  markAlertSeen(deps: ProspectionKevinDeps, alertId: string, by: "client" | "system"): Promise<ActionResult | null>;
  muteProspectAlerts(deps: ProspectionKevinDeps, prospectId: string, by: "client" | "system"): Promise<ActionResult | null>;
  networkOf(deps: ProspectionKevinDeps, prospectId: string): Promise<NetworkView | null>;
  pipelineValue(deps: ProspectionKevinDeps): Promise<PipelineValue>;
  /** Fourchette lisible ; reçoit une estimation complète ou une somme (pipeline). */
  formatValueRange(v: Pick<ValueEstimate, "low" | "base" | "high">): string;
  affiliatePerformance(deps: ProspectionKevinDeps, prospectId: string): Promise<AffiliatePerformance>;
  /** Lignes (secours lu en base) ; `text` : texte prêt du chantier B quand il existe (clics et premiers dépôts). */
  estimatedVsReal(deps: ProspectionKevinDeps): Promise<{ rows: EstimatedVsRealRow[]; text: string | null }>;
  listCalibrationChoices(deps: ProspectionKevinDeps): Promise<CalibrationChoice[]>;
  applyCalibration(deps: ProspectionKevinDeps, choices: number[], by: "client" | "system"): Promise<ActionResult | null>;
  undoCalibration(deps: ProspectionKevinDeps, by: "client" | "system"): Promise<ActionResult | null>;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any;
/** Fonction d'un chantier par son nom, ou null si elle n'existe pas encore. */
function fnOf(mod: unknown, name: string): AnyFn | null {
  const f = (mod as Record<string, unknown>)[name];
  return typeof f === "function" ? (f as AnyFn) : null;
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const numOr = (v: unknown, d: number | null = null): number | null => (typeof v === "number" && Number.isFinite(v) ? v : d);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const date = (v: unknown): Date | null => (v instanceof Date ? v : typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v) : null);

function toResult(r: unknown): ActionResult {
  const o = obj(r);
  if (r === true || r === undefined || r === null) return { ok: r !== null };
  return { ok: o.ok !== false, message: typeof o.message === "string" ? o.message : typeof o.reason === "string" ? o.reason : null };
}

function toAlert(r: unknown): AlertRow {
  const o = obj(r);
  return {
    id: String(o.id ?? ""),
    prospectId: String(o.prospectId ?? ""),
    kind: String(o.kind ?? ""),
    family: String(o.family ?? "info"),
    strength: numOr(o.strength, 0)!,
    data: obj(o.data),
    evidence: typeof o.evidence === "string" ? o.evidence : null,
    status: String(o.status ?? "NEW"),
    createdAt: date(o.createdAt) ?? new Date(0),
    sentAt: date(o.sentAt),
  };
}

// ------------------------------------------------------------------------------------------------ lectures de secours

async function dbAlerts(deps: ProspectionKevinDeps, opts: { kinds?: string[]; status?: string[]; limit?: number }): Promise<AlertRow[]> {
  const where: Record<string, unknown> = {};
  if (opts.kinds?.length) where.kind = { in: opts.kinds };
  where.status = { in: opts.status?.length ? opts.status : ["NEW", "SENT"] };
  const rows = await deps.prisma.prospectAlert.findMany({ where: where as never, orderBy: [{ strength: "desc" }, { createdAt: "desc" }] as never, take: opts.limit ?? 50 });
  return (rows as unknown[]).map(toAlert);
}

async function dbNetworkOf(deps: ProspectionKevinDeps, prospectId: string): Promise<NetworkView | null> {
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId }, select: { networkId: true } as never })) as { networkId?: string | null } | null;
  if (!p?.networkId) return null;
  const n = obj(await deps.prisma.prospectNetwork.findUnique({ where: { id: p.networkId } }));
  if (!n.id) return null;
  const members = (await deps.prisma.prospect.findMany({ where: { networkId: p.networkId } as never, select: { id: true, username: true, title: true, medianViews: true, status: true } as never })) as unknown as NetworkView["members"];
  return {
    id: String(n.id),
    name: String(n.name ?? ""),
    mainContact: typeof n.mainContact === "string" ? n.mainContact : null,
    totalReach: numOr(n.totalReach, 0)!,
    countries: strArr(n.countries),
    members,
    evidence: (Array.isArray(n.evidence) ? n.evidence : []).map((e: unknown) => {
      const x = obj(e);
      return { a: String(x.a ?? ""), b: String(x.b ?? ""), kind: String(x.kind ?? ""), points: numOr(x.points, 0)!, detail: String(x.detail ?? "") };
    }),
  };
}

const PIPELINE_STATUSES = ["QUALIFIED", "CONTACTED", "RESPONDED", "NEGOTIATING", "SIGNED", "ACTIVE"];

export function estimateOf(v: unknown): ValueEstimate | null {
  const o = obj(v);
  return typeof o.low === "number" && typeof o.base === "number" && typeof o.high === "number" ? (o as ValueEstimate) : null;
}

async function dbPipelineValue(deps: ProspectionKevinDeps): Promise<PipelineValue> {
  const rows = (await deps.prisma.prospect.findMany({ where: { status: { in: PIPELINE_STATUSES } } as never, select: { status: true, valueEstimate: true } as never })) as Array<{ status: string; valueEstimate: unknown }>;
  const by = new Map<string, { status: string; count: number; low: number; base: number; high: number }>();
  let calibrated = false;
  for (const r of rows) {
    const v = estimateOf(r.valueEstimate);
    if (!v) continue;
    if (v.calibratedBy && v.calibratedBy !== "default") calibrated = true;
    const b = by.get(r.status) ?? { status: r.status, count: 0, low: 0, base: 0, high: 0 };
    b.count++;
    b.low += v.low;
    b.base += v.base;
    b.high += v.high;
    by.set(r.status, b);
  }
  const byStatus = PIPELINE_STATUSES.map((s) => by.get(s)).filter((x): x is NonNullable<typeof x> => !!x);
  const total = byStatus.reduce((t, b) => ({ low: t.low + b.low, base: t.base + b.base, high: t.high + b.high, count: t.count + b.count }), { low: 0, base: 0, high: 0, count: 0 });
  return { byStatus, total, calibrated };
}

const euros = (n: number) => `${Math.round(n).toLocaleString("fr-FR")}`;

/** Fourchette lisible (« 120 – 650 €/mois, probable 300 € ») : jamais un chiffre seul. */
export function defaultValueRange(v: Pick<ValueEstimate, "low" | "base" | "high">): string {
  return `${euros(v.low)} – ${euros(v.high)} €/mois (probable ${euros(v.base)} €)`;
}

async function dbAffiliatePerformance(deps: ProspectionKevinDeps, prospectId: string): Promise<AffiliatePerformance> {
  const rows = (await deps.prisma.affiliateResult.findMany({ where: { prospectId }, orderBy: { month: "desc" }, take: 6 })) as Array<Record<string, unknown>>;
  const p = (await deps.prisma.prospect.findUnique({ where: { id: prospectId }, select: { valueEstimate: true } as never })) as { valueEstimate?: unknown } | null;
  return {
    months: rows.map((r) => ({ month: String(r.month), clicks: numOr(r.clicks), regs: numOr(r.regs), ftd: numOr(r.ftd), revenueCents: numOr(r.revenueCents), missing: strArr(r.missing) })),
    estimate: estimateOf(p?.valueEstimate),
  };
}

async function dbEstimatedVsReal(deps: ProspectionKevinDeps): Promise<EstimatedVsRealRow[]> {
  const ps = (await deps.prisma.prospect.findMany({ where: { linkAffiAffiliateId: { not: null } } as never, select: { id: true, username: true, title: true, valueEstimate: true } as never })) as Array<{ id: string; username: string | null; title: string | null; valueEstimate: unknown }>;
  const out: EstimatedVsRealRow[] = [];
  for (const p of ps) {
    const last = (await deps.prisma.affiliateResult.findFirst({ where: { prospectId: p.id }, orderBy: { month: "desc" } })) as Record<string, unknown> | null;
    const v = estimateOf(p.valueEstimate);
    out.push({ prospectId: p.id, name: p.username ? `@${p.username}` : (p.title ?? "?"), low: v?.low ?? null, base: v?.base ?? null, high: v?.high ?? null, realCents: numOr(last?.revenueCents), month: last ? String(last.month) : null });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ port réel

const REAL: ProspectionAdvancedKevinPort = {
  async listAlerts(deps, opts) {
    const f = fnOf(watch, "listAlerts");
    if (!f) return dbAlerts(deps, opts);
    const r = await f(deps, opts);
    return (Array.isArray(r) ? r : Array.isArray(obj(r).alerts) ? obj(r).alerts : []).map(toAlert);
  },
  async muteAlertKind(deps, kind, by) {
    const f = fnOf(watch, "muteAlertKind");
    return f ? toResult(await f(deps, kind, by)) : null;
  },
  async unmuteAlertKind(deps, kind, by) {
    const f = fnOf(watch, "unmuteAlertKind");
    return f ? toResult(await f(deps, kind, by)) : null;
  },
  async markAlertSeen(deps, alertId, by) {
    const f = fnOf(watch, "markAlertSeen");
    return f ? toResult(await f(deps, alertId, by)) : null;
  },
  async muteProspectAlerts(deps, prospectId, by) {
    const f = fnOf(watch, "muteProspectAlerts");
    return f ? toResult(await f(deps, prospectId, by)) : null;
  },
  async networkOf(deps, prospectId) {
    const f = fnOf(network, "networkOf");
    if (!f) return dbNetworkOf(deps, prospectId);
    const o = obj(await f(deps, prospectId));
    const n = obj(o.network);
    if (!n.id) return null;
    // Forme du chantier A : `{ network, members, evidence }`.
    return {
      id: String(n.id),
      name: String(n.name ?? ""),
      mainContact: typeof n.mainContact === "string" ? n.mainContact : null,
      totalReach: numOr(n.totalReach, 0)!,
      countries: strArr(n.countries),
      members: (Array.isArray(o.members) ? o.members : []).map((m: unknown) => {
        const x = obj(m);
        return { id: String(x.id ?? ""), username: typeof x.username === "string" ? x.username : null, title: typeof x.title === "string" ? x.title : null, medianViews: numOr(x.medianViews), status: String(x.status ?? "") };
      }),
      evidence: (Array.isArray(o.evidence) ? o.evidence : []).map((e: unknown) => {
        const x = obj(e);
        return { a: String(x.a ?? ""), b: String(x.b ?? ""), kind: String(x.kind ?? ""), points: numOr(x.points, 0)!, detail: String(x.detail ?? "") };
      }),
    };
  },
  async pipelineValue(deps) {
    const f = fnOf(value, "pipelineValue");
    if (!f) return dbPipelineValue(deps);
    const o = obj(await f(deps));
    if (!Array.isArray(o.byStatus) || !o.total) return dbPipelineValue(deps);
    const t = obj(o.total);
    return {
      byStatus: o.byStatus.map((b: unknown) => {
        const x = obj(b);
        return { status: String(x.status ?? ""), count: numOr(x.estimated ?? x.count, 0)!, low: numOr(x.low, 0)!, base: numOr(x.base, 0)!, high: numOr(x.high, 0)! };
      }),
      total: { count: numOr(t.estimated ?? t.count, 0)!, low: numOr(t.low, 0)!, base: numOr(t.base, 0)!, high: numOr(t.high, 0)! },
      calibrated: typeof t.calibration === "string" ? t.calibration !== "none" : t.calibrated === true,
      text: typeof o.text === "string" ? o.text : null,
    };
  },
  formatValueRange(v) {
    const f = fnOf(value, "formatValueRange");
    // La forme du chantier B dit aussi « non calibrée » ; une somme (sans `calibratedBy`) garde la forme d'ici.
    const s = f && "calibratedBy" in v ? f(v) : null;
    return typeof s === "string" && s.trim() ? s : defaultValueRange(v);
  },
  async affiliatePerformance(deps, prospectId) {
    const f = fnOf(learn, "affiliatePerformance");
    if (!f) return dbAffiliatePerformance(deps, prospectId);
    const r = await f(deps, prospectId);
    if (!r) return { months: [], estimate: null, text: null };
    const o = obj(r);
    if (!Array.isArray(o.months)) return dbAffiliatePerformance(deps, prospectId);
    return {
      months: o.months.map((m: unknown) => {
        const x = obj(m);
        return { month: String(x.month ?? ""), clicks: numOr(x.clicks), regs: numOr(x.regs), ftd: numOr(x.ftd), revenueCents: numOr(x.revenueCents), missing: strArr(x.missing) };
      }),
      estimate: estimateOf(o.estimate),
      text: typeof o.text === "string" ? o.text : null,
    };
  },
  async estimatedVsReal(deps) {
    const f = fnOf(learn, "estimatedVsReal");
    if (!f) return { rows: await dbEstimatedVsReal(deps), text: null };
    const o = obj(await f(deps));
    if (o.hasResults === false) return { rows: [], text: null };
    return { rows: await dbEstimatedVsReal(deps), text: typeof o.text === "string" && o.text.trim() ? o.text : null };
  },
  async listCalibrationChoices(deps) {
    const f = fnOf(learn, "listCalibrationChoices");
    if (!f) return [];
    const r = await f(deps);
    const rows = Array.isArray(r) ? r : obj(r).choices;
    return (Array.isArray(rows) ? rows : []).map((x: unknown, i: number) => {
      const o = obj(x);
      return { n: numOr(o.n ?? o.number, i + 1)!, text: String(o.text ?? o.label ?? o.summary ?? ""), recommendationId: typeof o.recommendationId === "string" ? o.recommendationId : typeof o.id === "string" ? o.id : null };
    });
  },
  async applyCalibration(deps, choices, by) {
    const f = fnOf(learn, "applyCalibration");
    return f ? toResult(await f(deps, choices, by)) : null;
  },
  async undoCalibration(deps, by) {
    const f = fnOf(learn, "undoCalibration");
    return f ? toResult(await f(deps, by)) : null;
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ProspectionAdvancedKevinDeps = ProspectionKevinDeps & { prospectionAdvancedKevin?: Partial<ProspectionAdvancedKevinPort> };

export function prospectionAdvancedKevinPort(deps: { prospectionAdvancedKevin?: Partial<ProspectionAdvancedKevinPort> }): ProspectionAdvancedKevinPort {
  return { ...REAL, ...(deps.prospectionAdvancedKevin ?? {}) };
}
