/**
 * Phase 29, chantier C — tâches de la file `agents-analystes` (le worker ne fait qu'appeler `runAnalystsJob`) et
 * réponses différées de Kevin :
 * - `analysts.schedule` (toutes les heures) : premier lancement (sources de départ + base de règles, une seule fois,
 *   `Setting analysts.bootstrapped`), sources dues → `analysts.scrape`, rapport de la semaine (jour et heure réglables,
 *   lundi 8 h Paris par défaut, une seule fois par semaine), découverte (une fois par semaine), revérification et purge
 *   (une fois par jour) ;
 * - `analysts.scrape` : lecture d'une source (chantier A) ; entrées des catégories « règles » → `analysts.compliance_check` ;
 *   tendance virale → message immédiat ; source coupée après 5 échecs → Kevin prévient une fois ;
 * - `analysts.compliance_check` (chantier B) : règle HIGH / BAN → message immédiat (une alerte par règle ou par entrée) ;
 * - `analysts.strategy` : synthèse de la semaine (puis `analysts.report`), ou question du client (réponse de Kevin
 *   dans la conversation de la question) ;
 * - `analysts.report` : envoi du rapport de la semaine (une seule fois) ou d'un briefing ;
 * - `analysts.discover` : source proposée → Kevin demande « Je l'ajoute à ma veille ? » (deux boutons) ; OUI → active ;
 * - `analysts.reverify`, `analysts.purge`.
 * `analysts.enabled = false` : rien ne tourne. L'équipe ne touche jamais aux pubs, canaux, budgets ni créatives.
 */
import { adminTelegramId, esc, nowOf, readSetting, writeSetting } from "../admin/journal";
import { askHuman } from "../human/requests";
import { registerAnswerAction } from "../human/respond";
import { pick } from "../boss/voice";
import { parisDay, parisParts, parisWeekday } from "../rules/time";
import type { AgentsDeps } from "../types";
import { LEGAL_DISCLAIMER, type AnalystsQueueJob, type Market } from "./contract";
import { analystsPort, type AnalystsKevinDeps } from "./kevin-port";
import { openMarketRecommendations, recommendationChoiceLine, recommendationTitle, ruleSources, type RuleRow, type SourceRow, type TrendRow } from "./kevin-read";
import {
  analystsEnabled,
  analystsScheduleSettings,
  ANALYSTS_ALERTED_PREFIX,
  ANALYSTS_REQUEST_PREFIX,
  ANALYSTS_SOURCE_WARNED_PREFIX,
  claimAlert,
  markAnalystsRequestAnswered,
  readAnalystsRequest,
  releaseAlert,
  sendKevin,
  writeAnalystsChoice,
  type AnalystsChoice,
  type AnalystsRequest,
} from "./kevin-state";
import { ANALYSTS_KEVIN_VARIANTS as V, boundedAnswer, riskAtLeast } from "./kevin-texts";
import { AnalystsAiError } from "./reasoning";
import { weekPeriod } from "./reporter";

/** Catégories d'entrée lues par la Compliance. */
export const ANALYSTS_COMPLIANCE_CATEGORIES = ["AD_BAN", "PLATFORM_CHANGE", "REGULATION"] as const;

export const ANALYSTS_BOOTSTRAP_SETTING = "analysts.bootstrapped";
/** Repères des passages (semaine ISO ou jour de Paris) : une seule mise en file par période. */
export const ANALYSTS_RUNS_SETTING = "analysts.runs";
/** Entrée signalée « à risque » par la veille : la Compliance prévient par la règle, sinon par l'entrée. */
export const ANALYSTS_ENTRY_FLAG_PREFIX = "analysts.alertEntry.";
/** Réponse au bouton « Je l'ajoute à ma veille ? ». */
export const ANALYSTS_ACTIVATE_ANSWER = "analysts-activate-source";

/** Un premier lancement raté se retente 6 heures plus tard (jamais à chaque heure). */
const BOOTSTRAP_RETRY_MS = 6 * 3600_000;
/** Sources lues par passage horaire, au plus. */
const SCHEDULE_MAX_SOURCES = 50;
/** Revérification et purge chaque jour à partir de ces heures (Paris). */
const REVERIFY_HOUR = 5;
const PURGE_HOUR = 3;

