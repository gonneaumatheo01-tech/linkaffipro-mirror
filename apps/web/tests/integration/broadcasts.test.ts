/**
 * « Écrire à un groupe » (phase 9) sur base réelle :
 * - lectures des écrans : résultats d'un envoi (clics, inscriptions, premiers dépôts), clics par envoi pour la liste,
 *   noms du groupe, comparaison A/B, choix de l'assistant (univers, pubs, langues) ;
 * - le groupe préparé par la liste des membres et les champs envoyés par l'assistant visent les mêmes membres que le
 *   compteur (étiquette avec une espace comprise) ;
 * - actions : l'assistant enregistre un brouillon avec les mêmes champs qu'avant, et « Envoyer un test à moi »
 *   n'écrit qu'à l'utilisateur (message TEST), sans rien lancer vers les membres.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseSegment } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { loadAbComparison } from "@/lib/broadcasts/ab-queries";
import { describeGroup, segmentFormFields, segmentFromSearchParams } from "@/lib/broadcasts/group";
import { countTargets, loadBroadcastOptions } from "@/lib/broadcasts/queries";
import { clicksByBroadcast, loadBroadcastResults, loadGroupNames } from "@/lib/broadcasts/results";
import { parseSegmentForm } from "@/lib/broadcasts/schema";
import { capturedJobs, createTestBot, resetDb } from "./helpers";

const session = vi.hoisted(() => ({
  user: {
    id: "",
    email: "groupe@broadcasts.test.local",
    name: "Équipe groupe",
    role: "ADMIN",
    telegramUserId: null as bigint | null,
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => session.user,
  requireAdmin: async () => session.user,
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
}));

const { createAndTestAction, createBroadcastAction } =
  await import("@/app/(admin)/members/broadcasts/actions");

const CAT_SLUG = "integ-wg-bonus";
const ids: Record<string, string> = {};

async function cleanExtras() {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("refuse de tourner hors de la base de test");
  await prisma.broadcast.deleteMany({ where: { bot: { username: "bot_812" } } });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: "WG · " } } });
  await prisma.messageCategory.deleteMany({ where: { slug: CAT_SLUG } });
  await prisma.auditLog.deleteMany({ where: { user: { email: session.user.email } } });
  await prisma.user.deleteMany({ where: { email: session.user.email } });
}

/** Lance une action serveur et renvoie l'adresse de redirection. */
async function redirectOf(p: Promise<void>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2] ?? "";
    throw err;
  }
  throw new Error("aucune redirection");
}

