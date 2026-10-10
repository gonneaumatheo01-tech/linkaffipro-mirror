import { prisma } from "@linkaffipro/db";
import { scopeFromCampaign, type CampaignScope } from "@/lib/campaigns/attribution";

export type { CampaignScope };

const EMPTY: CampaignScope = { channelIds: [], inviteLinkIds: [], trackingLinkIds: [], affiliateCampaignIds: [] };

/**
 * Périmètre d'une campagne pour filtrer le tableau de bord, les membres, les messages et les envois :
 * ses canaux, ses liens d'entrée (InviteLink), ses liens goolink (TrackingLink) et ses offres Link Affi.
 * Campagne inconnue → périmètre vide (les filtres ne renvoient alors rien).
 */
export async function campaignScope(campaignId: string): Promise<CampaignScope> {
  const c = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      channelIds: true,
      affiliateCampaignIds: true,
      inviteLinks: { select: { id: true } },
      trackingLinks: { select: { id: true } },
      adSets: { select: { ads: { select: { inviteLinkId: true, trackingLinkId: true } } } },
    },
  });
  return c ? scopeFromCampaign(c) : EMPTY;
}
