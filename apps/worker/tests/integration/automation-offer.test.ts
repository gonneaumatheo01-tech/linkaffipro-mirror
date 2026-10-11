/**
 * Bouton « Offre (campagne) » dans les relances automatiques et les messages à un groupe (phase 10), sur base réelle :
 * - relance : chaque membre reçoit un message dont le bouton ouvre le bot avec le lien de la relance (TrackingLink
 *   OFFER rattaché à la relance, à la campagne et à l'offre) ; au clic, le vrai handler du bot crée un identifiant de
 *   suivi neuf pour CE membre ; le joueur qui revient de Link Affi avec ce sub-ID (synchro réelle, API simulée) est
 *   rattaché au clic, donc à la relance ; chaque message privé est rattaché à la relance (envoyés) ;
 * - une relance existante à liens simples part comme avant (aucun lien traqué créé) ;
 * - message à un groupe avec bouton Offre : un message par membre, le même lien du bot avec le code du message
 *   conteneur, et un identifiant de suivi différent pour chaque membre qui clique, rattaché à l'envoi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { InlineKeyboardMarkup } from "grammy/types";
import { prisma } from "@linkaffipro/db";
import { LinkAffiClient } from "@linkaffipro/linkaffi";
import { createBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { expandBroadcast } from "../../src/broadcasts/expand";
import { automationOfferSlug } from "../../src/automations/offer-links";
import { handleEvent, runRuleForMember } from "../../src/automations/run";
import { runSync } from "../../src/sync/linkaffi-sync";
import { createBotAndChannel, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";

const CAMPAIGN = "Intégration offre des relances";
const TEMPLATE = "https://linkaffi.me/go/RLKEY01?sub_id={subid}";
const API_KEY = "lkst_relance_key";
const ANON_KEY = "anon_relance_key";

type Bot = ReturnType<typeof createBot>;
type DmButtons = Array<Array<{ text: string; url: string }>>;

function startUpdate(userId: number, firstName: string, payload: string, updateId: number) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: userId, type: "private" as const, first_name: firstName },
      from: { id: userId, is_bot: false, first_name: firstName, language_code: "fr" },
      text: `/start ${payload}`,
      entities: [{ type: "bot_command" as const, offset: 0, length: 6 }],
    },
  };
}

/** Le membre clique le bouton (le lien ouvre le bot avec `/start <charge>`) : renvoie le lien Link Affi reçu. */
async function click(
  bot: Bot,
  calls: TelegramCall[],
  userId: number,
  firstName: string,
  url: string,
  updateId: number,
): Promise<string> {
  const payload = new URL(url).searchParams.get("start")!;
  const before = calls.length;
  await bot.handleUpdate(startUpdate(userId, firstName, payload, updateId));
  const reply = calls
    .slice(before)
    .find((c) => c.method === "sendMessage" && c.payload.chat_id === userId);
  const button = (reply?.payload.reply_markup as InlineKeyboardMarkup | undefined)
    ?.inline_keyboard[0]?.[0] as { url?: string } | undefined;
  return button?.url ?? "";
}

/** API de lecture Link Affi simulée (même forme que docs/LINKAFFI-API.md). */
function fakeLinkAffi(tables: Record<string, Array<Record<string, unknown>>>): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-api-key"] !== API_KEY || req.headers["apikey"] !== ANON_KEY)
      return send(401, { error: "unauthorized" });
    const table = url.pathname.replace(/^\/stats-api\/?/, "");
    const rows = tables[table];
    if (!rows) return send(404, { error: "unknown table" });
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    const slice = rows.slice(offset, offset + limit);
    return send(200, {
      table,
      total: rows.length,
      offset,
      limit,
      count: slice.length,
      rows: slice,
    });
  });
}

