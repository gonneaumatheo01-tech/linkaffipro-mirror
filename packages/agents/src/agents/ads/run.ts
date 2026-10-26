/**
 * Agent Ads (rattaché au Grand Chef, logique programmée ; l'IA ne fait que rédiger) :
 * - passage toutes les 30 minutes (file `agents-ads`) : alertes, puis rapport quotidien dû (à partir de 9 h Paris,
 *   après celui du Grand Chef, au plus tard dès 10 h) avec les recommandations du jour, et le lundi le rapport de la
 *   semaine ;
 * - « rapport maintenant » (`pnpm agents:report-now --team ads [--weekly]`).
 * Pause de l'équipe « ads » (`AgentTeamConfig` `ads`) ou pause générale : plus de rapports ni de recommandations ; les
 * alertes gardent leurs interrupteurs de Réglages → Alertes.
 */
import type { AgentsDeps, LlmProvider } from "../../types";
import { agentEvent, nowOf, readSetting, writeSetting } from "../../admin/journal";
import { parisWeekStart } from "../../algo/week";
import { resolveProviders, type EngineDeps } from "../../missions/context";
import { AGENTS_MODELS_KEY, DEFAULT_MONTHLY_BUDGET_CENTS, isAgentsPausedAll, parseBudgets, parseModels } from "../../missions/settings";
import { monthUsage, recordUsage, totalCents } from "../../missions/usage";
import { REPORT_LAST_DAY_KEY } from "../../orchestrator/reports";
import { budgetState } from "../../orchestrator/budgets";
import { ADS_ACTION_LABELS, adsRecommendations, type AdsAction, type AdsProposal } from "../../rules/ads";
import { parisDay, parisParts, parisWeekday } from "../../rules/time";
import type { TeamKey } from "../../types";
import { runAdsAlerts } from "./alerts";
import { analysisOf, loadAdsContext, type AdsContext } from "./analysis";
import type { AdsRowDetail } from "./build";
import { ruleInputs } from "./inputs";
import { ADS_TEAM_KEY, saveAdsRecommendations, type SavedAdsRecommendations } from "./recommendations";
import { writeAdsReport, type AdsDailyFacts, type AdsFacts, type AdsPubFact, type AdsWeeklyFacts } from "./report";
import { comparableVariation } from "@linkaffipro/core";
import { ADS_VERTICALS, ADS_VERTICAL_LABELS } from "./thresholds";
import { addRaw, EMPTY_RAW, toMetrics, sumRaw, type AdsRaw } from "./metrics";
import { verticalUnionDimension, type AdsDataset } from "./dataset";
import { daysBetween } from "./periods";
import { checkRecommendations, type RecLike } from "../../qa-gates/recommendations";
import { qaGate } from "../../qa-gates/gate";

export const ADS_REPORT_HOUR = 9;
/** Sans rapport du Grand Chef, le rapport Ads part quand même dès 10 h. */
export const ADS_REPORT_LATEST_HOUR = 10;
export const ADS_LAST_DAILY_KEY = "agents.ads.lastDaily";
export const ADS_LAST_WEEKLY_KEY = "agents.ads.lastWeekly";
export const ADS_PAGE_PATH = "/agents/ads";
export const ADS_DEFAULT_BASE_URL = "https://app.linkaffipro.com";

/** Clé `InsightReport.weekStart` : jour du rapport (quotidien), `semaine-<lundi>` (hebdomadaire). */
export const adsReportKey = (kind: "daily" | "weekly", day: string) => (kind === "daily" ? day : `semaine-${day}`);

/** Adresse de la page Ads (variable `APP_BASE_URL`, sinon l'adresse du site). */
export function adsPageUrl(base = process.env.APP_BASE_URL): string {
  return `${(base && base.trim() ? base.trim() : ADS_DEFAULT_BASE_URL).replace(/\/+$/, "")}${ADS_PAGE_PATH}`;
}

/** Les rapports sont-ils dus (pur) ? */
export function adsReportsDue(now: Date, last: { daily: string | null; weekly: string | null; grandChef: string | null }): { daily: boolean; weekly: boolean } {
  const hour = parisParts(now).hour;
  const today = parisDay(now);
  const daily = hour >= ADS_REPORT_HOUR && last.daily !== today && (last.grandChef === today || hour >= ADS_REPORT_LATEST_HOUR);
  const weekly = parisWeekday(now) === 1 && hour >= ADS_REPORT_HOUR && last.weekly !== parisWeekStart(now) && (last.daily === today || daily);
  return { daily, weekly };
}

