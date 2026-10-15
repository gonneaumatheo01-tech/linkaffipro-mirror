/**
 * Phase 15, liens d'invitation des pages d'atterrissage côté site, sur base réelle (Telegram simulé, aucun appel
 * réseau) : une page et 3 sources → 3 liens LANDING créés AVEC demande d'adhésion par le bot de l'univers du canal
 * (même s'il n'est pas le bot principal), nommés « <page>-<source> », sans doublon si on relance ; journal de l'équipe ;
 * refus de Telegram gardé en français ; une demande par le lien d'une source via la vraie route du webhook (lien masqué
 * par Telegram, reçu par le bot principal) → provenance LANDING, exception « la page <nom> », compteurs du lien ;
 * invalidation publiée quand le titre du canal change ; pub d'une source changée → nouveau lien sur le bouton, l'ancien
 * reste valable (visiteurs qui ont encore la page à l'écran) ; source retirée et page supprimée → liens révoqués.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { prisma } from "@linkaffipro/db";
import { subscribeLandingInvalidate, type LandingInvalidateMessage } from "@linkaffipro/queue";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import {
  createTestBot,
  ctx,
  flushAfter,
  resetDb,
  webhookRequest,
  type TelegramCall,
} from "./helpers";

vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revalidatePath: () => undefined,
  updateTag: () => undefined,
  revalidateTag: () => undefined,
}));

const { syncLandingPageLinks, revokeLandingSourceLinks, loadLandingSourceLinks } =
  await import("@/lib/landing/links");
const { POST } = await import("@/app/api/telegram/[botId]/route");

const CHAT = -1001_950_000_001n;
const CAMPAIGN = "P15 · pub changée (liens)";

/** Telegram simulé par bot : liens uniques, refus à la demande, révocations consignées. */
class FakeTelegram {
  refuse = new Set<number>();
  private n = 0;
  install(api: Api, selfId: number): TelegramCall[] {
    const calls: TelegramCall[] = [];
    api.config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      calls.push({ method, payload: p });
      if (method === "createChatInviteLink" || method === "revokeChatInviteLink") {
        if (this.refuse.has(selfId))
          return {
            ok: false,
            error_code: 400,
            description: "Bad Request: not enough rights to manage chat invite links",
          } as never;
        if (method === "revokeChatInviteLink")
          return {
            ok: true,
            result: { invite_link: p.invite_link, is_revoked: true, creates_join_request: true },
          } as never;
        return {
          ok: true,
          result: {
            // Début unique, comme les vrais liens (Telegram en masque la fin pour les autres administrateurs).
            invite_link: `https://t.me/+${(++this.n).toString(36).padStart(3, "0")}L${selfId}zzzzzz`,
            creator: { id: selfId, is_bot: true, first_name: "bot" },
            creates_join_request: p.creates_join_request === true,
            is_primary: false,
            is_revoked: false,
            name: p.name,
          },
        } as never;
      }
      if (/^send(Message|Photo|Video|Animation|Document)$/.test(method))
        return {
          ok: true,
          result: {
            message_id: 1,
            date: Math.floor(Date.now() / 1000),
            chat: { id: Number(p.chat_id), type: "private" },
            text: p.text ?? "",
          },
        } as never;
      if (method === "getChat")
        return {
          ok: true,
          result: { id: Number(p.chat_id), type: "channel", title: "Casino VIP 🎰" },
        } as never;
      return { ok: true, result: true } as never;
    });
    return calls;
  }
}

