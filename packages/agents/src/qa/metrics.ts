/**
 * Phase 30 — chiffres du QA Global (prompt section 4) : taux d'approbation global, par équipe, par type, par heure / jour
 * / semaine (heure de Paris), latence moyenne, blocages « modèle indisponible », 5 premières raisons de refus.
 * Lecture seule ; lus par Kevin (`qa_status`) et par la page Agents → Qualité.
 *
 * Taux d'approbation = vérifications APPROVED ÷ toutes les vérifications de la période (un délai dépassé ou une erreur
 * n'est pas une approbation). Null quand il n'y a aucune vérification.
 */
import { addDaysToDay, parisDay, parisParts, parisWeekday } from "../rules/time";
import type { QaContentType, QaDeps, QaReason, QaVerdict } from "./contract";
import { QA_ENGINE_CODES, QA_NO_MODEL } from "./codes";

export type QaCounts = { total: number; approved: number; rejected: number; timeout: number; error: number; approvalRate: number | null };
export type QaBucket = QaCounts & { key: string };

export type QaStats = QaCounts & {
  since: string;
  until: string;
  byTeam: QaBucket[];
  byType: QaBucket[];
  /** « AAAA-MM-JJ HH » (Paris). */
  byHour: QaBucket[];
  /** « AAAA-MM-JJ » (Paris). */
  byDay: QaBucket[];
  /** Lundi de la semaine « AAAA-MM-JJ » (Paris). */
  byWeek: QaBucket[];
  /** Latence moyenne des vérifications où le modèle a été appelé (ms), null si aucune. */
  avgLatencyMs: number | null;
  /** Vérifications bloquées parce que le modèle était indisponible (panne, quota, clé absente). */
  unavailableBlocks: number;
  /** Délais dépassés. */
  timeouts: number;
  /** 5 premières raisons de refus (codes des motifs bloquants des vérifications REJECTED). */
  topRejectReasons: Array<{ code: string; count: number; example: string }>;
  costCents: number;
};

type Row = { verdict: QaVerdict; teamKey: string; contentType: QaContentType; durationMs: number; createdAt: Date; reasons: unknown; modelUsed: string; costCents: number };

const empty = (): QaCounts => ({ total: 0, approved: 0, rejected: 0, timeout: 0, error: 0, approvalRate: null });

function add(c: QaCounts, v: QaVerdict): void {
  c.total++;
  if (v === "APPROVED") c.approved++;
  else if (v === "REJECTED") c.rejected++;
  else if (v === "TIMEOUT") c.timeout++;
  else c.error++;
}

function rate(c: QaCounts): QaCounts {
  c.approvalRate = c.total ? Math.round((c.approved / c.total) * 1000) / 1000 : null;
  return c;
}

function bucketize(rows: Row[], keyOf: (r: Row) => string): QaBucket[] {
  const map = new Map<string, QaCounts>();
  for (const r of rows) {
    const k = keyOf(r);
    const c = map.get(k) ?? empty();
    add(c, r.verdict);
    map.set(k, c);
  }
  return [...map.entries()].map(([key, c]) => ({ key, ...rate(c) })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function reasonsOf(v: unknown): QaReason[] {
  return Array.isArray(v)
    ? v.filter((r): r is QaReason => !!r && typeof r === "object" && typeof (r as QaReason).code === "string" && typeof (r as QaReason).message === "string")
    : [];
}

const pad = (n: number) => String(n).padStart(2, "0");
export const parisHourKey = (at: Date) => `${parisDay(at)} ${pad(parisParts(at).hour)}`;
export const parisWeekKey = (at: Date) => addDaysToDay(parisDay(at), -(parisWeekday(at) - 1));

const ENGINE = new Set<string>(Object.values(QA_ENGINE_CODES));

/** Chiffres du QA sur [since, until[. */
export async function qaStats(deps: QaDeps, q: { since: Date; until: Date }): Promise<QaStats> {
  const rows = (await deps.prisma.qaCheck.findMany({
    where: { createdAt: { gte: q.since, lt: q.until } },
    orderBy: { createdAt: "asc" },
    select: { verdict: true, teamKey: true, contentType: true, durationMs: true, createdAt: true, reasons: true, modelUsed: true, costCents: true },
  })) as Row[];
  const total = empty();
  for (const r of rows) add(total, r.verdict);
  rate(total);

  const called = rows.filter((r) => r.verdict === "APPROVED" || r.verdict === "REJECTED" || r.verdict === "TIMEOUT").filter((r) => r.modelUsed !== QA_NO_MODEL);
  const avgLatencyMs = called.length ? Math.round(called.reduce((s, r) => s + r.durationMs, 0) / called.length) : null;
  const unavailableBlocks = rows.filter((r) => r.verdict !== "APPROVED" && reasonsOf(r.reasons).some((x) => x.code === QA_ENGINE_CODES.unavailable)).length;

  const top = new Map<string, { count: number; example: string }>();
  for (const r of rows) {
    if (r.verdict !== "REJECTED") continue;
    const codes = new Map<string, string>();
    for (const x of reasonsOf(r.reasons)) if (x.severity === "critical" && !ENGINE.has(x.code) && !codes.has(x.code)) codes.set(x.code, x.message);
    for (const [code, message] of codes) {
      const t = top.get(code) ?? { count: 0, example: message };
      t.count++;
      top.set(code, t);
    }
  }
  const topRejectReasons = [...top.entries()]
    .map(([code, t]) => ({ code, count: t.count, example: t.example }))
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1))
    .slice(0, 5);

  return {
    ...total,
    since: q.since.toISOString(),
    until: q.until.toISOString(),
    byTeam: bucketize(rows, (r) => r.teamKey),
    byType: bucketize(rows, (r) => r.contentType),
    byHour: bucketize(rows, (r) => parisHourKey(r.createdAt)),
    byDay: bucketize(rows, (r) => parisDay(r.createdAt)),
    byWeek: bucketize(rows, (r) => parisWeekKey(r.createdAt)),
    avgLatencyMs,
    unavailableBlocks,
    timeouts: total.timeout,
    topRejectReasons,
    costCents: rows.reduce((s, r) => s + (r.costCents || 0), 0),
  };
}
