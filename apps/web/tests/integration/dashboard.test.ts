/**
 * Tableau de bord (phase 8) : seuls « nos » joueurs comptent (clic à nous, ou campagne Link Affi rattachée à une de nos
 * campagnes), les dates sont celles de Link Affi, le NGR est daté : 7, 30 et 90 jours donnent des totaux différents.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { loadDashboardUncached } from "@/lib/dashboard/queries";
import { loadAdsTable, loadCohorts } from "@/lib/dashboard/daily";
import { loadLastEvents } from "@/lib/dashboard/events";
import { periodDayKeys, resolvePeriod, shiftDay } from "@/lib/periods";
import { loadLinkAffiDiagnostic } from "@/lib/linkaffi/diagnostic";
import { GET as exportPlayers } from "@/app/(admin)/members/players/export/route";
import { createBotAndChannel, resetDb } from "./helpers";

// Session simulée pour les routes d'export (rôle modifiable par test).
const session = vi.hoisted(() => ({
  user: {
    id: "",
    email: "diag@test.local",
    name: "Diag",
    role: "ADMIN" as "ADMIN" | "MANAGER",
    telegramUserId: null,
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => session.user,
  requireAdmin: async () => session.user,
  requireAdminPage: async () => session.user,
}));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const metric = (d: Awaited<ReturnType<typeof loadDashboardUncached>>, key: string) =>
  d.metrics.find((m) => m.key === key)!.series.total;

async function seed() {
  await resetDb();
  await prisma.campaign.deleteMany();
  const { channel } = await createBotAndChannel({
    chatId: BigInt(-1001234509999),
    title: "Canal stats",
  });
  const program = await prisma.affiliateProgram.create({
    data: { name: "Casino Test", externalId: "prog-1" },
  });
  const ours = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "KEY-OURS",
      name: "Notre offre",
      trackingUrlTemplate: "https://linkaffi.me/go/KEY-OURS?sub_id={subid}",
    },
  });
  const other = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "KEY-OTHER",
      name: "Offre d'un autre affilié",
      trackingUrlTemplate: "https://linkaffi.me/go/KEY-OTHER?sub_id={subid}",
    },
  });
  await prisma.campaign.create({
    data: { name: "Campagne test", affiliateCampaignIds: [ours.id], channelIds: [channel.id] },
  });
  const link = await prisma.trackingLink.create({
    data: {
      slug: "offrstat",
      kind: "OFFER",
      label: "Offre test",
      destinationTemplate: ours.trackingUrlTemplate,
      channelId: channel.id,
      affiliateCampaignId: ours.id,
    },
  });
  const click = await prisma.click.create({
    data: { trackingLinkId: link.id, subId: "SUBSTATS01", createdAt: daysAgo(6) },
  });
  // P1 : rattaché à notre clic ; inscrit il y a 5 jours, FTD il y a 4 jours, NGR +10 il y a 40 jours et +5 il y a 3 jours.
  const p1 = await prisma.player.create({
    data: {
      affiliateCampaignId: ours.id,
      externalPlayerId: "p1",
      clickId: click.id,
      subId: "SUBSTATS01",
      registeredAt: daysAgo(5),
      ftdAt: daysAgo(4),
      ngr: 15,
    },
  });
  await prisma.playerEvent.createMany({
    data: [
      { playerId: p1.id, type: "REGISTRATION", occurredAt: daysAgo(5) },
      { playerId: p1.id, type: "FTD", amount: 20, currency: "EUR", occurredAt: daysAgo(4) },
      { playerId: p1.id, type: "NGR", amount: 10, currency: "EUR", occurredAt: daysAgo(40) },
      { playerId: p1.id, type: "NGR", amount: 5, currency: "EUR", occurredAt: daysAgo(3) },
    ],
  });
  // P2 : sans clic mais sur notre campagne Link Affi ; inscrit il y a 20 jours.
  const p2 = await prisma.player.create({
    data: {
      affiliateCampaignId: ours.id,
      externalPlayerId: "p2",
      registeredAt: daysAgo(20),
      ngr: 0,
    },
  });
  await prisma.playerEvent.create({
    data: { playerId: p2.id, type: "REGISTRATION", occurredAt: daysAgo(20) },
  });
  // P3 : joueur d'un autre affilié (campagne Link Affi non rattachée) : ne doit jamais compter.
  const p3 = await prisma.player.create({
    data: {
      affiliateCampaignId: other.id,
      externalPlayerId: "p3",
      registeredAt: daysAgo(2),
      ftdAt: daysAgo(1),
      ngr: 999,
    },
  });
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

  const load = (range: string) =>
    loadDashboardUncached({ period: resolvePeriod({ range }), vertical: "", channelId: "" });

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

  it("filtre Campagne : un joueur venu d'un ancien bouton Offre sans campagne compte, comme son clic", async () => {
    const c = await prisma.campaign.findFirstOrThrow({ where: { name: "Campagne test" } });
    const d7 = await loadDashboardUncached({
      period: resolvePeriod({ range: "7d" }),
      vertical: "",
      channelId: "",
      campaignId: c.id,
    });
    expect(metric(d7, "offerClicks")).toBe(1);
    expect(metric(d7, "registrations")).toBe(1); // P1 (bouton sans campagne)
    expect(metric(d7, "ftds")).toBe(1);
    expect(metric(d7, "ngr")).toBe(5);
  });

  it("présente les indicateurs en deux lignes dans l'ordre du parcours", async () => {
    const d7 = await load("7d");
    expect(d7.metrics.filter((m) => m.group === "telegram").map((m) => m.key)).toEqual([
      "requests",
      "approved",
      "joined",
      "left",
    ]);
    expect(d7.metrics.filter((m) => m.group === "argent").map((m) => m.key)).toEqual([
      "entryClicks",
      "offerClicks",
      "registrations",
      "ftds",
      "depositAmount",
      "ngr",
    ]);
  });
});

/**
 * Filtres du tableau de bord (phase 8) : Campagne, univers et canal gardent le périmètre « nos joueurs » ;
 * inscriptions et FTD viennent d'une seule source (Player.registeredAt / ftdAt, FTD annulés exclus), comme le worker.
 */
