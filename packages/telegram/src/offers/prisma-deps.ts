import { jsonIds } from "@linkaffipro/core";
import { prisma, recordEvent } from "@linkaffipro/db";
import { emitAutomationEvent } from "@linkaffipro/queue";
import type { OfferDeps } from "./deps";
import { pickCampaignOffer } from "./logic";

function mediaKindOf(mimeType: string): "photo" | "video" | "animation" | "document" {
  if (mimeType === "image/gif") return "animation";
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

export const prismaOfferDeps: OfferDeps = {
  async memberStarted(botId, from) {
    const data = {
      firstName: from.first_name ?? null,
      lastName: from.last_name ?? null,
      username: from.username ?? null,
      languageCode: from.language_code ?? null,
      isPremium: from.is_premium ?? false,
      lastSeenAt: new Date(),
    };
    const member = await prisma.member.upsert({
      where: { telegramUserId: BigInt(from.id) },
      create: { telegramUserId: BigInt(from.id), ...data },
      update: data,
      select: { id: true },
    });
    const now = new Date();
    await prisma.memberBotState.upsert({
      where: { memberId_botId: { memberId: member.id, botId } },
      create: { memberId: member.id, botId, canDm: true, startedAt: now },
      update: { canDm: true, startedAt: now, blockedAt: null },
    });
    return { memberId: member.id };
  },

  async resolveOffer(slug, postCode) {
    const link = await prisma.trackingLink.findUnique({
      where: { slug },
      include: {
        affiliateCampaign: { select: { trackingUrlTemplate: true, isActive: true } },
        channel: { select: { id: true, language: true } },
        campaign: { select: { id: true, affiliateCampaignIds: true } },
      },
    });
    if (!link || !link.isActive || link.kind !== "OFFER") return null;
    let template = link.affiliateCampaign?.trackingUrlTemplate ?? link.destinationTemplate;
    // Bouton rattaché à une de nos campagnes : le lien Link Affi suit la campagne. Si l'offre du bouton en a été
    // retirée (ou est désactivée), on prend la première offre active de la campagne, et on le journalise.
    if (link.campaign) {
      const ids = jsonIds(link.campaign.affiliateCampaignIds);
      const offers = ids.length
        ? await prisma.affiliateCampaign.findMany({
            where: { id: { in: ids } },
            select: { id: true, trackingUrlTemplate: true, isActive: true },
          })
        : [];
      const picked = pickCampaignOffer(link.affiliateCampaignId, ids, offers);
      if (picked?.replaced) {
        template = picked.template;
        await recordEvent({
          type: "offer.campaign_fallback",
          channelId: link.channelId,
          payload: {
            trackingLinkId: link.id,
            campaignId: link.campaign.id,
            fromAffiliateCampaignId: link.affiliateCampaignId,
            toAffiliateCampaignId: picked.offerId,
          },
        });
      }
    }
    if (!template) return null;
    let postId: string | null = link.postId;
    let channelId: string | null = link.channelId;
    let channelLanguage: string | null = link.channel?.language ?? null;
    if (postCode) {
      const post = await prisma.post.findUnique({
        where: { code: postCode },
        select: { id: true, channelId: true, channel: { select: { language: true } } },
      });
      if (post) {
        postId = post.id;
        channelId = post.channelId;
        channelLanguage = post.channel.language;
      }
    }
    return {
      trackingLinkId: link.id,
      destinationTemplate: template,
      postId,
      channelId,
      channelLanguage,
    };
  },

  async recordOfferClick(input) {
    const click = await prisma.click.create({
      data: {
        trackingLinkId: input.trackingLinkId,
        subId: input.subId,
        memberId: input.memberId,
        postId: input.postId,
        botId: input.botId,
        destination: input.destination,
      },
      select: { id: true },
    });
    const previous = await prisma.click.count({
      where: {
        trackingLinkId: input.trackingLinkId,
        memberId: input.memberId,
        id: { not: click.id },
      },
    });
    await prisma.trackingLink.update({
      where: { id: input.trackingLinkId },
      data: {
        clicks: { increment: 1 },
        uniqueClicks: previous === 0 ? { increment: 1 } : undefined,
      },
    });
    if (input.postId) {
      await prisma.postStats.upsert({
        where: { postId: input.postId },
        create: { postId: input.postId, offerClicks: 1, clicks: 1, uniqueClickers: 1 },
        update: {
          offerClicks: { increment: 1 },
          clicks: { increment: 1 },
          uniqueClickers: previous === 0 ? { increment: 1 } : undefined,
        },
      });
    }
    await recordEvent({
      type: "click.offer",
      memberId: input.memberId,
      botId: input.botId,
      payload: {
        clickId: click.id,
        subId: input.subId,
        trackingLinkId: input.trackingLinkId,
        postId: input.postId,
      },
    });
    const post = input.postId
      ? await prisma.post
          .findUnique({
            where: { id: input.postId },
            select: { channelId: true, categoryId: true },
          })
          .catch(() => null)
      : null;
    const tl = await prisma.trackingLink
      .findUnique({ where: { id: input.trackingLinkId }, select: { affiliateCampaignId: true } })
      .catch(() => null);
    await emitAutomationEvent("OFFER_CLICKED", input.memberId, {
      postId: input.postId,
      channelId: post?.channelId ?? null,
      categoryId: post?.categoryId ?? null,
      affiliateCampaignId: tl?.affiliateCampaignId ?? null,
      clickId: click.id,
      botId: input.botId,
    });
    return { clickId: click.id };
  },

  async offerReplyTexts(channelId, lang, botId) {
    if (!channelId) return null;
    const seq = await prisma.sequence.findFirst({
      where: { channelId, trigger: "OFFER_REPLY", isActive: true },
      include: {
        steps: {
          orderBy: { order: "asc" },
          take: 1,
          include: {
            mediaAsset: {
              select: {
                mimeType: true,
                telegramFiles: botId
                  ? { where: { botId }, select: { telegramFileId: true } }
                  : false,
              },
            },
          },
        },
      },
    });
    const step = seq?.steps[0];
    if (!step) return null;
    const texts = (step.texts ?? {}) as Record<string, string>;
    const text = texts[lang] ?? texts.fr ?? Object.values(texts)[0];
    if (!text) return null;
    const buttons = (step.buttons ?? []) as Array<Array<{ text?: string }>>;
    const button = buttons[0]?.[0]?.text ?? (lang === "en" ? "Open the offer" : "Ouvrir l'offre");
    // Média : seulement si Telegram le connaît déjà pour ce bot (pas d'upload depuis le webhook, trop lent) ;
    // le file_id est mémorisé dès le premier envoi par le worker (message programmé, envoi groupé, test).
    const asset = step.mediaAsset;
    const fileId =
      asset && Array.isArray(asset.telegramFiles)
        ? asset.telegramFiles[0]?.telegramFileId
        : undefined;
    const media = asset && fileId ? { fileId, kind: mediaKindOf(asset.mimeType) } : null;
    return { text, button, media };
  },
};
