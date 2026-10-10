import { prisma, type AdPlatform, type Prisma } from "@linkaffipro/db";
import { cachedDashboard } from "@/lib/dashboard/cache";
import { periodDates, periodEnd, periodStart, previousPeriod, variationOf, type Period } from "@/lib/periods";
import { campaignOfferClickWhere, campaignPlayerWhere, jsonIds, scopeFromCampaign, type CampaignScope } from "./attribution";
import { computeMetrics, type CampaignMetrics } from "./metrics";

export type MetricKey = keyof CampaignMetrics;

/** Variations en % de chaque indicateur entre deux périodes (null si non calculable). */
export type CampaignDeltas = Partial<Record<MetricKey, number | null>>;

export function campaignDeltas(current: CampaignMetrics, previous: CampaignMetrics): CampaignDeltas {
  const out: CampaignDeltas = {};
  for (const k of Object.keys(current) as MetricKey[]) out[k] = variationOf(current[k], previous[k]);
  return out;
}

export type CampaignRow = {
  id: string;
  name: string;
  adPlatform: string | null;
  vertical: string | null;
  status: string;
  channels: string[];
  links: number;
  /** Nombre d'offres Link Affi rattachées. */
  offers: number;
  /** Campagne pub importée automatiquement depuis un compte connecté (phase 7) : plateforme d'origine. */
  importedFrom: AdPlatform | null;
  /** D'où viennent les coûts : compte connecté (api), fichier CSV (file), saisie (manual), ou aucun. */
  source: "api" | "file" | "manual" | null;
  metrics: CampaignMetrics;
  /** Période précédente (seulement si demandée). */
  previous: CampaignMetrics | null;
  deltas: CampaignDeltas | null;
};

/** Liste des campagnes avec leurs indicateurs sur la période (et la précédente si `compare`), mise en cache 60 s. */
export const listCampaigns: (period: Period, compare: boolean) => Promise<CampaignRow[]> = cachedDashboard("campaigns", (period: Period, compare: boolean) => listCampaignsUncached(period, compare));

const campaignScopeInclude = {
  inviteLinks: { select: { id: true } },
  trackingLinks: { select: { id: true } },
  adSets: { select: { ads: { select: { inviteLinkId: true, trackingLinkId: true } } } },
} satisfies Prisma.CampaignInclude;

/** Liste des campagnes avec leurs indicateurs sur la période, sans cache (plusieurs requêtes par campagne : lourd). */
export async function listCampaignsUncached(period: Period, compare = false): Promise<CampaignRow[]> {
  const prev = compare ? previousPeriod(period) : null;
  const [campaigns, channels] = await Promise.all([
    prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, include: campaignScopeInclude }),
    prisma.channel.findMany({ select: { id: true, title: true } }),
  ]);
  const channelTitle = new Map(channels.map((c) => [c.id, c.title]));
  const costSources = await prisma.adCost.groupBy({ by: ["campaignId", "source"], where: { campaignId: { not: null } } });
  const sourcesByCampaign = new Map<string, Set<string>>();
  for (const row of costSources) if (row.campaignId) (sourcesByCampaign.get(row.campaignId) ?? sourcesByCampaign.set(row.campaignId, new Set()).get(row.campaignId)!).add(row.source);
  const out: CampaignRow[] = [];
  for (const c of campaigns) {
    const scope = scopeFromCampaign(c);
    const [totals, prevTotals] = await Promise.all([campaignTotals(c.id, scope, period), prev ? campaignTotals(c.id, scope, prev) : Promise.resolve(null)]);
    const metrics = computeMetrics(totals);
    const previous = prevTotals ? computeMetrics(prevTotals) : null;
    out.push({
      id: c.id,
      name: c.name,
      adPlatform: c.adPlatform,
      vertical: c.vertical,
      status: c.status,
      channels: scope.channelIds.map((id) => channelTitle.get(id) ?? "?"),
      links: scope.inviteLinkIds.length,
      offers: scope.affiliateCampaignIds.length,
      importedFrom: c.externalCampaignId && c.adPlatform ? c.adPlatform : null,
      source: c.connectionId || sourcesByCampaign.get(c.id)?.has("API") ? "api" : sourcesByCampaign.get(c.id)?.has("CSV") ? "file" : sourcesByCampaign.get(c.id)?.has("MANUAL") ? "manual" : null,
      metrics,
      previous,
      deltas: previous ? campaignDeltas(metrics, previous) : null,
    });
  }
  return out;
}

/**
 * Totaux d'une campagne sur la période : dépense, clics d'entrée, membres, clics d'offre, inscriptions, FTD, dépôts, NGR.
 * Membres = demandes d'adhésion passées par ses liens d'entrée. Joueurs = rattachés à un clic de ses liens, à un de
 * ses membres, OU appartenant à une de ses campagnes Link Affi (voir `campaignPlayerWhere`).
 */
