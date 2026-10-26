/**
 * Lectures de la page Agents → Analyses (phase 29) : tendances de la veille, règles publicitaires, rapports, sources
 * et recommandations de l'équipe Analystes. Jamais le texte brut des contenus lus (`rawText`, effacé à 7 jours) :
 * seulement le résumé, le lien, la date et le classement.
 */
import { prisma, type Prisma } from "@linkaffipro/db";
import { ANALYSTS_AD_ANGLE_LABELS, ANALYSTS_AD_TYPE_LABELS, MARKET_ANALYSIS_SOURCE } from "@linkaffipro/agents";
import { TREND_WEEKS, marketRecView, stringList, weekStartUtc, type MarketRecView, type RuleFilters, type TrendFilters } from "./analyses";
import { hideUnapprovedProposals } from "@/lib/agents/qa-recommendations";

/** Entrées montrées au plus par vue (les plus récentes). */
export const TRENDS_LIMIT = 100;

export type TrendRow = {
  id: string;
  market: string;
  countries: string[];
  language: string;
  title: string | null;
  summary: string;
  url: string;
  author: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  category: string;
  sentiment: string;
  relevanceScore: number;
  verified: boolean;
  tags: string[];
  sourceName: string;
};

function trendWhere(f: TrendFilters): Prisma.TrendEntryWhereInput {
  return {
    relevanceScore: { gte: f.minScore },
    ...(f.market ? { market: f.market } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.sentiment ? { sentiment: f.sentiment } : {}),
    ...(f.country ? { countries: { array_contains: [f.country] } } : {}),
  };
}

export async function loadTrends(f: TrendFilters, now = new Date()): Promise<{ rows: TrendRow[]; total: number; weekDates: Date[] }> {
  const where = trendWhere(f);
  const since = new Date(weekStartUtc(now).getTime() - (TREND_WEEKS - 1) * 7 * 86_400_000);
  const [rows, total, dates] = await Promise.all([
    prisma.trendEntry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: TRENDS_LIMIT,
      select: {
        id: true,
        market: true,
        countries: true,
        language: true,
        title: true,
        summary: true,
        url: true,
        author: true,
        publishedAt: true,
        createdAt: true,
        category: true,
        sentiment: true,
        relevanceScore: true,
        verified: true,
        tags: true,
        source: { select: { name: true } },
      },
    }),
    prisma.trendEntry.count({ where }),
    prisma.trendEntry.findMany({ where: { ...where, createdAt: { gte: since } }, select: { createdAt: true } }),
  ]);
  return {
    rows: rows.map(({ source, countries, tags, ...r }) => ({
      ...r,
      market: String(r.market),
      category: String(r.category),
      sentiment: String(r.sentiment),
      countries: stringList(countries),
      tags: stringList(tags),
      sourceName: source.name,
    })),
    total,
    weekDates: dates.map((d) => d.createdAt),
  };
}

export type RuleRow = {
  id: string;
  platform: string;
  market: string;
  country: string;
  rule: string;
  riskLevel: string;
  evidence: unknown;
  verified: boolean;
  workaround: string | null;
  lastVerifiedAt: Date;
  updatedAt: Date;
};

export async function loadRules(f: RuleFilters): Promise<RuleRow[]> {
  const rows = await prisma.complianceRule.findMany({
    where: {
      isActive: true,
      ...(f.platform ? { platform: f.platform } : {}),
      ...(f.market ? { market: f.market } : {}),
      ...(f.risk ? { riskLevel: f.risk } : {}),
      // Une règle « tous les pays » vaut aussi pour le pays choisi.
      ...(f.country ? { country: { in: [f.country, "ALL"] } } : {}),
    },
    orderBy: [{ lastVerifiedAt: "desc" }],
    take: 300,
    select: { id: true, platform: true, market: true, country: true, rule: true, riskLevel: true, evidence: true, verified: true, workaround: true, lastVerifiedAt: true, updatedAt: true },
  });
  return rows.map((r) => ({ ...r, platform: String(r.platform), market: String(r.market), riskLevel: String(r.riskLevel) }));
}

