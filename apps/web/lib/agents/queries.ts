/**
 * Lectures en base de la rubrique Agents (tableau de bord du Grand Chef, fiche d'équipe, validations, demandes,
 * journal, réglages). Lecture seule : aucune de ces fonctions n'enfile une tâche ni n'appelle une IA.
 */
import { prisma, type Prisma } from "@linkaffipro/db";
import { TEAM_KEYS, type ProviderKey, type TeamKey } from "@linkaffipro/agents";
import { parisDayKey } from "@linkaffipro/core";
import { parisMidnightUtc } from "@/lib/periods";
import {
  parseAgentsModels,
  parseLibraryChannelId,
  parsePausedAll,
  teamConfigView,
  type AgentsModels,
  type TeamConfigView,
} from "./config";
import {
  currentMonth,
  missionsWhere,
  parseDailyReport,
  parseSteps,
  rangeStart,
  type DailyReport,
  type MissionFilters,
} from "./missions";
import { TEAM_CHAINS, TEAM_VERTICAL } from "./teams";

const CONFIG_SELECT = {
  teamKey: true,
  enabled: true,
  simulation: true,
  paused: true,
  pausedReason: true,
  autonomyLevel: true,
  monthlyBudgetCents: true,
  styleGuidelines: true,
  forbiddenWords: true,
  maxTextLength: true,
  quietHours: true,
  consecutiveFailures: true,
  updatedAt: true,
} satisfies Prisma.AgentTeamConfigSelect;

async function settingValue(key: string): Promise<unknown> {
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
}

export async function loadPausedAll(): Promise<boolean> {
  return parsePausedAll(await settingValue("agents.pausedAll"));
}

export async function loadTeamConfig(team: TeamKey): Promise<TeamConfigView> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: team }, select: CONFIG_SELECT });
  return teamConfigView(team, row);
}

export async function loadTeamConfigs(): Promise<Record<TeamKey, TeamConfigView>> {
  const rows = await prisma.agentTeamConfig.findMany({ select: CONFIG_SELECT });
  const out = {} as Record<TeamKey, TeamConfigView>;
  for (const t of TEAM_KEYS) out[t] = teamConfigView(t, rows.find((r) => r.teamKey === t) ?? null);
  return out;
}

/** Dépense du mois en centimes, par équipe et par fournisseur (`AgentUsage`). */
export async function loadMonthUsage(now: Date): Promise<Record<string, Partial<Record<ProviderKey, number>>>> {
  const rows = await prisma.agentUsage.findMany({
    where: { month: currentMonth(now) },
    select: { teamKey: true, provider: true, cents: true },
  });
  const out: Record<string, Partial<Record<ProviderKey, number>>> = {};
  for (const r of rows) {
    const t = (out[r.teamKey] ??= {});
    t[r.provider as ProviderKey] = (t[r.provider as ProviderKey] ?? 0) + r.cents;
  }
  return out;
}

export function sumCents(v: Partial<Record<string, number>> | undefined): number {
  return Object.values(v ?? {}).reduce<number>((a, n) => a + (n ?? 0), 0);
}

export type TeamDayFigures = {
  missionsToday: number;
  waiting: number;
  publishedToday: number;
  refusedToday: number;
  blocked: number;
};

function countBy(rows: Array<{ teamKey: string; _count: { _all: number } }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.teamKey] = (out[r.teamKey] ?? 0) + r._count._all;
  return out;
}

/** Chiffres du jour (Europe/Paris) de chaque équipe. */
export async function loadDayFigures(now: Date): Promise<Record<TeamKey, TeamDayFigures>> {
  const today = parisMidnightUtc(parisDayKey(now));
  const [created, waiting, published, refused, blocked] = await Promise.all([
    prisma.agentMission.groupBy({ by: ["teamKey"], where: { createdAt: { gte: today } }, _count: { _all: true } }),
    prisma.agentMission.groupBy({
      by: ["teamKey"],
      where: { status: { in: ["WAITING_VALIDATION", "WAITING_HUMAN"] } },
      _count: { _all: true },
    }),
    prisma.agentMission.groupBy({
      by: ["teamKey"],
      where: { status: "DONE", updatedAt: { gte: today } },
      _count: { _all: true },
    }),
    prisma.agentValidation.groupBy({
      by: ["teamKey"],
      where: { status: "REJECTED", decidedAt: { gte: today } },
      _count: { _all: true },
    }),
    prisma.agentMission.groupBy({
      by: ["teamKey"],
      where: { status: { in: ["BLOCKED_BUDGET", "FAILED"] }, updatedAt: { gte: today } },
      _count: { _all: true },
    }),
  ]);
  const [c, w, p, r, b] = [created, waiting, published, refused, blocked].map(countBy);
  const out = {} as Record<TeamKey, TeamDayFigures>;
  for (const t of TEAM_KEYS)
    out[t] = {
      missionsToday: c![t] ?? 0,
      waiting: w![t] ?? 0,
      publishedToday: p![t] ?? 0,
      refusedToday: r![t] ?? 0,
      blocked: b![t] ?? 0,
    };
  return out;
}