export async function isAdsPaused(deps: Pick<AgentsDeps, "prisma">): Promise<boolean> {
  const row = await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: ADS_TEAM_KEY } });
  return row?.paused === true || (await isAgentsPausedAll(deps.prisma));
}

/** Recommandations du jour (28 jours de données, fenêtre d'observation de chaque univers). */
export function adsProposalsOf(ctx: AdsContext): AdsProposal[] {
  const a = analysisOf(ctx, "28d");
  const all = ruleInputs(a.rows, ctx.daily, ctx.dataset, ctx.thresholds.thresholds, ctx.now);
  const leafIds = new Set(a.rows.filter((r) => r.leaf).map((r) => `${r.level}:${r.id}`));
  // Groupes sans activité sur la période : ils restent des audiences à proposer pour un test.
  const seen = new Set(all.map((i) => `${i.level}:${i.id}`));
  const idle = ctx.dataset.adSets
    .filter((s) => !seen.has(`adset:${s.id}`))
    .map((s) => {
      const c = ctx.dataset.campaigns.find((x) => x.id === s.campaignId);
      const zero = toMetrics(sumRaw([]));
      return { level: "adset" as const, id: s.id, name: s.name, vertical: c?.vertical ?? null, campaignId: s.campaignId, campaignName: c?.name ?? null, adSetId: s.id, adSetName: s.name, ageDays: null, window: zero, windowFrom: a.to, windowTo: a.to, last7: zero, prev7: zero, spendYesterday: 0, budget: null };
    });
  return adsRecommendations(
    all.filter((i) => leafIds.has(`${i.level}:${i.id}`)),
    ctx.thresholds.thresholds,
    [...all, ...idle],
  );
}

const pub = (r: AdsRowDetail): AdsPubFact => ({ name: r.name, campaign: r.campaignName, spend: r.current.spend, gains: r.current.gains, roas: r.current.roas });

function countActions(p: readonly { action: string }[]): AdsDailyFacts["recommendations"] {
  const c = { STOP: 0, SCALE: 0, TEST: 0, WATCH: 0, total: p.length };
  for (const x of p) if (x.action in c) c[x.action as AdsAction]++;
  return c;
}

/** Faits du rapport quotidien (pur). */
export function dailyFacts(ctx: AdsContext, proposals: readonly AdsProposal[]): AdsDailyFacts {
  const y = analysisOf(ctx, "yesterday");
  const ads = y.rows.filter((r) => r.level === "ad" && r.current.spend > 0).sort((a, b) => b.current.gains - a.current.gains);
  const day = y.to;
  return {
    kind: "daily",
    day,
    dayLabel: new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
    spend: y.totals.spend,
    commissions: y.totals.commissions,
    gains: y.totals.gains,
    roas: y.totals.roas === null ? null : Math.round(y.totals.roas * 100) / 100,
    connectorsMissing: y.connectorsMissing,
    best: ads[0] ? pub(ads[0]) : null,
    worst: ads.length > 1 ? pub(ads[ads.length - 1]!) : null,
    recommendations: countActions(proposals),
  };
}

/** Compteurs d'un univers sur des jours : ligne `campaigns:<univers>` du jour, sinon somme de ses campagnes (pur). */
export function verticalRaw(ds: AdsDataset, vertical: string, days: readonly string[]): AdsRaw {
  const ids = new Set(ds.campaigns.filter((c) => c.vertical === vertical).map((c) => c.id));
  const union = new Map<string, Partial<AdsRaw>>();
  const byCampaigns = new Map<string, AdsRaw>();
  const dim = verticalUnionDimension(vertical);
  for (const st of ds.stats) {
    if (st.dimension === dim) union.set(st.day, st.raw);
    else if (st.dimension.startsWith("campaign:") && ids.has(st.dimension.slice("campaign:".length)))
      byCampaigns.set(st.day, addRaw(byCampaigns.get(st.day) ?? { ...EMPTY_RAW }, st.raw));
  }
  return sumRaw(days.map((d) => union.get(d) ?? byCampaigns.get(d) ?? {}));
}