type Runs = { weekly?: string; discover?: string; reverify?: string; purge?: string };
type Bootstrap = { sourcesAt?: string; rulesAt?: string; triedAt?: string };

const jobKey = (job: AnalystsQueueJob, id: string) => `analysts-${job.type.replace("analysts.", "")}-${id}`;

/** Mise en file (worker) ; sans file (tests, outils), la tâche tourne tout de suite. */
async function queue(deps: AnalystsKevinDeps, job: AnalystsQueueJob, jobId: string): Promise<void> {
  const enqueue = deps.analysts?.enqueue;
  if (enqueue) await enqueue(job, { jobId });
  else await runAnalystsJob(deps, job);
}

function aiBlocked(err: unknown): "budget" | "no_ai" | null {
  if (err instanceof AnalystsAiError && (err.code === "budget" || err.code === "no_ai")) return err.code;
  const code = (err as { code?: unknown } | null)?.code;
  return code === "budget" || code === "no_ai" ? code : null;
}

// ------------------------------------------------------------------------------------------------ point d'entrée

export async function runAnalystsJob(deps: AnalystsKevinDeps, job: AnalystsQueueJob): Promise<Record<string, unknown>> {
  if (!(await analystsEnabled(deps))) {
    // Question en attente : Kevin dit que la veille est coupée (la personne n'attend pas pour rien).
    if (job.type === "analysts.strategy" && job.kind === "on_demand" && job.requestId) {
      const req = await readAnalystsRequest(deps, job.requestId);
      if (req && !req.answeredAt) {
        await sendKevin(deps, req.chatId, pick(V.disabled, "analysts.disabled", req.chatId));
        await markAnalystsRequestAnswered(deps, req);
      }
    }
    return { skipped: "disabled" };
  }
  switch (job.type) {
    case "analysts.schedule":
      return schedule(deps);
    case "analysts.scrape":
      return scrape(deps, job.sourceId);
    case "analysts.compliance_check":
      return complianceCheck(deps, job.entryId);
    case "analysts.strategy":
      return job.kind === "weekly" ? weeklyStrategy(deps) : onDemand(deps, job.requestId ?? null);
    case "analysts.report":
      return job.kind === "weekly" ? sendWeeklyReport(deps, job.reportId ?? null) : sendBriefing(deps, job.reportId ?? null);
    case "analysts.discover":
      return discover(deps);
    case "analysts.reverify":
      return reverify(deps);
    case "analysts.purge":
      return purge(deps);
    default:
      return { skipped: "unknown" };
  }
}

// ------------------------------------------------------------------------------------------------ planification

async function readRuns(deps: AgentsDeps): Promise<Runs> {
  const v = await readSetting(deps, ANALYSTS_RUNS_SETTING);
  return v && typeof v === "object" ? (v as Runs) : {};
}

async function schedule(deps: AnalystsKevinDeps): Promise<Record<string, unknown>> {
  const now = nowOf(deps);
  const out: Record<string, unknown> = {};
  out.bootstrap = await bootstrap(deps);
  const due = (await deps.prisma.trendSource.findMany({
    where: { isActive: true, OR: [{ nextScrapeAt: null }, { nextScrapeAt: { lte: now } }] },
    orderBy: { nextScrapeAt: "asc" },
    take: SCHEDULE_MAX_SOURCES,
  })) as SourceRow[];
  for (const s of due) await queue(deps, { type: "analysts.scrape", sourceId: s.id }, `analysts-scrape-${s.id}`);
  out.scrapes = due.length;

  const settings = await analystsScheduleSettings(deps);
  const runs = await readRuns(deps);
  const { period } = weekPeriod(now);
  const day = parisDay(now);
  const hour = parisParts(now).hour;
  const next: Runs = { ...runs };
  const todo: AnalystsQueueJob[] = [];
  // Rapport de la semaine : le bon jour seulement (jamais rattrapé le lendemain), dès l'heure réglée.
  if (parisWeekday(now) === settings.weeklyDay && hour >= settings.weeklyHour && runs.weekly !== period) {
    next.weekly = period;
    todo.push({ type: "analysts.strategy", kind: "weekly" });
  }
  if (runs.discover !== period) {
    next.discover = period;
    todo.push({ type: "analysts.discover" });
  }
  if (hour >= REVERIFY_HOUR && runs.reverify !== day) {
    next.reverify = day;
    todo.push({ type: "analysts.reverify" });
  }
  if (hour >= PURGE_HOUR && runs.purge !== day) {
    next.purge = day;
    todo.push({ type: "analysts.purge" });
  }
  if (todo.length) await writeSetting(deps, ANALYSTS_RUNS_SETTING, next);
  for (const job of todo) await queue(deps, job, jobKey(job, job.type === "analysts.strategy" ? period : job.type === "analysts.discover" ? period : day));
  out.queued = todo.map((j) => j.type);
  return out;
}