/** Les derniers rapports quotidiens du Grand Chef (`Event` `agents.report.daily`). */
export async function loadDailyReports(take = 3): Promise<DailyReport[]> {
  const rows = await prisma.event.findMany({
    where: { type: "agents.report.daily" },
    orderBy: { occurredAt: "desc" },
    take,
    select: { id: true, occurredAt: true, payload: true },
  });
  return rows.map(parseDailyReport);
}

/** Nombres à signaler dans la sous-navigation : validations à faire et demandes ouvertes. */
export async function loadPendingCounts(): Promise<{ validations: number; requests: number }> {
  const [validations, requests] = await Promise.all([
    prisma.agentValidation.count({ where: { status: "PENDING" } }),
    prisma.humanRequest.count({ where: { status: { in: ["QUEUED", "PENDING"] } } }),
  ]);
  return { validations, requests };
}

export type ChannelChoice = { id: string; title: string; username: string | null; isTest: boolean };

export type ChannelPlanRow = ChannelChoice & {
  plan: {
    enabled: boolean;
    postsPerDay: number;
    windowStart: string;
    windowEnd: string;
    minSpacingMinutes: number;
    mix: { video: number; photo: number; text: number };
    personaId: string | null;
    campaignId: string | null;
    themes: string[];
  } | null;
};

function parseMix(v: unknown): { video: number; photo: number; text: number } {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);
  const mix = { video: n(o.video), photo: n(o.photo), text: n(o.text) };
  return mix.video + mix.photo + mix.text === 0 ? { video: 0, photo: 0, text: 1 } : mix;
}

/** Canaux de l'univers de l'équipe, avec leur plan (le canal Test est toujours listé : il reçoit les simulations). */
export async function loadChannelPlans(team: TeamKey): Promise<ChannelPlanRow[]> {
  const vertical = TEAM_VERTICAL[team];
  if (!vertical) return [];
  const channels = await prisma.channel.findMany({
    where: { isActive: true, OR: [{ vertical }, { agentPlan: { teamKey: team } }] },
    orderBy: [{ isTest: "desc" }, { title: "asc" }],
    select: { id: true, title: true, username: true, isTest: true, agentPlan: true },
  });
  return channels.map((c) => ({
    id: c.id,
    title: c.title,
    username: c.username,
    isTest: c.isTest,
    plan: c.agentPlan
      ? {
          enabled: c.agentPlan.enabled,
          postsPerDay: c.agentPlan.postsPerDay,
          windowStart: c.agentPlan.windowStart,
          windowEnd: c.agentPlan.windowEnd,
          minSpacingMinutes: c.agentPlan.minSpacingMinutes,
          mix: parseMix(c.agentPlan.mix),
          personaId: c.agentPlan.personaId,
          campaignId: c.agentPlan.campaignId,
          themes: Array.isArray(c.agentPlan.themes)
            ? c.agentPlan.themes.filter((t): t is string => typeof t === "string")
            : [],
        }
      : null,
  }));
}