async function seedFilters() {
  await prisma.campaign.deleteMany();
  await resetDb();
  const { bot, channel } = await createBotAndChannel({
    chatId: BigInt(-1001234508888),
    title: "Canal casino",
  });
  await prisma.channel.update({ where: { id: channel.id }, data: { vertical: "CASINO" } });
  const quiet = await prisma.channel.create({
    data: {
      telegramChatId: BigInt(-1001234507777),
      title: "Canal qui se vide",
      type: "CHANNEL",
      vertical: "CASINO",
      primaryBotId: bot.id,
    },
  });
  const program = await prisma.affiliateProgram.create({
    data: { name: "Casino X", externalId: "prog-x" },
  });
  const offA = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "OFF-A",
      name: "Offre A",
      trackingUrlTemplate: "https://linkaffi.me/go/OFF-A?sub_id={subid}",
    },
  });
  const offB = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "OFF-B",
      name: "Offre d'un autre affilié",
      trackingUrlTemplate: "https://linkaffi.me/go/OFF-B?sub_id={subid}",
    },
  });
  // Deux campagnes qui partagent l'offre A : TT (lien d'entrée + lien pub) et FB (bouton Offre rattaché à FB).
  const tt = await prisma.campaign.create({
    data: {
      name: "TT casino",
      vertical: "CASINO",
      affiliateCampaignIds: [offA.id],
      channelIds: [channel.id],
    },
  });
  const fb = await prisma.campaign.create({
    data: {
      name: "FB casino",
      vertical: "CASINO",
      affiliateCampaignIds: [offA.id],
      channelIds: [channel.id],
    },
  });
  const invite = await prisma.inviteLink.create({
    data: {
      channelId: channel.id,
      botId: bot.id,
      telegramInviteLink: "https://t.me/+ttcasino",
      name: "TT — Pub 1",
      campaignId: tt.id,
    },
  });
  const entry = await prisma.trackingLink.create({
    data: {
      slug: "ttentry1",
      kind: "AD_ENTRY",
      label: "TT — Pub 1",
      destinationTemplate: invite.telegramInviteLink,
      channelId: channel.id,
      inviteLinkId: invite.id,
      campaignId: tt.id,
    },
  });
  const offerFb = await prisma.trackingLink.create({
    data: {
      slug: "fboffer1",
      kind: "OFFER",
      label: "Offre FB",
      destinationTemplate: offA.trackingUrlTemplate,
      channelId: channel.id,
      affiliateCampaignId: offA.id,
      campaignId: fb.id,
    },
  });
  await prisma.click.createMany({
    data: [
      { trackingLinkId: entry.id, createdAt: daysAgo(3) },
      { trackingLinkId: entry.id, createdAt: daysAgo(2) },
    ],
  });
  const m1 = await prisma.member.create({
    data: { telegramUserId: 9001n, firstName: "Arrivé par TT" },
  });
  const m2 = await prisma.member.create({
    data: { telegramUserId: 9002n, firstName: "Organique" },
  });
  const m3 = await prisma.member.create({ data: { telegramUserId: 9003n, firstName: "Ancien" } });
  await prisma.membership.create({
    data: {
      code: "msf1",
      memberId: m1.id,
      channelId: channel.id,
      inviteLinkId: invite.id,
      status: "APPROVED",
      requestedAt: daysAgo(3),
      approvedAt: daysAgo(3),
      joinedAt: daysAgo(3),
    },
  });
  await prisma.membership.create({
    data: {
      code: "msf2",
      memberId: m2.id,
      channelId: channel.id,
      status: "LEFT",
      requestedAt: daysAgo(2),
      approvedAt: daysAgo(2),
      joinedAt: daysAgo(2),
      leftAt: daysAgo(1),
    },
  });
  // Canal qui n'a eu que des départs sur la période : sa ligne « par canal » doit rester visible.
  await prisma.membership.create({
    data: {
      code: "msf3",
      memberId: m3.id,
      channelId: quiet.id,
      status: "LEFT",
      requestedAt: daysAgo(20),
      approvedAt: daysAgo(20),
      joinedAt: daysAgo(20),
      leftAt: daysAgo(1),
    },
  });
  const post = await prisma.post.create({
    data: { code: "pf1", channelId: channel.id, botId: bot.id, status: "SENT", sentAt: daysAgo(3) },
  });
  const k1 = await prisma.click.create({
    data: {
      trackingLinkId: offerFb.id,
      subId: "SUBFILT001",
      memberId: m2.id,
      postId: post.id,
      createdAt: daysAgo(2),
    },
  });
  // pA1 : clic sur le bouton de FB ; inscrit (sans événement REGISTRATION), FTD il y a 1 jour ; NGR +10 puis +5 (cumul faux à 999).
  const pA1 = await prisma.player.create({
    data: {
      affiliateCampaignId: offA.id,
      externalPlayerId: "pa1",
      clickId: k1.id,
      memberId: m2.id,
      subId: "SUBFILT001",
      registeredAt: daysAgo(2),
      ftdAt: daysAgo(1),
      ngr: 999,
    },
  });
  await prisma.playerEvent.createMany({
    data: [
      { playerId: pA1.id, type: "FTD", amount: 50, currency: "EUR", occurredAt: daysAgo(1) },
      { playerId: pA1.id, type: "NGR", amount: 10, currency: "EUR", occurredAt: daysAgo(1) },
      {
        playerId: pA1.id,
        type: "NGR",
        amount: 5,
        currency: "EUR",
        occurredAt: new Date(Date.now() - 3_600_000),
      },
    ],
  });
  // pA2 : sans clic, offre A (compte dans TT et dans FB).
  const pA2 = await prisma.player.create({
    data: { affiliateCampaignId: offA.id, externalPlayerId: "pa2", registeredAt: daysAgo(4) },
  });
  await prisma.playerEvent.create({
    data: { playerId: pA2.id, type: "REGISTRATION", occurredAt: daysAgo(4) },
  });
  // pA3 : sans clic, FTD annulé par Link Affi (ftdAt remis à null, l'événement FTD reste).
  const pA3 = await prisma.player.create({
    data: { affiliateCampaignId: offA.id, externalPlayerId: "pa3", registeredAt: daysAgo(5) },
  });
  await prisma.playerEvent.createMany({
    data: [
      { playerId: pA3.id, type: "REGISTRATION", occurredAt: daysAgo(5) },
      { playerId: pA3.id, type: "FTD", amount: 30, currency: "EUR", occurredAt: daysAgo(5) },
    ],
  });
  // pB : autre affilié : jamais compté.
  const pB = await prisma.player.create({
    data: {
      affiliateCampaignId: offB.id,
      externalPlayerId: "pb",
      registeredAt: daysAgo(1),
      ftdAt: daysAgo(1),
    },
  });
  await prisma.playerEvent.createMany({
    data: [
      { playerId: pB.id, type: "REGISTRATION", occurredAt: daysAgo(1) },
      { playerId: pB.id, type: "FTD", amount: 500, currency: "EUR", occurredAt: daysAgo(1) },
    ],
  });
  // Événements bruts : un player.* sans membre (autre affilié) ne doit pas sortir dans « Derniers événements ».
  await prisma.event.createMany({
    data: [
      { type: "member.start", memberId: m1.id, botId: bot.id, occurredAt: daysAgo(3) },
      { type: "player.ftd", memberId: m2.id, occurredAt: daysAgo(1) },
      { type: "player.registered", memberId: null, occurredAt: new Date() },
    ],
  });
  return { channel, quiet, tt, fb, pA1 };
}