describe("bouton « Offre (campagne) » : relances et messages à un groupe (base réelle)", () => {
  let botId = "";
  let campaignId = "";
  let offerId = "";
  let alice = "";
  let bruno = "";
  let bot: Bot;
  let calls: TelegramCall[] = [];
  let server: Server | null = null;

  beforeAll(async () => {
    await prisma.automationRun.deleteMany();
    await prisma.automationRule.deleteMany();
    await prisma.broadcast.deleteMany();
    await resetDb();
    await prisma.campaign.deleteMany({ where: { name: CAMPAIGN } });
    const { bot: botRow, channel } = await createBotAndChannel();
    botId = botRow.id;
    const program = await prisma.affiliateProgram.create({
      data: { name: "Casino relances", source: "LINKAFFI", externalId: "cas-rl" },
    });
    offerId = (
      await prisma.affiliateCampaign.create({
        data: {
          programId: program.id,
          externalId: "camp-rl",
          campaignKey: "RLKEY01",
          name: "Offre relances",
          trackingUrlTemplate: TEMPLATE,
        },
      })
    ).id;
    campaignId = (
      await prisma.campaign.create({
        data: {
          name: CAMPAIGN,
          status: "ACTIVE",
          affiliateCampaignIds: [offerId],
          channelIds: [channel.id],
        },
      })
    ).id;
    for (const [n, name] of [
      [910_001, "Alice"],
      [910_002, "Bruno"],
    ] as const) {
      const m = await prisma.member.create({
        data: { telegramUserId: BigInt(n), firstName: name, languageCode: "fr" },
      });
      await prisma.memberBotState.create({
        data: { memberId: m.id, botId, canDm: true, startedAt: new Date() },
      });
      await prisma.membership.create({
        data: {
          code: `RL${n}`,
          memberId: m.id,
          channelId: channel.id,
          status: "APPROVED",
          requestedAt: new Date(),
          joinedAt: new Date(),
        },
      });
      if (name === "Alice") alice = m.id;
      else bruno = m.id;
    }
    bot = createBot(botRow, prismaTelegramDeps);
    calls = installFakeTelegram(bot.api);
  });

  afterAll(async () => {
    // Rien ne doit gêner le `resetDb` des autres fichiers (envois et relances pointent vers les bots et les membres).
    await prisma.outboundMessage.deleteMany();
    await prisma.trackingLink.deleteMany({ where: { campaignId } });
    await prisma.post.deleteMany({ where: { templateName: { startsWith: "broadcast:" } } });
    await prisma.broadcast.deleteMany();
    await prisma.automationRun.deleteMany();
    await prisma.automationRule.deleteMany();
    await prisma.campaign.deleteMany({ where: { name: CAMPAIGN } });
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    delete process.env.LINKAFFI_API_URL;
    delete process.env.LINKAFFI_API_KEY;
    delete process.env.LINKAFFI_ANON_KEY;
  });

  it("relance avec bouton Offre : lien de la relance, un identifiant de suivi par membre au clic, joueur attribué à la relance", async () => {
    const rule = await prisma.automationRule.create({
      data: {
        name: "Relance offre",
        trigger: "JOINED",
        conditions: {},
        isActive: true,
        actions: [
          {
            type: "send_message",
            text: "Bonjour {prenom}, votre bonus vous attend.",
            buttons: [
              [{ text: "Voir l'offre", type: "OFFER", campaignId, affiliateCampaignId: offerId }],
              [{ text: "Aide", url: "https://exemple.fr/aide" }],
            ],
          },
        ],
      },
    });
    expect(
      (await handleEvent({ type: "event", trigger: "JOINED", memberId: alice, context: {} }))
        .started,
    ).toBe(1);
    expect(
      (await handleEvent({ type: "event", trigger: "JOINED", memberId: bruno, context: {} }))
        .started,
    ).toBe(1);

    // Un message par membre, rattaché à la relance ; le bouton Offre ouvre le bot avec le lien de la relance.
    const slug = automationOfferSlug(rule.id, campaignId, offerId);
    const deepLink = `https://t.me/bot_test?start=o${slug}`;
    const sent = await prisma.outboundMessage.findMany({
      where: { kind: "AUTOMATION" },
      orderBy: { queuedAt: "asc" },
    });
    expect(sent.map((o) => o.memberId)).toEqual([alice, bruno]);
    expect(sent.map((o) => o.automationRuleId)).toEqual([rule.id, rule.id]);
    expect(sent[0]!.text).toBe("Bonjour Alice, votre bonus vous attend.");
    for (const o of sent)
      expect(o.buttons).toEqual([
        [{ text: "Voir l'offre", url: deepLink }],
        [{ text: "Aide", url: "https://exemple.fr/aide" }],
      ]);

    // Un seul lien traqué pour la relance, rattaché à la relance, à la campagne et à l'offre.
    const links = await prisma.trackingLink.findMany({ where: { automationRuleId: rule.id } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      slug,
      kind: "OFFER",
      campaignId,
      affiliateCampaignId: offerId,
      isActive: true,
      label: "Voir l'offre (relance « Relance offre »)",
    });

    // Chaque membre clique : le bot crée SON identifiant de suivi et répond avec le lien Link Affi qui le porte.
    const urlA = await click(bot, calls, 910_001, "Alice", deepLink, 1);
    const urlB = await click(bot, calls, 910_002, "Bruno", deepLink, 2);
    expect(urlA).toMatch(/^https:\/\/linkaffi\.me\/go\/RLKEY01\?sub_id=[0-9A-Za-z]{12}$/);
    expect(urlB).toMatch(/^https:\/\/linkaffi\.me\/go\/RLKEY01\?sub_id=[0-9A-Za-z]{12}$/);
    const subA = new URL(urlA).searchParams.get("sub_id")!;
    const subB = new URL(urlB).searchParams.get("sub_id")!;
    expect(subA).not.toBe(subB);
    const clickA = await prisma.click.findUniqueOrThrow({
      where: { subId: subA },
      include: { trackingLink: true },
    });
    const clickB = await prisma.click.findUniqueOrThrow({
      where: { subId: subB },
      include: { trackingLink: true },
    });
    expect([clickA.memberId, clickB.memberId]).toEqual([alice, bruno]);
    expect(clickA.trackingLink.automationRuleId).toBe(rule.id);
    expect(clickA.postId).toBeNull();
    expect((await prisma.trackingLink.findUniqueOrThrow({ where: { slug } })).clicks).toBe(2);

    // Le joueur revient de Link Affi avec le sub-ID d'Alice (vraie synchro, API simulée) : il est attribué à la relance.
    const T0 = "2026-10-11T10:00:00.000Z";
    server = fakeLinkAffi({
      casinos: [{ id: "cas-rl", name: "Casino relances", is_active: true, updated_at: T0 }],
      campaigns: [
        {
          id: "camp-rl",
          campaign_key: "RLKEY01",
          casino_id: "cas-rl",
          name: "Offre relances",
          domain: null,
          created_at: T0,
        },
      ],
      players: [
        {
          id: "pl-rl-1",
          casino_id: "cas-rl",
          campaign_id: "camp-rl",
          external_player_id: "RL-1",
          sub_id: subA,
          sub_id_source: "postback",
          status: "active",
          ftd_amount: 30,
          ftd_at: T0,
          all_deposits_count: 1,
          total_deposited_amount: 30,
          redeposits_count: 0,
          created_at: T0,
          updated_at: T0,
        },
      ],
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    process.env.LINKAFFI_API_URL = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/stats-api`;
    process.env.LINKAFFI_API_KEY = API_KEY;
    process.env.LINKAFFI_ANON_KEY = ANON_KEY;
    const results = await runSync({
      client: new LinkAffiClient({ minIntervalMs: 0 }),
      tables: ["casinos", "campaigns", "players"],
    });
    expect(results.every((r) => r.ok)).toBe(true);
    const fromRule = await prisma.player.findMany({
      where: { click: { trackingLink: { automationRuleId: rule.id } } },
    });
    expect(fromRule.map((p) => [p.externalPlayerId, p.memberId, p.clickId])).toEqual([
      ["RL-1", alice, clickA.id],
    ]);
    expect(fromRule[0]!.ftdAt?.toISOString()).toBe(T0);
  });

  it("« Tester sur moi » : message de test rattaché à la relance mais compté à part (kind TEST)", async () => {
    const rule = await prisma.automationRule.findFirstOrThrow({ where: { name: "Relance offre" } });
    await runRuleForMember(rule.id, alice);
    const test = await prisma.outboundMessage.findFirstOrThrow({
      where: { kind: "TEST", memberId: alice },
      orderBy: { queuedAt: "desc" },
    });
    expect(test.automationRuleId).toBe(rule.id);
    // Même lien de la relance : aucun nouveau lien traqué.
    expect(await prisma.trackingLink.count({ where: { automationRuleId: rule.id } })).toBe(1);
  });

  it("relance « A cliqué sur une offre » avec bouton Offre : un clic sur son propre bouton ne la relance pas", async () => {
    const rule = await prisma.automationRule.create({
      data: {
        name: "Relance après un clic",
        trigger: "OFFER_CLICKED",
        conditions: {},
        isActive: true,
        oncePerMember: false,
        actions: [
          {
            type: "send_message",
            text: "Toujours partant, {prenom} ?",
            buttons: [
              [{ text: "Voir l'offre", type: "OFFER", campaignId, affiliateCampaignId: offerId }],
            ],
          },
        ],
      },
    });
    // Premier envoi : clic sur une offre ailleurs (message de canal, message à un groupe).
    expect(
      (await handleEvent({ type: "event", trigger: "OFFER_CLICKED", memberId: alice, context: {} }))
        .started,
    ).toBe(1);
    // Alice clique le bouton Offre de cette relance : l'événement émis par le bot (avec l'identifiant du clic) ne
    // relance pas la même relance (sinon un nouveau message à chaque clic).
    const deepLink = `https://t.me/bot_test?start=o${automationOfferSlug(rule.id, campaignId, offerId)}`;
    const url = await click(bot, calls, 910_001, "Alice", deepLink, 11);
    const own = await prisma.click.findUniqueOrThrow({
      where: { subId: new URL(url).searchParams.get("sub_id")! },
      select: { id: true, trackingLink: { select: { automationRuleId: true } } },
    });
    expect(own.trackingLink.automationRuleId).toBe(rule.id);
    expect(
      (
        await handleEvent({
          type: "event",
          trigger: "OFFER_CLICKED",
          memberId: alice,
          context: { clickId: own.id },
        })
      ).started,
    ).toBe(0);
    expect(await prisma.automationRun.count({ where: { ruleId: rule.id } })).toBe(1);
    expect(
      await prisma.outboundMessage.count({
        where: { automationRuleId: rule.id, kind: "AUTOMATION" },
      }),
    ).toBe(1);
    await prisma.automationRule.update({ where: { id: rule.id }, data: { isActive: false } });
  });

  it("relance existante à liens simples : envoyée comme avant, aucun lien traqué créé", async () => {
    const rule = await prisma.automationRule.create({
      data: {
        name: "Relance lien simple",
        trigger: "LEFT",
        conditions: {},
        isActive: true,
        actions: [
          {
            type: "send_message",
            text: "Au revoir {prenom}",
            buttons: [[{ text: "Site", url: "https://exemple.fr" }]],
          },
        ],
      },
    });
    await handleEvent({ type: "event", trigger: "LEFT", memberId: bruno, context: {} });
    const om = await prisma.outboundMessage.findFirstOrThrow({
      where: { automationRuleId: rule.id },
    });
    expect(om).toMatchObject({ kind: "AUTOMATION", memberId: bruno, text: "Au revoir Bruno" });
    expect(om.buttons).toEqual([[{ text: "Site", url: "https://exemple.fr" }]]);
    expect(await prisma.trackingLink.count({ where: { automationRuleId: rule.id } })).toBe(0);
    const run = await prisma.automationRun.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(run.status).toBe("DONE");
  });

  it("message à un groupe avec bouton Offre : un identifiant de suivi différent par membre, rattaché à l'envoi", async () => {
    const { channelId } = await prisma.campaign
      .findUniqueOrThrow({ where: { id: campaignId }, select: { channelIds: true } })
      .then((c) => ({ channelId: (c.channelIds as string[])[0]! }));
    const broadcast = await prisma.broadcast.create({
      data: {
        name: "Groupe offre",
        botId,
        segment: {},
        text: "Bonjour {prenom} !",
        status: "SENDING",
        startedAt: new Date(),
      },
    });
    // Ce que fait « Écrire à un groupe » à l'enregistrement : message conteneur + lien Offre de la campagne.
    const container = await prisma.post.create({
      data: {
        code: "GRPOFF01",
        channelId,
        botId,
        status: "SENT",
        sentAt: new Date(),
        text: "Bonjour",
        templateName: `broadcast:${broadcast.id}`,
      },
    });
    const link = await prisma.trackingLink.create({
      data: {
        slug: "grpoff01",
        kind: "OFFER",
        destinationTemplate: TEMPLATE,
        label: "Voir l'offre (message à un groupe)",
        channelId,
        postId: container.id,
        affiliateCampaignId: offerId,
        campaignId,
      },
    });
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        buttons: [
          [
            {
              text: "Voir l'offre",
              type: "OFFER",
              trackingLinkId: link.id,
              slug: link.slug,
              affiliateCampaignId: offerId,
              campaignId,
            },
          ],
        ],
      },
    });

    const r = await expandBroadcast(broadcast.id);
    expect(r.created).toBe(2);
    const messages = await prisma.outboundMessage.findMany({
      where: { broadcastId: broadcast.id },
      orderBy: { memberId: "asc" },
    });
    const deepLink = "https://t.me/bot_test?start=ogrpoff01_GRPOFF01";
    expect(messages.map((m) => (m.buttons as DmButtons)[0]![0]!.url)).toEqual([deepLink, deepLink]);
    expect(new Set(messages.map((m) => m.text))).toEqual(
      new Set(["Bonjour Alice !", "Bonjour Bruno !"]),
    );

    const urlA = await click(bot, calls, 910_001, "Alice", deepLink, 3);
    const urlB = await click(bot, calls, 910_002, "Bruno", deepLink, 4);
    const subA = new URL(urlA).searchParams.get("sub_id");
    const subB = new URL(urlB).searchParams.get("sub_id");
    expect(subA).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(subB).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(subA).not.toBe(subB);
    const clicks = await prisma.click.findMany({
      where: { trackingLinkId: link.id },
      orderBy: { createdAt: "asc" },
    });
    expect(clicks.map((c) => [c.memberId, c.postId, c.subId])).toEqual([
      [alice, container.id, subA],
      [bruno, container.id, subB],
    ]);
  });

  it("campagne supprimée après le premier envoi : la relance s'arrête en erreur et le journal l'explique", async () => {
    const rule = await prisma.automationRule.findFirstOrThrow({ where: { name: "Relance offre" } });
    const slug = automationOfferSlug(rule.id, campaignId, offerId);
    // Comme « Supprimer la campagne » : le lien reste (Campagnes → Liens), sans campagne.
    await prisma.campaign.delete({ where: { id: campaignId } });
    expect(await prisma.trackingLink.findUniqueOrThrow({ where: { slug } })).toMatchObject({
      campaignId: null,
      automationRuleId: rule.id,
    });
    const before = await prisma.outboundMessage.count({ where: { automationRuleId: rule.id } });
    const r = await runRuleForMember(rule.id, bruno);
    expect(r.status).toBe("FAILED");
    expect(r.error).toBe(
      "Bouton « Voir l'offre » : la campagne de l'offre a été supprimée ; choisissez-en une autre dans la relance.",
    );
    const run = await prisma.automationRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run.log).toEqual([
      expect.objectContaining({ type: "send_message", ok: false, detail: r.error }),
    ]);
    // Aucun message parti avec l'ancienne offre.
    expect(await prisma.outboundMessage.count({ where: { automationRuleId: rule.id } })).toBe(
      before,
    );
  });
});