/** Choix des listes du plan : personas et campagnes (de l'univers d'abord). */
export async function loadPlanChoices(team: TeamKey): Promise<{
  personas: Array<{ id: string; name: string; isActive: boolean }>;
  campaigns: Array<{ id: string; name: string }>;
}> {
  const vertical = TEAM_VERTICAL[team];
  const [personas, campaigns] = await Promise.all([
    prisma.persona.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } }),
    prisma.campaign.findMany({
      where: { status: { not: "ENDED" }, ...(vertical ? { OR: [{ vertical }, { vertical: null }] } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { personas, campaigns };
}

export type RunView = {
  id: string;
  missionId: string;
  agentKey: string;
  status: string;
  startedAt: Date;
  durationMs: number | null;
  costCents: number;
  outputSummary: string | null;
  error: string | null;
};

const RUN_SELECT = {
  id: true,
  missionId: true,
  agentKey: true,
  status: true,
  startedAt: true,
  durationMs: true,
  costCents: true,
  outputSummary: true,
  error: true,
} satisfies Prisma.AgentRunSelect;

/** Agents de la chaîne de l'équipe, chacun avec ses 3 derniers passages. */
export async function loadAgentsOfTeam(team: TeamKey): Promise<Array<{ agentKey: string; runs: RunView[] }>> {
  return Promise.all(
    TEAM_CHAINS[team].map(async (agentKey) => ({
      agentKey,
      runs: await prisma.agentRun.findMany({
        where: { agentKey, mission: { teamKey: team } },
        orderBy: { startedAt: "desc" },
        take: 3,
        select: RUN_SELECT,
      }),
    })),
  );
}

export type MissionView = {
  id: string;
  teamKey: string;
  kind: string;
  status: string;
  channelId: string | null;
  channelTitle: string | null;
  currentStep: number;
  steps: ReturnType<typeof parseSteps>;
  payload: unknown;
  costCents: number;
  postId: string | null;
  scheduledFor: Date | null;
  isTest: boolean;
  createdBy: string;
  attempts: number;
  lastError: string | null;
  lastActivityAt: Date;
  createdAt: Date;
};

const MISSION_SELECT = {
  id: true,
  teamKey: true,
  kind: true,
  status: true,
  channelId: true,
  channel: { select: { title: true } },
  currentStep: true,
  steps: true,
  payload: true,
  costCents: true,
  postId: true,
  scheduledFor: true,
  isTest: true,
  createdBy: true,
  attempts: true,
  lastError: true,
  lastActivityAt: true,
  createdAt: true,
} satisfies Prisma.AgentMissionSelect;

type MissionRow = Prisma.AgentMissionGetPayload<{ select: typeof MISSION_SELECT }>;

function missionView(m: MissionRow): MissionView {
  const { channel, steps, ...rest } = m;
  return { ...rest, channelTitle: channel?.title ?? null, steps: parseSteps(steps) };
}

export async function loadMissions(
  filters: MissionFilters,
  now: Date,
  opts: { teamKey?: string | null; take?: number; skip?: number } = {},
): Promise<{ rows: MissionView[]; total: number }> {
  const where = missionsWhere(filters, now, opts.teamKey);
  const [rows, total] = await Promise.all([
    prisma.agentMission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.take ?? 50,
      skip: opts.skip ?? 0,
      select: MISSION_SELECT,
    }),
    prisma.agentMission.count({ where }),
  ]);
  return { rows: rows.map(missionView), total };
}

export async function loadRuns(
  filters: MissionFilters,
  now: Date,
  opts: { teamKey?: string | null; agentKey?: string | null; take?: number; skip?: number } = {},
): Promise<{ rows: Array<RunView & { teamKey: string; inputSummary: string | null }>; total: number }> {
  // La période porte sur le début du passage ; statut et canal, sur sa mission.
  const since = rangeStart(filters.range, now);
  const where: Prisma.AgentRunWhereInput = {
    mission: missionsWhere({ ...filters, range: "all" }, now, opts.teamKey),
    ...(opts.agentKey ? { agentKey: opts.agentKey } : {}),
    ...(since ? { startedAt: { gte: since } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.agentRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: opts.take ?? 50,
      skip: opts.skip ?? 0,
      select: { ...RUN_SELECT, inputSummary: true, mission: { select: { teamKey: true } } },
    }),
    prisma.agentRun.count({ where }),
  ]);
  return {
    rows: rows.map(({ mission, ...r }) => ({ ...r, teamKey: mission.teamKey })),
    total,
  };
}

export type ValidationView = {
  id: string;
  number: number;
  missionId: string;
  teamKey: string;
  previewText: string;
  media: { id: string; mimeType: string } | null;
  reason: string;
  status: string;
  decidedVia: string | null;
  decidedAt: Date | null;
  rejectReason: string | null;
  createdAt: Date;
  channelTitle: string | null;
  simulation: boolean;
};