/** Faits du rapport de la semaine (pur sauf les recommandations ouvertes, passées en argument). */
export function weeklyFacts(ctx: AdsContext, open: ReadonlyArray<{ action: string | null; evidence: unknown }>): AdsWeeklyFacts {
  const w = analysisOf(ctx, "7d");
  const verticals = ADS_VERTICALS.map((v) => {
    // Ligne sans doublon de l'univers (`campaigns:<univers>`) les jours où elle existe, sinon somme de ses campagnes.
    const cur = toMetrics(verticalRaw(ctx.dataset, v, daysBetween(w.range.from, w.range.to)));
    const prev = toMetrics(verticalRaw(ctx.dataset, v, daysBetween(w.range.prevFrom, w.range.prevTo)));
    const change = (a: number, b: number) => {
      const x = comparableVariation(a, b);
      return x.kind === "pct" ? Math.round(x.pct) : null;
    };
    return { label: ADS_VERTICAL_LABELS[v], spend: cur.spend, gains: cur.gains, roas: cur.roas === null ? null : Math.round(cur.roas * 100) / 100, gainsChangePct: change(cur.gains, prev.gains), spendChangePct: change(cur.spend, prev.spend), active: cur.spend > 0 || prev.spend > 0 };
  })
    .filter((v) => v.active)
    .map(({ active: _a, ...v }) => v);
  const cohort = ctx.cohorts
    .filter((c) => c.members >= 5)
    .map((c) => ({ name: c.name, members: c.members, d30: c.d30, perMember30: Math.round((c.d30 / c.members) * 100) / 100 }))
    .sort((a, b) => b.perMember30 - a.perMember30)[0] ?? null;
  const order = (a: string | null) => ["STOP", "SCALE", "TEST", "WATCH"].indexOf(a ?? "");
  const prio = (e: unknown) => Number((e as { priority?: unknown } | null)?.priority ?? 0);
  const recs = [...open]
    .filter((r) => r.action !== "WATCH")
    .sort((a, b) => order(a.action) - order(b.action) || prio(b.evidence) - prio(a.evidence))
    .slice(0, 5)
    .map((r, i) => {
      const e = (r.evidence ?? {}) as { name?: string; sentence?: string };
      return { rank: i + 1, action: ADS_ACTION_LABELS[r.action as AdsAction] ?? "Recommandation", name: e.name ?? "pub", sentence: e.sentence ?? "" };
    });
  const weekStart = w.from;
  return {
    kind: "weekly",
    weekStart,
    weekLabel: new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }),
    spend: w.totals.spend,
    gains: w.totals.gains,
    roas: w.totals.roas === null ? null : Math.round(w.totals.roas * 100) / 100,
    verticals,
    cohort,
    recommendations: recs,
    connectorsMissing: w.connectorsMissing,
  };
}

/** Plafond IA de l'équipe « ads » (règle commune `budgetState`) : absent = sans limite, 0 € = aucun appel (pur). */
export function adsLlmAllowed(capCents: number | undefined, spentCents: number): boolean {
  return budgetState(ADS_TEAM_KEY as TeamKey, "llm", spentCents, capCents).allowed;
}

/** Modèle rapide, si une vraie clé existe et que le plafond IA de l'équipe « ads » n'est pas atteint. */
async function reportLlm(deps: AgentsDeps): Promise<{ llm: (LlmProvider & { fake?: boolean }) | null; model: string }> {
  const now = nowOf(deps);
  const [providers, models, team, usage] = await Promise.all([
    resolveProviders(deps as EngineDeps),
    deps.prisma.setting.findUnique({ where: { key: AGENTS_MODELS_KEY } }),
    deps.prisma.agentTeamConfig.findUnique({ where: { teamKey: ADS_TEAM_KEY } }),
    monthUsage(deps.prisma, ADS_TEAM_KEY as TeamKey, now),
  ]);
  // Règle commune des plafonds (`budgetState`) : absent = sans limite, 0 € = aucun appel, sinon refus dès qu'il est atteint.
  const cap = parseBudgets(team?.monthlyBudgetCents, DEFAULT_MONTHLY_BUDGET_CENTS).llm;
  const spent = totalCents(usage.filter((u) => u.provider === "llm"));
  const llm = adsLlmAllowed(cap, spent) ? (providers.llm as (LlmProvider & { fake?: boolean }) | null) : null;
  return { llm, model: parseModels(models?.value).fast };
}

