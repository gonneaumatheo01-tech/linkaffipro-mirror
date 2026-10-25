import { prisma, audit, type AdPlatform } from "@linkaffipro/db";
import { createEntryLink } from "@/lib/links/create";
import { DEFAULT_AD_SET_NAME } from "./wizard";

export type CampaignEntryLinkInput = {
  campaignId: string;
  campaignName: string;
  channelId: string;
  platform: AdPlatform;
  /** Nom de la pub précise (ex. « Pub 3 ») ; le lien prend « <campagne> — <pub> ». */
  adName: string;
  linkName?: string;
  /** Groupe de pubs ; par défaut « Groupe 1 » (créé s'il manque). */
  adSetName?: string;
  language?: string;
  userId: string | null;
  via?: "WEB" | "TELEGRAM";
};

/**
 * Crée, pour une campagne, une pub précise et son lien d'entrée : lien d'invitation Telegram (demande d'adhésion) +
 * lien goolink, tous deux rattachés à la campagne (`campaignId`) pour les filtres et les segments d'envoi.
 * Le nom de pub est rendu unique dans le groupe (« Pub 3 (2) ») si besoin.
 */
export async function createCampaignEntryLink(input: CampaignEntryLinkInput) {
  const adSetName = input.adSetName?.trim() || DEFAULT_AD_SET_NAME;
  const adSet =
    (await prisma.adSet.findFirst({ where: { campaignId: input.campaignId, name: adSetName }, select: { id: true } })) ??
    (await prisma.adSet.create({ data: { campaignId: input.campaignId, name: adSetName }, select: { id: true } }));
  const existingNames = new Set((await prisma.ad.findMany({ where: { adSetId: adSet.id }, select: { name: true } })).map((a) => a.name));
  let adName = input.adName.trim() || "Pub";
  for (let i = 2; existingNames.has(adName); i++) adName = `${input.adName.trim() || "Pub"} (${i})`;
  const linkName = (input.linkName?.trim() || `${input.campaignName.trim().slice(0, 50)} — ${adName}`).slice(0, 64);
  const channel = await prisma.channel.findUnique({ where: { id: input.channelId }, select: { language: true } });
  const { inviteLink, trackingLink } = await createEntryLink({
    channelId: input.channelId,
    name: linkName,
    platform: input.platform,
    adCampaignName: input.campaignName,
    adSetName,
    adName,
    language: input.language ?? channel?.language ?? "fr",
    userId: input.userId,
    via: input.via,
  });
  const [, , ad] = await prisma.$transaction([
    prisma.inviteLink.update({ where: { id: inviteLink.id }, data: { campaignId: input.campaignId } }),
    prisma.trackingLink.update({ where: { id: trackingLink.id }, data: { campaignId: input.campaignId } }),
    prisma.ad.create({ data: { adSetId: adSet.id, name: adName, inviteLinkId: inviteLink.id, trackingLinkId: trackingLink.id }, select: { id: true } }),
  ]);
  await audit({ userId: input.userId, action: "ad.created", entityType: "Ad", entityId: ad.id, metadata: { name: adName, campaignId: input.campaignId, inviteLinkId: inviteLink.id, trackingLinkId: trackingLink.id, viaCampaign: true, ...(input.via ? { via: input.via } : {}) } });
  return { ad, adSetId: adSet.id, inviteLink, trackingLink };
}
