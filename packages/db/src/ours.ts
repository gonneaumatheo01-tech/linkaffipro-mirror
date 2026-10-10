import { collectAffiliateCampaignIds, ourPlayerWhere, type OurPlayerWhere } from "@linkaffipro/core";
import { prisma } from "./client";

/** Campagnes Link Affi rattachées à une de nos campagnes (colonne JSON `Campaign.affiliateCampaignIds`). */
export async function ourAffiliateCampaignIds(): Promise<string[]> {
  const campaigns = await prisma.campaign.findMany({ select: { affiliateCampaignIds: true } });
  return collectAffiliateCampaignIds(campaigns);
}

/** Condition `where` Prisma sur `Player` limitant toute statistique à « nos » joueurs (phase 8). */
export async function ourPlayers(): Promise<OurPlayerWhere> {
  return ourPlayerWhere(await ourAffiliateCampaignIds());
}
