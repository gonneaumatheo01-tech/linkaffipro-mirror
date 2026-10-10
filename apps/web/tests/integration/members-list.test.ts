/**
 * Liste des membres (phase 9) : filtres en langage courant sur base réelle.
 * - « ont déposé », « premier dépôt » (jours de Paris), « rien fait depuis N jours », univers, combinés aux anciens
 *   filtres (statut, campagne) ;
 * - colonnes de la liste : d'où il vient (campagne, univers) et statut de la dernière demande ;
 * - choix des filtres : langues regroupées, campagnes, pubs ;
 * - le lien « Écrire à un groupe » vise les mêmes membres que la liste (règle du segment de `@linkaffipro/core`) ;
 *   avec une campagne et un statut, la campagne n'est pas reprise (le groupe les lirait sur la même demande).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMemberWhere, parseSegment } from "@linkaffipro/core";
import { prisma, type Prisma } from "@linkaffipro/db";
import { broadcastLink, parseMemberFilters } from "@/lib/members/filters";
import { listMembers, loadMemberFilterOptions } from "@/lib/members/query";
import { createTestBot, resetDb } from "./helpers";

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const ids: Record<string, string> = {};
let campaignId = "";
let campaignLinkId = "";
let casinoChannel = "";
let sportsChannel = "";

async function cleanCampaigns() {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("refuse de tourner hors de la base de test");
  await prisma.campaign.deleteMany({ where: { name: { startsWith: "MB · " } } });
}

async function names(sp: Record<string, string>): Promise<string[]> {
  const { rows } = await listMembers(parseMemberFilters(sp), { now });
  return rows.map((r) => r.displayName);
}

beforeAll(async () => {
  await resetDb();
  await cleanCampaigns();
  const bot = await createTestBot(711, "CASINO");
  casinoChannel = (
    await prisma.channel.create({
      data: { telegramChatId: BigInt(-100_711_001), title: "MB Casino", vertical: "CASINO" },
    })
  ).id;
  sportsChannel = (
    await prisma.channel.create({
      data: { telegramChatId: BigInt(-100_711_002), title: "MB Foot", vertical: "SPORTS" },
    })
  ).id;
  campaignId = (
    await prisma.campaign.create({
      data: { name: "MB · Casino octobre", vertical: "CASINO", status: "ACTIVE" },
    })
  ).id;
  const link = await prisma.inviteLink.create({
    data: {
      channelId: casinoChannel,
      botId: bot.id,
      telegramInviteLink: "https://t.me/+mb-test-711",
      name: "Lien MB 1",
      adName: "Vidéo bonus",
      adPlatform: "TIKTOK",
      campaignId,
    },
  });
  campaignLinkId = link.id;
  const program = await prisma.affiliateProgram.create({
    data: { name: "MB prog", externalId: "mb-prog" },
  });
  const offer = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "MB-1",
      name: "Offre MB",
      trackingUrlTemplate: "https://linkaffi.me/go/MB-1?sub_id={subid}",
    },
  });

  const member = (n: number, firstName: string, languageCode: string | null, lastSeenAt: Date) =>
    prisma.member.create({
      data: { telegramUserId: BigInt(7_110 + n), firstName, languageCode, lastSeenAt },
    });
  ids.alice = (await member(1, "Alice", "fr", daysAgo(1))).id;
  ids.bruno = (await member(2, "Bruno", "en-GB", daysAgo(10))).id;
  ids.chloe = (await member(3, "Chloé", "fr-FR", daysAgo(40))).id;
  ids.dan = (await member(4, "Dan", null, now)).id;

  await prisma.membership.createMany({
    data: [
      {
        code: "mb-1",
        memberId: ids.alice!,
        channelId: casinoChannel,
        status: "APPROVED",
        inviteLinkId: link.id,
        requestedAt: daysAgo(3),
      },
      {
        code: "mb-2",
        memberId: ids.bruno!,
        channelId: sportsChannel,
        status: "APPROVED",
        requestedAt: daysAgo(12),
      },
      {
        code: "mb-3",
        memberId: ids.chloe!,
        channelId: sportsChannel,
        status: "REQUESTED",
        requestedAt: daysAgo(45),
      },
    ],
  });
  const player = (n: number, memberId: string, data: Partial<Prisma.PlayerUncheckedCreateInput>) =>
    prisma.player.create({
      data: { affiliateCampaignId: offer.id, externalPlayerId: `mb-${n}`, memberId, ...data },
    });
  await player(1, ids.alice!, {
    depositCount: 2,
    depositTotal: 50,
    ftdAt: daysAgo(2),
    registeredAt: daysAgo(2),
  });
  await player(2, ids.bruno!, { registeredAt: daysAgo(9) });
  await player(3, ids.chloe!, {
    depositCount: 1,
    depositTotal: 20,
    ftdAt: daysAgo(20),
    registeredAt: daysAgo(21),
  });
});

afterAll(async () => {
  await resetDb();
  await cleanCampaigns();
});

describe("liste des membres : filtres en langage courant (base réelle)", () => {
  it("sans filtre : tous, de la dernière activité à la plus ancienne", async () => {
    expect(await names({})).toEqual(["Dan", "Alice", "Bruno", "Chloé"]);
  });

  it("« ont déposé » : un compte joueur avec un dépôt", async () => {
    expect(await names({ deposited: "1" })).toEqual(["Alice", "Chloé"]);
  });

  it("« premier dépôt » sur 7 et 30 jours", async () => {
    expect(await names({ ftd: "7d" })).toEqual(["Alice"]);
    expect(await names({ ftd: "30d" })).toEqual(["Alice", "Chloé"]);
    expect(await names({ ftd: "today" })).toEqual([]);
  });

  it("« rien fait depuis 7 / 30 jours »", async () => {
    expect(await names({ inactive: "7" })).toEqual(["Bruno", "Chloé"]);
    expect(await names({ inactive: "30" })).toEqual(["Chloé"]);
  });

  it("univers, seul ou avec le statut (même demande)", async () => {
    expect(await names({ universe: "SPORTS" })).toEqual(["Bruno", "Chloé"]);
    expect(await names({ universe: "SPORTS", status: "APPROVED" })).toEqual(["Bruno"]);
    expect(await names({ universe: "CASINO", status: "REQUESTED" })).toEqual([]);
  });

  it("combinés aux anciens filtres (campagne)", async () => {
    expect(await names({ campaignId, deposited: "1", universe: "CASINO" })).toEqual(["Alice"]);
    expect(await names({ campaignId, inactive: "7" })).toEqual([]);
  });

  it("colonnes : d'où il vient (campagne, univers, pub) et statut de la dernière demande", async () => {
    const { rows, total } = await listMembers(parseMemberFilters({}), { now });
    expect(total).toBe(4);
    const alice = rows.find((r) => r.id === ids.alice)!;
    expect(alice.origin).toMatchObject({
      channelTitle: "MB Casino",
      channelVertical: "CASINO",
      campaignId,
      campaignName: "MB · Casino octobre",
      campaignVertical: "CASINO",
      adName: "Vidéo bonus",
      adPlatform: "TIKTOK",
      linkName: "Lien MB 1",
    });
    expect(alice.status).toBe("APPROVED");
    expect(alice.depositTotal).toBe(50);
    const chloe = rows.find((r) => r.id === ids.chloe)!;
    expect(chloe.origin).toMatchObject({
      channelTitle: "MB Foot",
      campaignName: null,
      adName: null,
    });
    expect(chloe.status).toBe("REQUESTED");
    const dan = rows.find((r) => r.id === ids.dan)!;
    expect(dan.origin).toBeNull();
    expect(dan.status).toBeNull();
  });

  it("choix des filtres : langues regroupées, campagnes, pubs, canaux avec univers", async () => {
    const o = await loadMemberFilterOptions();
    expect(o.languages).toEqual([
      { code: "fr", count: 2 },
      { code: "en", count: 1 },
    ]);
    expect(o.campaigns.map((c) => c.name)).toContain("MB · Casino octobre");
    expect(o.inviteLinks).toEqual([
      expect.objectContaining({ label: "Vidéo bonus", campaignName: "MB · Casino octobre" }),
    ]);
    expect(o.channels).toEqual(
      expect.arrayContaining([
        { id: casinoChannel, title: "MB Casino", vertical: "CASINO" },
        { id: sportsChannel, title: "MB Foot", vertical: "SPORTS" },
      ]),
    );
  });

  it("« Écrire à un groupe » vise les mêmes membres que la liste", async () => {
    const f = parseMemberFilters({ universe: "SPORTS", inactive: "7", status: "APPROVED" });
    const link = broadcastLink(f, { SPORTS: [sportsChannel], CASINO: [casinoChannel] });
    expect(link.dropped).toEqual([]);
    const p = new URLSearchParams(link.href.split("?")[1]);
    const segment = parseSegment({
      channelIds: p.getAll("channelIds"),
      membershipStatuses: p.getAll("membershipStatuses"),
      inactiveDays: p.get("inactiveDays"),
    });
    const fromSegment = await prisma.member.findMany({
      where: buildMemberWhere(segment, now) as Prisma.MemberWhereInput,
      select: { firstName: true },
    });
    expect(fromSegment.map((m) => m.firstName)).toEqual(
      await names({ universe: "SPORTS", inactive: "7", status: "APPROVED" }),
    );
    expect(fromSegment.map((m) => m.firstName)).toEqual(["Bruno"]);
  });

  it("campagne + statut : la campagne n'est pas reprise (le groupe la lirait sur la même demande que le statut)", async () => {
    // Eva : venue par la campagne vers le casino (refusée), puis acceptée dans le canal foot.
    const eva = await prisma.member.create({
      data: { telegramUserId: BigInt(7_115), firstName: "Eva", lastSeenAt: daysAgo(2) },
    });
    try {
      await prisma.membership.createMany({
        data: [
          {
            code: "mb-5a",
            memberId: eva.id,
            channelId: casinoChannel,
            status: "DECLINED",
            inviteLinkId: campaignLinkId,
            requestedAt: daysAgo(6),
          },
          {
            code: "mb-5b",
            memberId: eva.id,
            channelId: sportsChannel,
            status: "APPROVED",
            requestedAt: daysAgo(5),
          },
        ],
      });
      const groupOf = async (href: string) => {
        const p = new URLSearchParams(href.split("?")[1] ?? "");
        const segment = parseSegment({
          channelIds: p.getAll("channelIds"),
          membershipStatuses: p.getAll("membershipStatuses"),
          campaignIds: p.getAll("campaignIds"),
        });
        const found = await prisma.member.findMany({
          where: buildMemberWhere(segment, now) as Prisma.MemberWhereInput,
          select: { firstName: true },
        });
        return found.map((m) => m.firstName ?? "").sort();
      };

      // La campagne seule : le groupe vise exactement la liste.
      const alone = broadcastLink(parseMemberFilters({ campaignId }));
      expect(alone.dropped).toEqual([]);
      expect(await names({ campaignId })).toEqual(["Alice", "Eva"]);
      expect(await groupOf(alone.href)).toEqual(["Alice", "Eva"]);

      // Avec le statut : la liste garde Eva (campagne sur une demande, statut sur une autre)…
      const sp = { campaignId, status: "APPROVED" };
      expect(await names(sp)).toEqual(["Alice", "Eva"]);
      // … alors qu'un groupe « campagne + statut » la perdrait : c'est pourquoi la campagne n'est pas reprise.
      expect(await groupOf(`?campaignIds=${campaignId}&membershipStatuses=APPROVED`)).toEqual([
        "Alice",
      ]);
      const link = broadcastLink(parseMemberFilters(sp));
      expect(link.dropped).toEqual(["la campagne, qui ne s'y combine pas avec le statut"]);
      expect(new URLSearchParams(link.href.split("?")[1]).getAll("campaignIds")).toEqual([]);
      // Le groupe repris contient toute la liste (et la phrase de la liste prévient qu'il est plus large).
      const group = await groupOf(link.href);
      expect(group).toEqual(["Alice", "Bruno", "Eva"]);
      for (const n of await names(sp)) expect(group).toContain(n);
    } finally {
      await prisma.membership.deleteMany({ where: { memberId: eva.id } });
      await prisma.member.delete({ where: { id: eva.id } });
    }
  });
});
