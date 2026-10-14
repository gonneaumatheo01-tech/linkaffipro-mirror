/**
 * Campagnes Telegram d'affiliés connues de la plateforme (liens LINKAFFI créés à la demande de Link Affi) et affiliés
 * qui en découlent (phase 13). Lecture seule ; sans dépendance aux autres lectures du site (pas d'import circulaire :
 * la liste des membres et les statistiques s'en servent).
 */
import { prisma } from "@linkaffipro/db";
import { affiliateOptions, type AffiliateCampaignRef, type AffiliateOption } from "./scope";

/** Toutes les campagnes Telegram d'affiliés (liens LINKAFFI), de la plus ancienne à la plus récente. */
export async function loadAffiliateCampaigns(): Promise<AffiliateCampaignRef[]> {
  const links = await prisma.inviteLink.findMany({
    where: { kind: "LINKAFFI", linkaffiCampaignKey: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      linkaffiCampaignKey: true,
      linkaffiCampaignName: true,
      linkaffiAffiliateId: true,
      linkaffiAffiliateName: true,
      channelId: true,
      isActive: true,
      attributionDays: true,
      createdAt: true,
      channel: { select: { title: true } },
    },
  });
  return links.map((l) => ({
    inviteLinkId: l.id,
    campaignKey: l.linkaffiCampaignKey!,
    campaignName: l.linkaffiCampaignName,
    affiliateId: l.linkaffiAffiliateId,
    affiliateName: l.linkaffiAffiliateName,
    channelId: l.channelId,
    channelTitle: l.channel.title,
    isActive: l.isActive,
    attributionDays: l.attributionDays,
    createdAt: l.createdAt,
  }));
}

/** Affiliés connus par leurs campagnes (filtres « Affilié », exception « un affilié précis »). */
export async function loadAffiliateOptions(): Promise<AffiliateOption[]> {
  return affiliateOptions(await loadAffiliateCampaigns());
}

/** Campagnes (clé + canal) et clés d'un affilié (filtre « Affilié » des statistiques). */
export async function affiliateScope(affiliateId: string): Promise<{
  keys: string[];
  campaigns: Array<{ campaignKey: string; channelId: string }>;
}> {
  const links = await prisma.inviteLink.findMany({
    where: {
      kind: "LINKAFFI",
      linkaffiAffiliateId: affiliateId,
      linkaffiCampaignKey: { not: null },
    },
    select: { linkaffiCampaignKey: true, channelId: true },
  });
  return {
    keys: [...new Set(links.map((l) => l.linkaffiCampaignKey!))],
    campaigns: links.map((l) => ({ campaignKey: l.linkaffiCampaignKey!, channelId: l.channelId })),
  };
}
