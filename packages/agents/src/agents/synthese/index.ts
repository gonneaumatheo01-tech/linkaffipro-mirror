/**
 * Agent Synthèse & réglages (le lundi, après les autres) : recommandations de la semaine, application selon le niveau
 * de l'équipe Algorithme (0 : rien ; 1 : petits réglages ; 2 : tout, dans les bornes), rapport « Ce qui marche » par
 * équipe (`InsightReport`) et envoi Telegram. Rédaction du rapport : modèle rapide à partir des chiffres calculés.
 */
import type { AgentDefinition, AgentsDeps, LlmProvider } from "../../types";
import { agentEvent, nowOf } from "../../admin/journal";
import type { ConversationProfileStats } from "../../algo/contracts";
import { loadAlgoTeam, type AlgoSettings } from "../../algo/settings";
import { parisWeekStart, weekStartDate } from "../../algo/week";
import { resolveProviders, type EngineDeps } from "../../missions/context";
import { loadTeamSettings } from "../../missions/settings";
import { recordUsage } from "../../missions/usage";
import { checkBudgets, maybeAlertBudget } from "../../orchestrator/budgets";
import { bestCase, FORMAT_LABELS, type ScopeRanking } from "../posts/rank";
import type { ChannelWindows, SuggestedWindow } from "../horaires/windows";
import { applyRecommendationImpl } from "./apply";
import { shouldAutoApply } from "./bounds";
import { generateWeeklyRecommendations } from "./proposals";
import { REPORT_TEAMS, writeReport, type ReportTeam, type TeamFacts } from "./report";

const DAYS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const VERTICAL_OF: Record<ReportTeam, "DATING" | "CASINO" | "SPORTS"> = { dating: "DATING", casino: "CASINO", sports: "SPORTS" };

export type SyntheseInput = {
  channels: ScopeRanking[];
  verticals: ScopeRanking[];
  windows: Record<string, ChannelWindows>;
  conversations: ConversationProfileStats[];
  conversationReview?: unknown;
  closedTests?: Array<{ id: string; sentence: string; winner: string | null }>;
};

/** Applique les propositions en attente que le niveau permet. */
export async function autoApplyPending(deps: AgentsDeps, level: 0 | 1 | 2): Promise<{ applied: string[]; refused: string[] }> {
  const applied: string[] = [];
  const refused: string[] = [];
  if (level === 0) return { applied, refused };
  const pending = (await deps.prisma.recommendation.findMany({ where: { status: "PROPOSED", teamKey: { not: "ads" } }, orderBy: { createdAt: "asc" } })) as Array<{ id: string; size: string }>;
  for (const r of pending) {
    if (!shouldAutoApply(level, r.size)) continue;
    const res = await applyRecommendationImpl(deps, r.id, { by: "GRAND_CHEF" });
    (res.ok ? applied : refused).push(r.id);
  }
  return { applied, refused };
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 10_000) / 100);

/** Chiffres du rapport d'une équipe (lecture en base + classements déjà calculés). */
async function teamFacts(deps: AgentsDeps, team: ReportTeam, input: SyntheseInput, since: Date): Promise<TeamFacts> {
  const now = nowOf(deps);
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const planned = (await deps.prisma.channelAgentPlan.findMany({ where: { teamKey: team }, select: { channelId: true } })) as Array<{ channelId: string }>;
  const channels = (await deps.prisma.channel.findMany({
    where: { OR: [{ vertical: VERTICAL_OF[team] }, { id: { in: planned.map((p) => p.channelId) } }] },
    select: { id: true, title: true },
  })) as Array<{ id: string; title: string }>;
  const ids = new Set(channels.map((c) => c.id));
  const titles = new Map(channels.map((c) => [c.id, c.title]));
  const recent = (await deps.prisma.postInsight.findMany({ where: { sentAt: { gte: week }, channelId: { in: [...ids] } }, select: { viewsFinal: true } })) as Array<{ viewsFinal: number }>;
  const vertical = input.verticals.find((v) => v.id === VERTICAL_OF[team]);
  const fmt = vertical ? bestCase(vertical.dimensions.format) : null;
  let top: { id: string; w: SuggestedWindow } | null = null;
  for (const id of ids) for (const w of input.windows[id]?.all ?? []) if (!top || w.score > top.w.score) top = { id, w };
  const bestWindow: TeamFacts["bestWindow"] = top ? { day: DAYS[top.w.day] ?? "?", start: top.w.start, end: top.w.end, channel: titles.get(top.id) ?? "canal" } : null;
  const persona = vertical ? bestCase(vertical.dimensions.persona) : null;
  const chan = input.channels
    .filter((c) => ids.has(c.id) && c.posts >= 1)
    .map((c) => ({ c, ctr: c.views > 0 ? c.dimensions.format.cases.reduce((s, x) => s + x.offerClicks, 0) / c.views : null }))
    .filter((x) => x.ctr !== null && (x.c.posts >= 20 || x.c.views >= 1000))
    .sort((a, b) => b.ctr! - a.ctr!)[0];
  const [applied, proposed, running, closed] = await Promise.all([
    deps.prisma.recommendation.count({ where: { teamKey: team, status: "APPLIED", appliedAt: { gte: since } } }),
    deps.prisma.recommendation.count({ where: { teamKey: team, status: "PROPOSED" } }),
    deps.prisma.experiment.count({ where: { teamKey: team, status: "RUNNING" } }),
    deps.prisma.experiment.findMany({ where: { teamKey: team, status: "CLOSED", closedAt: { gte: since } }, select: { result: true } }) as Promise<Array<{ result: unknown }>>,
  ]);
  const conv =
    team === "dating"
      ? input.conversations.filter((p) => p.enoughData && p.replyRate !== null).sort((a, b) => (b.replyRate ?? 0) - (a.replyRate ?? 0))[0]
      : undefined;
  return {
    team,
    posts7d: recent.length,
    views7d: recent.reduce((s, r) => s + r.viewsFinal, 0),
    bestFormat: fmt ? { label: FORMAT_LABELS[fmt.key] ?? fmt.label, ctrPct: pct(fmt.ctr) } : null,
    bestWindow,
    best: persona ? { kind: "persona", label: persona.label, ctrPct: pct(persona.ctr) } : chan ? { kind: "canal", label: titles.get(chan.c.id) ?? "canal", ctrPct: pct(chan.ctr) } : null,
    applied,
    proposed,
    testsRunning: running,
    testsClosed: closed.map((c) => (c.result as { sentence?: string } | null)?.sentence).filter((s): s is string => !!s).slice(0, 2),
    conversation: conv ? { label: conv.personaName ?? conv.botLabel, replyRatePct: pct(conv.replyRate), conversations: conv.conversations } : null,
  };
}

