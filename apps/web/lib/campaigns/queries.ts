import { prisma } from "@linkaffipro/db";
import { cachedDashboard } from "@/lib/dashboard/cache";
import { periodDates, periodEnd, periodStart, previousPeriod, variationOf, type Period } from "@/lib/periods";
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
  metrics: CampaignMetrics;
  /** Période précédente (seulement si demandée). */
  previous: CampaignMetrics | null;
  deltas: CampaignDeltas | null;
};

/** Liste des pubs avec leurs indicateurs sur la période (et la précédente si `compare`), mise en cache 60 s. */
export const listCampaigns: (period: Period, compare: boolean) => Promise<CampaignRow[]> = cachedDashboard("campaigns", (period: Period, compare: boolean) => listCampaignsUncached(period, compare));

/** Liste des pubs avec leurs indicateurs sur la période, sans cache (une à deux requêtes par pub : lourd). */
export async function listCampaignsUncached(period: Period, compare = false): Promise<CampaignRow[]> {
  const prev = compare ? previousPeriod(period) : null;
  const [campaigns, channels] = await Promise.all([
    prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        inviteLinks: { select: { id: true } },
        trackingLinks: { select: { id: true } },
        adSets: { include: { ads: { select: { id: true, inviteLinkId: true, trackingLinkId: true } } } },
      },
    }),
    prisma.channel.findMany({ select: { id: true, title: true } }),
  ]);
  const channelTitle = new Map(channels.map((c) => [c.id, c.title]));
  const out: CampaignRow[] = [];
  for (const c of campaigns) {
    const inviteLinkIds = new Set<string>(c.inviteLinks.map((l) => l.id));
    const trackingLinkIds = new Set<string>(c.trackingLinks.map((l) => l.id));
    for (const s of c.adSets) for (const a of s.ads) {
      if (a.inviteLinkId) inviteLinkIds.add(a.inviteLinkId);
      if (a.trackingLinkId) trackingLinkIds.add(a.trackingLinkId);
    }
    const [totals, prevTotals] = await Promise.all([
      campaignTotals(c.id, [...inviteLinkIds], [...trackingLinkIds], period),
      prev ? campaignTotals(c.id, [...inviteLinkIds], [...trackingLinkIds], prev) : Promise.resolve(null),
    ]);
    const metrics = computeMetrics(totals);
    const previous = prevTotals ? computeMetrics(prevTotals) : null;
    const channelIds = Array.isArray(c.channelIds) ? (c.channelIds as string[]) : [];
    out.push({
      id: c.id,
      name: c.name,
      adPlatform: c.adPlatform,
      vertical: c.vertical,
      status: c.status,
      channels: channelIds.map((id) => channelTitle.get(id) ?? "?"),
      links: inviteLinkIds.size,
      metrics,
      previous,
      deltas: previous ? campaignDeltas(metrics, previous) : null,
    });
  }
  return out;
}

/** Totaux d'une pub sur la période : dépense, membres, inscriptions, FTD, revenu, clics d'entrée. */
export async function campaignTotals(campaignId: string, inviteLinkIds: string[], trackingLinkIds: string[], period: Period) {
  const since = periodStart(period);
  const until = periodEnd(period);
  const { dateFrom, dateTo } = periodDates(period);
  const within = { gte: since, lt: until };
  const [spendAgg, members, players, clicks] = await Promise.all([
    prisma.adCost.aggregate({
      _sum: { spend: true },
      where: { date: { gte: dateFrom, lte: dateTo }, OR: [{ campaignId }, { adSet: { campaignId } }, { ad: { adSet: { campaignId } } }] },
    }),
    inviteLinkIds.length ? prisma.membership.count({ where: { inviteLinkId: { in: inviteLinkIds }, requestedAt: within, status: { in: ["APPROVED", "LEFT", "KICKED"] } } }) : 0,
    trackingLinkIds.length
      ? prisma.player.findMany({ where: { click: { trackingLinkId: { in: trackingLinkIds } }, createdAt: within }, select: { registeredAt: true, ftdAt: true, ngr: true } })
      : [],
    trackingLinkIds.length ? prisma.click.count({ where: { trackingLinkId: { in: trackingLinkIds }, isBot: false, createdAt: within } }) : 0,
  ]);
  return {
    spend: Number(spendAgg._sum.spend ?? 0),
    members,
    registrations: players.filter((p) => p.registeredAt).length,
    ftds: players.filter((p) => p.ftdAt).length,
    revenue: players.reduce((s, p) => s + Number(p.ngr), 0),
    entryClicks: clicks,
  };
}

/** Arbre campagne → groupes → pubs (pour la correspondance à l'import). */
export async function campaignTree() {
  const campaigns = await prisma.campaign.findMany({ select: { id: true, name: true, adSets: { select: { id: true, name: true, ads: { select: { id: true, name: true } } } } } });
  return campaigns;
}

/** Liens d'entrée non encore rattachés à une pub. */
export async function unattachedEntryLinks() {
  return prisma.inviteLink.findMany({
    where: { kind: "AD_ENTRY", ad: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, adPlatform: true, channel: { select: { title: true } } },
  });
}