describe("tableau de bord : filtres Campagne, univers et canal", () => {
  let s: Awaited<ReturnType<typeof seedFilters>>;
  beforeAll(async () => {
    s = await seedFilters();
  });
  afterAll(async () => {
    await prisma.campaign.deleteMany();
    await resetDb();
  });

  const load = (
    f: Partial<{ vertical: "" | "CASINO" | "SPORTS"; channelId: string; campaignId: string }> = {},
    range = "7d",
  ) =>
    loadDashboardUncached({
      period: resolvePeriod({ range }),
      vertical: f.vertical ?? "",
      channelId: f.channelId ?? "",
      ...(f.campaignId ? { campaignId: f.campaignId } : {}),
    });

  it("inscriptions et FTD : Player.registeredAt / ftdAt (FTD annulé exclu), comme les statistiques journalières", async () => {
    const d = await load();
    expect(metric(d, "registrations")).toBe(3);
    expect(metric(d, "ftds")).toBe(1);
    expect(metric(d, "ngr")).toBe(15);
  });

  it("filtre Campagne : chaque campagne n'a que ses liens et ses joueurs (adhésions par ses liens d'entrée)", async () => {
    const tt = await load({ campaignId: s.tt.id });
    expect(metric(tt, "entryClicks")).toBe(2);
    // m1 (lien d'entrée de TT) seulement : m2, arrivé sans lien dans un canal de TT, n'est à aucune campagne.
    expect(metric(tt, "requests")).toBe(1);
    expect(metric(tt, "joined")).toBe(1);
    expect(metric(tt, "offerClicks")).toBe(0);
    expect(metric(tt, "registrations")).toBe(2); // pA2 et pA3 (offre, sans clic) ; pA1 vient du bouton de FB
    expect(metric(tt, "ftds")).toBe(0);
    const fb = await load({ campaignId: s.fb.id });
    expect(metric(fb, "entryClicks")).toBe(0);
    expect(metric(fb, "offerClicks")).toBe(1);
    expect(metric(fb, "registrations")).toBe(3);
    expect(metric(fb, "ftds")).toBe(1);
    expect(metric(fb, "ngr")).toBe(15);
  });

  it("filtre univers : les joueurs rattachés par l'offre d'une campagne de l'univers restent comptés", async () => {
    expect(metric(await load({ vertical: "CASINO" }), "registrations")).toBe(3);
  });

  it("filtre canal : même règle que la ligne du canal (clic depuis un message du canal), pas les joueurs sans clic", async () => {
    const d = await load({ channelId: s.channel.id });
    expect(metric(d, "registrations")).toBe(1); // pA1 ; pA2 et pA3 (sans clic) n'ont pas de canal
    expect(metric(d, "offerClicks")).toBe(1);
  });

  it("univers sans canal : aucun clic pub compté", async () => {
    const d = await load({ vertical: "SPORTS" });
    expect(metric(d, "entryClicks")).toBe(0);
    expect(metric(d, "registrations")).toBe(0);
  });

  it("par canal : un canal qui n'a eu que des départs reste dans le tableau", async () => {
    const d = await load();
    expect(d.channels.find((c) => c.channelId === s.quiet.id)).toMatchObject({
      left: 1,
      joined: 0,
    });
  });

  it("derniers événements : pas d'activité Link Affi d'autres affiliés, libellés en français", async () => {
    const events = await loadLastEvents(12);
    expect(events.map((e) => e.type)).toEqual(["player.ftd", "member.start"]);
    expect(events.map((e) => e.label)).toEqual(["Premier dépôt", "A démarré le bot (/start)"]);
  });

  it("cohortes : NGR daté (somme des événements, pas le cumul), période et filtres transmis", async () => {
    const rows = await loadCohorts(resolvePeriod({ range: "7d" }), { vertical: "", channelId: "" });
    expect(rows.reduce((a, r) => a + r.members, 0)).toBe(2);
    expect(rows.reduce((a, r) => a + r.ltv * r.members, 0)).toBeCloseTo(15, 5);
    const old = await loadCohorts(resolvePeriod({ range: "30d" }), {
      vertical: "",
      channelId: s.quiet.id,
    });
    expect(old.reduce((a, r) => a + r.members, 0)).toBe(1);
    const tt = await loadCohorts(resolvePeriod({ range: "30d" }), {
      vertical: "",
      channelId: "",
      campaignId: s.tt.id,
    });
    expect(tt.reduce((a, r) => a + r.members, 0)).toBe(1); // m1, arrivé par le lien d'entrée de TT
  });
});

