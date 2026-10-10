/**
 * Statistiques journalières (phase 8) sur base réelle : seuls « nos » joueurs entrent dans `DailyStat`, les joueurs
 * rattachés par l'offre d'une campagne remplissent la ligne de la campagne, un recalcul complet remet à zéro les
 * anciennes lignes (même avant le premier jour de données), et les rapports Telegram n'ont plus le total Link Affi global.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { DAILY_LAST_RUN_KEY, recomputeDailyStats } from "../../src/stats/daily";
import { dayKey, parisMidnightUtc } from "../../src/stats/aggregate";
import { buildDailyData, buildWeeklyData, shiftKey, utcDateOf } from "../../src/reports/build";
import { resetDb } from "./helpers";

const now = new Date();
const yesterdayKey = shiftKey(dayKey(now), -1);
const yesterdayNoon = new Date(parisMidnightUtc(yesterdayKey).getTime() + 12 * 3_600_000);
const staleKey = shiftKey(dayKey(now), -10);

async function cleanStats() {
  await prisma.dailyStat.deleteMany();
  await prisma.adCost.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.setting.deleteMany({ where: { key: DAILY_LAST_RUN_KEY } });
}

async function stat(dimension: string, key = yesterdayKey) {
  return prisma.dailyStat.findUnique({
    where: { date_dimension: { date: utcDateOf(key), dimension } },
  });
}

let tt: { id: string };
let fb: { id: string };

async function seed() {
  await cleanStats();
  await resetDb();
  const program = await prisma.affiliateProgram.create({
    data: { name: "Casino X", externalId: "prog-daily" },
  });
  const offOurs = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "OFF-OURS",
      name: "Notre offre",
      trackingUrlTemplate: "https://linkaffi.me/go/OFF-OURS?sub_id={subid}",
    },
  });
  const offOther = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "OFF-OTHER",
      name: "Offre d'un autre affilié",
      trackingUrlTemplate: "https://linkaffi.me/go/OFF-OTHER?sub_id={subid}",
    },
  });
  // Deux campagnes qui partagent la même offre ; TT a son propre bouton Offre (lien rattaché à TT).
  tt = await prisma.campaign.create({
    data: { name: "TT casino", vertical: "CASINO", affiliateCampaignIds: [offOurs.id] },
  });
  fb = await prisma.campaign.create({
    data: { name: "FB casino", vertical: "CASINO", affiliateCampaignIds: [offOurs.id] },
  });
  const ttOffer = await prisma.trackingLink.create({
    data: {
      slug: "ttoffre1",
      kind: "OFFER",
      label: "Offre TT",
      destinationTemplate: offOurs.trackingUrlTemplate,
      affiliateCampaignId: offOurs.id,
      campaignId: tt.id,
    },
  });
  const click = await prisma.click.create({
    data: { trackingLinkId: ttOffer.id, subId: "SUBDAILY0001", createdAt: yesterdayNoon },
  });
  // P1 : sans clic, rattaché par l'offre (compte dans TT et FB, une seule fois dans « all ») ; NGR +7 hier.
  const p1 = await prisma.player.create({
    data: {
      affiliateCampaignId: offOurs.id,
      externalPlayerId: "d1",
      registeredAt: yesterdayNoon,
      ngr: 7,
    },
  });
  await prisma.playerEvent.create({
    data: { playerId: p1.id, type: "NGR", amount: 7, currency: "EUR", occurredAt: yesterdayNoon },
  });
  // P3 : clic sur le bouton de TT : compte dans TT seulement.
  await prisma.player.create({
    data: {
      affiliateCampaignId: offOurs.id,
      externalPlayerId: "d3",
      clickId: click.id,
      subId: "SUBDAILY0001",
      registeredAt: yesterdayNoon,
    },
  });
  // P4 : clic sur un ancien bouton Offre sans campagne (créé avant la phase 8) vers l'offre partagée : son clic compte
  // dans TT et FB (règle de l'offre) ; son inscription et son NGR (+4) doivent y compter aussi.
  const oldButton = await prisma.trackingLink.create({
    data: {
      slug: "ancien01",
      kind: "OFFER",
      label: "Ancien bouton Offre",
      destinationTemplate: offOurs.trackingUrlTemplate,
      affiliateCampaignId: offOurs.id,
    },
  });
  const oldClick = await prisma.click.create({
    data: { trackingLinkId: oldButton.id, subId: "SUBDAILY0004", createdAt: yesterdayNoon },
  });
  const p4 = await prisma.player.create({
    data: {
      affiliateCampaignId: offOurs.id,
      externalPlayerId: "d4",
      clickId: oldClick.id,
      subId: "SUBDAILY0004",
      registeredAt: yesterdayNoon,
      ngr: 4,
    },
  });
  await prisma.playerEvent.create({
    data: { playerId: p4.id, type: "NGR", amount: 4, currency: "EUR", occurredAt: yesterdayNoon },
  });
  // P2 : joueur d'un autre affilié, inscrit, FTD et NGR hier : ne doit jamais compter.
  const p2 = await prisma.player.create({
    data: {
      affiliateCampaignId: offOther.id,
      externalPlayerId: "d2",
      registeredAt: yesterdayNoon,
      ftdAt: yesterdayNoon,
      ngr: 500,
    },
  });
  await prisma.playerEvent.createMany({
    data: [
      { playerId: p2.id, type: "FTD", amount: 100, currency: "EUR", occurredAt: yesterdayNoon },
      { playerId: p2.id, type: "NGR", amount: 500, currency: "EUR", occurredAt: yesterdayNoon },
    ],
  });
  // Lignes écrites avant la phase 8 (totaux Link Affi globaux), antérieures au premier jour de données.
  await prisma.dailyStat.create({
    data: { date: utcDateOf(staleKey), dimension: "all", registrations: 99, ftds: 40, ngr: 1234 },
  });
  await prisma.dailyStat.create({
    data: {
      date: utcDateOf(staleKey),
      dimension: `campaign:${tt.id}`,
      campaignId: tt.id,
      registrations: 12,
    },
  });
}

describe("statistiques journalières : nos joueurs, campagnes par l'offre, recalcul complet", () => {
  beforeAll(async () => {
    await seed();
    await recomputeDailyStats({ full: true });
  });
  afterAll(async () => {
    await cleanStats();
    await resetDb();
  });

  it("« all » ne compte que nos joueurs", async () => {
    expect(await stat("all")).toMatchObject({ registrations: 3, ftds: 0, offerClicks: 2 });
    expect(Number((await stat("all"))?.ngr)).toBe(11);
  });

  it("les joueurs rattachés par l'offre remplissent la ligne de chaque campagne qui la porte, sans doubler les totaux", async () => {
    expect(await stat(`campaign:${tt.id}`)).toMatchObject({ registrations: 3, offerClicks: 2 });
    expect(await stat(`campaign:${fb.id}`)).toMatchObject({ registrations: 2, offerClicks: 1 });
    expect(Number((await stat(`campaign:${fb.id}`))?.ngr)).toBe(11);
    expect(await stat("campaigns")).toMatchObject({ registrations: 3, offerClicks: 2 });
    expect(Number((await stat("campaigns"))?.ngr)).toBe(11);
    expect(await stat("vertical:CASINO")).toMatchObject({ registrations: 3 });
  });

  it("ancien bouton Offre sans campagne : le joueur compte là où son clic compte", async () => {
    // FB n'a aucun lien : son clic et son inscription viennent tous deux de l'ancien bouton (P4).
    const fbRow = await stat(`campaign:${fb.id}`);
    expect(fbRow?.offerClicks).toBe(1);
    expect(fbRow?.registrations).toBe(2); // P1 (sans clic) + P4 (ancien bouton)
  });

  it("chaque recalcul réussi note son heure, même quand aucune ligne ne change (« Chiffres calculés le … »)", async () => {
    const first = await prisma.setting.findUnique({ where: { key: DAILY_LAST_RUN_KEY } });
    const at1 = new Date((first?.value as { at: string }).at);
    expect(Date.now() - at1.getTime()).toBeLessThan(5 * 60_000);
    const before = await prisma.dailyStat.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    await new Promise((r) => setTimeout(r, 20));
    await recomputeDailyStats({ days: 3 });
    const second = await prisma.setting.findUnique({ where: { key: DAILY_LAST_RUN_KEY } });
    const value = second?.value as { at: string; full: boolean };
    expect(new Date(value.at).getTime()).toBeGreaterThan(at1.getTime());
    expect(value.full).toBe(false);
    // Rien n'a changé : aucune ligne réécrite, mais l'heure du calcul avance.
    const after = await prisma.dailyStat.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });

  it("un recalcul complet remet à zéro les lignes antérieures au premier jour de données", async () => {
    expect(await stat("all", staleKey)).toMatchObject({ registrations: 0, ftds: 0 });
    expect(Number((await stat("all", staleKey))?.ngr)).toBe(0);
    expect(await stat(`campaign:${tt.id}`, staleKey)).toMatchObject({ registrations: 0 });
  });

  it("brief quotidien et rapport hebdomadaire : plus de total Link Affi global", async () => {
    const daily = await buildDailyData(now);
    expect(daily.current.registrations).toBe(3);
    expect(daily.current.ftds).toBe(0);
    expect(daily.current.ngr).toBe(11);
    expect(daily.topCampaigns.map((c) => c.name)).toEqual(["TT casino", "FB casino"]);
    const weekly = await buildWeeklyData(now);
    expect(weekly.current.registrations).toBe(3);
    expect(weekly.current.ngr).toBe(11);
    expect(weekly.previous.registrations).toBe(0);
  });
});
