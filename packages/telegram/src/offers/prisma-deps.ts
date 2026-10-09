import { prisma, recordEvent } from "@linkaffipro/db";
import type { OfferDeps } from "./deps";

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
      include: { affiliateCampaign: { select: { trackingUrlTemplate: true, isActive: true } }, channel: { select: { id: true, language: true } } },
    });
    if (!link || !link.isActive || link.kind !== "OFFER") return null;
    const template = link.affiliateCampaign?.trackingUrlTemplate ?? link.destinationTemplate;
    if (!template) return null;
    let postId: string | null = link.postId;
    let channelId: string | null = link.channelId;
    let channelLanguage: string | null = link.channel?.language ?? null;
    if (postCode) {
      const post = await prisma.post.findUnique({ where: { code: postCode }, select: { id: true, channelId: true, channel: { select: { language: true } } } });
      if (post) {
        postId = post.id;
        channelId = post.channelId;
        channelLanguage = post.channel.language;
      }
    }
    return { trackingLinkId: link.id, destinationTemplate: template, postId, channelId, channelLanguage };
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
    const previous = await prisma.click.count({ where: { trackingLinkId: input.trackingLinkId, memberId: input.memberId, id: { not: click.id } } });
    await prisma.trackingLink.update({
      where: { id: input.trackingLinkId },
      data: { clicks: { increment: 1 }, uniqueClicks: previous === 0 ? { increment: 1 } : undefined },
    });
    if (input.postId) {
      await prisma.postStats.upsert({
        where: { postId: input.postId },
        create: { postId: input.postId, offerClicks: 1, clicks: 1, uniqueClickers: 1 },
        update: { offerClicks: { increment: 1 }, clicks: { increment: 1 }, uniqueClickers: previous === 0 ? { increment: 1 } : undefined },
      });
    }
    await recordEvent({
      type: "click.offer",
      memberId: input.memberId,
      botId: input.botId,
      payload: { clickId: click.id, subId: input.subId, trackingLinkId: input.trackingLinkId, postId: input.postId },
    });
    return { clickId: click.id };
  },

  async offerReplyTexts(channelId, lang) {
    if (!channelId) return null;
    const seq = await prisma.sequence.findFirst({
      where: { channelId, trigger: "OFFER_REPLY", isActive: true },
      include: { steps: { orderBy: { order: "asc" }, take: 1 } },
    });
    const step = seq?.steps[0];
    if (!step) return null;
    const texts = (step.texts ?? {}) as Record<string, string>;
    const text = texts[lang] ?? texts.fr ?? Object.values(texts)[0];
    if (!text) return null;
    const buttons = (step.buttons ?? []) as Array<Array<{ text?: string }>>;
    const button = buttons[0]?.[0]?.text ?? (lang === "en" ? "Open the offer" : "Ouvrir l'offre");
    return { text, button };
  },
};