/**
 * Même filtre, mêmes chiffres que les statistiques journalières (entonnoir, onglet Campagnes) : adhésions d'une campagne
 * par ses liens d'entrée ; canal d'un joueur ou d'un clic = celui du message cliqué, à défaut celui où son membre est
 * arrivé par un lien de pub (même règle que apps/worker/src/stats/daily.ts).
 */
describe("tableau de bord : mêmes règles que les statistiques journalières", () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    await prisma.campaign.deleteMany();
    await resetDb();
    const { bot, channel: c } = await createBotAndChannel({
      chatId: BigInt(-1001234506666),
      title: "Canal C",
    });
    const d = await prisma.channel.create({
      data: { telegramChatId: BigInt(-1001234505555), title: "Canal D", primaryBotId: bot.id },
    });
    ids.c = c.id;
    ids.d = d.id;
    const program = await prisma.affiliateProgram.create({
      data: { name: "Casino R", externalId: "prog-r" },
    });
    const offA = await prisma.affiliateCampaign.create({
      data: {
        programId: program.id,
        externalId: "OFF-R",
        name: "Offre R",
        trackingUrlTemplate: "https://linkaffi.me/go/OFF-R?sub_id={subid}",
      },
    });
    const x = await prisma.campaign.create({
      data: { name: "Campagne X", affiliateCampaignIds: [offA.id], channelIds: [c.id, d.id] },
    });
    ids.x = x.id;
    const invite = await prisma.inviteLink.create({
      data: {
        channelId: c.id,
        botId: bot.id,
        telegramInviteLink: "https://t.me/+campx",
        name: "X — Pub",
        campaignId: x.id,
      },
    });
    const adSet = await prisma.adSet.create({ data: { campaignId: x.id, name: "Groupe" } });
    await prisma.ad.create({ data: { adSetId: adSet.id, name: "Pub", inviteLinkId: invite.id } });
    const m1 = await prisma.member.create({ data: { telegramUserId: 9101n, firstName: "Pub" } });
    const m2 = await prisma.member.create({ data: { telegramUserId: 9102n, firstName: "Orga" } });
    await prisma.membership.createMany({
      data: [
        {
          code: "msr1",
          memberId: m1.id,
          channelId: c.id,
          inviteLinkId: invite.id,
          status: "APPROVED",
          requestedAt: daysAgo(2),
        },
        {
          code: "msr2",
          memberId: m2.id,
          channelId: c.id,
          status: "REQUESTED",
          requestedAt: daysAgo(2),
        },
      ],
    });
    // Ancien bouton Offre (sans campagne) publié dans D, cliqué par m2.
    const oldButton = await prisma.trackingLink.create({
      data: {
        slug: "ancienr1",
        kind: "OFFER",
        label: "Ancien bouton",
        destinationTemplate: offA.trackingUrlTemplate,
        affiliateCampaignId: offA.id,
      },
    });
    const post = await prisma.post.create({
      data: { code: "pr1", channelId: d.id, botId: bot.id, status: "SENT", sentAt: daysAgo(2) },
    });
    const k = await prisma.click.create({
      data: {
        trackingLinkId: oldButton.id,
        subId: "SUBRULES01",
        memberId: m2.id,
        postId: post.id,
        createdAt: daysAgo(2),
      },
    });
    await prisma.player.createMany({
      data: [
        // q1 : sans clic, membre arrivé par la pub de X dans C.
        {
          affiliateCampaignId: offA.id,
          externalPlayerId: "q1",
          memberId: m1.id,
          registeredAt: daysAgo(1),
        },
        // q2 : sans clic ni membre.
        { affiliateCampaignId: offA.id, externalPlayerId: "q2", registeredAt: daysAgo(1) },
        // q3 : ancien bouton, message dans D.
        {
          affiliateCampaignId: offA.id,
          externalPlayerId: "q3",
          memberId: m2.id,
          clickId: k.id,
          subId: "SUBRULES01",
          registeredAt: daysAgo(1),
        },
      ],
    });
  });
  afterAll(async () => {
    await prisma.campaign.deleteMany();
    await resetDb();
  });
  const load = (f: { channelId?: string; campaignId?: string }) =>
    loadDashboardUncached({
      period: resolvePeriod({ range: "7d" }),
      vertical: "",
      channelId: f.channelId ?? "",
      ...(f.campaignId ? { campaignId: f.campaignId } : {}),
    });

  it("campagne : adhésions par ses liens d'entrée seulement, joueurs par la règle commune", async () => {
    const x = await load({ campaignId: ids.x! });
    expect(metric(x, "requests")).toBe(1);
    expect(metric(x, "registrations")).toBe(3);
    expect(metric(x, "offerClicks")).toBe(1);
  });

  it("canal : message cliqué, à défaut canal d'arrivée par une pub", async () => {
    const c = await load({ channelId: ids.c! });
    expect(metric(c, "requests")).toBe(2);
    expect(metric(c, "registrations")).toBe(1); // q1 (arrivé par la pub dans C)
    expect(metric(c, "offerClicks")).toBe(0);
    expect(c.channels.find((r) => r.channelId === ids.c)).toMatchObject({ registrations: 1 });
    const d = await load({ channelId: ids.d! });
    expect(metric(d, "registrations")).toBe(1); // q3
    expect(metric(d, "offerClicks")).toBe(1);
    // Tableau par canal sans filtre : chaque joueur dans un seul canal.
    const all = await load({});
    expect(all.channels.find((r) => r.channelId === ids.c)).toMatchObject({ registrations: 1 });
    expect(all.channels.find((r) => r.channelId === ids.d)).toMatchObject({
      registrations: 1,
      offerClicks: 1,
    });
  });
});