export type AdsReportResult = { reportId: string; sent: boolean; writtenBy: "ai" | "code"; rejected: boolean; lines: string[]; html: string };

async function writeArchiveSend(deps: AgentsDeps, facts: AdsFacts, key: string, extra: Record<string, unknown>, send: boolean): Promise<AdsReportResult> {
  const now = nowOf(deps);
  const { llm, model } = await reportLlm(deps);
  let written = await writeAdsReport(facts, { llm, model, pageUrl: adsPageUrl() });
  // Phase 30 : rapport rédigé par l'IA → QA Global avant l'envoi ; refusé ou QA indisponible → les lignes du code.
  if (written.writtenBy === "ai" && send) {
    const gate = await qaGate(deps, { contentType: "REPORT", contentId: `ads:${key}`, teamKey: ADS_TEAM_KEY, content: { title: `Rapport pubs ${key}`, text: written.html, facts: JSON.parse(JSON.stringify(facts)) } });
    if (gate.kind !== "approved") {
      const cost = written.costCents;
      written = { ...(await writeAdsReport(facts, { llm: null, model, pageUrl: adsPageUrl() })), costCents: cost };
      await agentEvent(deps, "qa.report.code_fallback", { team: ADS_TEAM_KEY, key, verdict: gate.kind });
    }
  }
  if (written.costCents > 0) await recordUsage(deps.prisma, ADS_TEAM_KEY as TeamKey, "llm", written.costCents, now);
  // `content` = lignes en texte simple (sans HTML) ; le message Telegram complet reste dans `stats.html`.
  const value = {
    content: written.lines.join("\n"),
    stats: JSON.parse(JSON.stringify({ kind: facts.kind, facts, html: written.html, writtenBy: written.writtenBy, rejected: written.rejected, costCents: written.costCents, ...extra })),
  };
  const row = await deps.prisma.insightReport.upsert({
    where: { teamKey_weekStart: { teamKey: ADS_TEAM_KEY, weekStart: key } },
    create: { teamKey: ADS_TEAM_KEY, weekStart: key, ...value },
    update: value,
  });
  let sent = false;
  if (send && deps.admin) {
    try {
      sent = (await deps.admin.send(written.html)) !== null;
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message }, "[agents] rapport pub non envoyé");
    }
    if (sent) await deps.prisma.insightReport.update({ where: { id: row.id }, data: { sentAt: now } });
  }
  await agentEvent(deps, `agents.ads.report_${facts.kind}`, { reportId: row.id, key, sent, writtenBy: written.writtenBy, rejected: written.rejected });
  return { reportId: row.id, sent, writtenBy: written.writtenBy, rejected: written.rejected, lines: written.lines, html: written.html };
}

export type AdsDailyResult = AdsReportResult & { recommendations: SavedAdsRecommendations; proposals: number };

/** Recommandations du jour + rapport quotidien (archivé, envoyé). */
export async function runAdsDaily(deps: AgentsDeps, opts: { send?: boolean; ctx?: AdsContext } = {}): Promise<AdsDailyResult> {
  const now = nowOf(deps);
  const ctx = opts.ctx ?? (await loadAdsContext(deps.prisma, now));
  const proposals = adsProposalsOf(ctx);
  const saved = await saveAdsRecommendations(deps, proposals);
  const facts = dailyFacts(ctx, proposals);
  const r = await writeArchiveSend(deps, facts, adsReportKey("daily", parisDay(now)), { recommendationIds: [...saved.created, ...saved.updated], thresholds: ctx.thresholds }, opts.send !== false);
  await writeSetting(deps, ADS_LAST_DAILY_KEY, parisDay(now));
  return { ...r, recommendations: saved, proposals: proposals.length };
}