/** Validations à faire (les plus anciennes d'abord) et les 20 dernières décidées. */
export async function loadValidations(): Promise<{ pending: ValidationView[]; recent: ValidationView[] }> {
  const select = {
    id: true,
    number: true,
    missionId: true,
    teamKey: true,
    previewText: true,
    mediaAssetId: true,
    reason: true,
    status: true,
    decidedVia: true,
    decidedAt: true,
    rejectReason: true,
    createdAt: true,
    mission: { select: { payload: true, channel: { select: { title: true } } } },
  } satisfies Prisma.AgentValidationSelect;
  const [pending, recent] = await Promise.all([
    prisma.agentValidation.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 50, select }),
    prisma.agentValidation.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select,
    }),
  ]);
  const mediaIds = [...pending, ...recent].map((v) => v.mediaAssetId).filter((x): x is string => Boolean(x));
  const media = mediaIds.length
    ? await prisma.mediaAsset.findMany({ where: { id: { in: mediaIds } }, select: { id: true, mimeType: true } })
    : [];
  const view = (v: (typeof pending)[number]): ValidationView => {
    const payload = v.mission.payload && typeof v.mission.payload === "object" ? (v.mission.payload as Record<string, unknown>) : {};
    return {
      id: v.id,
      number: v.number,
      missionId: v.missionId,
      teamKey: v.teamKey,
      previewText: v.previewText,
      media: media.find((m) => m.id === v.mediaAssetId) ?? null,
      reason: v.reason,
      status: v.status,
      decidedVia: v.decidedVia,
      decidedAt: v.decidedAt,
      rejectReason: v.rejectReason,
      createdAt: v.createdAt,
      channelTitle: v.mission.channel?.title ?? null,
      simulation: payload.simulation !== false,
    };
  };
  return { pending: pending.map(view), recent: recent.map(view) };
}

export type HumanRequestView = {
  id: string;
  teamKey: string | null;
  kind: string;
  key: string;
  question: string;
  options: string[];
  status: string;
  answerSummary: string | null;
  askedAt: Date | null;
  answeredAt: Date | null;
  createdAt: Date;
  missionId: string | null;
};

/** Demandes ouvertes (la question en cours d'abord, puis la file) et les 20 dernières closes. */
export async function loadHumanRequests(): Promise<{ open: HumanRequestView[]; closed: HumanRequestView[] }> {
  const select = {
    id: true,
    teamKey: true,
    kind: true,
    key: true,
    question: true,
    options: true,
    status: true,
    answerSummary: true,
    askedAt: true,
    answeredAt: true,
    createdAt: true,
    missionId: true,
  } satisfies Prisma.HumanRequestSelect;
  const [open, closed] = await Promise.all([
    prisma.humanRequest.findMany({
      where: { status: { in: ["PENDING", "QUEUED"] } },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: 50,
      select,
    }),
    prisma.humanRequest.findMany({
      where: { status: { in: ["ANSWERED", "SKIPPED", "EXPIRED"] } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select,
    }),
  ]);
  const view = (r: (typeof open)[number]): HumanRequestView => ({
    ...r,
    options: Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string") : [],
  });
  // « PENDING » (question posée) avant « QUEUED » (en file) : l'ordre alphabétique de l'enum ne le garantit pas.
  const rank = (s: string) => (s === "PENDING" ? 0 : 1);
  return {
    open: open.map(view).sort((a, b) => rank(a.status) - rank(b.status) || a.createdAt.getTime() - b.createdAt.getTime()),
    closed: closed.map(view),
  };
}

export type AgentsGeneralSettings = {
  models: AgentsModels;
  libraryChannelId: string | null;
  pausedAll: boolean;
  channels: Array<ChannelChoice & { isMediaLibrary: boolean }>;
};

export async function loadAgentsGeneralSettings(): Promise<AgentsGeneralSettings> {
  const [models, library, pausedAll, channels] = await Promise.all([
    settingValue("agents.models"),
    settingValue("agents.libraryChannelId"),
    settingValue("agents.pausedAll"),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true, username: true, isTest: true, isMediaLibrary: true },
    }),
  ]);
  return {
    models: parseAgentsModels(models),
    libraryChannelId: parseLibraryChannelId(library),
    pausedAll: parsePausedAll(pausedAll),
    channels,
  };
}
