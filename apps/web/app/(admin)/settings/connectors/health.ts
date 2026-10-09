import { prisma } from "@linkaffipro/db";
import { HEALTH_WINDOW_DAYS, evaluateSubIdHealth, type SubIdHealth } from "@linkaffipro/linkaffi";

/**
 * Compte, sur 7 jours glissants et à partir de nos tables :
 * - joueurs rattachés par `postback` / `time_match` ;
 * - joueurs sans sub-ID appartenant à une campagne sur laquelle nous avons envoyé des clics d'offre avec sub-ID ;
 * - clics d'offre avec sub-ID envoyés (contexte).
 */
export async function computeSubIdHealth(now = new Date()): Promise<SubIdHealth> {
  const since = new Date(now.getTime() - HEALTH_WINDOW_DAYS * 24 * 3600 * 1000);
  const [postback, timeMatch, offerClicks, clickedCampaigns] = await Promise.all([
    prisma.player.count({ where: { subIdSource: "postback", createdAt: { gte: since } } }),
    prisma.player.count({ where: { subIdSource: "time_match", createdAt: { gte: since } } }),
    prisma.click.count({ where: { subId: { not: null }, createdAt: { gte: since } } }),
    prisma.trackingLink.findMany({
      where: { affiliateCampaignId: { not: null }, clickRecords: { some: { subId: { not: null }, createdAt: { gte: since } } } },
      select: { affiliateCampaignId: true },
      distinct: ["affiliateCampaignId"],
    }),
  ]);
  const campaignIds = clickedCampaigns.map((t) => t.affiliateCampaignId).filter((x): x is string => x !== null);
  const missingWithClicks =
    campaignIds.length === 0 ? 0 : await prisma.player.count({ where: { subId: null, createdAt: { gte: since }, affiliateCampaignId: { in: campaignIds } } });
  return evaluateSubIdHealth({ postback, timeMatch, missingWithClicks, offerClicks });
}
