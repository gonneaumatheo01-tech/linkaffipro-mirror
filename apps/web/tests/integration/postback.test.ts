import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { ctx, flushAfter, resetDb } from "./helpers";

// La route est écrite par le chantier B ; le test est ignoré si elle manque.
const route = await import("@/app/api/postback/[token]/route").catch(() => null);
const TOKEN = "integ-token-0123456789abcdef";

describe.skipIf(!route)("postback direct (base réelle)", () => {
  beforeAll(async () => {
    await resetDb();
    const program = await prisma.affiliateProgram.create({ data: { name: "Programme test", source: "API", externalId: "integ" } });
    const campaign = await prisma.affiliateCampaign.create({ data: { programId: program.id, externalId: "camp-integ", name: "Campagne test", trackingUrlTemplate: "https://example.org/go?sub_id={subid}" } });
    const link = await prisma.trackingLink.create({ data: { slug: "OFFER001", kind: "OFFER", destinationTemplate: campaign.trackingUrlTemplate, label: "Offre test", affiliateCampaignId: campaign.id } });
    const member = await prisma.member.create({ data: { telegramUserId: 777n, firstName: "Max" } });
    await prisma.click.create({ data: { trackingLinkId: link.id, subId: "SUBINTEG0001", memberId: member.id } });
    await prisma.postbackEndpoint.create({ data: { programId: program.id, name: "Test", token: TOKEN, mapping: {} } });
  });

  it("crée le joueur et l'événement rattachés par sub_id, puis ignore le doublon", async () => {
    const url = `http://localhost/api/postback/${TOKEN}?sub_id=SUBINTEG0001&player_id=P1&event=registration&txid=t1`;
    const res = await route!.GET(new Request(url), ctx({ token: TOKEN }));
    expect(res.status).toBe(200);
    await flushAfter();
    const player = await prisma.player.findFirst({ where: { externalPlayerId: "P1" }, include: { events: true, member: true } });
    expect(player).not.toBeNull();
    expect(player?.subId).toBe("SUBINTEG0001");
    expect(player?.member?.telegramUserId).toBe(777n);
    expect(player?.events.map((e) => e.type)).toContain("REGISTRATION");

    const res2 = await route!.GET(new Request(url), ctx({ token: TOKEN }));
    expect(res2.status).toBe(200);
    await flushAfter();
    const logs = await prisma.postbackLog.findMany({ orderBy: { receivedAt: "asc" } });
    expect(logs.map((l) => l.status)).toEqual(["ACCEPTED", "IGNORED"]);
    expect(await prisma.playerEvent.count()).toBe(1);
  });

  it("refuse un jeton inconnu", async () => {
    const res = await route!.GET(new Request("http://localhost/api/postback/inconnu-0123456789abcdef"), ctx({ token: "inconnu-0123456789abcdef" }));
    expect(res.status).toBe(404);
  });
});
