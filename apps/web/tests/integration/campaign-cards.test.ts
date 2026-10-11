/**
 * Page Campagnes en cartes (phase 9) : lectures sur base réelle.
 * - mini-tendances lues dans DailyStat (dimension campaign:<id>), une série complète par jour de la période ;
 * - total des campagnes affichées sans double compte : un joueur d'une offre partagée par deux campagnes n'est compté
 *   qu'une fois (même calcul que la ligne Total historique, `totalsForScopes`) ;
 * - gains (phase 10) = commissions (CPA du joueur + part de revshare de l'offre) − dépense pub, jamais le revenu net.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  loadCampaignTrendsUncached,
  totalForCampaignsUncached,
} from "@/lib/campaigns/card-queries";
import { listCampaignsUncached } from "@/lib/campaigns/queries";
import { periodDayKeys, resolvePeriod, shiftDay } from "@/lib/periods";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const period = resolvePeriod({ range: "7d" });
const keys = periodDayKeys(period);
let A = "";
let B = "";
let C = "";

async function clean() {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("refuse de tourner hors de la base de test");
  await prisma.dailyStat.deleteMany({ where: { dimension: { startsWith: "campaign:" } } });
  await prisma.affiliateDailyStat.deleteMany({ where: { externalId: { startsWith: "k-" } } });
  await prisma.playerEvent.deleteMany({
    where: { player: { externalPlayerId: { startsWith: "k-" } } },
  });
  await prisma.player.deleteMany({ where: { externalPlayerId: { startsWith: "k-" } } });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: "K · " } } });
  await prisma.affiliateCampaign.deleteMany({ where: { externalId: { startsWith: "K-" } } });
  await prisma.affiliateProgram.deleteMany({ where: { externalId: "k-prog" } });
}

beforeAll(async () => {
  await clean();
  const program = await prisma.affiliateProgram.create({
    data: { name: "K prog", externalId: "k-prog" },
  });
  const offer = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "K-SHARED",
      name: "Offre partagée",
      trackingUrlTemplate: "https://linkaffi.me/go/K-SHARED?sub_id={subid}",
    },
  });
  // A et B partagent la même offre ; C n'a rien.
  A = (
    await prisma.campaign.create({
      data: { name: "K · A", affiliateCampaignIds: [offer.id], status: "ACTIVE" },
    })
  ).id;
  B = (
    await prisma.campaign.create({
      data: { name: "K · B", affiliateCampaignIds: [offer.id], status: "PAUSED" },
    })
  ).id;
  C = (await prisma.campaign.create({ data: { name: "K · C" } })).id;
  const p = await prisma.player.create({
    data: {
      affiliateCampaignId: offer.id,
      externalPlayerId: "k-p1",
      registeredAt: daysAgo(3),
      ftdAt: daysAgo(2),
      ngr: 0,
    },
  });
  await prisma.playerEvent.createMany({
    data: [
      { playerId: p.id, type: "FTD", amount: 50, currency: "EUR", occurredAt: daysAgo(2) },
      { playerId: p.id, type: "NGR", amount: 30, currency: "EUR", occurredAt: daysAgo(2) },
      {
        playerId: p.id,
        type: "CPA",
        amount: 70,
        currency: "EUR",
        occurredAt: daysAgo(2),
        externalId: "cpa:k-p1",
      },
    ],
  });
  // Part de revshare de l'offre partagée : comptée une fois dans le total, dans chaque campagne qui la porte.
  await prisma.affiliateDailyStat.create({
    data: {
      externalId: "k-st-1",
      affiliateCampaignId: offer.id,
      date: new Date(`${keys.at(-2)}T00:00:00Z`),
      revshareRevenue: 12.5,
    },
  });
  await prisma.adCost.createMany({
    data: [
      {
        campaignId: A,
        levelKey: `campaign:${A}`,
        date: new Date(`${keys.at(-2)}T00:00:00Z`),
        spend: 10,
        source: "MANUAL",
      },
      {
        campaignId: B,
        levelKey: `campaign:${B}`,
        date: new Date(`${keys.at(-2)}T00:00:00Z`),
        spend: 5,
        source: "MANUAL",
      },
    ],
  });
  await prisma.dailyStat.createMany({
    data: [
      {
        date: new Date(`${keys[0]}T00:00:00Z`),
        dimension: `campaign:${A}`,
        campaignId: A,
        approved: 2,
        ftds: 0,
        spend: 3,
        ngr: 1,
      },
      {
        date: new Date(`${keys.at(-1)}T00:00:00Z`),
        dimension: `campaign:${A}`,
        campaignId: A,
        approved: 4,
        ftds: 1,
        spend: 2.5,
        // Gains du jour = commissions − dépense = 10 − 2,5 ; le revenu net (900 €) n'y entre jamais.
        ngr: 900,
        commissions: 10,
      },
      // Hors période : ignoré.
      {
        date: new Date(`${shiftDay(keys[0]!, -1)}T00:00:00Z`),
        dimension: `campaign:${A}`,
        campaignId: A,
        approved: 99,
      },
    ],
  });
});

afterAll(clean);

describe("campagnes en cartes : lectures", () => {
  it("mini-tendances : une valeur par jour de la période, 0 les jours sans ligne", async () => {
    const t = await loadCampaignTrendsUncached([A, C], period);
    expect(t[A]!.members).toHaveLength(7);
    expect(t[A]!.members[0]).toBe(2);
    expect(t[A]!.members.at(-1)).toBe(4);
    expect(t[A]!.members.reduce((s, v) => s + v, 0)).toBe(6);
    expect(t[A]!.gains.at(-1)).toBe(7.5);
    expect(t[A]!.ftds.at(-1)).toBe(1);
    expect(t[C]!.members).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("total des campagnes affichées : le joueur de l'offre partagée compte une fois, la dépense deux lignes", async () => {
    const both = await totalForCampaignsUncached([A, B], period, true);
    expect(both.total.ftds).toBe(1);
    expect(both.total.registrations).toBe(1);
    expect(both.total.spend).toBe(15);
    expect(both.total.revenue).toBe(30);
    // CPA 70 + revshare 12,50 (offre partagée, comptée une fois) = 82,50 ; gains = 82,50 − 15.
    expect(both.total).toMatchObject({
      cpaCommissions: 70,
      revshareCommissions: 12.5,
      commissions: 82.5,
    });
    expect(both.total.gains).toBe(67.5);
    expect(both.previousTotal).not.toBeNull();
    expect(both.previousTotal!.spend).toBe(0);
    const onlyA = await totalForCampaignsUncached([A], period, false);
    expect(onlyA.total.spend).toBe(10);
    expect(onlyA.total.ftds).toBe(1);
    expect(onlyA.total.gains).toBe(72.5);
    expect(onlyA.previousTotal).toBeNull();
  });

  it("même total que la liste quand toutes les campagnes sont affichées", async () => {
    const list = await listCampaignsUncached(period, false);
    const ours = list.rows.filter((r) => [A, B, C].includes(r.id));
    expect(ours).toHaveLength(3);
    const all = await totalForCampaignsUncached(
      list.rows.map((r) => r.id),
      period,
      false,
    );
    expect(all.total).toEqual(list.total);
    // La somme des lignes compterait le joueur partagé deux fois.
    expect(ours.reduce((s, r) => s + r.metrics.ftds, 0)).toBe(2);
  });
});
