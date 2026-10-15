/**
 * Phase 15, scénario complet de la rubrique « Pages » sur la base réelle (Telegram simulé, aucun appel réseau) :
 * création d'une page avec 3 sources (tk01 reliée à une pub, tk03, exo1) et le lien principal → 4 liens d'invitation
 * AVEC demande d'adhésion, créés par le bot de l'univers du canal → page publique servie avec le lien de la source →
 * visites, clics et ouverture de Telegram envoyés par la page (robot et rechargement jamais comptés) et écrits par le
 * worker → demande d'adhésion par le lien de tk01 (mise à jour Telegram sur la vraie route du webhook) → acceptation
 * (entrée dans le canal) → chiffres justes dans le tableau (visites, clics, % de clic, demandes, acceptés,
 * % visite → join, coût par join, ouverture par téléphone), dans la liste, et comparaison avec les liens directs des
 * pubs du canal → modification (source retirée : lien révoqué) → suppression (liens révoqués, demandes gardées).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { prisma } from "@linkaffipro/db";
import { getOrCreateBot, prismaTelegramDeps } from "@linkaffipro/telegram";
import { mainSource, type LandingFormState } from "@/lib/landing/form";
import { periodDates, resolvePeriod } from "@/lib/periods";
import {
  capturedJobs,
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

const { saveLandingPage, deleteLandingPage } = await import("@/lib/landing/save");
const { loadLandingTables, loadDirectAdLinks } = await import("@/lib/landing/stats");
const { loadLandingList, loadLandingPage } = await import("@/lib/landing/queries");
const { LandingCache, prismaLandingStore, setLandingCacheForTests } =
  await import("@/lib/landing/cache");
const { POST: webhookPOST } = await import("@/app/api/telegram/[botId]/route");
const { GET: pageGET } = await import("@/app/j/[slug]/route");
const { POST: eventPOST } = await import("@/app/j/%5Fe/route");
const { writeLandingEvent } = await import("../../../worker/src/landing/events");

const CHAT = -1001_960_000_001n;
const BOT_TG = 961;

const UA = {
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR WKWebView/1 BytedanceWebview/d8a21c6",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A.240305.019.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 Instagram 321.0.0.39.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; fr_FR; 573487456)",
  robot: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
};

/** Telegram simulé du bot : liens uniques (création, révocation consignées), le reste répond « ok ». */
function installTelegram(api: Api): TelegramCall[] {
  const calls: TelegramCall[] = [];
  let n = 0;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (method === "createChatInviteLink")
      return {
        ok: true,
        result: {
          invite_link: `https://t.me/+flow${(++n).toString().padStart(3, "0")}Xy${BOT_TG}`,
          creator: { id: BOT_TG, is_bot: true, first_name: "Casino" },
          creates_join_request: p.creates_join_request === true,
          is_primary: false,
          is_revoked: false,
          name: p.name,
        },
      } as never;
    if (method === "revokeChatInviteLink")
      return {
        ok: true,
        result: { invite_link: p.invite_link, is_revoked: true, creates_join_request: true },
      } as never;
    if (/^send(Message|Photo)$/.test(method))
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
        result: { id: Number(p.chat_id), type: "channel", title: "Casino VIP" },
      } as never;
    return { ok: true, result: true } as never;
  });
  return calls;
}

function beacon(
  body: { p: string; s: string; v: string; t: string; m?: string | null; q?: string },
  ua: string,
) {
  return eventPOST(
    new Request("https://go.goolink.eu/j/_e", {
      method: "POST",
      headers: {
        host: "go.goolink.eu",
        origin: "https://go.goolink.eu",
        "content-type": "text/plain;charset=UTF-8",
        "user-agent": ua,
        "x-forwarded-for": "90.84.1.1",
      },
      body: JSON.stringify({ m: null, q: "", ...body }),
    }),
  );
}

let updateId = 96_000;
function joinRequest(userId: number, inviteLink: string) {
  return webhookRequest(
    {
      update_id: ++updateId,
      chat_join_request: {
        chat: { id: Number(CHAT), type: "channel", title: "Casino VIP" },
        from: { id: userId, is_bot: false, first_name: `Membre${userId}`, language_code: "fr" },
        user_chat_id: userId,
        date: Math.floor(Date.now() / 1000) - 5,
        invite_link: {
          invite_link: inviteLink,
          creator: { id: BOT_TG, is_bot: true, first_name: "Casino" },
          creates_join_request: true,
          is_primary: false,
          is_revoked: false,
        },
      },
    },
    `secret-${BOT_TG}`,
  );
}