describe("onglet Campagnes : ligne Total et date du dernier calcul", () => {
  const period = resolvePeriod({ range: "30d" });
  const keys = periodDayKeys(period);
  const today = keys[keys.length - 1]!;
  const day = (k: string) => new Date(`${k}T00:00:00Z`);
  let a: { id: string };
  let b: { id: string };
  beforeAll(async () => {
    await prisma.dailyStat.deleteMany();
    await prisma.setting.deleteMany({ where: { key: "stats.daily.lastRunAt" } });
    await prisma.campaign.deleteMany();
    await resetDb();
    a = await prisma.campaign.create({ data: { name: "A" } });
    b = await prisma.campaign.create({ data: { name: "B" } });
    const old = shiftDay(today, -20);
    const recent = shiftDay(today, -1);
    // Lignes par campagne sur 30 jours ; la ligne sans doublon « campaigns » n'existe que pour le jour récent
    // (recalcul horaire de 3 jours passé, pas encore de recalcul complet).
    await prisma.dailyStat.createMany({
      data: [
        { date: day(old), dimension: `campaign:${a.id}`, campaignId: a.id, registrations: 5 },
        { date: day(recent), dimension: `campaign:${a.id}`, campaignId: a.id, registrations: 1 },
        { date: day(recent), dimension: `campaign:${b.id}`, campaignId: b.id, registrations: 1 },
        { date: day(recent), dimension: "campaigns", registrations: 1 },
      ],
    });
  });
  afterAll(async () => {
    await prisma.dailyStat.deleteMany();
    await prisma.setting.deleteMany({ where: { key: "stats.daily.lastRunAt" } });
    await prisma.campaign.deleteMany();
  });

  it("Total : ligne sans doublon les jours recalculés, somme des campagnes les autres jours", async () => {
    const t = await loadAdsTable(period);
    expect(t.rows.find((r) => r.campaignId === a.id)?.totals.registrations).toBe(6);
    expect(t.rows.find((r) => r.campaignId === b.id)?.totals.registrations).toBe(1);
    expect(t.total.registrations).toBe(6); // 5 (ancien jour, somme) + 1 (jour récent, sans doublon)
  });

  it("« Chiffres calculés le … » : heure du dernier recalcul, même sans ligne réécrite", async () => {
    const at = new Date(Date.now() + 60_000);
    await prisma.setting.create({
      data: { key: "stats.daily.lastRunAt", value: { at: at.toISOString(), full: false } },
    });
    expect((await loadAdsTable(period)).lastComputedAt?.toISOString()).toBe(at.toISOString());
  });
});

