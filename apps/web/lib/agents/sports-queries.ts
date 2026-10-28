/**
 * Lectures de la fiche d'équipe Paris sportifs (phase 23) : catégories, paris du jour avec leur capture, bilan
 * (`betSummary` du moteur), appels de cotes du mois. Aucune écriture, aucune file.
 */
import { betSummary, type BetSummaryRow } from "@linkaffipro/agents";
import { prisma, type PrismaClient } from "@linkaffipro/db";
import { currentMonth } from "./missions";
import { parseSportsSettings, stringList, type SportsSettings, type SummaryBy } from "./sports";

const db = () => prisma as unknown as PrismaClient;

export type BetCategoryView = {
  id: string;
  key: string;
  name: string;
  sport: string;
  marketTypes: string[];
  leagues: string[];
  bookmakers: string[];
  minOdds: number;
  maxOdds: number;
  picksPerDay: number;
  channelIds: string[];
  campaignId: string | null;
  minMinutesBeforeKickoff: number;
  maxOddsDriftPct: number;
  active: boolean;
  sortOrder: number;
  updatedAt: Date;
};

export async function loadBetCategories(): Promise<BetCategoryView[]> {
  const rows = await prisma.betCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    sport: c.sport,
    marketTypes: stringList(c.marketTypes),
    leagues: stringList(c.leagues),
    bookmakers: stringList(c.bookmakers),
    minOdds: c.minOdds,
    maxOdds: c.maxOdds,
    picksPerDay: c.picksPerDay,
    channelIds: stringList(c.channelIds),
    campaignId: c.campaignId,
    minMinutesBeforeKickoff: c.minMinutesBeforeKickoff,
    maxOddsDriftPct: c.maxOddsDriftPct,
    active: c.active,
    sortOrder: c.sortOrder,
    updatedAt: c.updatedAt,
  }));
}

export type BettingPickView = {
  id: string;
  categoryName: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  marketLabel: string;
  selectionLabel: string;
  line: number | null;
  bookmaker: string;
  odds: number;
  consensusOdds: number | null;
  interestScore: number | null;
  oddsAtSend: number | null;
  /** 28 octobre 2026 : « human-pending » = l'équipe doit envoyer la capture et la cote ; « human » = reçues. */
  oddsLevel: string | null;
  reasoning: unknown;
  status: string;
  skipReason: string | null;
  result: unknown;
  createdAt: Date;
  missionId: string | null;
  screenshot: { id: string; mimeType: string; origin: string | null } | null;
};

/** Paris créés depuis `since` (début du jour de Paris), les plus récents d'abord, 60 au plus. */
export async function loadPicksSince(since: Date): Promise<BettingPickView[]> {
  const rows = await prisma.bettingPick.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 60,
    include: { category: { select: { name: true } } },
  });
  const assetIds = rows.map((r) => r.screenshotAssetId).filter((x): x is string => Boolean(x));
  const assets = assetIds.length
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, mimeType: true, origin: true },
      })
    : [];
  const byId = new Map(assets.map((a) => [a.id, a]));
  return rows.map((r) => {
    const a = r.screenshotAssetId ? byId.get(r.screenshotAssetId) : undefined;
    return {
      id: r.id,
      categoryName: r.category.name,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      league: r.league,
      kickoffAt: r.kickoffAt,
      marketLabel: r.marketLabel,
      selectionLabel: r.selectionLabel,
      line: r.line,
      bookmaker: r.bookmaker,
      odds: r.odds,
      consensusOdds: r.consensusOdds,
      interestScore: r.interestScore,
      oddsAtSend: r.oddsAtSend,
      oddsLevel: r.oddsLevel ?? null,
      reasoning: r.reasoning,
      status: r.status,
      skipReason: r.skipReason,
      result: r.result,
      createdAt: r.createdAt,
      missionId: r.missionId,
      screenshot: a ? { id: a.id, mimeType: a.mimeType, origin: a.origin } : null,
    };
  });
}

export async function loadSportsSettings(): Promise<SportsSettings> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "sports" }, select: { settings: true } });
  return parseSportsSettings(row?.settings);
}

/** Bilan du moteur ; `null` si le calcul échoue (la page le dit sans planter). */
export async function loadBetSummary(q: { from: Date; to: Date; by: SummaryBy }): Promise<BetSummaryRow[] | null> {
  try {
    return await betSummary(db(), q);
  } catch (err) {
    console.error("[agents] bilan des paris", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Appels au fournisseur de cotes ce mois-ci (`AgentUsage` de l'équipe, poste `odds`). */
export async function loadOddsCallsThisMonth(now: Date): Promise<number> {
  const row = await prisma.agentUsage.findUnique({
    where: { teamKey_provider_month: { teamKey: "sports", provider: "odds", month: currentMonth(now) } },
    select: { calls: true },
  });
  return row?.calls ?? 0;
}
