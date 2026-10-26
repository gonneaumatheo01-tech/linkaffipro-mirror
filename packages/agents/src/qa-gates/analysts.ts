/**
 * Phase 30, chantier B — QA Global des sorties de l'équipe Analystes (rapports, alertes immédiates, règles à risque).
 * - Rapport (`StrategyReport`) avant l'envoi par Kevin : `REPORT` avec les sources de la veille (chargées par le moteur
 *   d'après `sources` / `usedEntryIds`). Refus → nouvelle rédaction du Rapporteur avec les corrections (une fois), puis
 *   le rapport écrit par le code, qui repasse au QA ; 3e refus → le client tranche. Indisponible → envoi reporté.
 * - Alerte immédiate (tendance virale, entrée ou règle à risque) : `ALERT` ; refus → alerte annulée (faux positif),
 *   journalisée, jamais renvoyée ; indisponible → alerte gardée et retentée par la file de rattrapage.
 * - Règle publicitaire HIGH / BAN avant toute alerte : `COMPLIANCE_RULE` ; refusée → règle désactivée avec le motif.
 */
import { agentEvent, nowOf, readSetting, writeSetting } from "../admin/journal";
import type { QaContent, QaDeps } from "../qa/contract";
import type { AgentsDeps } from "../types";
import { askQaDecision, correctionLines, qaGate, registerQaDecisionHandler, shortMotif } from "./gate";

export const ANALYSTS_QA_RETRY_MS = 5 * 60_000;
/** Alerte retenue faute de QA : retentée par `qa-sweep` (`retryPendingAlerts`). */
export const QA_PENDING_ALERT_PREFIX = "qa.pendingAlert.";
/** Alerte annulée par le QA (faux positif) : jamais renvoyée. */
export const QA_CANCELLED_ALERT_PREFIX = "qa.alertCancelled.";
/** Règle désactivée par le QA : motif gardé (lu par le site et Kevin). */
export const QA_RULE_REJECTED_PREFIX = "qa.ruleRejected.";

type ReportRow = { id: string; reportType: string; period: string; title: string; summary?: string | null; content: unknown; recommendations: unknown; requestText?: string | null };
type RuleLike = { id: string; platform: string; market: string; country: string; rule: string; riskLevel: string; evidence: unknown; verified: boolean; workaround?: string | null; sourceEntryId: string | null };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Contenu vérifié d'un rapport (texte envoyé, résumé, recommandations, sources citées). */
export function reportQaContent(row: ReportRow): QaContent {
  const c = obj(row.content);
  const recs = Array.isArray(row.recommendations) ? (row.recommendations as unknown[]).map((r) => {
    const o = obj(r);
    return { title: o.title ?? null, countries: o.countries ?? null, platform: o.platform ?? null, evidence: o.evidence ?? null };
  }) : [];
  return {
    title: row.title,
    reportType: row.reportType,
    period: row.period,
    summary: row.summary ?? null,
    text: typeof c.text === "string" ? c.text : "",
    recommendations: recs,
    sources: Array.isArray(c.sources) ? c.sources : [],
    sourceEntryIds: Array.isArray(c.usedEntryIds) ? c.usedEntryIds : [],
    question: row.requestText ?? null,
  };
}

export type ReportGateResult = "send" | "human" | "later" | "dropped" | "held";

/**
 * Rapport prêt à partir ? `rewrite(mode, corrections)` : nouvelle rédaction de la même ligne (rapport de la semaine) ;
 * absente (briefing) : un refus le retient (`held`). `retry(delayMs)` : nouvel envoi plus tard.
 */
export async function gateReport(
  deps: QaDeps,
  reportId: string,
  opts: { rewrite?: (mode: "ai" | "code", corrections: string[]) => Promise<boolean>; retry?: (delayMs: number) => Promise<void> } = {},
): Promise<ReportGateResult> {
  for (let round = 0; round < 3; round++) {
    const row = (await deps.prisma.strategyReport.findUnique({ where: { id: reportId } })) as ReportRow | null;
    if (!row) return "dropped";
    if (obj(obj(row.content).qa).dropped === true) return "dropped";
    const gate = await qaGate(deps, { contentType: "REPORT", contentId: row.id, teamKey: "analystes", content: reportQaContent(row) });
    if (gate.kind === "approved") return "send";
    if (gate.kind === "unavailable") {
      await opts.retry?.(ANALYSTS_QA_RETRY_MS).catch(() => undefined);
      return "later";
    }
    if (gate.needsHuman) {
      await askQaDecision(deps, { contentType: "REPORT", contentId: row.id, teamKey: "analystes", hash: gate.hash, label: `le rapport « ${row.title.slice(0, 60)} »`, result: gate.result, extra: { reportType: row.reportType } });
      return "human";
    }
    if (!opts.rewrite) return "held";
    // Première refonte : le Rapporteur réécrit avec les corrections ; ensuite : le rapport écrit par le code.
    const mode: "ai" | "code" = gate.result.attempt <= 1 && round === 0 ? "ai" : "code";
    const ok = await opts.rewrite(mode, correctionLines(gate.result)).catch(() => false);
    await agentEvent(deps, "qa.report.returned", { reportId: row.id, mode, rewritten: ok });
    if (!ok) return "held";
  }
  return "held";
}

// ------------------------------------------------------------------------------------------------ alertes

export type AlertRef = { kind: "rule" | "entry"; id: string };
const alertKey = (prefix: string, a: AlertRef) => `${prefix}${a.kind}.${a.id}`;