beforeAll(async () => {
  await resetDb();
  await cleanExtras();
  const u = await prisma.user.create({
    data: { email: session.user.email, name: session.user.name, passwordHash: "x", role: "ADMIN" },
  });
  session.user.id = u.id;
  const bot = await createTestBot(812, "CASINO");
  ids.bot = bot.id;
  ids.casino = (
    await prisma.channel.create({
      data: { telegramChatId: BigInt(-100_812_001), title: "WG Casino", vertical: "CASINO" },
    })
  ).id;
  ids.foot = (
    await prisma.channel.create({
      data: { telegramChatId: BigInt(-100_812_002), title: "WG Foot", vertical: "SPORTS" },
    })
  ).id;
  ids.campaign = (
    await prisma.campaign.create({
      data: { name: "WG · Casino octobre", vertical: "CASINO", status: "ACTIVE" },
    })
  ).id;
  ids.link = (
    await prisma.inviteLink.create({
      data: {
        channelId: ids.casino,
        botId: bot.id,
        telegramInviteLink: "https://t.me/+wg-test-812",
        name: "Lien WG",
        adName: "Vidéo bonus WG",
        campaignId: ids.campaign,
      },
    })
  ).id;
  ids.category = (
    await prisma.messageCategory.create({ data: { slug: CAT_SLUG, name: "Bonus WG" } })
  ).id;

  const member = (n: number, firstName: string, languageCode: string, tags: string[]) =>
    prisma.member.create({
      data: { telegramUserId: BigInt(8_120 + n), firstName, languageCode, tags },
    });
  ids.alice = (await member(1, "Alice", "fr-FR", ["Gros joueur"])).id;
  ids.bruno = (await member(2, "Bruno", "en", ["Gros"])).id;
  ids.chloe = (await member(3, "Chloé", "fr", ["Gros joueur"])).id;
  // Alice et Bruno peuvent recevoir un message privé du bot ; Chloé non.
  await prisma.memberBotState.createMany({
    data: [
      { memberId: ids.alice, botId: bot.id, canDm: true, startedAt: new Date() },
      { memberId: ids.bruno, botId: bot.id, canDm: true, startedAt: new Date() },
      { memberId: ids.chloe, botId: bot.id, canDm: false },
    ],
  });
  await prisma.membership.createMany({
    data: [
      {
        code: "wg-1",
        memberId: ids.alice,
        channelId: ids.casino,
        status: "APPROVED",
        inviteLinkId: ids.link,
      },
      { code: "wg-2", memberId: ids.bruno, channelId: ids.foot, status: "APPROVED" },
      { code: "wg-3", memberId: ids.chloe, channelId: ids.casino, status: "APPROVED" },
    ],
  });

  // Envoi A (test A/B) avec ses boutons traqués et deux joueurs venus de ses clics ; envoi B sans clic.
  const segment = { channelIds: [ids.casino], campaignIds: [ids.campaign] };
  const mk = (name: string, variant: string) =>
    prisma.broadcast.create({
      data: {
        name,
        botId: bot.id,
        segment,
        text: `Bonjour ${variant}`,
        status: "SENT",
        targeted: 40,
        sent: 38,
        failed: 1,
        blocked: 1,
        abGroupId: "wg-ab",
        abVariant: variant,
        abSplit: 50,
        createdById: u.id,
      },
    });
  ids.a = (await mk("WG promo — A", "A")).id;
  ids.b = (await mk("WG promo — B", "B")).id;
  const post = await prisma.post.create({
    data: {
      code: "wgpost01",
      channelId: ids.casino,
      botId: bot.id,
      status: "SENT",
      sentAt: new Date(),
      text: "Bonjour A",
      templateName: `broadcast:${ids.a}`,
    },
  });
  const program = await prisma.affiliateProgram.create({
    data: { name: "WG prog", externalId: "wg-prog" },
  });
  const offer = await prisma.affiliateCampaign.create({
    data: {
      programId: program.id,
      externalId: "WG-1",
      name: "Offre WG",
      trackingUrlTemplate: "https://linkaffi.me/go/WG-1?sub_id={subid}",
    },
  });
  const offerLink = await prisma.trackingLink.create({
    data: {
      slug: "wgoffer1",
      kind: "OFFER",
      destinationTemplate: offer.trackingUrlTemplate,
      label: "Jouer (envoi groupé)",
      affiliateCampaignId: offer.id,
      postId: post.id,
      channelId: ids.casino,
      clicks: 5,
      uniqueClicks: 3,
    },
  });
  await prisma.trackingLink.create({
    data: {
      slug: "wgbtn001",
      kind: "BUTTON",
      destinationTemplate: "https://example.com",
      label: "Site (envoi groupé)",
      postId: post.id,
      channelId: ids.casino,
      clicks: 2,
      uniqueClicks: 2,
    },
  });
  const click = (n: number) =>
    prisma.click.create({
      data: { trackingLinkId: offerLink.id, subId: `wg-sub-${n}`, memberId: ids.alice },
    });
  const c1 = await click(1);
  const c2 = await click(2);
  await prisma.player.create({
    data: {
      affiliateCampaignId: offer.id,
      externalPlayerId: "wg-p1",
      clickId: c1.id,
      registeredAt: new Date(),
      ftdAt: new Date(),
      depositCount: 1,
      depositTotal: 50,
    },
  });
  await prisma.player.create({
    data: {
      affiliateCampaignId: offer.id,
      externalPlayerId: "wg-p2",
      clickId: c2.id,
      registeredAt: new Date(),
    },
  });
  // Joueur sans clic d'envoi : jamais compté.
  await prisma.player.create({
    data: { affiliateCampaignId: offer.id, externalPlayerId: "wg-p3", ftdAt: new Date() },
  });
});

afterAll(async () => {
  await cleanExtras();
  await resetDb();
});

describe("lectures des écrans « Écrire à un groupe » (base réelle)", () => {
  it("résultats d'un envoi : clics des boutons traqués, inscriptions et premiers dépôts rattachés", async () => {
    const a = await loadBroadcastResults(ids.a!);
    expect(a).toMatchObject({
      clicks: 7,
      uniqueClicks: 5,
      offerClicks: 5,
      registrations: 2,
      ftds: 1,
    });
    expect(a.links.map((l) => l.label)).toEqual(["Jouer (envoi groupé)", "Site (envoi groupé)"]);
    expect(await loadBroadcastResults(ids.b!)).toEqual({
      links: [],
      clicks: 0,
      uniqueClicks: 0,
      offerClicks: 0,
      registrations: 0,
      ftds: 0,
    });
  });

  it("clics par envoi pour la liste (un envoi sans bouton n'apparaît pas)", async () => {
    const m = await clicksByBroadcast([ids.a!, ids.b!]);
    expect(m.get(ids.a!)).toEqual({ clicks: 7, uniqueClicks: 5 });
    expect(m.has(ids.b!)).toBe(false);
    expect((await clicksByBroadcast([])).size).toBe(0);
  });

  it("comparaison A/B : mêmes chiffres que la fiche, texte et boutons de chaque version", async () => {
    const cmp = await loadAbComparison("wg-ab");
    expect(cmp?.name).toBe("WG promo");
    expect(cmp?.variants.map((v) => [v.variant, v.uniqueClicks, v.ftds, v.registrations])).toEqual([
      ["A", 5, 1, 2],
      ["B", 0, 0, 0],
    ]);
    expect(cmp?.variants[0]).toMatchObject({ text: "Bonjour A", mediaAssetId: null, buttons: [] });
  });

  it("noms du groupe et phrase affichée", async () => {
    const b = await prisma.broadcast.findUniqueOrThrow({ where: { id: ids.a! } });
    const segment = parseSegment(b.segment);
    const names = await loadGroupNames([segment, { clickedCategoryIds: [ids.category!] }]);
    expect(names.channels).toEqual({ [ids.casino!]: "WG Casino" });
    expect(names.categories).toEqual({ [ids.category!]: "Bonus WG" });
    expect(describeGroup(segment, names)).toBe(
      "Membres du canal « WG Casino » et venus de la campagne « WG · Casino octobre »",
    );
    expect(await loadGroupNames([])).toEqual({
      channels: {},
      campaigns: {},
      inviteLinks: {},
      categories: {},
    });
  });

  it("choix de l'assistant : univers des canaux et campagnes, pubs nommées, langues regroupées", async () => {
    const o = await loadBroadcastOptions();
    expect(o.channels.find((c) => c.id === ids.casino)).toMatchObject({ vertical: "CASINO" });
    expect(o.campaigns.find((c) => c.id === ids.campaign)).toMatchObject({ vertical: "CASINO" });
    expect(o.inviteLinks.find((l) => l.id === ids.link)).toMatchObject({
      label: "Vidéo bonus WG",
      campaignName: "WG · Casino octobre",
    });
    expect(o.languages).toEqual([
      { code: "fr", count: 2 },
      { code: "en", count: 1 },
    ]);
  });
});

