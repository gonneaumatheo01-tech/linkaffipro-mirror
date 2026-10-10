/**
 * Lectures des résultats d'un envoi à un groupe (fiche, liste, page A/B). Règle existante, inchangée : les clics
 * sont ceux des boutons traqués du message « conteneur » de l'envoi (Post `templateName = broadcast:<id>`), et les
 * inscriptions et premiers dépôts sont ceux des joueurs rattachés par leur clic à ces boutons (identifiant de suivi),
 * donc nos joueurs par définition.
 */
import { prisma } from "@linkaffipro/db";
import type { Segment } from "@linkaffipro/core";
import type { GroupNames } from "./group";

const containerOf = (broadcastId: string) => `broadcast:${broadcastId}`;

export type BroadcastLinkStats = {
  label: string;
  kind: string;
  clicks: number;
  uniqueClicks: number;
  slug: string;
};

export type BroadcastResults = {
  links: BroadcastLinkStats[];
  clicks: number;
  uniqueClicks: number;
  offerClicks: number;
  registrations: number;
  ftds: number;
};

/** Clics des boutons traqués, inscriptions et premiers dépôts rattachés à un envoi. */
export async function loadBroadcastResults(broadcastId: string): Promise<BroadcastResults> {
  const templateName = containerOf(broadcastId);
  const [links, registrations, ftds] = await Promise.all([
    prisma.trackingLink.findMany({
      where: { post: { templateName } },
      orderBy: { createdAt: "asc" },
      select: { label: true, kind: true, clicks: true, uniqueClicks: true, slug: true },
    }),
    prisma.player.count({ where: { click: { trackingLink: { post: { templateName } } } } }),
    prisma.player.count({
      where: { ftdAt: { not: null }, click: { trackingLink: { post: { templateName } } } },
    }),
  ]);
  return {
    links,
    clicks: links.reduce((n, l) => n + l.clicks, 0),
    uniqueClicks: links.reduce((n, l) => n + l.uniqueClicks, 0),
    offerClicks: links.filter((l) => l.kind === "OFFER").reduce((n, l) => n + l.clicks, 0),
    registrations,
    ftds,
  };
}

/** Clics (total et personnes) par envoi, pour une page de la liste. */
export async function clicksByBroadcast(
  ids: string[],
): Promise<Map<string, { clicks: number; uniqueClicks: number }>> {
  const out = new Map<string, { clicks: number; uniqueClicks: number }>();
  if (ids.length === 0) return out;
  const links = await prisma.trackingLink.findMany({
    where: { post: { templateName: { in: ids.map(containerOf) } } },
    select: { clicks: true, uniqueClicks: true, post: { select: { templateName: true } } },
  });
  for (const l of links) {
    const id = l.post?.templateName?.slice("broadcast:".length);
    if (!id) continue;
    const c = out.get(id) ?? { clicks: 0, uniqueClicks: 0 };
    c.clicks += l.clicks;
    c.uniqueClicks += l.uniqueClicks;
    out.set(id, c);
  }
  return out;
}

/** Noms des canaux, campagnes, pubs et catégories cités par ces groupes (lecture des seuls identifiants utiles). */
export async function loadGroupNames(segments: Segment[]): Promise<GroupNames> {
  const ids = (pick: (s: Segment) => string[] | undefined) => [
    ...new Set(segments.flatMap((s) => pick(s) ?? [])),
  ];
  const channelIds = ids((s) => s.channelIds);
  const campaignIds = ids((s) => s.campaignIds);
  const inviteLinkIds = ids((s) => s.inviteLinkIds);
  const categoryIds = ids((s) => s.clickedCategoryIds);
  const [channels, campaigns, inviteLinks, categories] = await Promise.all([
    channelIds.length
      ? prisma.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, title: true },
        })
      : [],
    campaignIds.length
      ? prisma.campaign.findMany({
          where: { id: { in: campaignIds } },
          select: { id: true, name: true },
        })
      : [],
    inviteLinkIds.length
      ? prisma.inviteLink.findMany({
          where: { id: { in: inviteLinkIds } },
          select: { id: true, name: true, adName: true },
        })
      : [],
    categoryIds.length
      ? prisma.messageCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);
  return {
    channels: Object.fromEntries(channels.map((c) => [c.id, c.title])),
    campaigns: Object.fromEntries(campaigns.map((c) => [c.id, c.name])),
    inviteLinks: Object.fromEntries(inviteLinks.map((l) => [l.id, l.adName || l.name])),
    categories: Object.fromEntries(categories.map((c) => [c.id, c.name])),
  };
}