describe("Link Affi : diagnostic et export des joueurs", () => {
  beforeAll(async () => {
    await seedFilters();
    await prisma.user.deleteMany({ where: { email: session.user.email } });
    session.user.id = (
      await prisma.user.create({
        data: { email: session.user.email, name: "Diag", passwordHash: "x", role: "ADMIN" },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: session.user.id } });
    await prisma.user.deleteMany({ where: { email: session.user.email } });
    await prisma.campaign.deleteMany();
    await resetDb();
  });

  const csvRows = async (url: string) => {
    const res = await exportPlayers(new Request(url));
    const text = await res.text();
    return { status: res.status, lines: text.split(/\r?\n/).filter((l) => l.trim() !== "") };
  };

  it("diagnostic : joueurs rattachés / non rattachés et offres non liées", async () => {
    const d = await loadLinkAffiDiagnostic();
    expect(d.players).toEqual({ total: 4, ours: 3, notOurs: 1 });
    expect(d.unlinked).toHaveLength(1);
    expect(d.unlinked[0]).toMatchObject({ name: "Offre d'un autre affilié", players: 1 });
    expect(d.unlinked[0]!.lastRegisteredAt).toBeInstanceOf(Date);
  });

  it("export « Joueurs » de Membres : nos joueurs seulement, colonne « NGR de la période » sur demande", async () => {
    const plain = await csvRows("http://localhost/members/players/export");
    expect(plain.status).toBe(200);
    expect(plain.lines).toHaveLength(1 + 3);
    expect(plain.lines.join("\n")).not.toContain("pb");
    expect(plain.lines[0]).not.toContain("NGR de la période");
    const withPeriod = await csvRows("http://localhost/members/players/export?range=7d");
    expect(withPeriod.lines[0]).toContain("NGR de la période");
    const header = withPeriod.lines[0]!.split(";");
    const col = header.findIndex((h) => h.includes("NGR de la période"));
    const pa1 = withPeriod.lines.find((l) => l.startsWith("pa1"))!.split(";");
    expect(pa1[col]).toMatch(/^15([,.]00)?$/);
  });

  it("export brut de tous les joueurs Link Affi : ADMIN seulement", async () => {
    session.user.role = "MANAGER";
    expect((await csvRows("http://localhost/members/players/export?scope=all")).status).toBe(403);
    session.user.role = "ADMIN";
    const all = await csvRows("http://localhost/members/players/export?scope=all");
    expect(all.lines).toHaveLength(1 + 4);
  });
});
