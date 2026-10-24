/**
 * Lectures de l'équipe Paris sportifs (phase 23) : catégories (`BetCategory`), pari d'une mission (`BettingPick`),
 * paris récents (doublons, quotas du jour, nouveautés), historique réglé (moyennes récentes). Requêtes à plat.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { parisDay, parisDayStart } from "../rules/time";
import type { CategoryCriteria, PickKey, TeamStatSample } from "../rules/bets";
import { DUPLICATE_WINDOW_MS } from "../rules/bets";
import type { Mission } from "../types";

export type BetCategoryInfo = CategoryCriteria & {
  id: string;
  key: string;
  name: string;
  sport: string;
  picksPerDay: number;
  channelIds: string[];
  campaignId: string | null;
  minMinutesBeforeKickoff: number;
  maxOddsDriftPct: number;
  active: boolean;
};

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

export function toCategory(r: Record<string, unknown>): BetCategoryInfo {
  return {
    id: String(r.id),
    key: String(r.key),
    name: String(r.name),
    sport: typeof r.sport === "string" && r.sport ? r.sport : "SOCCER",
    marketTypes: strings(r.marketTypes),
    leagues: strings(r.leagues),
    bookmakers: strings(r.bookmakers).map((b) => b.toLowerCase()),
    minOdds: Number(r.minOdds ?? 1.5),
    maxOdds: Number(r.maxOdds ?? 3.5),
    picksPerDay: Math.max(0, Math.round(Number(r.picksPerDay ?? 2))),
    channelIds: strings(r.channelIds),
    campaignId: typeof r.campaignId === "string" && r.campaignId ? r.campaignId : null,
    minMinutesBeforeKickoff: Math.max(0, Math.round(Number(r.minMinutesBeforeKickoff ?? 30))),
    maxOddsDriftPct: Math.max(0, Number(r.maxOddsDriftPct ?? 5)),
    active: r.active === true,
  };
}

export async function loadCategory(prisma: PrismaClient, id: string | null | undefined): Promise<BetCategoryInfo | null> {
  if (!id) return null;
  const r = await prisma.betCategory.findUnique({ where: { id } });
  return r ? toCategory(r as unknown as Record<string, unknown>) : null;
}

export async function activeCategories(prisma: PrismaClient): Promise<BetCategoryInfo[]> {
  const rows = await prisma.betCategory.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => toCategory(r as unknown as Record<string, unknown>));
}

export type PickRow = {
  id: string;
  missionId: string | null;
  categoryId: string;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  marketId: string;
  marketLabel: string;
  selectionLabel: string;
  line: number | null;
  bookmaker: string;
  odds: number;
  consensusOdds: number | null;
  interestScore: number | null;
  oddsAtSend: number | null;
  reasoning: unknown;
  screenshotAssetId: string | null;
  postId: string | null;
  status: string;
  skipReason: string | null;
  result: unknown;
  createdAt: Date;
};

export async function loadMissionPick(prisma: PrismaClient, mission: Pick<Mission, "id" | "payload">): Promise<PickRow | null> {
  const id = typeof mission.payload.pickId === "string" ? mission.payload.pickId : null;
  const row = id
    ? await prisma.bettingPick.findUnique({ where: { id } })
    : await prisma.bettingPick.findFirst({ where: { missionId: mission.id }, orderBy: { createdAt: "asc" } });
  return row as PickRow | null;
}

/** Statuts qui comptent comme « publié ou en cours » (doublons, quota du jour). */
export const LIVE_PICK_STATUSES = ["PROPOSED", "PUBLISHED", "WON", "LOST", "VOID"] as const;
export const PUBLISHED_PICK_STATUSES = ["PUBLISHED", "WON", "LOST", "VOID"] as const;

/** Paris des 48 dernières heures (hors écartés), pour les doublons. */
export async function recentPickKeys(prisma: PrismaClient, now: Date, excludeId?: string): Promise<Array<PickKey & { at: Date }>> {
  const rows = (await prisma.bettingPick.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) }, status: { in: [...LIVE_PICK_STATUSES] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { eventId: true, marketId: true, selectionLabel: true, line: true, createdAt: true },
  })) as Array<{ eventId: string; marketId: string; selectionLabel: string; line: number | null; createdAt: Date }>;
  return rows.map((r) => ({ eventId: r.eventId, marketId: r.marketId, selectionLabel: r.selectionLabel, line: r.line, at: r.createdAt }));
}

