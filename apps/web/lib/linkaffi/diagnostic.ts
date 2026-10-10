import { prisma, ourAffiliateCampaignIds, ourPlayers, type Prisma } from "@linkaffipro/db";

/**
 * Diagnostic Link Affi (Réglages → Connecteurs, ADMIN) : la seule page où les données Link Affi qui ne sont PAS à nous
 * restent visibles. « Nos » joueurs = rattachés à un de nos clics (sub-ID) ou à une offre Link Affi liée à une de nos
 * campagnes ; les autres (autres affiliés, offres non liées) n'entrent dans aucune statistique.
 */
export type UnlinkedOffer = {
  affiliateCampaignId: string;
  name: string;
  campaignKey: string | null;
  programName: string;
  vertical: string | null;
  players: number;
  lastRegisteredAt: Date | null;
};

export type LinkAffiDiagnostic = {
  programs: number;
  offers: number;
  linkedOffers: number;
  playerEvents: number;
  players: { total: number; ours: number; notOurs: number };
  /** Offres Link Affi non liées à une de nos campagnes, par nombre de joueurs non rattachés (les plus gros d'abord). */
  unlinked: UnlinkedOffer[];
  unlinkedOffersTotal: number;
};

export async function loadLinkAffiDiagnostic(limit = 20): Promise<LinkAffiDiagnostic> {
  const [ours, linked] = await Promise.all([ourPlayers(), ourAffiliateCampaignIds()]);
  const notOursWhere: Prisma.PlayerWhereInput = { NOT: ours };
  const [programs, offers, playerEvents, total, oursCount, groups] = await Promise.all([
    prisma.affiliateProgram.count(),
    prisma.affiliateCampaign.count(),
    prisma.playerEvent.count(),
    prisma.player.count(),
    prisma.player.count({ where: ours }),
    prisma.player.groupBy({
      by: ["affiliateCampaignId"],
      where: notOursWhere,
      _count: { _all: true },
      _max: { registeredAt: true },
    }),
  ]);
  const sorted = [...groups].sort((a, b) => b._count._all - a._count._all);
  const top = sorted.slice(0, limit);
  const details = await prisma.affiliateCampaign.findMany({
    where: { id: { in: top.map((g) => g.affiliateCampaignId) } },
    select: {
      id: true,
      name: true,
      campaignKey: true,
      vertical: true,
      program: { select: { name: true } },
    },
  });
  const byId = new Map(details.map((d) => [d.id, d]));
  return {
    programs,
    offers,
    linkedOffers: linked.length,
    playerEvents,
    players: { total, ours: oursCount, notOurs: total - oursCount },
    unlinked: top.map((g) => {
      const d = byId.get(g.affiliateCampaignId);
      return {
        affiliateCampaignId: g.affiliateCampaignId,
        name: d?.name ?? g.affiliateCampaignId,
        campaignKey: d?.campaignKey ?? null,
        programName: d?.program.name ?? "—",
        vertical: d?.vertical ?? null,
        players: g._count._all,
        lastRegisteredAt: g._max.registeredAt ?? null,
      };
    }),
    unlinkedOffersTotal: sorted.length,
  };
}

/** Adresse de l'assistant « Nouvelle campagne » pré-rempli avec une offre Link Affi (étape « Offre »). */
export function newCampaignHrefFor(
  offer: Pick<UnlinkedOffer, "affiliateCampaignId" | "vertical">,
): string {
  const draft = {
    affiliateCampaignIds: [offer.affiliateCampaignId],
    ...(offer.vertical ? { vertical: offer.vertical } : {}),
  };
  return `/campaigns/new?${new URLSearchParams({ draft: JSON.stringify(draft) }).toString()}`;
}
