/**
 * Statistiques (phase 10) sur base réelle : gains = commissions − dépense pub, partout.
 * - Vue d'ensemble (calcul en direct) : commissions = CPA de nos joueurs (+ au crédit, − le jour de l'annulation)
 *   + part de revshare de nos offres ; dépense pub ; gains. Filtre canal : CPA des joueurs du canal seulement (la part
 *   de revshare n'existe que par offre), ni dépense ni gains (une dépense n'appartient pas à un canal).
 * - Pubs (statistiques journalières) : commissions et gains lus dans `DailyStat`, retour sur dépense pub = commissions
 *   ÷ dépense ; jamais le revenu net.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { loadDashboardUncached } from "@/lib/dashboard/queries";
import { loadAdsTable } from "@/lib/dashboard/daily";
import { parisMidnightUtc, periodDayKeys, resolvePeriod, shiftDay } from "@/lib/periods";
import { createBotAndChannel, resetDb } from "./helpers";

const period = resolvePeriod({ range: "7d" });
const keys = periodDayKeys(period);
const day = (k: string) => new Date(`${k}T00:00:00Z`);
const noon = (k: string) => new Date(parisMidnightUtc(k).getTime() + 12 * 3_600_000);
const metric = (d: Awaited<ReturnType<typeof loadDashboardUncached>>, key: string) =>
  d.metrics.find((m) => m.key === key);

let campaignId = "";
let channelId = "";

async function clean() {
  await prisma.dailyStat.deleteMany();
  await prisma.affiliateDailyStat.deleteMany();
  await prisma.adCost.deleteMany();
  await prisma.campaign.deleteMany();
  await resetDb();
}

beforeAll(async () => {
  await clean();
  const { channel } = await createBotAndChannel({
    chatId: BigInt(-1001234507777),
    title: "Canal gains",
  });
  channelId = channel.id;
  const program = await prisma.affiliateProgram.create({
    data: { name: "Casino G", externalId: "prog-g" },
  });
  const ours = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "G-OURS",
      name: "Notre offre",
      trackingUrlTemplate: "https://linkaffi.me/go/G?sub_id={subid}",
    },
  });
  const other = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "G-OTHER",
      name: "Autre affilié",
      trackingUrlTemplate: "https://linkaffi.me/go/H?sub_id={subid}",
    },
  });
  campaignId = (
    await prisma.campaign.create({
      data: {
        name: "Gains test",
        vertical: "SPORTS",
        affiliateCampaignIds: [ours.id],
        channelIds: [channel.id],
      },
    })
  ).id;
  // Joueur venu d'un message du canal (clic) : CPA +70 créditée, puis annulée deux jours plus tard.
  const bot = await prisma.bot.findFirstOrThrow();
  const post = await prisma.post.create({
    data: {
      code: "GAINSP01",
      channelId: channel.id,
      botId: bot.id,
      status: "SENT",
      text: "Offre",
      sentAt: noon(keys[0]!),
    },
  });
  const link = await prisma.trackingLink.create({
    data: {
      slug: "gainsof1",
      kind: "OFFER",
      label: "Offre",
      destinationTemplate: ours.trackingUrlTemplate,
      affiliateCampaignId: ours.id,
      postId: post.id,
    },
  });
  const click = await prisma.click.create({
    data: {
      trackingLinkId: link.id,
      subId: "SUBGAINS001",
      postId: post.id,
      createdAt: noon(keys[0]!),
    },
  });
  const p1 = await prisma.player.create({
    data: {
      affiliateCampaignId: ours.id,
      externalPlayerId: "g1",
      clickId: click.id,
      registeredAt: noon(keys[1]!),
    },
  });
  // Joueur sans clic de notre offre : CPA +50.
  const p2 = await prisma.player.create({
    data: { affiliateCampaignId: ours.id, externalPlayerId: "g2" },
  });
  // Autre affilié : jamais compté.
  const p3 = await prisma.player.create({
    data: { affiliateCampaignId: other.id, externalPlayerId: "g3" },
  });
  await prisma.playerEvent.createMany({
    data: [
      {
        playerId: p1.id,
        type: "CPA",
        amount: 70,
        occurredAt: noon(keys[2]!),
        externalId: "cpa:g1",
      },
      {
        playerId: p1.id,
        type: "CPA_REVERSAL",
        amount: -70,
        occurredAt: noon(keys[4]!),
        externalId: "cpa_reversal:g1",
      },
      {
        playerId: p2.id,
        type: "CPA",
        amount: 50,
        occurredAt: noon(keys[4]!),
        externalId: "cpa:g2",
      },
      {
        playerId: p3.id,
        type: "CPA",
        amount: 999,
        occurredAt: noon(keys[4]!),
        externalId: "cpa:g3",
      },
      // Revenu net de nos joueurs : volume seulement, jamais dans les gains.
      { playerId: p2.id, type: "NGR", amount: 800, occurredAt: noon(keys[4]!) },
    ],
  });
  await prisma.affiliateDailyStat.createMany({
    data: [
      {
        externalId: "g-st-1",
        affiliateCampaignId: ours.id,
        date: day(keys[3]!),
        revshareRevenue: 13.0926,
      },
      {
        externalId: "g-st-2",
        affiliateCampaignId: other.id,
        date: day(keys[3]!),
        revshareRevenue: 400,
      },
      // Avant la période, créée avant : hors période.
      {
        externalId: "g-st-3",
        affiliateCampaignId: ours.id,
        date: day(shiftDay(keys[0]!, -3)),
        sourceCreatedAt: parisMidnightUtc(shiftDay(keys[0]!, -3)),
        revshareRevenue: 99,
      },
    ],
  });
  await prisma.adCost.create({
    data: {
      campaignId,
      levelKey: `campaign:${campaignId}`,
      date: day(keys[3]!),
      spend: 40,
      source: "MANUAL",
    },
  });
  // Statistiques journalières écrites par le worker (dimension de la campagne et « toutes campagnes »).
  for (const dimension of [`campaign:${campaignId}`, "campaigns"])
    await prisma.dailyStat.createMany({
      data: [
        {
          date: day(keys[2]!),
          dimension,
          ...(dimension === "campaigns" ? {} : { campaignId }),
          cpaCommissions: 70,
          commissions: 70,
        },
        {
          date: day(keys[3]!),
          dimension,
          ...(dimension === "campaigns" ? {} : { campaignId }),
          revshareCommissions: 13.09,
          commissions: 13.09,
          spend: 40,
          ngr: 900,
        },
        {
          date: day(keys[4]!),
          dimension,
          ...(dimension === "campaigns" ? {} : { campaignId }),
          cpaCommissions: -20,
          commissions: -20,
          ngr: 800,
        },
      ],
    });
});

afterAll(clean);

describe("vue d'ensemble : commissions, dépense pub et gains", () => {
  it("toutes nos données : CPA nette + revshare de nos offres − dépense ; jour par jour", async () => {
    const d = await loadDashboardUncached({ period, vertical: "", channelId: "" });
    expect(d.metrics.filter((m) => m.group === "argent").map((m) => m.key)).toEqual([
      "entryClicks",
      "offerClicks",
      "registrations",
      "ftds",
      "depositAmount",
      "ngr",
      "spend",
      "commissions",
      "gains",
    ]);
    // CPA : 70 − 70 + 50 = 50 ; revshare 13,09 → 63,09 ; dépense 40 ; gains 23,09. Revenu net : 800 (volume).
    expect(metric(d, "commissions")!.series.total).toBeCloseTo(63.09, 2);
    expect(metric(d, "spend")!.series.total).toBe(40);
    expect(metric(d, "gains")!.series.total).toBeCloseTo(23.09, 2);
    expect(metric(d, "ngr")!.series.total).toBe(800);
    const commissions = metric(d, "commissions")!.series.values;
    expect(commissions[2]).toBe(70);
    expect(commissions[3]).toBe(13.09);
    // Jour de l'annulation : −70 + 50.
    expect(commissions[4]).toBe(-20);
    expect(metric(d, "gains")!.series.values[3]).toBeCloseTo(-26.91, 2);
  });

  it("filtre campagne et univers : mêmes chiffres (une seule campagne, Paris sportifs)", async () => {
    const byCampaign = await loadDashboardUncached({
      period,
      vertical: "",
      channelId: "",
      campaignId,
    });
    expect(metric(byCampaign, "commissions")!.series.total).toBeCloseTo(63.09, 2);
    expect(metric(byCampaign, "gains")!.series.total).toBeCloseTo(23.09, 2);
    const byVertical = await loadDashboardUncached({ period, vertical: "SPORTS", channelId: "" });
    expect(metric(byVertical, "commissions")!.series.total).toBeCloseTo(63.09, 2);
    const casino = await loadDashboardUncached({ period, vertical: "CASINO", channelId: "" });
    expect(metric(casino, "commissions")!.series.total).toBe(0);
    expect(metric(casino, "spend")!.series.total).toBe(0);
  });

  it("filtre canal : primes des joueurs venus du canal seulement, ni dépense ni gains", async () => {
    const d = await loadDashboardUncached({ period, vertical: "", channelId });
    // Seul le joueur du clic depuis le message du canal : +70 puis −70.
    expect(metric(d, "commissions")!.series.total).toBe(0);
    expect(metric(d, "commissions")!.series.values[2]).toBe(70);
    expect(metric(d, "commissions")!.note).toMatch(/primes des joueurs/i);
    expect(metric(d, "spend")).toBeUndefined();
    expect(metric(d, "gains")).toBeUndefined();
  });
});

describe("Pubs : commissions et gains des statistiques journalières", () => {
  it("ligne de la campagne et total : gains = commissions − dépense, retour sur dépense pub = commissions ÷ dépense", async () => {
    const t = await loadAdsTable(period, {});
    const row = t.rows.find((r) => r.campaignId === campaignId)!;
    expect(row.totals.commissions).toBeCloseTo(63.09, 2);
    expect(row.totals.cpaCommissions).toBe(50);
    expect(row.totals.revshareCommissions).toBe(13.09);
    expect(row.derived.gains).toBeCloseTo(23.09, 2);
    // Rapport exact (arrondi à l'affichage seulement).
    expect(row.derived.roas).toBeCloseTo(1.58, 2);
    expect(t.total.commissions).toBeCloseTo(63.09, 2);
    expect(t.totalDerived.gains).toBeCloseTo(23.09, 2);
    // Jour par jour : la somme des jours fait le total.
    expect(t.daily.reduce((s, d) => s + d.commissions, 0)).toBeCloseTo(63.09, 2);
  });
});
