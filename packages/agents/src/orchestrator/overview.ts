/**
 * Résumé de supervision des agents (phase 25) : une seule lecture pour la page /agents, la carte de l'État du
 * système, la commande « agents » et `pnpm agents:status`. Lecture seule, requêtes à plat et par lots (aucune requête
 * par mission ou par post), pour ne jamais ralentir le site.
 */
import type { Db } from "@linkaffipro/db";
import type { AgentsOverview, TeamOverview } from "./overview-contract";
import { FALLBACK_EVENT } from "../agents/media-ia/fallback";
import { CASINO_FALLBACK_EVENT } from "../casino/format";
import { ADS_TEAM_KEY } from "../agents/ads/recommendations";
import { AGENTS_PAUSED_ALL_KEY, defaultBudgetsFor, parseBudgets } from "../missions/settings";
import { AI_CONFIG_KEY } from "../providers/llm";
import { secretSettingKey } from "../human/secrets";
import { addDaysToDay, parisDay, parisDayStart, parisMonth } from "../rules/time";
import { weekStartDate } from "../algo/week";
import { PROVIDER_KEYS, TEAM_KEYS, TEAM_LABELS, type ProviderKey, type TeamKey } from "../types";
import { postResults, type ResultsWindow } from "./overview-results";

const DAY = 86_400_000;
/** Une mission sans activité depuis 30 minutes a raté deux balayages `resume` (10 min) : elle est bloquée. */
export const STUCK_AFTER_MS = 30 * 60_000;
const WAITING = ["WAITING_VALIDATION", "WAITING_HUMAN"] as const;

/** Fournisseurs suivis par la santé : clé rangée, agents qui les appellent (dernier appel réussi, erreurs 24 h). */
export const OVERVIEW_PROVIDERS = [
  { key: "llm", label: "IA texte (Claude)", agents: ["redaction", "controle"], setting: AI_CONFIG_KEY },
  { key: "fal", label: "Vidéos et photos (fal.ai)", agents: ["media-ia"], setting: secretSettingKey("providers.fal.apiKey") },
  { key: "magichour", label: "Vidéos de secours (Magic Hour)", agents: ["media-ia"], setting: secretSettingKey("providers.magichour.apiKey") },
  { key: "odds", label: "Cotes (SportsGameOdds)", agents: ["cotes"], setting: secretSettingKey("providers.odds.apiKey") },
  { key: "apifootball", label: "Statistiques des matchs", agents: ["cotes"], setting: secretSettingKey("providers.apifootball.apiKey") },
] as const;

type ConfigRow = { teamKey: string; enabled: boolean; simulation: boolean; paused: boolean; autonomyLevel: number; monthlyBudgetCents: unknown };
type MissionRow = { teamKey: string; status: string; createdAt: Date; updatedAt: Date };

function keyPresent(key: string, value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return key === "llm" ? typeof v.apiKeyEncrypted === "string" && v.apiKeyEncrypted !== "" : typeof v.enc === "string" && v.enc !== "";
}

/** Projection à fin de mois (pur) : rythme moyen depuis le 1er du mois de Paris (au moins un jour écoulé). */
export function projectMonthEnd(cents: number, now: Date): number {
  const month = parisMonth(now);
  const start = parisDayStart(`${month}-01`);
  const nextMonth = addDaysToDay(`${month}-28`, 4).slice(0, 7);
  const end = parisDayStart(`${nextMonth}-01`);
  const elapsed = Math.max(DAY, now.getTime() - start.getTime());
  return Math.round((cents * (end.getTime() - start.getTime())) / elapsed);
}

/** Missions du jour d'une équipe (pur) : créées, publiées, refusées, échouées aujourd'hui ; en attente maintenant. */
export function todayCounts(rows: readonly MissionRow[], dayStart: Date, fallbacks: number): TeamOverview["today"] {
  const today = (d: Date) => d.getTime() >= dayStart.getTime();
  const out = { created: 0, published: 0, waiting: 0, rejected: 0, failed: 0, fallbacks };
  for (const m of rows) {
    if (today(m.createdAt)) out.created++;
    if ((WAITING as readonly string[]).includes(m.status)) out.waiting++;
    else if (!today(m.updatedAt)) continue;
    else if (m.status === "DONE") out.published++;
    else if (m.status === "CANCELLED") out.rejected++;
    else if (m.status === "FAILED" || m.status === "BLOCKED_BUDGET") out.failed++;
  }
  return out;
}

function spendOf(teamKey: TeamKey, budgets: unknown, usage: { provider: string; cents: number }[], now: Date): TeamOverview["spend"] {
  const caps = parseBudgets(budgets, defaultBudgetsFor(teamKey));
  const providers = PROVIDER_KEYS.filter((p) => caps[p] !== undefined || usage.some((u) => u.provider === p && u.cents > 0));
  return providers.map((provider: ProviderKey) => {
    const cents = usage.filter((u) => u.provider === provider).reduce((s, u) => s + u.cents, 0);
    return { provider, cents, capCents: caps[provider] ?? null, projectedCents: projectMonthEnd(cents, now) };
  });
}