function joined(userId: number, inviteLink: string) {
  const user = { id: userId, is_bot: false, first_name: `Membre${userId}` };
  return webhookRequest(
    {
      update_id: ++updateId,
      chat_member: {
        chat: { id: Number(CHAT), type: "channel", title: "Casino VIP" },
        from: { id: BOT_TG, is_bot: true, first_name: "Casino" },
        date: Math.floor(Date.now() / 1000) - 1,
        old_chat_member: { user, status: "left" },
        new_chat_member: { user, status: "member" },
        invite_link: {
          invite_link: inviteLink,
          creator: { id: BOT_TG, is_bot: true, first_name: "Casino" },
          creates_join_request: true,
          is_primary: false,
          is_revoked: false,
        },
      },
    },
    `secret-${BOT_TG}`,
  );
}

describe("rubrique Pages : scénario complet (base réelle, Telegram simulé)", () => {
  const ids = { bot: "", channel: "", user: "", page: "", campaign: "", ad: "" };
  let calls: TelegramCall[] = [];
  const today = resolvePeriod({ range: "today" });

  beforeAll(async () => {
    await prisma.landingSource.deleteMany();
    await prisma.landingPage.deleteMany();
    await resetDb();
    await prisma.campaign.deleteMany({ where: { name: "Flux pages · campagne" } });
    const bot = await createTestBot(BOT_TG, "CASINO");
    ids.bot = bot.id;
    calls = installTelegram(getOrCreateBot(bot, prismaTelegramDeps).api);
    const channel = await prisma.channel.create({
      data: {
        telegramChatId: CHAT,
        title: "Casino VIP",
        vertical: "CASINO",
        language: "fr",
        primaryBotId: bot.id,
        isTest: true,
        // Déjà relu : pas de relecture du titre à l'enregistrement (testée par le moteur).
        chatCheckedAt: new Date(),
      },
    });
    ids.channel = channel.id;
    await prisma.channelBotAdmin.create({
      data: {
        channelId: channel.id,
        botId: bot.id,
        rights: { status: "administrator", can_invite_users: true },
      },
    });
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
    const user = await prisma.user.create({
      data: {
        email: `pages-${Date.now()}@test.local`,
        passwordHash: "x",
        name: "Resp",
        role: "MANAGER",
      },
    });
    ids.user = user.id;
    // Une pub de nos campagnes, avec 30 € dépensés aujourd'hui (coût par join de tk01).
    const campaign = await prisma.campaign.create({
      data: {
        name: "Flux pages · campagne",
        vertical: "CASINO",
        status: "ACTIVE",
        adSets: { create: [{ name: "Groupe 1", ads: { create: [{ name: "Vidéo bonus" }] } }] },
      },
      include: { adSets: { include: { ads: true } } },
    });
    ids.campaign = campaign.id;
    ids.ad = campaign.adSets[0]!.ads[0]!.id;
    await prisma.adCost.create({
      data: {
        adId: ids.ad,
        levelKey: `ad:${ids.ad}`,
        date: periodDates(today).dateFrom,
        spend: 30,
        currency: "EUR",
        source: "MANUAL",
      },
    });
    setLandingCacheForTests(new LandingCache({ store: prismaLandingStore() }));
  });

  afterAll(async () => {
    setLandingCacheForTests(null);
    await prisma.landingSource.deleteMany();
    await prisma.landingPage.deleteMany();
    await resetDb();
    await prisma.campaign.deleteMany({ where: { id: ids.campaign } });
  });

  const form = (over: Partial<LandingFormState> = {}): LandingFormState => ({
    pageId: null,
    channelId: ids.channel,
    headline: "Les meilleurs bonus, chaque soir",
    subtext: "",
    buttonText: "",
    footnote: "Gratuit · 1 clic · via Telegram",
    language: "fr",
    tiktokPixel: "",
    metaPixel: "",
    cookieBanner: false,
    showPhoto: false,
    name: "Promo VIP",
    slug: "",
    slugTouched: false,
    isActive: true,
    sources: [
      mainSource(),
      { id: null, key: "tk01", adId: ids.ad, removed: false, main: false },
      { id: null, key: "TK03", adId: null, removed: false, main: false },
      { id: null, key: "exo1", adId: null, removed: false, main: false },
    ],
    ...over,
  });

  const linkOf = async (key: string) =>
    prisma.inviteLink.findFirstOrThrow({
      where: { landingPageId: ids.page, landingSource: key, isActive: true },
    });

  it("création : une page, 3 sources et le lien principal → 4 liens avec demande d'adhésion, par le bot du canal", async () => {
    const r = await saveLandingPage(form(), ids.user);
    expect(r).toMatchObject({
      ok: true,
      created: true,
      message: "Page créée. 4 liens Telegram créés.",
    });
    if (!r.ok) return;
    ids.page = r.pageId;
    const page = await prisma.landingPage.findUniqueOrThrow({
      where: { id: ids.page },
      include: { sources: { orderBy: { key: "asc" } } },
    });
    expect(page).toMatchObject({
      slug: "promo-vip",
      name: "Promo VIP",
      version: 1,
      isActive: true,
    });
    expect(page.sources.map((s) => [s.key, s.adId, !!s.inviteLinkId])).toEqual([
      ["", null, true],
      ["exo1", null, true],
      ["tk01", ids.ad, true],
      ["tk03", null, true],
    ]);
    const created = calls.filter((c) => c.method === "createChatInviteLink");
    expect(created.map((c) => [c.payload.name, c.payload.creates_join_request]).sort()).toEqual([
      ["Promo VIP", true],
      ["Promo VIP-exo1", true],
      ["Promo VIP-tk01", true],
      ["Promo VIP-tk03", true],
    ]);
    const links = await prisma.inviteLink.findMany({ where: { landingPageId: ids.page } });
    expect(links.every((l) => l.kind === "LANDING" && l.createsJoinRequest)).toBe(true);
    // Source reliée à une pub : son lien porte la campagne de la pub (ses demandes comptent pour elle).
    expect(links.find((l) => l.landingSource === "tk01")?.campaignId).toBe(ids.campaign);
    expect(links.find((l) => l.landingSource === "tk03")?.campaignId).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { userId: ids.user, action: "landing.page_created" } }),
    ).toBe(1);
    const detail = await loadLandingPage(ids.page);
    expect(detail?.links.map((l) => [l.key, l.status]).sort()).toEqual([
      ["", "ready"],
      ["exo1", "ready"],
      ["tk01", "ready"],
      ["tk03", "ready"],
    ]);
  });

  it("refus : adresse déjà prise, accroche vide (rien n'est créé)", async () => {
    const before = await prisma.landingPage.count();
    expect(await saveLandingPage(form({ slug: "promo-vip" }), ids.user)).toMatchObject({
      ok: false,
      error: "Cette adresse est déjà celle d'une autre page : choisissez-en une autre.",
    });
    expect(await saveLandingPage(form({ headline: "  " }), ids.user)).toMatchObject({
      ok: false,
      error: "Écrivez la phrase d'accroche.",
    });
    expect(await prisma.landingPage.count()).toBe(before);
  });

  it("page publique : le lien de la source demandée, sinon le lien principal", async () => {
    const tk01 = await linkOf("tk01");
    const main = await linkOf("");
    const res = await pageGET(
      new Request("https://go.goolink.eu/j/promo-vip?src=tk01", {
        headers: { host: "go.goolink.eu" },
      }),
      ctx({ slug: "promo-vip" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`href="${tk01.telegramInviteLink}"`);
    expect(html).toContain("Casino VIP");
    const other = await pageGET(
      new Request("https://go.goolink.eu/j/promo-vip?src=inconnue", {
        headers: { host: "go.goolink.eu" },
      }),
      ctx({ slug: "promo-vip" }),
    );
    expect(await other.text()).toContain(`href="${main.telegramInviteLink}"`);
  });

  it("visites, clics, ouverture : envoyés par la page, écrits par le worker ; robot et rechargement jamais comptés", async () => {
    (globalThis.__jobs ??= []).length = 0;
    const p = ids.page;
    // Visiteur A (TikTok, iPhone) : visite, rechargement, clic (appli ouverte directement), Telegram ouvert.
    await beacon(
      { p, s: "tk01", v: "visitorA000000001", t: "VIEW", q: "?src=tk01&ttclid=TT1" },
      UA.tiktokIos,
    );
    await beacon(
      { p, s: "tk01", v: "visitorA000000001", t: "VIEW", q: "?src=tk01&ttclid=TT1" },
      UA.tiktokIos,
    );
    await beacon(
      { p, s: "tk01", v: "visitorA000000001", t: "CLICK", m: "TG_SCHEME" },
      UA.tiktokIos,
    );
    await beacon(
      { p, s: "tk01", v: "visitorA000000001", t: "OPENED", m: "TG_SCHEME" },
      UA.tiktokIos,
    );
    // Visiteur B (TikTok, iPhone) : visite seulement.
    await beacon({ p, s: "tk01", v: "visitorB000000001", t: "VIEW" }, UA.tiktokIos);
    // Robot connu (aperçu de lien) : enregistré, jamais compté.
    await beacon({ p, s: "tk01", v: "robot000000000001", t: "VIEW" }, UA.robot);
    // Visiteur C (Instagram, Android) sur tk03 : visite et clic, Telegram ne s'ouvre pas.
    await beacon({ p, s: "tk03", v: "visitorC000000001", t: "VIEW" }, UA.instagramAndroid);
    await beacon(
      { p, s: "tk03", v: "visitorC000000001", t: "CLICK", m: "INTENT" },
      UA.instagramAndroid,
    );
    await flushAfter();
    const jobs = capturedJobs("landing-events");
    expect(jobs).toHaveLength(8);
    for (const j of jobs) await writeLandingEvent((j.data as { event: never }).event);
    expect(await prisma.landingEvent.count({ where: { landingPageId: p } })).toBe(8);
    expect(await prisma.landingEvent.count({ where: { landingPageId: p, isBot: true } })).toBe(1);
  });

  it("demande d'adhésion par le lien de tk01 (exception « la page Promo VIP ») puis acceptation ; une demande par tk03", async () => {
    await prisma.approvalRule.create({
      data: {
        channelId: ids.channel,
        name: "Venu de la page « Promo VIP »",
        label: "Venu de la page « Promo VIP »",
        scope: "SOURCE_KIND",
        sourceKind: "LANDING_PAGE",
        landingPageId: ids.page,
        mode: "DELAY",
        delaySeconds: 60,
        reminderAfterMinutes: [],
        maxReminders: 0,
      },
    });
    const tk01 = await linkOf("tk01");
    const tk03 = await linkOf("tk03");
    expect(
      (await webhookPOST(joinRequest(96_100, tk01.telegramInviteLink), ctx({ botId: ids.bot })))
        .status,
    ).toBe(200);
    await flushAfter();
    const m = await prisma.membership.findFirstOrThrow({
      where: { channelId: ids.channel, member: { telegramUserId: 96_100n } },
    });
    expect(m.inviteLinkId).toBe(tk01.id);
    expect(m.status).toBe("SCHEDULED");
    const source = m.source as Record<string, unknown>;
    expect(source.provenance).toMatchObject({
      type: "LANDING",
      landing: { pageId: ids.page, sourceKey: "tk01" },
      label: "Venu de la page « Promo VIP » (source « tk01 »)",
    });
    expect(source.appliedRule).toMatchObject({
      scope: "SOURCE_KIND",
      label: "Venu de la page « Promo VIP »",
    });
    // Acceptation (le bot a accepté, Telegram annonce l'entrée dans le canal).
    expect(
      (await webhookPOST(joined(96_100, tk01.telegramInviteLink), ctx({ botId: ids.bot }))).status,
    ).toBe(200);
    await flushAfter();
    const after = await prisma.membership.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.joinedAt).not.toBeNull();
    expect(await prisma.inviteLink.findUniqueOrThrow({ where: { id: tk01.id } })).toMatchObject({
      requests: 1,
      joined: 1,
    });

    expect(
      (await webhookPOST(joinRequest(96_101, tk03.telegramInviteLink), ctx({ botId: ids.bot })))
        .status,
    ).toBe(200);
    await flushAfter();
    expect(
      await prisma.membership.count({ where: { channelId: ids.channel, inviteLinkId: tk03.id } }),
    ).toBe(1);
  });

  it("tableau de la page : chiffres justes par source et pour toute la page", async () => {
    const t = (await loadLandingTables([ids.page], today)).get(ids.page)!;
    const row = (k: string) => t.sources.find((s) => s.key === k)!;
    expect(t.sources.map((s) => s.key)).toEqual(["", "exo1", "tk01", "tk03"]);
    expect(row("tk01")).toMatchObject({
      visits: 2,
      clicks: 1,
      clickRate: 0.5,
      requests: 1,
      approved: 1,
      visitToJoin: 0.5,
      spend: 30,
      costPerJoin: 30,
    });
    // Ouverture de Telegram par téléphone, puis par appli (les façons d'ouvrir se comparent dans une même appli).
    expect(row("tk01").opened).toEqual([
      {
        os: "IOS",
        clicks: 1,
        opened: 1,
        rate: 1,
        browsers: [
          {
            key: "IOS:TIKTOK",
            os: "IOS",
            inApp: "TIKTOK",
            label: "TikTok sur iPhone",
            clicks: 1,
            opened: 1,
            rate: 1,
            methods: [{ method: "TG_SCHEME", clicks: 1, opened: 1, rate: 1 }],
            httpsInApp: false,
          },
        ],
      },
    ]);
    expect(row("tk03")).toMatchObject({
      visits: 1,
      clicks: 1,
      requests: 1,
      approved: 0,
      visitToJoin: 1,
      spend: null,
      costPerJoin: null,
    });
    expect(row("exo1")).toMatchObject({ visits: 0, clicks: 0, requests: 0, clickRate: null });
    expect(t.totals).toMatchObject({
      visits: 3,
      clicks: 2,
      requests: 2,
      approved: 1,
      spend: 30,
      costPerJoin: 30,
    });
    expect(t.totals.clickRate).toBeCloseTo(2 / 3);
    expect(t.totals.opened.map((o) => [o.os, o.clicks, o.opened])).toEqual([
      ["IOS", 1, 1],
      ["ANDROID", 1, 0],
    ]);
    // Une autre période : rien.
    const yesterday = (
      await loadLandingTables([ids.page], resolvePeriod({ range: "yesterday" }))
    ).get(ids.page)!;
    // Aucune dépense de la pub ce jour-là : inconnue (« — »), jamais 0 € faute de donnée.
    expect(yesterday.totals).toMatchObject({
      visits: 0,
      clicks: 0,
      requests: 0,
      spend: null,
      spendNote: "none",
    });

    const list = await loadLandingList();
    const mine = list.rows.find((r) => r.id === ids.page)!;
    expect(mine).toMatchObject({ slug: "promo-vip", linkReady: true, sourceCount: 4 });
    expect(mine.table?.totals).toMatchObject({ visits: 3, clicks: 2, requests: 2 });
  });

  it("comparaison : les liens directs des pubs du même canal sur la même période", async () => {
    const link = await prisma.inviteLink.create({
      data: {
        channelId: ids.channel,
        botId: ids.bot,
        telegramInviteLink: "https://t.me/+directPub1",
        name: "Lien direct",
        kind: "AD_ENTRY",
        adPlatform: "TIKTOK",
        adName: "Pub directe",
      },
    });
    const tracking = await prisma.trackingLink.create({
      data: {
        slug: `flow${Date.now().toString(36)}`,
        kind: "AD_ENTRY",
        destinationTemplate: link.telegramInviteLink,
        label: "Lien direct",
        inviteLinkId: link.id,
        channelId: ids.channel,
      },
    });
    await prisma.click.createMany({
      data: [
        { trackingLinkId: tracking.id, isBot: false },
        { trackingLinkId: tracking.id, isBot: false },
        { trackingLinkId: tracking.id, isBot: false },
        { trackingLinkId: tracking.id, isBot: true },
      ],
    });
    const member = await prisma.member.create({
      data: { telegramUserId: 96_200n, firstName: "Direct" },
    });
    await prisma.membership.create({
      data: {
        code: `flow${Date.now().toString(36)}`,
        memberId: member.id,
        channelId: ids.channel,
        inviteLinkId: link.id,
        status: "APPROVED",
        approvedAt: new Date(),
      },
    });
    const direct = await loadDirectAdLinks(ids.channel, today);
    expect(direct.rows).toEqual([
      {
        inviteLinkId: link.id,
        name: "Pub directe",
        platform: "TIKTOK",
        isActive: true,
        clicks: 3,
        requests: 1,
        approved: 1,
        spend: null,
        spendNote: null,
        sharedWithPage: false,
        clickToJoin: 1 / 3,
        costPerJoin: null,
      },
    ]);

    // La pub de tk01 a aussi son lien direct, cliqué 2 fois aujourd'hui : ses 30 € sont partagés entre la page
    // (2 visites de tk01) et le lien direct (2 clics), jamais comptés deux fois.
    const adLink = await prisma.inviteLink.create({
      data: {
        channelId: ids.channel,
        botId: ids.bot,
        telegramInviteLink: "https://t.me/+directPub2",
        name: "Lien direct de la pub",
        kind: "AD_ENTRY",
        adPlatform: "TIKTOK",
        campaignId: ids.campaign,
      },
    });
    await prisma.ad.update({ where: { id: ids.ad }, data: { inviteLinkId: adLink.id } });
    const adTracking = await prisma.trackingLink.create({
      data: {
        slug: `flowad${Date.now().toString(36)}`,
        kind: "AD_ENTRY",
        destinationTemplate: adLink.telegramInviteLink,
        label: "Lien direct de la pub",
        inviteLinkId: adLink.id,
        channelId: ids.channel,
      },
    });
    await prisma.click.createMany({
      data: [
        { trackingLinkId: adTracking.id, isBot: false },
        { trackingLinkId: adTracking.id, isBot: false },
        { trackingLinkId: adTracking.id, isBot: true },
      ],
    });
    const shared = await loadDirectAdLinks(ids.channel, today);
    expect(shared.rows.find((r) => r.inviteLinkId === adLink.id)).toMatchObject({
      name: "Vidéo bonus",
      clicks: 2,
      spend: 15,
      sharedWithPage: true,
    });
    const page = (await loadLandingTables([ids.page], today)).get(ids.page)!;
    expect(page.sources.find((s) => s.key === "tk01")).toMatchObject({
      spend: 15,
      costPerJoin: 15,
    });
    expect(page.totals.spend! + shared.totals.spend!).toBe(30);
  });

  it("source inconnue ou mal recopiée dans la pub (?src=tk1) : comptée dans le lien principal et signalée", async () => {
    (globalThis.__jobs ??= []).length = 0;
    await beacon(
      { p: ids.page, s: "", v: "visitorD000000001", t: "VIEW", q: "?src=tk1" },
      UA.tiktokIos,
    );
    await flushAfter();
    for (const j of capturedJobs("landing-events"))
      await writeLandingEvent((j.data as { event: never }).event);
    const t = (await loadLandingTables([ids.page], today)).get(ids.page)!;
    expect(t.unknownSources).toEqual([{ raw: "tk1", visits: 1 }]);
    expect(t.sources.find((s) => s.key === "")?.visits).toBe(1);
  });

  it("modification : source retirée → son lien révoqué, nouvelle version ; suppression → liens révoqués, demandes gardées", async () => {
    const detail = (await loadLandingPage(ids.page))!;
    const exo1 = await linkOf("exo1");
    const sources = detail.sources
      .filter((s) => s.isActive)
      .map((s) =>
        s.key === ""
          ? mainSource(s.id, s.adId)
          : { id: s.id, key: s.key, adId: s.adId, removed: s.key === "exo1", main: false },
      );
    const r = await saveLandingPage(
      form({ pageId: ids.page, slug: "promo-vip", headline: "Nouvelle accroche", sources }),
      ids.user,
    );
    expect(r).toMatchObject({ ok: true, created: false });
    const page = await prisma.landingPage.findUniqueOrThrow({ where: { id: ids.page } });
    expect(page).toMatchObject({ version: 2, headline: "Nouvelle accroche" });
    expect(
      calls.filter((c) => c.method === "revokeChatInviteLink").map((c) => c.payload.invite_link),
    ).toEqual([exo1.telegramInviteLink]);
    expect((await prisma.inviteLink.findUniqueOrThrow({ where: { id: exo1.id } })).isActive).toBe(
      false,
    );
    expect(
      await prisma.auditLog.findFirst({
        where: { userId: ids.user, action: "landing.page_updated" },
        select: { metadata: true },
      }),
    ).toMatchObject({ metadata: { sourcesRemoved: ["exo1"] } });

    const del = await deleteLandingPage(ids.page, ids.user);
    expect(del).toEqual({
      ok: true,
      message: "Page « Promo VIP » supprimée : ses liens ne fonctionnent plus.",
    });
    expect(await prisma.landingPage.count({ where: { id: ids.page } })).toBe(0);
    expect(calls.filter((c) => c.method === "revokeChatInviteLink")).toHaveLength(4);
    expect(
      await prisma.inviteLink.count({
        where: { kind: "LANDING", channelId: ids.channel, isActive: true },
      }),
    ).toBe(0);
    // Les demandes déjà arrivées restent (leur provenance garde le nom de la page).
    expect(await prisma.membership.count({ where: { channelId: ids.channel } })).toBe(3);
    expect(
      await prisma.auditLog.count({ where: { userId: ids.user, action: "landing.page_deleted" } }),
    ).toBe(1);
  });
});