/** Premier lancement : sources de départ puis base de règles, chacune une seule fois. */
async function bootstrap(deps: AnalystsKevinDeps): Promise<string> {
  const now = nowOf(deps);
  const state = ((await readSetting(deps, ANALYSTS_BOOTSTRAP_SETTING)) ?? {}) as Bootstrap;
  if (state.sourcesAt && state.rulesAt) return "done";
  if (state.triedAt && now.getTime() - new Date(state.triedAt).getTime() < BOOTSTRAP_RETRY_MS) return "waiting";
  const port = analystsPort(deps);
  const next: Bootstrap = { ...state, triedAt: now.toISOString() };
  try {
    if (!state.sourcesAt) {
      await port.seedSources(deps);
      next.sourcesAt = now.toISOString();
    }
    if (!state.rulesAt) {
      const r = await port.buildInitialRules(deps);
      next.rulesAt = now.toISOString();
      // Base de départ : les règles déjà connues ne déclenchent pas une avalanche d'alertes ; elles sont marquées
      // « déjà signalées » et restent consultables (« y a des alertes en ce moment ? »).
      for (const id of [...r.created, ...r.updated]) await claimAlert(deps, "rule", id);
    }
    await writeSetting(deps, ANALYSTS_BOOTSTRAP_SETTING, { ...next, triedAt: undefined });
    return "done";
  } catch (err) {
    await writeSetting(deps, ANALYSTS_BOOTSTRAP_SETTING, next);
    deps.logger?.warn({ err: (err as Error).message }, "[analystes] premier lancement incomplet, nouvel essai plus tard");
    return aiBlocked(err) ?? "error";
  }
}

// ------------------------------------------------------------------------------------------------ veille

async function scrape(deps: AnalystsKevinDeps, sourceId: string): Promise<Record<string, unknown>> {
  const port = analystsPort(deps);
  const r = await port.scrapeSource(deps, sourceId);
  if (!r.ok) {
    if ("event" in r && r.event) await warnSourceDown(deps, r.event.sourceId, r.event.name, r.event.errorCount);
    return { ok: false, ...("skipped" in r && r.skipped ? { skipped: r.skipped } : { error: "error" in r ? r.error : null }) };
  }
  const entries = r.entryIds.length ? ((await deps.prisma.trendEntry.findMany({ where: { id: { in: r.entryIds } } })) as TrendRow[]) : [];
  let checks = 0;
  for (const e of entries) {
    if (!(ANALYSTS_COMPLIANCE_CATEGORIES as readonly string[]).includes(e.category)) continue;
    await queue(deps, { type: "analysts.compliance_check", entryId: e.id }, `analysts-compliance-${e.id}`);
    checks++;
  }
  let alerts = 0;
  for (const a of r.alerts) {
    if (a.kind === "viral") {
      if (await sendEntryAlert(deps, a.entryId, "trend")) alerts++;
    } else {
      // Risque élevé : la Compliance prévient par la règle qu'elle en tire, sinon par l'entrée elle-même.
      await writeSetting(deps, `${ANALYSTS_ENTRY_FLAG_PREFIX}${a.entryId}`, { at: nowOf(deps).toISOString(), risk: a.risk });
      if (!(ANALYSTS_COMPLIANCE_CATEGORIES as readonly string[]).includes(a.category)) {
        await queue(deps, { type: "analysts.compliance_check", entryId: a.entryId }, `analysts-compliance-${a.entryId}`);
        checks++;
      }
    }
  }
  return { ok: true, created: r.created, checks, alerts };
}

