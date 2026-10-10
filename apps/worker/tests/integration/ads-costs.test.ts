/**
 * Synchro des pubs sur base réelle : l'API a priorité sur les coûts CSV et saisis d'une même campagne et d'un même
 * jour (la dépense n'est jamais comptée deux fois après l'adoption d'une de nos campagnes), les jours que l'API ne
 * couvre pas gardent leurs coûts CSV, et une pub rattachée automatiquement à un lien d'entrée fait entrer ce lien
 * dans la campagne.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { applyInsights } from "../../src/ads/apply";
import { createBotAndChannel, resetDb } from "./helpers";

const DAY = "2026-10-05";
const OTHER_DAY = "2026-10-04";
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function cleanAds() {
  await prisma.adCost.deleteMany();
  await prisma.ad.deleteMany();
  await prisma.adSet.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.adAccountConnection.deleteMany({ where: { externalId: "act-int-test" } });
}

let connection: { id: string; platform: "TIKTOK"; currency: string; name: string };
let ours: { id: string };
let inviteLinkId: string;
let trackingLinkId: string;

beforeAll(async () => {
  await cleanAds();
  await resetDb();
  const conn = await prisma.adAccountConnection.create({
    data: {
      platform: "TIKTOK",
      externalId: "act-int-test",
      name: "Compte TT test",
      tokenEncrypted: "x",
    },
  });
  connection = { id: conn.id, platform: "TIKTOK", currency: "EUR", name: conn.name };
  ours = await prisma.campaign.create({
    data: {
      name: "TT-casinoX-FR-2026-10",
      connectionId: conn.id,
      adPlatform: "TIKTOK",
      affiliateCampaignIds: ["aff1"],
      channelIds: [],
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const set = await prisma.adSet.create({ data: { campaignId: ours.id, name: "Groupe CSV" } });
  const ad = await prisma.ad.create({ data: { adSetId: set.id, name: "Pub CSV" } });
  // Coûts importés par CSV (niveau campagne) et saisis (niveau pub, sans campaignId) avant le rattachement.
  await prisma.adCost.createMany({
    data: [
      {
        levelKey: `campaign:${ours.id}`,
        campaignId: ours.id,
        date: day(DAY),
        spend: 40,
        source: "CSV",
      },
      { levelKey: `ad:${ad.id}`, adId: ad.id, date: day(DAY), spend: 5, source: "MANUAL" },
      {
        levelKey: `campaign:${ours.id}`,
        campaignId: ours.id,
        date: day(OTHER_DAY),
        spend: 30,
        source: "CSV",
      },
    ],
  });
  const { bot, channel } = await createBotAndChannel();
  const invite = await prisma.inviteLink.create({
    data: {
      channelId: channel.id,
      botId: bot.id,
      telegramInviteLink: "https://t.me/+ads-int-test",
      name: "Pub TT 1",
      kind: "AD_ENTRY",
    },
  });
  const tl = await prisma.trackingLink.create({
    data: {
      slug: "adsint01",
      kind: "AD_ENTRY",
      label: "Pub TT 1",
      destinationTemplate: "https://t.me/+ads-int-test",
      inviteLinkId: invite.id,
    },
  });
  inviteLinkId = invite.id;
  trackingLinkId = tl.id;
});

afterAll(async () => {
  await cleanAds();
  await resetDb();
});

describe("synchro des pubs : priorité de l'API, rattachement des liens (base réelle)", () => {
  it("adoption par le nom + coûts API du même jour : CSV et saisie du jour retirés, l'autre jour gardé", async () => {
    const report = await applyInsights(
      connection,
      [
        {
          date: DAY,
          campaignExternalId: "ext-int-1",
          campaignName: "tt-casinox-fr-2026-10",
          adSetExternalId: "set-int-1",
          adSetName: "Groupe TT",
          adExternalId: "ad-int-1",
          adName: "Pub TT 1",
          spend: 42,
          currency: "EUR",
          impressions: 1000,
          clicks: 20,
        },
      ],
      { EUR: 1 } as never,
    );
    expect(report.adopted).toBe(1);
    expect(report.replacedCosts).toBe(2);
    const costs = await prisma.adCost.findMany({
      where: {
        OR: [
          { campaignId: ours.id },
          { adSet: { campaignId: ours.id } },
          { ad: { adSet: { campaignId: ours.id } } },
        ],
      },
      select: { date: true, source: true, spend: true },
      orderBy: [{ date: "asc" }, { source: "asc" }],
    });
    expect(
      costs.map((c) => [c.date.toISOString().slice(0, 10), c.source, Number(c.spend)]),
    ).toEqual([
      [OTHER_DAY, "CSV", 30],
      [DAY, "API", 42],
    ]);
    const ev = await prisma.event.findFirst({ where: { type: "ads.costs_replaced_by_api" } });
    expect(ev?.payload).toMatchObject({ campaignId: ours.id, removed: 2, spend: 45 });
  });

  it("la pub rattachée automatiquement à son lien d'entrée fait entrer ce lien dans la campagne", async () => {
    const ad = await prisma.ad.findFirst({ where: { externalId: "ad-int-1" } });
    expect(ad?.inviteLinkId).toBe(inviteLinkId);
    const [invite, tl] = await Promise.all([
      prisma.inviteLink.findUnique({ where: { id: inviteLinkId } }),
      prisma.trackingLink.findUnique({ where: { id: trackingLinkId } }),
    ]);
    expect(invite?.campaignId).toBe(ours.id);
    expect(tl?.campaignId).toBe(ours.id);
  });

  it("nouvelle synchro du même jour : rien de plus n'est retiré (idempotente)", async () => {
    const report = await applyInsights(
      connection,
      [
        {
          date: DAY,
          campaignExternalId: "ext-int-1",
          campaignName: "tt-casinox-fr-2026-10",
          spend: 42,
          currency: "EUR",
          impressions: 1000,
          clicks: 20,
        },
      ],
      { EUR: 1 } as never,
    );
    expect(report.replacedCosts).toBe(0);
  });
});