/** Rapport de la semaine passée (lundi). */
export async function runAdsWeekly(deps: AgentsDeps, opts: { send?: boolean; ctx?: AdsContext } = {}): Promise<AdsReportResult> {
  const now = nowOf(deps);
  const ctx = opts.ctx ?? (await loadAdsContext(deps.prisma, now));
  const open0 = (await deps.prisma.recommendation.findMany({ where: { teamKey: ADS_TEAM_KEY, status: "PROPOSED" } })) as RecLike[];
  // Phase 30 : propositions vérifiées par le QA Global avant d'entrer dans le rapport ; seules les approuvées y figurent.
  const open = (await checkRecommendations(deps, open0, 10)).approved as unknown as Array<{ action: string | null; evidence: unknown }>;
  const facts = weeklyFacts(ctx, open);
  const r = await writeArchiveSend(deps, facts, adsReportKey("weekly", facts.weekStart), { cohorts: ctx.cohorts.slice(0, 20) }, opts.send !== false);
  await writeSetting(deps, ADS_LAST_WEEKLY_KEY, parisWeekStart(now));
  return r;
}

type Out = Record<string, unknown>;

async function part<T>(deps: AgentsDeps, name: string, out: Out, fn: () => Promise<T>): Promise<T | null> {
  try {
    const r = await fn();
    out[name] = r;
    return r;
  } catch (err) {
    out[name] = { error: (err as Error).message };
    deps.logger?.error({ err: (err as Error).message, part: name }, "[agents] partie de l'Agent Ads en erreur");
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Passage de la file `agents-ads`. */
export async function runAdsTick(deps: AgentsDeps): Promise<Out> {
  const out: Out = {};
  const now = nowOf(deps);
  const ctx = await loadAdsContext(deps.prisma, now);
  await part(deps, "alerts", out, () => runAdsAlerts(deps, ctx));
  if (await isAdsPaused(deps)) {
    out.reports = { skipped: "Agent Ads en pause" };
    return out;
  }
  const due = adsReportsDue(now, {
    daily: str(await readSetting(deps, ADS_LAST_DAILY_KEY)),
    weekly: str(await readSetting(deps, ADS_LAST_WEEKLY_KEY)),
    grandChef: str(await readSetting(deps, REPORT_LAST_DAY_KEY)),
  });
  if (due.daily) {
    // Marqué avant : jamais deux rapports le même jour, même si l'envoi échoue.
    await writeSetting(deps, ADS_LAST_DAILY_KEY, parisDay(now));
    const d = await part(deps, "daily", out, () => runAdsDaily(deps, { ctx }));
    if (d) out.daily = { reportId: d.reportId, sent: d.sent, writtenBy: d.writtenBy, proposals: d.proposals };
  }
  if (due.weekly) {
    await writeSetting(deps, ADS_LAST_WEEKLY_KEY, parisWeekStart(now));
    const w = await part(deps, "weekly", out, () => runAdsWeekly(deps, { ctx }));
    if (w) out.weekly = { reportId: w.reportId, sent: w.sent, writtenBy: w.writtenBy };
  }
  return out;
}

/** « Rapport maintenant » (commande, site) : quotidien (recommandations comprises) ou de la semaine. */
export async function runAdsReportNowImpl(
  deps: AgentsDeps,
  opts: { kind?: "daily" | "weekly"; send?: boolean } = {},
): Promise<{ ok: boolean; message: string; reportId: string | null }> {
  try {
    if (opts.kind === "weekly") {
      const r = await runAdsWeekly(deps, { send: opts.send });
      return { ok: true, message: `Rapport pub de la semaine ${r.sent ? "envoyé" : "enregistré"} (${r.writtenBy === "ai" ? "rédigé par l'IA" : "écrit par le code"}).`, reportId: r.reportId };
    }
    const r = await runAdsDaily(deps, { send: opts.send });
    return {
      ok: true,
      message: `Rapport pub du jour ${r.sent ? "envoyé" : "enregistré"} (${r.writtenBy === "ai" ? "rédigé par l'IA" : "écrit par le code"}) ; ${r.proposals} recommandation(s) : ${r.recommendations.created.length} nouvelle(s), ${r.recommendations.updated.length} mise(s) à jour, ${r.recommendations.closed.length} close(s).`,
      reportId: r.reportId,
    };
  } catch (err) {
    return { ok: false, message: `Rapport pub impossible : ${(err as Error).message}`, reportId: null };
  }
}