/** Source coupée après 5 échecs : Kevin prévient une seule fois (jusqu'à ce qu'elle soit rallumée). */
async function warnSourceDown(deps: AnalystsKevinDeps, sourceId: string, name: string, errorCount: number): Promise<void> {
  const key = `${ANALYSTS_SOURCE_WARNED_PREFIX}${sourceId}`;
  if ((await readSetting(deps, key)) !== undefined) return;
  await writeSetting(deps, key, { at: nowOf(deps).toISOString() });
  const sent = await sendKevin(deps, null, pick(V.sourceDown({ name: esc(name), n: errorCount }), "analysts.sourceDown"));
  if (sent === null) await deps.prisma.setting.deleteMany({ where: { key } });
}

/** Alerte d'une entrée (tendance virale, ou entrée à risque sans règle) ; une seule fois par entrée. */
async function sendEntryAlert(deps: AnalystsKevinDeps, entryId: string, kind: "trend" | "risk"): Promise<boolean> {
  const e = (await deps.prisma.trendEntry.findUnique({ where: { id: entryId } })) as TrendRow | null;
  if (!e || !(await claimAlert(deps, "entry", entryId))) return false;
  const text =
    kind === "trend"
      ? analystsPort(deps).alertFor({ id: e.id, summary: e.summary, url: e.url, verified: e.verified, title: e.title }).text
      : `${pick(V.entryAlert({ summary: esc(e.summary.replace(/[.\s]+$/u, "").slice(0, 240)), url: esc(e.url) }), "analysts.alert.entry")}\n${esc(LEGAL_DISCLAIMER)}`;
  const sent = await sendKevin(deps, null, text);
  if (sent === null) {
    await releaseAlert(deps, "entry", entryId);
    return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ compliance

async function complianceCheck(deps: AnalystsKevinDeps, entryId: string): Promise<Record<string, unknown>> {
  const port = analystsPort(deps);
  const flagKey = `${ANALYSTS_ENTRY_FLAG_PREFIX}${entryId}`;
  const flagged = (await readSetting(deps, flagKey)) !== undefined;
  let res: Awaited<ReturnType<typeof port.checkEntryCompliance>>;
  try {
    res = await port.checkEntryCompliance(deps, entryId);
  } catch (err) {
    // Compliance indisponible : une entrée à risque est quand même signalée (une fois), puis l'erreur remonte.
    if (flagged && (await sendEntryAlert(deps, entryId, "risk"))) await deps.prisma.setting.deleteMany({ where: { key: flagKey } });
    if (aiBlocked(err)) return { ok: false, reason: aiBlocked(err) };
    throw err;
  }
  const { alertRisk } = await analystsScheduleSettings(deps);
  let sent = 0;
  const alerted = new Set<string>();
  // Alertes rendues par la Compliance (HIGH / BAN, texte prêt).
  for (const a of "alerts" in res ? res.alerts : []) {
    if (a.kind !== "compliance" || !a.riskLevel || !riskAtLeast(a.riskLevel, alertRisk)) continue;
    alerted.add(a.refId);
    if (await sendRuleAlert(deps, a.refId, a.text)) sent++;
  }
  // Filet : règles nées de cette entrée au-dessus du seuil, pas encore signalées.
  const born = (await deps.prisma.complianceRule.findMany({ where: { sourceEntryId: entryId, isActive: true } })) as RuleRow[];
  for (const r of born) {
    if (alerted.has(r.id) || !riskAtLeast(r.riskLevel, alertRisk)) continue;
    alerted.add(r.id);
    const text = port.alertFor({
      id: r.id,
      platform: r.platform as never,
      market: r.market as Market,
      country: r.country,
      rule: r.rule,
      riskLevel: r.riskLevel as never,
      verified: r.verified,
      evidence: ruleSources(r).map((s) => ({ url: s.url })),
    }).text;
    if (await sendRuleAlert(deps, r.id, text)) sent++;
  }
  if (flagged) {
    if (!alerted.size) await sendEntryAlert(deps, entryId, "risk");
    await deps.prisma.setting.deleteMany({ where: { key: flagKey } });
  }
  return { ok: true, alerts: sent };
}

/** Une alerte par règle : réservée avant l'envoi, libérée si le message n'est pas parti. */
async function sendRuleAlert(deps: AnalystsKevinDeps, ruleId: string, text: string): Promise<boolean> {
  if (!(await claimAlert(deps, "rule", ruleId))) return false;
  const html = text.includes(esc(LEGAL_DISCLAIMER)) || text.includes(LEGAL_DISCLAIMER) ? text : `${text}\n${esc(LEGAL_DISCLAIMER)}`;
  const sent = await sendKevin(deps, null, html);
  if (sent === null) {
    await releaseAlert(deps, "rule", ruleId);
    return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ semaine

async function weeklyStrategy(deps: AnalystsKevinDeps): Promise<Record<string, unknown>> {
  const now = nowOf(deps);
  const { period } = weekPeriod(now);
  const existing = (await deps.prisma.strategyReport.findFirst({ where: { reportType: "WEEKLY", period } })) as { id: string } | null;
  if (existing) {
    await queue(deps, { type: "analysts.report", kind: "weekly", reportId: existing.id }, `analysts-report-${existing.id}`);
    return { ok: true, reportId: existing.id, reused: true };
  }
  const port = analystsPort(deps);
  let synthesis = null;
  try {
    synthesis = await port.weeklySynthesis(deps);
  } catch (err) {
    if (!aiBlocked(err)) deps.logger?.warn({ err: (err as Error).message }, "[analystes] synthèse de la semaine en échec, rapport écrit par le code");
  }
  const report = await port.buildWeeklyReport(deps, synthesis);
  await queue(deps, { type: "analysts.report", kind: "weekly", reportId: report.reportId }, `analysts-report-${report.reportId}`);
  return { ok: true, reportId: report.reportId };
}

type ReportRow = { id: string; reportType: string; period: string; title: string; content: unknown; recommendations: unknown; sentAt: Date | null; requestedBy: string | null };

async function sendWeeklyReport(deps: AnalystsKevinDeps, reportId: string | null): Promise<Record<string, unknown>> {
  if (!reportId) return { skipped: "no_report" };
  const row = (await deps.prisma.strategyReport.findUnique({ where: { id: reportId } })) as ReportRow | null;
  if (!row) return { skipped: "not_found" };
  if (row.sentAt) return { skipped: "already_sent" };
  // Une seule fois par semaine, même si deux rapports existent pour la même semaine.
  const twin = (await deps.prisma.strategyReport.findFirst({ where: { reportType: "WEEKLY", period: row.period, sentAt: { not: null } } })) as ReportRow | null;
  if (twin) return { skipped: "already_sent" };
  const content = (row.content ?? {}) as { text?: unknown };
  const body = typeof content.text === "string" && content.text.trim() ? esc(content.text) : pick(V.weeklyNone, "analysts.weeklyNone");
  const recIds = (Array.isArray(row.recommendations) ? (row.recommendations as Array<{ id?: unknown }>) : []).map((r) => r.id).filter((x): x is string => typeof x === "string");
  // Choix rangé sous la conversation privée de l'admin (celle où il répondra « applique 2 »).
  const choice = await choiceBlock(deps, (await adminTelegramId(deps))?.toString() ?? null, "admin", { ids: recIds });
  const text = choice.lines.length ? `${body}\n\n${choice.lines.join("\n")}` : body;
  const sent = await sendKevin(deps, null, text);
  if (sent === null) throw new Error("rapport de la semaine non envoyé");
  if (choice.choice) await writeAnalystsChoice(deps, choice.choice);
  await deps.prisma.strategyReport.update({ where: { id: row.id }, data: { sentAt: nowOf(deps) } });
  return { ok: true, sent: true };
}

// ------------------------------------------------------------------------------------------------ questions

/** Propositions ouvertes en choix numéroté (3 au plus) : lignes à ajouter et choix à garder. */
async function choiceBlock(
  deps: AnalystsKevinDeps,
  chatId: string | null,
  askedBy: string,
  f: { market?: Market | null; countries?: string[]; ids?: string[] },
): Promise<{ lines: string[]; choice: AnalystsChoice | null }> {
  let recs = await openMarketRecommendations(deps, f.ids?.length ? {} : { market: f.market ?? null, countries: f.countries ?? [] }, 20);
  if (f.ids?.length) recs = recs.filter((r) => f.ids!.includes(r.id));
  recs = recs.slice(0, 3);
  if (!recs.length) return { lines: [], choice: null };
  const lines = [pick(V.choiceHead, "analysts.choiceHead", chatId), ...recs.map((r, i) => recommendationChoiceLine(i + 1, r)), pick(V.choiceTail, "analysts.choiceTail", chatId)];
  const choice: AnalystsChoice = {
    items: recs.map((r, i) => ({ n: i + 1, recommendationId: r.id, label: recommendationTitle(r) })),
    chatId,
    askedBy,
    createdAt: nowOf(deps).toISOString(),
    answeredAt: null,
  };
  return { lines, choice };
}

/**
 * Réponse à une question rangée (analyse, stratégie, briefing) : texte prêt (20 lignes au plus, sources visibles,
 * phrase fixe dès qu'on parle de règles) et choix numéroté gardé. N'envoie rien.
 */
export async function composeAnalystsAnswer(deps: AnalystsKevinDeps, req: AnalystsRequest): Promise<{ text: string; reportId?: string }> {
  const port = analystsPort(deps);
  const chatId = req.chatId;
  try {
    if (req.kind === "briefing" && req.market) {
      const b = await port.buildBriefing(deps, { market: req.market, countries: req.countries, question: null, requestedBy: req.askedBy === "admin" ? null : req.askedBy });
      const choice = req.askedBy === "admin" ? await choiceBlock(deps, chatId, req.askedBy, { market: req.market, countries: req.countries }) : { lines: [], choice: null };
      if (choice.choice) await writeAnalystsChoice(deps, choice.choice);
      const body = boundedAnswer(b.text, { sources: b.sources, maxLines: 20 - choice.lines.length });
      return { text: [body, ...choice.lines].join("\n"), reportId: b.reportId };
    }
    const a = await port.answerMarketQuestion(deps, { question: req.question, market: req.market, countries: req.countries, platform: req.platform });
    const wantsChoice = req.kind === "strategy" || req.kind === "briefing";
    const choice = wantsChoice && req.askedBy === "admin" ? await choiceBlock(deps, chatId, req.askedBy, { market: req.market, countries: req.countries }) : { lines: [], choice: null };
    if (choice.choice) await writeAnalystsChoice(deps, choice.choice);
    // Le texte du Stratège porte déjà ses sources et la phrase fixe ; on la remet seulement si elle manque.
    const body = boundedAnswer(a.text, { sources: a.sources, rules: a.mentionsRules || req.kind === "strategy", maxLines: 20 - choice.lines.length });
    return { text: [body, ...choice.lines].join("\n") };
  } catch (err) {
    const blocked = aiBlocked(err);
    deps.logger?.warn({ err: (err as Error).message }, "[analystes] question sans réponse");
    return { text: blocked === "budget" ? pick(V.budget, "analysts.budget", chatId) : pick(V.noAnswer, "analysts.noAnswer", chatId) };
  }
}

async function onDemand(deps: AnalystsKevinDeps, requestId: string | null): Promise<Record<string, unknown>> {
  if (!requestId) return { skipped: "no_request" };
  const req = await readAnalystsRequest(deps, requestId);
  if (!req) return { skipped: "not_found" };
  if (req.answeredAt) return { skipped: "already_answered" };
  const r = await composeAnalystsAnswer(deps, req);
  const sent = await sendKevin(deps, req.chatId, r.text);
  if (sent === null) throw new Error("réponse de Kevin non envoyée");
  await markAnalystsRequestAnswered(deps, req);
  if (r.reportId) await deps.prisma.strategyReport.update({ where: { id: r.reportId }, data: { sentAt: nowOf(deps) } }).catch(() => undefined);
  return { ok: true, sent: true };
}

/** Briefing déjà rangé (StrategyReport ON_DEMAND) envoyé à l'admin, une fois. */
async function sendBriefing(deps: AnalystsKevinDeps, reportId: string | null): Promise<Record<string, unknown>> {
  if (!reportId) return { skipped: "no_report" };
  const row = (await deps.prisma.strategyReport.findUnique({ where: { id: reportId } })) as ReportRow | null;
  if (!row) return { skipped: "not_found" };
  if (row.sentAt) return { skipped: "already_sent" };
  const content = (row.content ?? {}) as { text?: unknown; sources?: unknown };
  const text = typeof content.text === "string" ? content.text : esc(row.title);
  const sources = Array.isArray(content.sources) ? (content.sources as Array<{ url?: unknown; date?: unknown }>).filter((s) => typeof s?.url === "string").map((s) => ({ url: s.url as string, date: typeof s.date === "string" ? s.date : null })) : [];
  const sent = await sendKevin(deps, null, boundedAnswer(text, { sources }));
  if (sent === null) throw new Error("briefing non envoyé");
  await deps.prisma.strategyReport.update({ where: { id: row.id }, data: { sentAt: nowOf(deps) } });
  return { ok: true, sent: true };
}

// ------------------------------------------------------------------------------------------------ découverte, entretien

async function discover(deps: AnalystsKevinDeps): Promise<Record<string, unknown>> {
  const r = await analystsPort(deps).discoverSources(deps);
  if (!r.ok) return { skipped: r.skipped };
  let asked = 0;
  for (const p of r.proposals) {
    const s = (await deps.prisma.trendSource.findUnique({ where: { id: p.sourceId } })) as SourceRow | null;
    if (!s || s.isActive) continue;
    await askHuman(deps, {
      kind: "CONFIRM",
      key: `analysts.discover.${s.id}`,
      question: pick(V.discovered({ name: s.name, url: s.url }), "analysts.discovered"),
      onAnswer: { action: ANALYSTS_ACTIVATE_ANSWER, sourceId: s.id, buttonYes: pick(V.discoveredYes, "analysts.discoveredYes") },
    });
    asked++;
  }
  return { ok: true, proposals: r.proposals.length, asked };
}

// OUI au bouton « Je l'ajoute à ma veille ? » : la source passe active (lue dans l'heure) ; NON : elle reste de côté.
registerAnswerAction(ANALYSTS_ACTIVATE_ANSWER, async (deps, { value, actor, onAnswer }) => {
  const id = typeof onAnswer.sourceId === "string" ? onAnswer.sourceId : null;
  const s = id ? ((await deps.prisma.trendSource.findUnique({ where: { id } })) as SourceRow | null) : null;
  if (!s) return undefined;
  if (value !== "oui") return pick(V.sourceKept({ name: s.name }), "analysts.sourceKept");
  await deps.prisma.trendSource.update({ where: { id: s.id }, data: { isActive: true, errorCount: 0, lastError: null, nextScrapeAt: nowOf(deps) } });
  await deps.prisma.setting.deleteMany({ where: { key: `${ANALYSTS_SOURCE_WARNED_PREFIX}${s.id}` } });
  await deps.prisma.auditLog
    .create({ data: { userId: actor.userId ?? null, action: "analysts.source.activated", entityType: "TrendSource", entityId: s.id, metadata: { via: actor.via } } })
    .catch(() => undefined);
  return pick(V.sourceActivated({ name: s.name }), "analysts.sourceActivated");
});

async function reverify(deps: AnalystsKevinDeps): Promise<Record<string, unknown>> {
  const r = await analystsPort(deps).reverifyRules(deps);
  let sent = 0;
  const { alertRisk } = await analystsScheduleSettings(deps);
  for (const a of r.alerts) if (a.kind === "compliance" && a.riskLevel && riskAtLeast(a.riskLevel, alertRisk) && (await sendRuleAlert(deps, a.refId, a.text))) sent++;
  return { ok: true, checked: r.checked.length, alerts: sent };
}

/** Purge : textes bruts de plus de 7 jours (veille), questions et repères d'entrées de plus de 90 jours (ceux des règles restent : une alerte par règle). */
async function purge(deps: AnalystsKevinDeps): Promise<Record<string, unknown>> {
  const r = await analystsPort(deps).purgeRawTexts(deps);
  const before = new Date(nowOf(deps).getTime() - 90 * 86400_000);
  const old = await deps.prisma.setting.deleteMany({
    where: { OR: [{ key: { startsWith: ANALYSTS_REQUEST_PREFIX } }, { key: { startsWith: `${ANALYSTS_ALERTED_PREFIX}entry.` } }, { key: { startsWith: ANALYSTS_ENTRY_FLAG_PREFIX } }], updatedAt: { lt: before } },
  });
  return { ok: true, purged: r.purged, settings: old.count };
}