async function targetLabels(prisma: Db, recs: { target: string; targetId: string }[]): Promise<Map<string, string>> {
  const channelIds = [...new Set(recs.filter((r) => r.target === "CHANNEL_PLAN").map((r) => r.targetId))];
  const personaIds = [...new Set(recs.filter((r) => r.target === "PERSONA").map((r) => r.targetId))];
  const [channels, personas] = await Promise.all([
    channelIds.length ? prisma.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, title: true } }) : [],
    personaIds.length ? prisma.persona.findMany({ where: { id: { in: personaIds } }, select: { id: true, name: true } }) : [],
  ]);
  const out = new Map<string, string>();
  for (const c of channels as { id: string; title: string | null }[]) out.set(`CHANNEL_PLAN:${c.id}`, c.title ?? "canal");
  for (const p of personas as { id: string; name: string }[]) out.set(`PERSONA:${p.id}`, p.name);
  for (const r of recs)
    if (r.target === "TEAM_CONFIG") out.set(`TEAM_CONFIG:${r.targetId}`, `équipe ${TEAM_LABELS[r.targetId as TeamKey] ?? r.targetId}`);
  return out;
}

async function providersHealth(prisma: Db, now: Date): Promise<AgentsOverview["health"]["providers"]> {
  const since24h = new Date(now.getTime() - DAY);
  const agentKeys = [...new Set(OVERVIEW_PROVIDERS.flatMap((p) => p.agents as readonly string[]))];
  const [settings, errors, lastOk, lastMagic] = await Promise.all([
    prisma.setting.findMany({ where: { key: { in: OVERVIEW_PROVIDERS.map((p) => p.setting) } } }),
    prisma.agentRun.findMany({
      where: { agentKey: { in: agentKeys }, status: "ERROR", startedAt: { gte: since24h } },
      select: { agentKey: true, error: true, outputSummary: true },
    }),
    // Un appel indexé (agentKey, startedAt) par agent suivi : 5 agents au plus, quel que soit le volume.
    Promise.all(
      agentKeys.map((agentKey) =>
        prisma.agentRun.findFirst({ where: { agentKey, status: "OK" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, endedAt: true } }),
      ),
    ),
    prisma.agentRun.findFirst({
      where: { agentKey: "media-ia", status: "OK", outputSummary: { contains: "magichour" } },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, endedAt: true },
    }),
  ]);
  const settingBy = new Map((settings as { key: string; value: unknown }[]).map((s) => [s.key, s.value]));
  const okBy = new Map(agentKeys.map((k, i) => [k, lastOk[i] as { startedAt: Date; endedAt: Date | null } | null]));
  const isMagic = (e: { error: string | null; outputSummary: string | null }) => /magic ?hour/i.test(`${e.error ?? ""} ${e.outputSummary ?? ""}`);
  return OVERVIEW_PROVIDERS.map((p) => {
    const agents = p.agents as readonly string[];
    const runs = (errors as { agentKey: string; error: string | null; outputSummary: string | null }[]).filter((e) => agents.includes(e.agentKey));
    const errors24h = p.key === "magichour" ? runs.filter(isMagic).length : p.key === "fal" ? runs.filter((e) => !isMagic(e)).length : runs.length;
    const ok =
      p.key === "magichour"
        ? (lastMagic as { startedAt: Date; endedAt: Date | null } | null)
        : agents.map((a) => okBy.get(a) ?? null).reduce<{ startedAt: Date; endedAt: Date | null } | null>(
            (best, r) => (r && (!best || r.startedAt > best.startedAt) ? r : best),
            null,
          );
    return {
      key: p.key,
      label: p.label,
      keyPresent: keyPresent(p.key, settingBy.get(p.setting)),
      lastOkAt: ok ? (ok.endedAt ?? ok.startedAt).toISOString() : null,
      errors24h,
    };
  });
}