export type ReportRow = {
  id: string;
  market: string | null;
  countries: string[];
  period: string;
  reportType: string;
  title: string;
  summary: string;
  requestText: string | null;
  sentAt: Date | null;
  createdAt: Date;
};

export async function loadReports(): Promise<ReportRow[]> {
  const rows = await prisma.strategyReport.findMany({
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, market: true, countries: true, period: true, reportType: true, title: true, summary: true, requestText: true, sentAt: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, market: r.market ? String(r.market) : null, reportType: String(r.reportType), countries: stringList(r.countries) }));
}

export type ReportDetail = ReportRow & { content: unknown; recommendations: unknown };

export async function loadReport(id: string): Promise<ReportDetail | null> {
  const r = await prisma.strategyReport.findUnique({ where: { id } });
  if (!r) return null;
  return {
    id: r.id,
    market: r.market ? String(r.market) : null,
    countries: stringList(r.countries),
    period: r.period,
    reportType: String(r.reportType),
    title: r.title,
    summary: r.summary,
    requestText: r.requestText,
    sentAt: r.sentAt,
    createdAt: r.createdAt,
    content: r.content,
    recommendations: r.recommendations,
  };
}

export type SourceRow = {
  id: string;
  name: string;
  url: string;
  sourceType: string;
  market: string;
  countries: string[];
  languages: string[];
  isActive: boolean;
  origin: string;
  lastScrapedAt: Date | null;
  nextScrapeAt: Date | null;
  errorCount: number;
  lastError: string | null;
  entries: number;
};

export async function loadSources(): Promise<SourceRow[]> {
  const rows = await prisma.trendSource.findMany({
    orderBy: [{ isActive: "desc" }, { market: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      url: true,
      sourceType: true,
      market: true,
      countries: true,
      languages: true,
      isActive: true,
      origin: true,
      lastScrapedAt: true,
      nextScrapeAt: true,
      errorCount: true,
      lastError: true,
      _count: { select: { entries: true } },
    },
  });
  return rows.map(({ _count, ...r }) => ({
    ...r,
    sourceType: String(r.sourceType),
    market: String(r.market),
    countries: stringList(r.countries),
    languages: stringList(r.languages),
    entries: _count.entries,
  }));
}

export async function loadMarketRecommendations(): Promise<MarketRecView[]> {
  const rows = await prisma.recommendation.findMany({
    where: { source: MARKET_ANALYSIS_SOURCE },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, field: true, targetId: true, after: true, evidence: true, status: true, comment: true, createdAt: true, appliedAt: true, doneAt: true, rejectedAt: true },
  });
  // Phase 30 : propositions montrées seulement si le QA Global les a approuvées.
  const shown = (await hideUnapprovedProposals(rows)).rows;
  return shown.map((r) => marketRecView({ ...r, status: String(r.status) }, { adType: ANALYSTS_AD_TYPE_LABELS, angle: ANALYSTS_AD_ANGLE_LABELS }));
}

/** Pastilles : nombres par vue (sources en erreur, recommandations à décider). */
export async function loadAnalysesCounts(): Promise<{ sourcesInError: number; sourcesProposed: number; recsOpen: number }> {
  const [sourcesInError, sourcesProposed, recsOpen] = await Promise.all([
    prisma.trendSource.count({ where: { errorCount: { gt: 0 }, lastError: { not: null } } }),
    prisma.trendSource.count({ where: { isActive: false, origin: "discovered", lastScrapedAt: null } }),
    prisma.recommendation.count({ where: { source: MARKET_ANALYSIS_SOURCE, status: "PROPOSED" } }),
  ]);
  return { sourcesInError, sourcesProposed, recsOpen };
}
