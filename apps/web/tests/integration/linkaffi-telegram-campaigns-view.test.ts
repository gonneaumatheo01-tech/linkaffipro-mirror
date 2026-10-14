/**
 * Phase 13 (synchro, site) sur la base réelle : bloc « Écarts avec Link Affi » de Réglages → Connexions. Nos liens
 * d'affiliés (LINKAFFI) en base font foi pour « campagne inconnue ici », et un réglage de forme minimale (données de
 * démonstration, sans sources ni repères) n'annonce pas comme manquants des chiffres qui sont là.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { loadTelegramCampaignsView } from "@/lib/linkaffi/telegram-campaigns";
import { createBotAndChannel, resetDb } from "./helpers";

const KEY = "linkaffi.telegramCampaigns";
const NOW = new Date();

beforeAll(async () => {
  await resetDb();
  const { bot, channel } = await createBotAndChannel({ chatId: -100_915_001n });
  const other = await prisma.channel.create({
    data: {
      telegramChatId: -100_915_002n,
      title: "Canal Paris",
      type: "CHANNEL",
      language: "fr",
      primaryBotId: bot.id,
      isTest: true,
    },
  });
  // Même campagne sur deux canaux (lien désactivé sur l'un, actif sur l'autre) : une seule clé.
  for (const [url, channelId, isActive] of [
    ["https://t.me/+DemoPaulAncien", channel.id, false],
    ["https://t.me/+DemoPaulActif", other.id, true],
  ] as const)
    await prisma.inviteLink.create({
      data: {
        channelId,
        botId: bot.id,
        telegramInviteLink: url,
        name: "Paul — Telegram",
        kind: "LINKAFFI",
        linkaffiCampaignKey: "demotgpaul01",
        linkaffiCampaignName: "Paul — Telegram",
        linkaffiAffiliateId: "aff-paul",
        linkaffiAffiliateName: "Paul",
        isActive,
      },
    });
  // Lien d'une pub : jamais une campagne d'affilié.
  await prisma.inviteLink.create({
    data: {
      channelId: channel.id,
      botId: bot.id,
      telegramInviteLink: "https://t.me/+PubTikTok01",
      name: "Pub TikTok",
      kind: "AD_ENTRY",
    },
  });
  const value = {
    syncedAt: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
    available: true,
    campaigns: {
      demotgpaul01: {
        affiliateId: "aff-paul",
        affiliateName: "Paul",
        name: "Paul — Telegram",
        inviteLinkId: "x",
        isActive: true,
        clicks: 41,
        members: 12,
        registrations: 4,
        ftds: 1,
      },
      zoeailleurs1: {
        affiliateId: "aff-zoe",
        affiliateName: "Zoé",
        name: "Zoé — Telegram",
        inviteLinkId: "y",
        clicks: 3,
        members: 2,
        registrations: 0,
        ftds: 0,
      },
    },
    divergences: [
      { campaignKey: "demotgpaul01", field: "ftds", ours: 2, theirs: 1 },
      { campaignKey: "zoeailleurs1", field: "members", ours: 0, theirs: 2 },
    ],
  };
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: KEY } });
  await resetDb();
});

describe("écarts avec Link Affi (base réelle)", () => {
  it("campagne dont nous avons un lien : connue ici ; sinon « inconnue ici » ; rien d'annoncé manquant", async () => {
    const view = await loadTelegramCampaignsView(NOW);
    expect(view.status).toBe("divergent");
    expect(view.missing).toEqual([]);
    expect(view.stale).toBe(false);
    expect(Object.fromEntries(view.divergences.map((d) => [d.campaignKey, d.unknownHere]))).toEqual(
      { demotgpaul01: false, zoeailleurs1: true },
    );
    expect(view.campaigns.demotgpaul01?.clicks).toBe(41);
  });
});
