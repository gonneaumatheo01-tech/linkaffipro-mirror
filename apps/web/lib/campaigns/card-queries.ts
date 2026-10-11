/**
 * Lectures de la page Campagnes en cartes et de l'en-tête de la fiche (lecture seule, aucune règle nouvelle) :
 * - mini-tendances jour par jour lues dans `DailyStat` (dimension `campaign:<id>`, écrite par le worker) ;
 * - total des campagnes affichées (filtres), calculé par `totalsForScopes` : chaque joueur, clic et membre n'y est
 *   compté qu'une fois, comme la ligne Total historique.
 * Les deux sont mis en cache 60 s comme les autres tableaux (`cachedDashboard`).
 */
import { prisma } from "@linkaffipro/db";
import { cachedDashboard } from "@/lib/dashboard/cache";
import { periodDates, periodDayKeys, previousPeriod, type Period } from "@/lib/periods";
import { scopeFromCampaign } from "./attribution";
import { computeMetrics, type CampaignMetrics } from "./metrics";
import { campaignScopeInclude, totalsForScopes } from "./queries";
import { buildCampaignTrends, campaignDimension, type CampaignTrend } from "./trend";

/** Séries jour par jour de chaque campagne demandée sur la période (objet simple : mis en cache en JSON). */
export async function loadCampaignTrendsUncached(
  campaignIds: string[],
  period: Period,
): Promise<Record<string, CampaignTrend>> {
  const ids = [...new Set(campaignIds)];
  if (ids.length === 0) return {};
  const { dateFrom, dateTo } = periodDates(period);
  const rows = await prisma.dailyStat.findMany({
    where: { dimension: { in: ids.map(campaignDimension) }, date: { gte: dateFrom, lte: dateTo } },
    select: {
      dimension: true,
      date: true,
      approved: true,
      ftds: true,
      spend: true,
      ngr: true,
      commissions: true,
    },
  });
  const trends = buildCampaignTrends(
    ids,
    periodDayKeys(period),
    rows.map((r) => ({
      ...r,
      spend: Number(r.spend),
      ngr: Number(r.ngr),
      commissions: Number(r.commissions),
    })),
  );
  return Object.fromEntries(trends);
}

/** Mini-tendances, en cache 60 s (identifiants triés : même clé quel que soit l'ordre). */
export const loadCampaignTrends: (
  campaignIds: string[],
  period: Period,
) => Promise<Record<string, CampaignTrend>> = (() => {
  // « v2 » : la série `profit` est devenue `gains` (phase 10) ; une ancienne entrée ne doit jamais resservir.
  const cached = cachedDashboard("campaign-trends-v2", loadCampaignTrendsUncached);
  return (campaignIds: string[], period: Period) => cached([...campaignIds].sort(), period);
})();

export type SubsetTotal = { total: CampaignMetrics; previousTotal: CampaignMetrics | null };

/**
 * Total des campagnes indiquées sur la période (et la précédente si `compare`), sans double compte : même calcul
 * que la ligne Total de la liste (`totalsForScopes`), limité aux campagnes affichées après filtres.
 */
export async function totalForCampaignsUncached(
  campaignIds: string[],
  period: Period,
  compare = false,
): Promise<SubsetTotal> {
  const ids = [...new Set(campaignIds)];
  const campaigns = ids.length
    ? await prisma.campaign.findMany({ where: { id: { in: ids } }, include: campaignScopeInclude })
    : [];
  const items = campaigns.map((c) => ({ campaignId: c.id, scope: scopeFromCampaign(c) }));
  const [total, previousTotal] = await Promise.all([
    totalsForScopes(items, period).then(computeMetrics),
    compare
      ? totalsForScopes(items, previousPeriod(period)).then(computeMetrics)
      : Promise.resolve(null),
  ]);
  return { total, previousTotal };
}

/** Total des campagnes affichées, en cache 60 s. */
export const totalForCampaigns: (
  campaignIds: string[],
  period: Period,
  compare: boolean,
) => Promise<SubsetTotal> = (() => {
  const cached = cachedDashboard("campaigns-subset-total-v2", totalForCampaignsUncached);
  return (campaignIds: string[], period: Period, compare: boolean) =>
    cached([...campaignIds].sort(), period, compare);
})();
