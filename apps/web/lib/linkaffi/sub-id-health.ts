import { prisma } from "@linkaffipro/db";
import { HEALTH_WINDOW_DAYS, evaluateSubIdHealth, type SubIdHealth } from "@linkaffipro/linkaffi";

/**
 * Santé du sub-ID sur 7 jours glissants, à partir de nos tables (mêmes requêtes que l'alerte `subid_health` du worker,
 * apps/worker/src/maintenance/alerts.ts) :
 * - joueurs rattachés par `postback` / `time_match` ;
 * - joueurs sans sub-ID appartenant à une offre sur laquelle nous avons envoyé des clics d'offre avec sub-ID ;
 * - clics d'offre avec sub-ID envoyés (contexte).
 * Les joueurs sont comptés à leur date d'inscription Link Affi (`registeredAt`), jamais à leur date d'import
 * (`createdAt`) : une resynchronisation complète ne fait pas passer tout l'historique pour « des 7 derniers jours ».
 */
export async function computeSubIdHealth(now = new Date()): Promise<SubIdHealth> {
  const since = new Date(now.getTime() - HEALTH_WINDOW_DAYS * 24 * 3600 * 1000);
  const [postback, timeMatch, offerClicks, clickedCampaigns] = await Promise.all([
    prisma.player.count({ where: { subIdSource: "postback", registeredAt: { gte: since } } }),
    prisma.player.count({ where: { subIdSource: "time_match", registeredAt: { gte: since } } }),
    prisma.click.count({ where: { subId: { not: null }, createdAt: { gte: since } } }),
    prisma.trackingLink.findMany({
      where: {
        affiliateCampaignId: { not: null },
        clickRecords: { some: { subId: { not: null }, createdAt: { gte: since } } },
      },
      select: { affiliateCampaignId: true },
      distinct: ["affiliateCampaignId"],
    }),
  ]);
  const campaignIds = clickedCampaigns
    .map((t) => t.affiliateCampaignId)
    .filter((x): x is string => x !== null);
  const missingWithClicks =
    campaignIds.length === 0
      ? 0
      : await prisma.player.count({
          where: {
            subId: null,
            registeredAt: { gte: since },
            affiliateCampaignId: { in: campaignIds },
            // Joueurs agrégés (offres sans fiches joueurs) : jamais d'identifiant de suivi, ce n'est pas une panne.
            OR: [{ subIdSource: null }, { subIdSource: { not: "aggregate" } }],
          },
        });
  return evaluateSubIdHealth({ postback, timeMatch, missingWithClicks, offerClicks });
}