/** Paris du jour de Paris d'une catégorie (hors écartés, hors paris de test) : publiés ou en cours. */
export async function picksToday(prisma: PrismaClient, categoryId: string, now: Date): Promise<number> {
  const rows = (await prisma.bettingPick.findMany({
    where: { categoryId, status: { in: [...LIVE_PICK_STATUSES] }, createdAt: { gte: parisDayStart(parisDay(now)) } },
    select: { missionId: true },
  })) as Array<{ missionId: string | null }>;
  const tests = await testMissionIds(prisma, rows.map((r) => r.missionId));
  return rows.filter((r) => !r.missionId || !tests.has(r.missionId)).length;
}

/** Identifiants des missions de test (leurs paris ne comptent ni dans les nouveautés ni dans le bilan). */
export async function testMissionIds(prisma: PrismaClient, missionIds: readonly (string | null)[]): Promise<Set<string>> {
  const ids = [...new Set(missionIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Set();
  const rows = await prisma.agentMission.findMany({ where: { id: { in: ids }, isTest: true }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/**
 * Ligue et marché déjà publiés sur un VRAI canal (hors tests, hors simulation : un post parti sur le canal Test ne
 * compte pas, hors ce pari) : sinon « toujours validé ».
 */
export async function noveltyOf(prisma: PrismaClient, pick: Pick<PickRow, "id" | "league" | "marketId">): Promise<{ newLeague: boolean; newMarket: boolean }> {
  const rows = (await prisma.bettingPick.findMany({
    where: { id: { not: pick.id }, status: { in: [...PUBLISHED_PICK_STATUSES] }, postId: { not: null }, OR: [{ league: pick.league }, { marketId: pick.marketId }] },
    select: { league: true, marketId: true, missionId: true, postId: true },
    take: 500,
  })) as Array<{ league: string; marketId: string; missionId: string | null; postId: string | null }>;
  const tests = await testMissionIds(prisma, rows.map((r) => r.missionId));
  const candidates = rows.filter((r) => r.postId && (!r.missionId || !tests.has(r.missionId)));
  const postIds = [...new Set(candidates.map((r) => r.postId!))];
  const posts = postIds.length ? ((await prisma.post.findMany({ where: { id: { in: postIds } }, select: { id: true, channelId: true } })) as Array<{ id: string; channelId: string }>) : [];
  const channelIds = [...new Set(posts.map((p) => p.channelId))];
  const realChannels = channelIds.length
    ? new Set(((await prisma.channel.findMany({ where: { id: { in: channelIds }, isTest: false }, select: { id: true } })) as Array<{ id: string }>).map((c) => c.id))
    : new Set<string>();
  const realPosts = new Set(posts.filter((p) => realChannels.has(p.channelId)).map((p) => p.id));
  const real = candidates.filter((r) => realPosts.has(r.postId!));
  return { newLeague: !real.some((r) => r.league === pick.league), newMarket: !real.some((r) => r.marketId === pick.marketId) };
}

/** Matchs déjà réglés (60 jours) : statistiques par équipe pour les moyennes récentes. */
export async function settledSamples(prisma: PrismaClient, now: Date): Promise<TeamStatSample[]> {
  const rows = (await prisma.bettingPick.findMany({
    where: { status: { in: ["WON", "LOST", "VOID"] }, kickoffAt: { gte: new Date(now.getTime() - 60 * 86_400_000) } },
    select: { eventId: true, homeTeam: true, awayTeam: true, kickoffAt: true, result: true },
    orderBy: { kickoffAt: "desc" },
    take: 500,
  })) as Array<{ eventId: string; homeTeam: string; awayTeam: string; kickoffAt: Date; result: unknown }>;
  const seen = new Set<string>();
  const out: TeamStatSample[] = [];
  for (const r of rows) {
    if (seen.has(r.eventId)) continue;
    seen.add(r.eventId);
    const stats = (r.result as { stats?: Record<string, number> } | null)?.stats;
    if (stats && typeof stats === "object") out.push({ homeTeam: r.homeTeam, awayTeam: r.awayTeam, at: r.kickoffAt, values: stats });
  }
  return out;
}