export async function campaignTotals(campaignId: string, scope: CampaignScope, period: Period) {
  const since = periodStart(period);
  const until = periodEnd(period);
  const { dateFrom, dateTo } = periodDates(period);
  const within = { gte: since, lt: until };
  const playerWhere = campaignPlayerWhere(scope) as Prisma.PlayerWhereInput;
  const [spendAgg, members, players, entryClicks, offerClicks, depositEvents] = await Promise.all([
    prisma.adCost.aggregate({
      _sum: { spend: true },
      where: { date: { gte: dateFrom, lte: dateTo }, OR: [{ campaignId }, { adSet: { campaignId } }, { ad: { adSet: { campaignId } } }] },
    }),
    scope.inviteLinkIds.length ? prisma.membership.count({ where: { inviteLinkId: { in: scope.inviteLinkIds }, requestedAt: within, status: { in: ["APPROVED", "LEFT", "KICKED"] } } }) : 0,
    prisma.player.findMany({ where: { AND: [playerWhere, { OR: [{ createdAt: within }, { registeredAt: within }, { ftdAt: within }] }] }, select: { createdAt: true, registeredAt: true, ftdAt: true, ngr: true } }),
    scope.trackingLinkIds.length ? prisma.click.count({ where: { trackingLinkId: { in: scope.trackingLinkIds }, trackingLink: { kind: "AD_ENTRY" }, isBot: false, createdAt: within } }) : 0,
    prisma.click.count({ where: { ...(campaignOfferClickWhere(scope) as Prisma.ClickWhereInput), createdAt: within } }),
    prisma.playerEvent.aggregate({ _count: { _all: true }, _sum: { amount: true }, where: { type: { in: ["FTD", "DEPOSIT", "REDEPOSIT"] }, occurredAt: within, player: playerWhere } }),
  ]);
  const inWindow = (d: Date | null) => !!d && d >= since && d < until;
  return {
    spend: Number(spendAgg._sum.spend ?? 0),
    members,
    registrations: players.filter((p) => inWindow(p.registeredAt)).length,
    ftds: players.filter((p) => inWindow(p.ftdAt)).length,
    revenue: players.filter((p) => inWindow(p.registeredAt) || inWindow(p.createdAt)).reduce((s, p) => s + Number(p.ngr), 0),
    entryClicks,
    offerClicks,
    deposits: depositEvents._count._all,
    depositAmount: Number(depositEvents._sum.amount ?? 0),
  };
}

/** Arbre campagne → groupes → pubs (pour la correspondance à l'import). */
export async function campaignTree() {
  const campaigns = await prisma.campaign.findMany({ select: { id: true, name: true, adSets: { select: { id: true, name: true, ads: { select: { id: true, name: true } } } } } });
  return campaigns;
}

/** Liens d'entrée non encore rattachés à une pub précise. */
export async function unattachedEntryLinks() {
  return prisma.inviteLink.findMany({
    where: { kind: "AD_ENTRY", ad: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, adPlatform: true, channel: { select: { title: true } } },
  });
}

export type OfferOption = { id: string; name: string; programName: string };
export type CampaignOptionWithOffers = { id: string; name: string; vertical: string | null; status: string; offers: OfferOption[] };

/**
 * Nos campagnes avec leurs offres Link Affi (pour le bouton « Offre » des messages et envois, et les filtres).
 * Les offres inactives ou supprimées côté Link Affi sont ignorées.
 */
export async function listCampaignOptions(): Promise<CampaignOptionWithOffers[]> {
  const [campaigns, offers] = await Promise.all([
    prisma.campaign.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], select: { id: true, name: true, vertical: true, status: true, affiliateCampaignIds: true } }),
    prisma.affiliateCampaign.findMany({ where: { isActive: true }, select: { id: true, name: true, program: { select: { name: true } } } }),
  ]);
  const byId = new Map(offers.map((o) => [o.id, { id: o.id, name: o.name, programName: o.program.name }]));
  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    vertical: c.vertical,
    status: c.status,
    offers: jsonIds(c.affiliateCampaignIds).map((id) => byId.get(id)).filter((o): o is OfferOption => !!o),
  }));
}

export type OfferCandidateRow = { id: string; name: string; programName: string; campaignKey: string | null; externalId: string; trackingUrlTemplate: string; vertical: string | null };

/** Campagnes Link Affi synchronisées et actives, pour choisir les offres d'une campagne. */
export async function listOfferCandidates(): Promise<OfferCandidateRow[]> {
  const rows = await prisma.affiliateCampaign.findMany({
    where: { isActive: true },
    orderBy: [{ program: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, campaignKey: true, externalId: true, trackingUrlTemplate: true, vertical: true, program: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, programName: r.program.name, campaignKey: r.campaignKey, externalId: r.externalId, trackingUrlTemplate: r.trackingUrlTemplate, vertical: r.vertical }));
}

export type ConnectionOption = { id: string; platform: AdPlatform; name: string; externalId: string };

/** Comptes publicitaires connectés et actifs (phase 7), pour rattacher une campagne à son compte. */
export async function listActiveConnections(): Promise<ConnectionOption[]> {
  return prisma.adAccountConnection.findMany({ where: { status: "ACTIVE" }, orderBy: [{ platform: "asc" }, { name: "asc" }], select: { id: true, platform: true, name: true, externalId: true } });
}
