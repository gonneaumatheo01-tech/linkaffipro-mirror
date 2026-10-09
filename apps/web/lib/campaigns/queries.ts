import { prisma } from "@linkaffipro/db";
import { cachedDashboard } from "@/lib/dashboard/cache";
import { computeMetrics, type CampaignMetrics } from "./metrics";

export const RANGES = { "7": 7, "30": 30, "90": 90 } as const;
export type RangeKey = keyof typeof RANGES;

export function rangeKeyOf(v: unknown): RangeKey {
  return typeof v === "string" && v in RANGES ? (v as RangeKey) : "30";
}

export function sinceFor(range: RangeKey, now = Date.now()): Date {
  const d = new Date(now - RANGES[range] * 24 * 3600 * 1000);
  d.setUTCHours(0, 0, 0, 0);
  return d;
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
};

/** Liste des pubs avec leurs indicateurs sur la période, mise en cache 60 s (une requête par pub : lourd). */
export const listCampaigns: (range: RangeKey) => Promise<CampaignRow[]> = cachedDashboard("campaigns", (range: RangeKey) => listCampaignsUncached(range));

/** Liste des pubs avec leurs indicateurs sur la période, sans cache. */
export async function listCampaignsUncached(range: RangeKey): Promise<CampaignRow[]> {
  const since = sinceFor(range);
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
    const totals = await campaignTotals(c.id, [...inviteLinkIds], [...trackingLinkIds], since);
    const channelIds = Array.isArray(c.channelIds) ? (c.channelIds as string[]) : [];
    out.push({
      id: c.id,
      name: c.name,
      adPlatform: c.adPlatform,
      vertical: c.vertical,
      status: c.status,
      channels: channelIds.map((id) => channelTitle.get(id) ?? "?"),
      links: inviteLinkIds.size,
      metrics: computeMetrics(totals),
    });
  }
  return out;
}

/** Totaux d'une pub sur la période : dépense, membres, inscriptions, FTD, revenu, clics d'entrée. */
export async function campaignTotals(campaignId: string, inviteLinkIds: string[], trackingLinkIds: string[], since: Date) {
  const [spendAgg, members, players, clicks] = await Promise.all([
    prisma.adCost.aggregate({
      _sum: { spend: true },
      where: { date: { gte: since }, OR: [{ campaignId }, { adSet: { campaignId } }, { ad: { adSet: { campaignId } } }] },
    }),
    inviteLinkIds.length ? prisma.membership.count({ where: { inviteLinkId: { in: inviteLinkIds }, requestedAt: { gte: since }, status: { in: ["APPROVED", "LEFT", "KICKED"] } } }) : 0,
    trackingLinkIds.length
      ? prisma.player.findMany({ where: { click: { trackingLinkId: { in: trackingLinkIds } }, createdAt: { gte: since } }, select: { registeredAt: true, ftdAt: true, ngr: true } })
      : [],
    trackingLinkIds.length ? prisma.click.count({ where: { trackingLinkId: { in: trackingLinkIds }, isBot: false, createdAt: { gte: since } } }) : 0,
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