describe("groupe de membres : compteur, liste des membres et formulaire d'accord", () => {
  it("groupe préparé par la liste des membres → mêmes membres au compteur et à l'envoi", async () => {
    const { segment } = segmentFromSearchParams(
      { channelIds: ids.casino!, tags: "Gros joueur", languages: "fr" },
      { channelIds: [ids.casino!, ids.foot!] },
    );
    // Alice (joignable) ; Chloé correspond mais ne peut pas recevoir de message privé.
    expect(await countTargets(segment, ids.bot!)).toBe(1);
    const fd = new FormData();
    for (const [k, v] of segmentFormFields(segment)) fd.append(k, v);
    const sent = parseSegmentForm(fd);
    expect(sent).toEqual(segment);
    expect(await countTargets(sent, ids.bot!)).toBe(1);
    // L'étiquette « Gros joueur » ne vise pas Bruno (« Gros »).
    expect(await countTargets({ tags: ["Gros joueur"] }, ids.bot!)).toBe(1);
  });
});

describe("actions de l'assistant (base réelle)", () => {
  function wizardForm(extra: Record<string, string>): FormData {
    const fd = new FormData();
    fd.append("name", "WG brouillon");
    fd.append("botId", ids.bot!);
    for (const [k, v] of segmentFormFields({ channelIds: [ids.casino!], tags: ["Gros joueur"] }))
      fd.append(k, v);
    fd.append("text", "Bonjour <b>VIP</b>");
    fd.append("mediaAssetId", "");
    fd.append(
      "buttons",
      JSON.stringify([[{ text: "Site", type: "URL", url: "https://example.com" }]]),
    );
    fd.append("scheduledAt", "");
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return fd;
  }

  it("« Enregistrer en brouillon » : l'envoi garde le groupe, le texte et les boutons, rien ne part", async () => {
    const before = capturedJobs().length;
    const url = await redirectOf(createBroadcastAction(wizardForm({ intent: "draft" })));
    const id = url.split("?")[0]!.split("/").pop()!;
    const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
    expect(b).toMatchObject({ name: "WG brouillon", status: "DRAFT", text: "Bonjour <b>VIP</b>" });
    expect(parseSegment(b.segment)).toEqual({
      channelIds: [ids.casino],
      tags: ["Gros joueur"],
    });
    expect(b.buttons).toEqual([[{ text: "Site", type: "URL", url: "https://example.com" }]]);
    expect(capturedJobs().length).toBe(before);
  });

  it("« Envoyer un test à moi » : brouillon, puis un seul message TEST, à l'utilisateur", async () => {
    session.user.telegramUserId = BigInt(8_121); // Alice : compte Telegram lié à l'utilisateur
    try {
      const url = await redirectOf(createAndTestAction(wizardForm({ intent: "now" })));
      const id = url.split("?")[0]!.split("/").pop()!;
      expect(new URLSearchParams(url.split("?")[1]).get("ok")).toContain("Message de test envoyé");
      const b = await prisma.broadcast.findUniqueOrThrow({ where: { id } });
      expect(b.status).toBe("DRAFT");
      const sent = await prisma.outboundMessage.findMany({ where: { botId: ids.bot! } });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ kind: "TEST", memberId: ids.alice, broadcastId: null });
      expect(capturedJobs("scheduler")).toHaveLength(0);
    } finally {
      session.user.telegramUserId = null;
    }
  });
});