/**
 * Alerte immédiate : « send » si le QA l'approuve ; « cancelled » si refusée (faux positif : annulée, journalisée,
 * jamais renvoyée) ; « later » si le QA ne répond pas (gardée, retentée par `qa-sweep`).
 */
export async function gateAlert(
  deps: QaDeps,
  a: AlertRef & { text: string; riskLevel?: string | null; source?: { url?: string | null; entryId?: string | null } | null },
): Promise<"send" | "cancelled" | "later"> {
  if ((await readSetting(deps, alertKey(QA_CANCELLED_ALERT_PREFIX, a))) !== undefined) return "cancelled";
  const content: QaContent = {
    message: a.text,
    riskLevel: a.riskLevel ?? null,
    source: { url: a.source?.url ?? null, entryId: a.source?.entryId ?? null },
    refKind: a.kind,
    ...(a.source?.entryId ? { sourceEntryId: a.source.entryId } : {}),
  };
  const gate = await qaGate(deps, { contentType: "ALERT", contentId: `${a.kind}:${a.id}`, teamKey: "analystes", content });
  if (gate.kind === "approved") {
    await deps.prisma.setting.deleteMany({ where: { key: alertKey(QA_PENDING_ALERT_PREFIX, a) } });
    return "send";
  }
  if (gate.kind === "unavailable") {
    await writeSetting(deps, alertKey(QA_PENDING_ALERT_PREFIX, a), { at: nowOf(deps).toISOString() });
    return "later";
  }
  await deps.prisma.setting.deleteMany({ where: { key: alertKey(QA_PENDING_ALERT_PREFIX, a) } });
  await writeSetting(deps, alertKey(QA_CANCELLED_ALERT_PREFIX, a), { at: nowOf(deps).toISOString(), checkId: gate.result.checkId, motif: shortMotif(gate.result, 200) });
  await agentEvent(deps, "qa.alert.cancelled", { kind: a.kind, id: a.id, checkId: gate.result.checkId });
  return "cancelled";
}

/** Alertes retenues faute de QA (lues par la file de rattrapage). */
export async function pendingAlerts(deps: Pick<AgentsDeps, "prisma">, limit = 20): Promise<AlertRef[]> {
  const rows = (await deps.prisma.setting.findMany({ where: { key: { startsWith: QA_PENDING_ALERT_PREFIX } }, take: limit })) as Array<{ key: string }>;
  const out: AlertRef[] = [];
  for (const r of rows) {
    const m = /^qa\.pendingAlert\.(rule|entry)\.(.+)$/.exec(r.key);
    if (m) out.push({ kind: m[1] as "rule" | "entry", id: m[2]! });
  }
  return out;
}

export async function clearPendingAlert(deps: Pick<AgentsDeps, "prisma">, a: AlertRef): Promise<void> {
  await deps.prisma.setting.deleteMany({ where: { key: alertKey(QA_PENDING_ALERT_PREFIX, a) } });
}

// ------------------------------------------------------------------------------------------------ règles

export function ruleQaContent(r: RuleLike): QaContent {
  return {
    platform: r.platform,
    market: r.market,
    country: r.country,
    rule: r.rule,
    riskLevel: r.riskLevel,
    evidence: r.evidence,
    verified: r.verified,
    workaround: r.workaround ?? null,
    sourceEntryId: r.sourceEntryId,
  };
}

/** Règle HIGH / BAN avant toute alerte : « ok », « deactivated » (refusée : désactivée avec le motif) ou « later ». */
export async function gateComplianceRule(deps: QaDeps, rule: RuleLike): Promise<"ok" | "deactivated" | "later"> {
  const gate = await qaGate(deps, { contentType: "COMPLIANCE_RULE", contentId: rule.id, teamKey: "analystes", content: ruleQaContent(rule) });
  if (gate.kind === "approved") return "ok";
  if (gate.kind === "unavailable") return "later";
  await deps.prisma.complianceRule.update({ where: { id: rule.id }, data: { isActive: false } });
  await writeSetting(deps, `${QA_RULE_REJECTED_PREFIX}${rule.id}`, { at: nowOf(deps).toISOString(), checkId: gate.result.checkId, motif: shortMotif(gate.result, 300) });
  await agentEvent(deps, "qa.rule.deactivated", { ruleId: rule.id, checkId: gate.result.checkId });
  return "deactivated";
}

// ------------------------------------------------------------------------------------------------ décision du client

type AnalystsEnqueueLike = (job: { type: "analysts.report"; kind: "weekly" | "briefing"; reportId: string }, opts?: { jobId?: string; delayMs?: number }) => Promise<void>;

registerQaDecisionHandler("REPORT", {
  async onApprove(deps, d) {
    const enqueue = (deps as AgentsDeps & { analysts?: { enqueue?: AnalystsEnqueueLike } }).analysts?.enqueue;
    const kind = d.extra.reportType === "WEEKLY" ? "weekly" : "briefing";
    await enqueue?.({ type: "analysts.report", kind, reportId: d.contentId }, { jobId: `analysts-report-${d.contentId}-qa${nowOf(deps).getTime()}` });
  },
  async onDrop(deps, d) {
    const row = (await deps.prisma.strategyReport.findUnique({ where: { id: d.contentId } })) as { content: unknown } | null;
    if (!row) return;
    await deps.prisma.strategyReport.update({ where: { id: d.contentId }, data: { content: JSON.parse(JSON.stringify({ ...obj(row.content), qa: { dropped: true, at: nowOf(deps).toISOString() } })) } });
  },
});
