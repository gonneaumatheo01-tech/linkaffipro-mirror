/**
 * Lectures en base de la page « Ce qui marche » (`/agents/algo`, phase 21) et de l'encart de la fiche persona.
 * Lecture seule : aucune tâche enfilée, aucun appel d'IA. Les tableaux du moteur (fiches, tests, recommandations,
 * rapports) sont lus tels quels ; la mise en mots est dans les fichiers voisins.
 */
import { prisma } from "@linkaffipro/db";
import type { ConversationProfileStats } from "@linkaffipro/agents";
import { periodEnd, periodStart, type Period } from "@/lib/periods";
import { TEAM_NAMES, TEAM_VERTICAL, type TeamKey } from "../teams";
import type { ExperimentView } from "./experiments";
import type { InsightRow } from "./insights";
import type { RecommendationView } from "./recommendations";
import { parseProfiles, parseReview, type ReviewNotes } from "./reports";
import { parseAlgoSettings, type AlgoSettings } from "./settings";
import { hideUnapprovedProposals } from "@/lib/agents/qa-recommendations";

export type AlgoChannel = { id: string; title: string; isTest: boolean };

export async function loadAlgoSettings(): Promise<AlgoSettings> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "algo" }, select: { settings: true } });
  return parseAlgoSettings(row?.settings);
}

/** Canaux d'un univers (ceux d'un plan de l'équipe compris). */
export async function loadTeamChannels(team: TeamKey): Promise<AlgoChannel[]> {
  const vertical = TEAM_VERTICAL[team];
  if (!vertical) return [];
  return prisma.channel.findMany({
    where: { isActive: true, OR: [{ vertical }, { agentPlan: { teamKey: team } }] },
    orderBy: [{ isTest: "desc" }, { title: "asc" }],
    select: { id: true, title: true, isTest: true },
  });
}

/** Fiches de résultats de la période, pour un univers (et un canal). */
export async function loadInsightRows(
  period: Period,
  channelIds: string[],
  channelId: string | null,
): Promise<InsightRow[]> {
  const ids = channelId ? channelIds.filter((id) => id === channelId) : channelIds;
  if (ids.length === 0) return [];
  return prisma.postInsight.findMany({
    where: { channelId: { in: ids }, sentAt: { gte: periodStart(period), lt: periodEnd(period) } },
    select: {
      channelId: true,
      personaId: true,
      format: true,
      theme: true,
      hourParis: true,
      weekdayParis: true,
      textLength: true,
      views24h: true,
      viewsFinal: true,
      offerClicks: true,
      registrations: true,
    },
    take: 20_000,
  });
}

export async function loadPersonaNames(ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return {};
  const rows = await prisma.persona.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

export type SuggestedWindow = { day: number | null; start: string; end: string; score: number | null };

/** Fenêtres conseillées par l'agent Horaires pour un canal (`ChannelAgentPlan.suggestedWindows`). */
export async function loadSuggestedWindows(channelId: string): Promise<{ windows: SuggestedWindow[]; styleNotes: string | null }> {
  const plan = await prisma.channelAgentPlan.findUnique({
    where: { channelId },
    select: { suggestedWindows: true, styleNotes: true },
  });
  const raw = Array.isArray(plan?.suggestedWindows) ? (plan.suggestedWindows as unknown[]) : [];
  const windows = raw
    .map((w) => {
      const o = w && typeof w === "object" ? (w as Record<string, unknown>) : {};
      if (typeof o.start !== "string" || typeof o.end !== "string") return null;
      return {
        day: typeof o.day === "number" ? o.day : null,
        start: o.start,
        end: o.end,
        score: typeof o.score === "number" ? o.score : null,
      };
    })
    .filter((w): w is SuggestedWindow => w !== null);
  return { windows, styleNotes: plan?.styleNotes ?? null };
}

async function labelsFor(
  targets: Array<{ target: string; targetId: string; teamKey: string }>,
): Promise<Map<string, string>> {
  const ids = [...new Set(targets.map((t) => t.targetId))];
  const [channels, plans, personas] = await Promise.all([
    prisma.channel.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }),
    prisma.channelAgentPlan.findMany({ where: { id: { in: ids } }, select: { id: true, channel: { select: { title: true } } } }),
    prisma.persona.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
  ]);
  const m = new Map<string, string>();
  for (const c of channels) m.set(c.id, c.title);
  for (const p of plans) m.set(p.id, p.channel.title);
  for (const p of personas) m.set(p.id, p.name);
  return m;
}

