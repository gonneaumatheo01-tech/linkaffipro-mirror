import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import type { InlineKeyboardMarkup } from "grammy/types";
import { POST } from "@/app/api/telegram/[botId]/route";
import { capturedJobs, createBotAndChannel, ctx, flushAfter, installFakeTelegram, resetDb, webhookRequest, type TelegramCall } from "./helpers";

const SLUG = "offtest1";
const POST_CODE = "P0STCODE";
const USER_ID = 6262;

function startUpdate(payload: string, updateId: number) {
  const text = `/start ${payload}`;
  return {
    update_id: updateId,
    message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: USER_ID, type: "private", first_name: "Léo" }, from: { id: USER_ID, is_bot: false, first_name: "Léo", language_code: "fr" }, text, entities: [{ type: "bot_command", offset: 0, length: 6 }] },
  };
}

describe("offre personnalisée /start o<slug>_<code> (webhook, base réelle)", () => {
  let botId = "";
  let postId = "";
  let trackingLinkId = "";
  let calls: TelegramCall[] = [];

  beforeAll(async () => {
    await resetDb();
    const { bot, channel } = await createBotAndChannel();
    botId = bot.id;
    const program = await prisma.affiliateProgram.create({ data: { name: "Casino test", source: "LINKAFFI", externalId: "cas-1" } });
    const campaign = await prisma.affiliateCampaign.create({ data: { programId: program.id, externalId: "camp-1", campaignKey: "KEY1", name: "Campagne test", trackingUrlTemplate: "https://linkaffi.me/go/KEY1?sub_id={subid}" } });
    const post = await prisma.post.create({ data: { code: POST_CODE, channelId: channel.id, botId: bot.id, status: "SENT", text: "Bonus du jour", sentAt: new Date() } });
    postId = post.id;
    const link = await prisma.trackingLink.create({ data: { slug: SLUG, kind: "OFFER", destinationTemplate: campaign.trackingUrlTemplate, label: "Offre test", affiliateCampaignId: campaign.id, postId: post.id, channelId: channel.id } });
    trackingLinkId = link.id;
    calls = installFakeTelegram(getOrCreateBot(bot, prismaTelegramDeps).api);
  });

  it("répond avec un lien personnalisé portant un sub-ID et enregistre le clic", async () => {
    const res = await POST(webhookRequest(startUpdate(`o${SLUG}_${POST_CODE}`, 20)), ctx({ botId }));
    expect(res.status).toBe(200);
    await flushAfter();

    const member = await prisma.member.findUnique({ where: { telegramUserId: BigInt(USER_ID) }, include: { botStates: true } });
    expect(member?.firstName).toBe("Léo");
    expect(member?.botStates[0]?.canDm).toBe(true);

    // Réponse privée : texte par défaut + bouton vers Link Affi avec sub_id.
    const sent = calls.find((c) => c.method === "sendMessage");
    expect(sent).toBeDefined();
    expect(sent?.payload.chat_id).toBe(USER_ID);
    expect(String(sent?.payload.text)).toContain("Léo");
    const url = (sent?.payload.reply_markup as InlineKeyboardMarkup).inline_keyboard[0]?.[0] as { url?: string } | undefined;
    expect(url?.url).toMatch(/^https:\/\/linkaffi\.me\/go\/KEY1\?sub_id=[0-9A-Za-z]{12}$/);
    const subId = new URL(url!.url!).searchParams.get("sub_id")!;

    // Clic relié au membre, au message et au lien traqué.
    const click = await prisma.click.findUnique({ where: { subId } });
    expect(click).not.toBeNull();
    expect(click?.memberId).toBe(member!.id);
    expect(click?.postId).toBe(postId);
    expect(click?.trackingLinkId).toBe(trackingLinkId);
    expect(click?.botId).toBe(botId);
    expect(click?.destination).toBe(url!.url);

    const link = await prisma.trackingLink.findUnique({ where: { id: trackingLinkId } });
    expect(link?.clicks).toBe(1);
    expect(link?.uniqueClicks).toBe(1);
    const stats = await prisma.postStats.findUnique({ where: { postId } });
    expect(stats?.offerClicks).toBe(1);
    expect(stats?.uniqueClickers).toBe(1);

    const events = await prisma.event.findMany({ where: { memberId: member!.id } });
    expect(events.map((e) => e.type)).toContain("click.offer");
    const automation = capturedJobs("automations").find((j) => j.data.trigger === "OFFER_CLICKED");
    expect(automation?.data.memberId).toBe(member!.id);
  });

  it("un second clic du même membre crée un nouveau sub-ID sans recompter l'unique", async () => {
    await POST(webhookRequest(startUpdate(`o${SLUG}_${POST_CODE}`, 21)), ctx({ botId }));
    await flushAfter();
    const link = await prisma.trackingLink.findUnique({ where: { id: trackingLinkId } });
    expect(link?.clicks).toBe(2);
    expect(link?.uniqueClicks).toBe(1);
    const subIds = (await prisma.click.findMany({ where: { trackingLinkId }, select: { subId: true } })).map((c) => c.subId);
    expect(new Set(subIds).size).toBe(2);
  });

  it("refuse un slug inconnu sans créer de clic", async () => {
    const before = await prisma.click.count();
    await POST(webhookRequest(startUpdate("oinconnu1", 22)), ctx({ botId }));
    await flushAfter();
    const last = calls.filter((c) => c.method === "sendMessage").at(-1);
    expect(String(last?.payload.text)).toContain("plus valable");
    expect(await prisma.click.count()).toBe(before);
  });
});
