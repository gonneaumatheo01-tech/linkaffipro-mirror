/**
 * Tableau de bord (phase 8) : seuls « nos » joueurs comptent (clic à nous, ou campagne Link Affi rattachée à une de nos
 * campagnes), les dates sont celles de Link Affi, le NGR est daté : 7, 30 et 90 jours donnent des totaux différents.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { loadDashboardUncached } from "@/lib/dashboard/queries";
import { resolvePeriod } from "@/lib/periods";
import { createBotAndChannel, resetDb } from "./helpers";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const metric = (d: Awaited<ReturnType<typeof loadDashboardUncached>>, key: string) => d.metrics.find((m) => m.key === key)!.series.total;

async function seed() {
  await resetDb();
  await prisma.campaign.deleteMany();
  const { channel } = await createBotAndChannel({ chatId: BigInt(-1001234509999), title: "Canal stats" });
  const program = await prisma.affiliateProgram.create({ data: { name: "Casino Test", externalId: "prog-1" } });
  const ours = await prisma.affiliateCampaign.create({ data: { programId: program.id, externalId: "KEY-OURS", name: "Notre offre", trackingUrlTemplate: "https://linkaffi.me/go/KEY-OURS?sub_id={subid}" } });
  const other = await prisma.affiliateCampaign.create({ data: { programId: program.id, externalId: "KEY-OTHER", name: "Offre d'un autre affilié", trackingUrlTemplate: "https://linkaffi.me/go/KEY-OTHER?sub_id={subid}" } });
  await prisma.campaign.create({ data: { name: "Campagne test", affiliateCampaignIds: [ours.id], channelIds: [channel.id] } });
  const link = await prisma.trackingLink.create({ data: { slug: "offrstat", kind: "OFFER", label: "Offre test", destinationTemplate: ours.trackingUrlTemplate, channelId: channel.id, affiliateCampaignId: ours.id } });
  const click = await prisma.click.create({ data: { trackingLinkId: link.id, subId: "SUBSTATS01", createdAt: daysAgo(6) } });
  // P1 : rattaché à notre clic ; inscrit il y a 5 jours, FTD il y a 4 jours, NGR +10 il y a 40 jours et +5 il y a 3 jours.
  const p1 = await prisma.player.create({ data: { affiliateCampaignId: ours.id, externalPlayerId: "p1", clickId: click.id, subId: "SUBSTATS01", registeredAt: daysAgo(5), ftdAt: daysAgo(4), ngr: 15 } });
  await prisma.playerEvent.createMany({
    data: [
      { playerId: p1.id, type: "REGISTRATION", occurredAt: daysAgo(5) },
      { playerId: p1.id, type: "FTD", amount: 20, currency: "EUR", occurredAt: daysAgo(4) },
      { playerId: p1.id, type: "NGR", amount: 10, currency: "EUR", occurredAt: daysAgo(40) },
      { playerId: p1.id, type: "NGR", amount: 5, currency: "EUR", occurredAt: daysAgo(3) },
    ],
  });
  // P2 : sans clic mais sur notre campagne Link Affi ; inscrit il y a 20 jours.
  const p2 = await prisma.player.create({ data: { affiliateCampaignId: ours.id, externalPlayerId: "p2", registeredAt: daysAgo(20), ngr: 0 } });
  await prisma.playerEvent.create({ data: { playerId: p2.id, type: "REGISTRATION", occurredAt: daysAgo(20) } });
  // P3 : joueur d'un autre affilié (campagne Link Affi non rattachée) : ne doit jamais compter.
  const p3 = await prisma.player.create({ data: { affiliateCampaignId: other.id, externalPlayerId: "p3", registeredAt: daysAgo(2), ftdAt: daysAgo(1), ngr: 999 } });
  await prisma.playerEvent.createMany({
    data: [
      { playerId: p3.id, type: "REGISTRATION", occurredAt: daysAgo(2) },
      { playerId: p3.id, type: "FTD", amount: 500, currency: "EUR", occurredAt: daysAgo(1) },
      { playerId: p3.id, type: "NGR", amount: 999, currency: "EUR", occurredAt: daysAgo(1) },
    ],
  });
}

describe("tableau de bord : périmètre et dates", () => {
  beforeAll(seed);
  afterAll(async () => {
    await prisma.campaign.deleteMany();
    await resetDb();
  });

  const load = (range: string) => loadDashboardUncached({ period: resolvePeriod({ range }), vertical: "", channelId: "" });

  it("7, 30 et 90 jours donnent des totaux différents (dates réelles, pas la date d'import)", async () => {
    const [d7, d30, d90] = await Promise.all([load("7d"), load("30d"), load("90d")]);
    expect(metric(d7, "registrations")).toBe(1);
    expect(metric(d30, "registrations")).toBe(2);
    expect(metric(d90, "registrations")).toBe(2);
    expect(metric(d7, "ngr")).toBe(5);
    expect(metric(d30, "ngr")).toBe(5);
    expect(metric(d90, "ngr")).toBe(15);
  });

  it("exclut les joueurs d'un autre affilié Link Affi", async () => {
    const d7 = await load("7d");
    expect(metric(d7, "ftds")).toBe(1);
    expect(metric(d7, "depositAmount")).toBe(20);
    expect(metric(d7, "ngr")).toBe(5);
  });

  it("présente les indicateurs en deux lignes dans l'ordre du parcours", async () => {
    const d7 = await load("7d");
    expect(d7.metrics.filter((m) => m.group === "telegram").map((m) => m.key)).toEqual(["requests", "approved", "joined", "left"]);
    expect(d7.metrics.filter((m) => m.group === "argent").map((m) => m.key)).toEqual(["entryClicks", "offerClicks", "registrations", "ftds", "depositAmount", "ngr"]);
  });
});