function teamLabel(key: string): string {
  return (TEAM_NAMES as Record<string, string>)[key] ? `Équipe ${(TEAM_NAMES as Record<string, string>)[key]}` : key;
}

const REC_SELECT = {
  id: true,
  teamKey: true,
  target: true,
  targetId: true,
  field: true,
  before: true,
  after: true,
  evidence: true,
  expectedGain: true,
  size: true,
  status: true,
  appliedAt: true,
  appliedBy: true,
  undoneAt: true,
  rejectedAt: true,
  weekStart: true,
  createdAt: true,
} as const;

async function withLabels<T extends { target: string; targetId: string; teamKey: string }>(
  rows: T[],
): Promise<Array<T & { targetLabel: string }>> {
  const labels = await labelsFor(rows);
  return rows.map((r) => ({
    ...r,
    targetLabel: r.target === "TEAM_CONFIG" ? teamLabel(r.targetId || r.teamKey) : (labels.get(r.targetId) ?? "Introuvable"),
  }));
}

/** Recommandations d'un univers : de l'équipe, ou visant un de ses canaux. Les plus récentes d'abord. */
export async function loadRecommendations(team: TeamKey, channelIds: string[]): Promise<RecommendationView[]> {
  const rows = await prisma.recommendation.findMany({
    where: { OR: [{ teamKey: team }, { targetId: { in: channelIds } }] },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
    select: REC_SELECT,
  });
  // Phase 30 : propositions montrées seulement si le QA Global les a approuvées.
  return withLabels((await hideUnapprovedProposals(rows)).rows);
}

/** Recommandations PERSONA d'une persona (encart de sa fiche). */
export async function loadPersonaRecommendations(personaId: string): Promise<RecommendationView[]> {
  const rows = await prisma.recommendation.findMany({
    where: { target: "PERSONA", targetId: personaId },
    orderBy: [{ createdAt: "desc" }],
    take: 20,
    select: REC_SELECT,
  });
  return withLabels((await hideUnapprovedProposals(rows)).rows);
}

/** Tests A/B d'un univers (de l'équipe ou sur un de ses canaux). */
export async function loadExperiments(team: TeamKey, channelIds: string[]): Promise<ExperimentView[]> {
  const rows = await prisma.experiment.findMany({
    where: { OR: [{ teamKey: team }, { channelId: { in: channelIds } }] },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      teamKey: true,
      channelId: true,
      personaId: true,
      kind: true,
      hypothesis: true,
      variants: true,
      metric: true,
      minSamples: true,
      status: true,
      startedAt: true,
      endsAt: true,
      closedAt: true,
      result: true,
      winner: true,
      createdAt: true,
    },
  });
  const labels = await labelsFor(
    rows.flatMap((r) => [
      ...(r.channelId ? [{ target: "CHANNEL_PLAN", targetId: r.channelId, teamKey: r.teamKey }] : []),
      ...(r.personaId ? [{ target: "PERSONA", targetId: r.personaId, teamKey: r.teamKey }] : []),
    ]),
  );
  return rows.map((r) => ({
    ...r,
    targetLabel: (r.channelId && labels.get(r.channelId)) || (r.personaId && labels.get(r.personaId)) || null,
  }));
}

export type ReportView = { id: string; teamKey: string; weekStart: string; content: string; sentAt: Date | null; createdAt: Date };

/** Rapports hebdomadaires archivés (toutes équipes), les plus récents d'abord. */
export async function loadReports(take = 12): Promise<ReportView[]> {
  // Les rapports de l'Agent Ads (phase 24) ont leur page (`/agents/ads`).
  return prisma.insightReport.findMany({
    where: { teamKey: { not: "ads" } },
    orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }],
    take,
    select: { id: true, teamKey: true, weekStart: true, content: true, sentAt: true, createdAt: true },
  });
}

/** Chiffres par profil du dernier rapport qui en contient, avec la relecture de l'IA. */
export async function loadConversationProfiles(): Promise<{
  weekStart: string | null;
  profiles: ConversationProfileStats[];
  review: ReviewNotes[];
}> {
  const rows = await prisma.insightReport.findMany({
    where: { teamKey: { not: "ads" } },
    orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }],
    take: 10,
    select: { weekStart: true, stats: true },
  });
  for (const r of rows) {
    const profiles = parseProfiles(r.stats);
    if (profiles.length === 0) continue;
    const s = r.stats && typeof r.stats === "object" ? (r.stats as Record<string, unknown>) : {};
    return { weekStart: r.weekStart, profiles, review: parseReview(s.conversationReview) };
  }
  return { weekStart: null, profiles: [], review: [] };
}