export async function agentsOverviewImpl(prismaIn: unknown, opts: { now?: Date; results?: boolean } = {}): Promise<AgentsOverview> {
  const prisma = prismaIn as Db;
  const now = opts.now ?? new Date();
  const dayStart = parisDayStart(parisDay(now));
  const month = parisMonth(now);
  const weekStart = weekStartDate(now);
  const teamKeys = [...TEAM_KEYS] as string[];

  const [configs, pausedAllRow, missions, usage, fallbackEvents, applied, experimentsRunning, openAlerts, openHumanRequests, pendingValidations, adsRecs, adsReport, lastCycle, stuckMissions] =
    await Promise.all([
      prisma.agentTeamConfig.findMany({ where: { teamKey: { in: [...teamKeys, ADS_TEAM_KEY] } } }),
      prisma.setting.findUnique({ where: { key: AGENTS_PAUSED_ALL_KEY } }),
      prisma.agentMission.findMany({
        where: {
          teamKey: { in: teamKeys },
          OR: [{ createdAt: { gte: dayStart } }, { updatedAt: { gte: dayStart } }, { status: { in: [...WAITING] } }],
        },
        select: { teamKey: true, status: true, createdAt: true, updatedAt: true },
      }),
      prisma.agentUsage.findMany({ where: { month }, select: { teamKey: true, provider: true, cents: true } }),
      prisma.event.findMany({
        where: { type: { in: [FALLBACK_EVENT, CASINO_FALLBACK_EVENT] }, occurredAt: { gte: dayStart } },
        select: { type: true },
      }),
      prisma.recommendation.findMany({
        where: { status: "APPLIED", teamKey: { notIn: [ADS_TEAM_KEY, "analystes"] }, appliedAt: { gte: weekStart } },
        orderBy: { appliedAt: "desc" },
        take: 20,
        select: { id: true, teamKey: true, target: true, targetId: true, field: true, appliedAt: true },
      }),
      prisma.experiment.count({ where: { status: "RUNNING" } }),
      prisma.alert.count({ where: { resolvedAt: null, OR: [{ kind: { startsWith: "agents_" } }, { kind: { startsWith: "ads_" } }] } }),
      prisma.humanRequest.count({ where: { status: { in: ["QUEUED", "PENDING"] } } }),
      prisma.agentValidation.count({ where: { status: "PENDING" } }),
      prisma.recommendation.count({ where: { teamKey: ADS_TEAM_KEY, status: "PROPOSED" } }),
      prisma.insightReport.findFirst({ where: { teamKey: ADS_TEAM_KEY }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.event.findFirst({ where: { type: "agents.cycle" }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
      prisma.agentMission.count({ where: { status: { in: ["PENDING", "RUNNING"] }, lastActivityAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } } }),
    ]);

  const pausedAll = pausedAllRow?.value === true || (pausedAllRow?.value as { paused?: unknown } | null)?.paused === true;
  const configBy = new Map((configs as ConfigRow[]).map((c) => [c.teamKey, c]));
  const results: Record<string, Record<ResultsWindow, TeamOverview["results"]["d7"]>> =
    opts.results === false ? {} : await postResults(prisma, now);
  const empty = { posts: 0, views: 0, clicks: 0, registrations: 0, ftds: 0, commissions: 0 };

  const teams: TeamOverview[] = TEAM_KEYS.map((teamKey) => {
    const c = configBy.get(teamKey);
    const fallbackType = teamKey === "dating" ? FALLBACK_EVENT : teamKey === "casino" ? CASINO_FALLBACK_EVENT : null;
    const fallbacks = fallbackType ? (fallbackEvents as { type: string }[]).filter((e) => e.type === fallbackType).length : 0;
    const level = Math.round(Number(c?.autonomyLevel ?? 0));
    return {
      teamKey,
      label: TEAM_LABELS[teamKey],
      // Sans ligne enregistrée : valeurs par défaut (active, simulation, niveau 0), comme les agents.
      enabled: c?.enabled !== false,
      simulation: c?.simulation !== false,
      paused: c?.paused === true,
      autonomyLevel: level === 1 || level === 2 ? level : 0,
      today: todayCounts((missions as MissionRow[]).filter((m) => m.teamKey === teamKey), dayStart, fallbacks),
      spend: spendOf(teamKey, c?.monthlyBudgetCents, (usage as { teamKey: string; provider: string; cents: number }[]).filter((u) => u.teamKey === teamKey), now),
      results: { d7: results[teamKey]?.d7 ?? { ...empty }, d28: results[teamKey]?.d28 ?? { ...empty } },
    };
  });

  const appliedRows = applied as { id: string; teamKey: string; target: string; targetId: string; field: string; appliedAt: Date | null }[];
  const labels = await targetLabels(prisma, appliedRows);
  return {
    at: now.toISOString(),
    pausedAll,
    teams,
    ads: {
      paused: configBy.get(ADS_TEAM_KEY)?.paused === true || pausedAll,
      openRecommendations: adsRecs,
      lastReportAt: (adsReport as { createdAt: Date } | null)?.createdAt.toISOString() ?? null,
    },
    algoAppliedThisWeek: appliedRows.map((r) => ({
      id: r.id,
      teamKey: r.teamKey,
      field: r.field,
      targetLabel: labels.get(`${r.target}:${r.targetId}`) ?? r.targetId,
      appliedAt: (r.appliedAt ?? now).toISOString(),
    })),
    experimentsRunning,
    openAlerts,
    openHumanRequests,
    pendingValidations,
    health: {
      lastGrandChefAt: (lastCycle as { occurredAt: Date } | null)?.occurredAt.toISOString() ?? null,
      stuckMissions,
      providers: await providersHealth(prisma, now),
    },
  };
}