describe("liens d'invitation des sources d'une page (base réelle)", () => {
  const tg = new FakeTelegram();
  const calls: Record<string, TelegramCall[]> = {};
  const ids = { channel: "", casino: "", sports: "", page: "", user: "", tk03: "" };
  const received: LandingInvalidateMessage[] = [];
  let sub: { close(): Promise<void> } | null = null;

  beforeAll(async () => {
    await prisma.landingSource.deleteMany();
    await prisma.landingPage.deleteMany();
    await resetDb();
    // Bot principal du canal : le bot sports ; bot de l'univers du canal (casino) : celui qui crée les liens.
    const sports = await createTestBot(951, "SPORTS");
    const casino = await createTestBot(952, "CASINO");
    ids.sports = sports.id;
    ids.casino = casino.id;
    calls.sports = tg.install(getOrCreateBot(sports, prismaTelegramDeps).api, 951);
    calls.casino = tg.install(getOrCreateBot(casino, prismaTelegramDeps).api, 952);
    const channel = await prisma.channel.create({
      data: {
        telegramChatId: CHAT,
        title: "Casino VIP",
        vertical: "CASINO",
        language: "fr",
        primaryBotId: sports.id,
        isTest: true,
        // Déjà relu : aucune relecture du titre à l'enregistrement (testée à part par le worker).
        chatCheckedAt: new Date(),
      },
    });
    ids.channel = channel.id;
    for (const botId of [sports.id, casino.id])
      await prisma.channelBotAdmin.create({
        data: {
          channelId: channel.id,
          botId,
          rights: { status: "administrator", can_invite_users: true },
        },
      });
    const page = await prisma.landingPage.create({
      data: {
        slug: "promo-vip",
        name: "Promo VIP",
        channelId: channel.id,
        headline: "Les meilleurs bonus",
        sources: { create: [{ key: "" }, { key: "tk01" }, { key: "tk03" }] },
      },
      include: { sources: true },
    });
    ids.page = page.id;
    ids.tk03 = page.sources.find((s) => s.key === "tk03")!.id;
    const user = await prisma.user.create({
      data: {
        email: `landing-${Date.now()}@test.local`,
        passwordHash: "x",
        name: "Resp",
        role: "MANAGER",
      },
    });
    ids.user = user.id;
    // Exception « la page Promo VIP » : tout de suite, sans canal à rejoindre ; par défaut : 1 heure.
    await prisma.approvalRule.create({
      data: {
        channelId: channel.id,
        name: "Règle par défaut",
        isDefault: true,
        scope: "DEFAULT",
        mode: "DELAY",
        delaySeconds: 3600,
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    await prisma.approvalRule.create({
      data: {
        channelId: channel.id,
        name: "Venu de la page « Promo VIP »",
        label: "Venu de la page « Promo VIP »",
        scope: "SOURCE_KIND",
        sourceKind: "LANDING_PAGE",
        landingPageId: page.id,
        mode: "DELAY",
        delaySeconds: 60,
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    sub = subscribeLandingInvalidate((m) => received.push(m));
  });

  afterAll(async () => {
    await sub?.close();
    await prisma.landingSource.deleteMany();
    await prisma.landingPage.deleteMany();
    await resetDb();
    await prisma.campaign.deleteMany({ where: { name: CAMPAIGN } });
  });

  it("3 sources → 3 liens LANDING avec demande d'adhésion, par le bot de l'univers du canal, journal de l'équipe", async () => {
    const r = await syncLandingPageLinks(ids.page, { userId: ids.user });
    expect(r).toMatchObject({ found: true, created: 3, failed: 0, revoked: 0 });
    expect(r.message).toBe("3 liens Telegram créés.");
    const created = calls.casino!.filter((c) => c.method === "createChatInviteLink");
    expect(
      created.map((c) => [c.payload.chat_id, c.payload.name, c.payload.creates_join_request]),
    ).toEqual([
      [Number(CHAT), "Promo VIP", true],
      [Number(CHAT), "Promo VIP-tk01", true],
      [Number(CHAT), "Promo VIP-tk03", true],
    ]);
    expect(calls.sports!.filter((c) => c.method === "createChatInviteLink")).toEqual([]);
    const links = await prisma.inviteLink.findMany({
      where: { landingPageId: ids.page },
      orderBy: { landingSource: "asc" },
    });
    expect(
      links.map((l) => [l.kind, l.landingSource, l.botId, l.createsJoinRequest, l.isActive]),
    ).toEqual([
      ["LANDING", "", ids.casino, true, true],
      ["LANDING", "tk01", ids.casino, true, true],
      ["LANDING", "tk03", ids.casino, true, true],
    ]);
    const views = await loadLandingSourceLinks(ids.page);
    expect(views.map((v) => [v.key, v.status, v.inviteUrl])).toEqual(
      links.map((l) => [l.landingSource, "ready", l.telegramInviteLink]),
    );
    expect(
      await prisma.auditLog.count({
        where: { userId: ids.user, action: "invite_link.landing_created" },
      }),
    ).toBe(3);
    expect(await prisma.event.count({ where: { type: "invite_link.landing_created" } })).toBe(3);
  });

  it("relancé : aucun doublon, aucun appel à Telegram", async () => {
    const before = calls.casino!.length + calls.sports!.length;
    const r = await syncLandingPageLinks(ids.page, { userId: ids.user });
    expect(r).toMatchObject({ created: 0, failed: 0, revoked: 0, message: null });
    expect(calls.casino!.length + calls.sports!.length).toBe(before);
    expect(await prisma.inviteLink.count({ where: { landingPageId: ids.page } })).toBe(3);
  });

  it("nouvelle source refusée par nos deux bots : refus en français gardé sur la source", async () => {
    tg.refuse.add(951);
    tg.refuse.add(952);
    const s = await prisma.landingSource.create({ data: { landingPageId: ids.page, key: "exo1" } });
    const r = await syncLandingPageLinks(ids.page);
    expect(r).toMatchObject({ created: 0, failed: 1 });
    const row = await prisma.landingSource.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.inviteLinkId).toBeNull();
    expect(row.linkError).toBe(
      "Telegram refuse que @bot_952 crée le lien dans « Casino VIP ». Ajoutez @bot_952 comme administrateur de « Casino VIP » avec le droit « Inviter via un lien ». Nouvel essai automatique dans quelques minutes.",
    );
    expect(r.message).toBe(`1 lien en attente : ${row.linkError}`);
    // Telegram accepte de nouveau : le lien est créé au passage suivant, le refus est effacé.
    tg.refuse.clear();
    expect((await syncLandingPageLinks(ids.page)).created).toBe(1);
    const fixed = await prisma.landingSource.findUniqueOrThrow({ where: { id: s.id } });
    expect(fixed.linkError).toBeNull();
    expect(fixed.inviteLinkId).not.toBeNull();
  });

  it("demande par le lien tk01 (masqué par Telegram, reçue par le bot principal) : provenance LANDING, exception de la page", async () => {
    const link = await prisma.inviteLink.findFirstOrThrow({
      where: { landingPageId: ids.page, landingSource: "tk01" },
    });
    // Le bot principal (sports) reçoit la demande ; le lien a été créé par le bot casino : Telegram en masque la fin.
    const masked = `${link.telegramInviteLink.slice(0, "https://t.me/+".length + 6)}…`;
    const res = await POST(
      webhookRequest(
        {
          update_id: 95_001,
          chat_join_request: {
            chat: { id: Number(CHAT), type: "channel", title: "Casino VIP" },
            from: { id: 95_100, is_bot: false, first_name: "Léa", language_code: "fr" },
            user_chat_id: 95_100,
            date: Math.floor(Date.now() / 1000) - 2,
            invite_link: {
              invite_link: masked,
              creator: { id: 952, is_bot: true, first_name: "Casino" },
              creates_join_request: true,
              is_primary: false,
              is_revoked: false,
            },
          },
        },
        "secret-951",
      ),
      ctx({ botId: ids.sports }),
    );
    expect(res.status).toBe(200);
    await flushAfter();
    const m = await prisma.membership.findFirstOrThrow({ where: { channelId: ids.channel } });
    expect(m.inviteLinkId).toBe(link.id);
    const source = m.source as Record<string, unknown>;
    expect(source.provenance).toMatchObject({
      type: "LANDING",
      inviteLinkId: link.id,
      landing: { pageId: ids.page, sourceKey: "tk01" },
      label: "Venu de la page « Promo VIP » (source « tk01 »)",
    });
    expect(source.appliedRule).toMatchObject({
      scope: "SOURCE_KIND",
      label: "Venu de la page « Promo VIP »",
    });
    expect(m.status).toBe("SCHEDULED");
    expect(m.approveAt!.getTime() - m.requestedAt.getTime()).toBe(60_000);
    expect((await prisma.inviteLink.findUniqueOrThrow({ where: { id: link.id } })).requests).toBe(
      1,
    );
  });

  it("titre du canal changé (mise à jour reçue par le bot) : pages du canal invalidées", async () => {
    received.length = 0;
    await prismaTelegramDeps.upsertChannel({
      id: Number(CHAT),
      type: "channel",
      title: "Casino VIP 🎰 nouveau",
    } as never);
    const deadline = Date.now() + 3000;
    while (!received.some((m) => m.channelId === ids.channel) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    expect(received).toContainEqual({ channelId: ids.channel });
    expect((await prisma.channel.findUniqueOrThrow({ where: { id: ids.channel } })).title).toBe(
      "Casino VIP 🎰 nouveau",
    );
  });

  it("pub de la source tk01 changée : le bouton prend un nouveau lien, l'ancien reste valable pour les visiteurs déjà sur la page", async () => {
    const campaign = await prisma.campaign.create({
      data: {
        name: CAMPAIGN,
        vertical: "CASINO",
        adSets: { create: [{ name: "Groupe 1", ads: { create: [{ name: "Pub X" }] } }] },
      },
      include: { adSets: { include: { ads: true } } },
    });
    const adId = campaign.adSets[0]!.ads[0]!.id;
    const tk01 = { landingPageId_key: { landingPageId: ids.page, key: "tk01" } };
    const old = (await prisma.landingSource.findUniqueOrThrow({ where: tk01 })).inviteLinkId!;
    const revokes = () =>
      [...calls.casino!, ...calls.sports!].filter((c) => c.method === "revokeChatInviteLink");
    const before = revokes().length;

    await prisma.landingSource.update({ where: tk01, data: { adId } });
    const r = await syncLandingPageLinks(ids.page, { userId: ids.user });
    expect(r).toMatchObject({ found: true, created: 1, failed: 0, revoked: 0 });
    const current = await prisma.landingSource.findUniqueOrThrow({
      where: tk01,
      include: { inviteLink: true },
    });
    expect(current.inviteLinkId).not.toBe(old);
    expect(current.inviteLink).toMatchObject({
      isActive: true,
      landingSource: "tk01",
      landingAdId: adId,
      campaignId: campaign.id,
    });
    expect(r.sources.find((s) => s.key === "tk01")).toMatchObject({
      status: "ready",
      inviteUrl: current.inviteLink!.telegramInviteLink,
    });
    // L'ancien lien n'est pas révoqué à l'enregistrement : la page déjà affichée (ou reprise du cache du navigateur,
    // ou par le retour arrière) garde un bouton qui fonctionne ; ses demandes comptent toujours pour l'ancienne pub.
    expect(await prisma.inviteLink.findUniqueOrThrow({ where: { id: old } })).toMatchObject({
      isActive: true,
      landingSource: "tk01",
      landingAdId: null,
    });
    expect(revokes()).toHaveLength(before);
    // Enregistré de nouveau tout de suite : toujours gardé.
    expect((await syncLandingPageLinks(ids.page, { userId: ids.user })).revoked).toBe(0);
    expect((await prisma.inviteLink.findUniqueOrThrow({ where: { id: old } })).isActive).toBe(true);
  });

  it("source retirée : son lien révoqué par le bot qui l'a créé ; page supprimée : tous ses liens révoqués", async () => {
    const tk03 = await prisma.inviteLink.findFirstOrThrow({
      where: { landingPageId: ids.page, landingSource: "tk03" },
    });
    await prisma.landingSource.update({ where: { id: ids.tk03 }, data: { isActive: false } });
    const r = await syncLandingPageLinks(ids.page, { userId: ids.user });
    expect(r.revoked).toBe(1);
    const revoked = calls.casino!.filter((c) => c.method === "revokeChatInviteLink");
    expect(revoked.map((c) => c.payload.invite_link)).toEqual([tk03.telegramInviteLink]);
    expect((await prisma.inviteLink.findUniqueOrThrow({ where: { id: tk03.id } })).isActive).toBe(
      false,
    );
    expect(r.sources.find((s) => s.key === "tk03")?.status).toBe("inactive");

    // Page supprimée : ses 3 liens actuels et l'ancien lien de tk01 (remplacé à l'instant) révoqués tout de suite.
    const all = await revokeLandingSourceLinks({ pageId: ids.page, userId: ids.user });
    expect(all).toMatchObject({ revoked: 4, disabledOnly: 0, retryLater: 0 });
    expect(
      await prisma.inviteLink.count({ where: { landingPageId: ids.page, isActive: true } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { userId: ids.user, action: "invite_link.landing_revoked" },
      }),
    ).toBe(2);
  });
});