export type SyntheseResult = { recommendations: string[]; applied: string[]; refused: string[]; reportIds: string[]; sent: boolean; writtenBy: "ai" | "code" };

/** `reportOnly` : équipe en pause, aucune application automatique (les propositions restent proposées). */
export async function runSynthese(deps: AgentsDeps, input: SyntheseInput, opts: { send?: boolean; settings?: AlgoSettings; reportOnly?: boolean } = {}): Promise<SyntheseResult> {
  const now = nowOf(deps);
  const team = await loadAlgoTeam(deps.prisma);
  const settings = opts.settings ?? team.settings;
  const cells: Record<string, ChannelWindows["cells"]> = {};
  for (const [id, w] of Object.entries(input.windows)) cells[id] = w.cells;
  const recommendations = await generateWeeklyRecommendations(deps, { channels: input.channels, verticals: input.verticals, cells, settings });
  const { applied, refused } = opts.reportOnly ? { applied: [] as string[], refused: [] as string[] } : await autoApplyPending(deps, team.level);

  const weekStart = parisWeekStart(now);
  const since = weekStartDate(now);
  const facts: TeamFacts[] = [];
  for (const t of REPORT_TEAMS) facts.push(await teamFacts(deps, t, input, since));
  const providers = await resolveProviders(deps as EngineDeps);
  const algoSettings = await loadTeamSettings(deps.prisma, "algo");
  // Plafond IA de l'équipe Algorithme vérifié avant l'appel (atteint ou 0 € : rapport assemblé par le code),
  // dépense comptée et alerte 80 / 100 % après.
  const budget = await checkBudgets(deps, algoSettings, ["llm"], now);
  const written = await writeReport(facts, {
    weekLabel: new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }),
    llm: budget ? null : (providers.llm as (LlmProvider & { fake?: boolean }) | null),
    model: algoSettings.models.fast,
  });
  if (written.costCents > 0) {
    await recordUsage(deps.prisma, "algo", "llm", written.costCents, now);
    await maybeAlertBudget(deps, algoSettings, "llm", now);
  }
  const reportIds: string[] = [];
  const upsert = async (teamKey: string, content: string, stats: Record<string, unknown>) => {
    const value = { content, stats: JSON.parse(JSON.stringify(stats)) };
    const row = await deps.prisma.insightReport.upsert({
      where: { teamKey_weekStart: { teamKey, weekStart } },
      create: { teamKey, weekStart, ...value },
      update: value,
    });
    reportIds.push(row.id);
    return row.id;
  };
  for (const f of facts) await upsert(f.team, written.byTeam[f.team].join("\n"), { facts: f, writtenBy: written.writtenBy });
  const mainId = await upsert("algo", written.html, {
    teams: facts,
    writtenBy: written.writtenBy,
    costCents: written.costCents,
    conversations: input.conversations,
    conversationReview: input.conversationReview ?? null,
    recommendations,
    applied,
    refused,
    closedTests: input.closedTests ?? [],
  });
  let sent = false;
  if (opts.send !== false && deps.admin) {
    try {
      sent = (await deps.admin.send(written.html)) !== null;
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message }, "[agents] rapport « Ce qui marche » non envoyé");
    }
    if (sent) await deps.prisma.insightReport.updateMany({ where: { weekStart, teamKey: { in: ["algo", ...REPORT_TEAMS] } }, data: { sentAt: now } });
  }
  await agentEvent(deps, "agents.algo.report", { weekStart, reportId: mainId, sent, writtenBy: written.writtenBy, recommendations: recommendations.length, applied: applied.length });
  return { recommendations, applied, refused, reportIds, sent, writtenBy: written.writtenBy };
}

export const agent: AgentDefinition = {
  key: "synthese",
  async run(_mission, ctx) {
    const { level } = await loadAlgoTeam(ctx.prisma);
    const r = await autoApplyPending(ctx, level);
    return { ok: true, summary: `${r.applied.length} réglage(s) appliqué(s)` };
  },
};
