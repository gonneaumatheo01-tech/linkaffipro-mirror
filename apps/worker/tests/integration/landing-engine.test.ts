/**
 * Phase 15, moteur des pages d'atterrissage côté worker, sur base réelle (Telegram simulé, aucun appel réseau) :
 * - relecture du titre et de la petite photo des canaux qui ont une page active (`getChat`), invalidation du HTML ;
 * - nouvel essai des liens manquants des sources, révocation des liens qui ne sont plus le lien d'une source active
 *   (un lien remplacé parce que la pub de sa source a changé : seulement après le délai des liens remplacés) ;
 * - reprise des liens manquants chacune à son tour (les pages essayées le moins récemment d'abord) ;
 * - pub figée sur le lien (D9) : un lien garde pour toujours la pub et la campagne pour lesquelles il a été créé
 *   (changement de pub, pub supprimée, page supprimée : l'historique ne change pas), demandes et visites comptées pour
 *   la pub et sa campagne dans les statistiques journalières, une seule fois ; lien en trop d'un passage concurrent
 *   sans source, sans pub ni campagne ;
 * - purge des visites et clics selon la conservation des données personnelles.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  ensureLandingLinks,
  LANDING_REPLACED_GRACE_MS,
  pagesMissingLandingLinks,
  retryMissingLandingLinksWithDb,
  revokeDetachedLandingLinksWithDb,
  type LandingBotApi,
} from "@linkaffipro/telegram";
import { processMaintenance, repeatableMaintenance } from "../../src/processors/maintenance";
import {
  LANDING_STATS_JOB_PREFIX,
  runLandingChatRefresh,
  runLandingLinkRepair,
  workerLandingDeps,
} from "../../src/maintenance/landing";
import { runPurge } from "../../src/maintenance/purge";
import { recomputeDailyStats } from "../../src/stats/daily";
import { capturedJobs, createBotAndChannel, fakeJob, resetDb } from "./helpers";

type Call = { bot: string; method: string; args: unknown[] };

/** Telegram simulé par bot (identifiant de bot → réponses). */
function fakeTelegram(opts: { title?: () => string; photoUnique?: () => string | null } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const apiFor = async (botId: string): Promise<LandingBotApi | null> => ({
    async createChatInviteLink(chatId, other) {
      calls.push({ bot: botId, method: "createChatInviteLink", args: [chatId, other] });
      return { invite_link: `https://t.me/+landing${++n}x${Date.now().toString(36)}` };
    },
    async revokeChatInviteLink(chatId, link) {
      calls.push({ bot: botId, method: "revokeChatInviteLink", args: [chatId, link] });
      return true;
    },
    async getChat(chatId) {
      calls.push({ bot: botId, method: "getChat", args: [chatId] });
      const unique = opts.photoUnique?.() ?? null;
      return {
        id: chatId,
        type: "channel",
        title: opts.title?.() ?? "Canal test",
        ...(unique
          ? { photo: { small_file_id: `F-${unique}`, small_file_unique_id: unique } }
          : {}),
      };
    },
    async getFile(fileId) {
      calls.push({ bot: botId, method: "getFile", args: [fileId] });
      return { file_path: `profile_photos/${fileId}.jpg` };
    },
  });
  return { calls, apiFor };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function deps(tg: ReturnType<typeof fakeTelegram>, published: unknown[]) {
  return workerLandingDeps({
    apiFor: tg.apiFor,
    publish: async (msg) => {
      published.push(msg);
      return true;
    },
    fetch: (async (url: string | URL | Request) => {
      tg.calls.push({
        bot: "-",
        method: "download",
        args: [String(url).replace(/bot[^/]+\//, "bot<jeton>/")],
      });
      return new Response(JPEG, {
        status: 200,
        headers: { "content-length": String(JPEG.length) },
      });
    }) as typeof fetch,
    sleep: async () => undefined,
  });
}

async function cleanLanding() {
  await prisma.dailyStat.deleteMany();
  await prisma.adCost.deleteMany();
  await prisma.landingEvent.deleteMany();
  await prisma.landingSource.deleteMany();
  await prisma.landingPage.deleteMany();
  await prisma.inviteLink.updateMany({ data: { campaignId: null, landingAdId: null } });
  await prisma.campaign.deleteMany();
  await prisma.setting.deleteMany({
    where: { key: { in: ["retention.months", "stats.daily.lastRunAt"] } },
  });
}

async function seedPage(
  channelId: string,
  over: { showPhoto?: boolean; isActive?: boolean; slug?: string } = {},
) {
  return prisma.landingPage.create({
    data: {
      slug: over.slug ?? "promo",
      name: "Promo",
      channelId,
      headline: "Les meilleurs bonus",
      showPhoto: over.showPhoto ?? false,
      isActive: over.isActive ?? true,
      sources: { create: [{ key: "" }, { key: "tk01" }, { key: "exo1" }] },
    },
    include: { sources: true },
  });
}

beforeEach(async () => {
  await cleanLanding();
  await resetDb();
});

afterAll(async () => {
  await cleanLanding();
  await resetDb();
});

describe("tâches périodiques de la file maintenance", () => {
  it("relecture des canaux toutes les 5 minutes, reprise des liens toutes les 10 minutes", () => {
    expect(repeatableMaintenance).toEqual(
      expect.arrayContaining([
        { data: { type: "landing-chats" }, everyMs: 300_000, jobId: "maintenance-landing-chats" },
        { data: { type: "landing-links" }, everyMs: 600_000, jobId: "maintenance-landing-links" },
      ]),
    );
  });

  it("le processeur connaît les deux tâches (aucune page : rien à faire, aucun appel)", async () => {
    await expect(processMaintenance(fakeJob({ type: "landing-chats" }))).resolves.toMatchObject({
      checked: 0,
    });
    await expect(processMaintenance(fakeJob({ type: "landing-links" }))).resolves.toMatchObject({
      recomputeQueued: false,
    });
  });
});

describe("titre et photo des canaux qui ont une page", () => {
  it("titre changé chez Telegram : enregistré, photo récupérée si la page l'affiche, pages invalidées", async () => {
    const { channel } = await createBotAndChannel({ title: "Ancien titre" });
    await seedPage(channel.id, { showPhoto: true });
    const tg = fakeTelegram({ title: () => "Casino VIP 🎰", photoUnique: () => "U1" });
    const published: unknown[] = [];
    const r = await runLandingChatRefresh({ deps: deps(tg, published) });
    expect(r).toMatchObject({ checked: 1, updated: 1, failed: 0, retryLater: 0 });
    const c = await prisma.channel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(c.title).toBe("Casino VIP 🎰");
    expect(c.photoFileUniqueId).toBe("U1");
    expect(c.chatCheckedAt).toBeInstanceOf(Date);
    // La photo (octets) n'est jamais lue par une requête de canal qui ne la demande pas (client partagé : `omit`).
    expect("photoSmall" in c).toBe(false);
    const photo = await prisma.channel.findUniqueOrThrow({
      where: { id: channel.id },
      select: { photoSmall: true },
    });
    expect(Array.from(photo.photoSmall ?? [])).toEqual(Array.from(JPEG));
    expect(published).toEqual([{ channelId: channel.id }]);
    expect(tg.calls.map((x) => x.method)).toEqual(["getChat", "getFile", "download"]);
    expect(tg.calls[2]!.args[0]).toBe(
      "https://api.telegram.org/file/bot<jeton>/profile_photos/F-U1.jpg",
    );

    // Relu il y a moins de 30 minutes : pas de nouvel appel.
    const again = await runLandingChatRefresh({ deps: deps(tg, published) });
    expect(again.checked).toBe(0);
    expect(tg.calls).toHaveLength(3);
  });

  it("canal sans page active : jamais relu", async () => {
    const { channel } = await createBotAndChannel();
    await seedPage(channel.id, { isActive: false });
    const tg = fakeTelegram();
    await runLandingChatRefresh({ deps: deps(tg, []) });
    expect(tg.calls).toEqual([]);
  });
});

describe("liens d'invitation des sources", () => {
  it("nouvel essai : 3 sources → 3 liens LANDING par le bot du canal, puis plus rien", async () => {
    const { bot, channel } = await createBotAndChannel();
    const page = await seedPage(channel.id);
    await prisma.landingSource.updateMany({
      where: { landingPageId: page.id },
      data: {
        linkError:
          "Telegram ne répond pas pour l'instant : nouvel essai automatique dans quelques minutes.",
      },
    });
    const tg = fakeTelegram();
    const published: unknown[] = [];
    const r = await runLandingLinkRepair({ deps: deps(tg, published) });
    expect(r.retry).toMatchObject({ pages: 1, created: 3, failed: 0, stopped: false });
    const links = await prisma.inviteLink.findMany({
      where: { landingPageId: page.id },
      orderBy: { landingSource: "asc" },
    });
    expect(
      links.map((l) => [l.kind, l.landingSource, l.name, l.createsJoinRequest, l.botId]),
    ).toEqual([
      ["LANDING", "", "Promo", true, bot.id],
      ["LANDING", "exo1", "Promo-exo1", true, bot.id],
      ["LANDING", "tk01", "Promo-tk01", true, bot.id],
    ]);
    const sources = await prisma.landingSource.findMany({ where: { landingPageId: page.id } });
    expect(sources.every((s) => s.inviteLinkId && s.linkError === null)).toBe(true);
    expect(published).toEqual([{ pageId: page.id }]);
    expect(await prisma.event.count({ where: { type: "invite_link.landing_created" } })).toBe(3);

    const calls = tg.calls.length;
    const again = await runLandingLinkRepair({ deps: deps(tg, published) });
    expect(again.retry.pages).toBe(0);
    expect(tg.calls.length).toBe(calls);
  });

  it("source retirée, page supprimée : liens révoqués par le bot créateur ; page en pause : liens gardés", async () => {
    const { channel } = await createBotAndChannel();
    const tg = fakeTelegram();
    const page = await seedPage(channel.id);
    const paused = await seedPage(channel.id, { slug: "pause", isActive: false });
    const gone = await seedPage(channel.id, { slug: "supprimee" });
    const d = deps(tg, []);
    const { ensureLandingLinks } = await import("@linkaffipro/telegram");
    for (const p of [page, paused, gone]) await ensureLandingLinks(d, p.id);
    // Liens créés il y a plus de 10 minutes (délai de grâce des liens orphelins).
    await prisma.inviteLink.updateMany({ data: { createdAt: new Date(Date.now() - 3_600_000) } });
    await prisma.landingSource.update({
      where: { landingPageId_key: { landingPageId: page.id, key: "exo1" } },
      data: { isActive: false },
    });
    const goneLinks = await prisma.inviteLink.findMany({ where: { landingPageId: gone.id } });
    await prisma.landingPage.delete({ where: { id: gone.id } });

    const r = await runLandingLinkRepair({ deps: d });
    expect(r.detached).toMatchObject({ revoked: 4, disabledOnly: 0, retryLater: 0 });
    const revoked = tg.calls
      .filter((c) => c.method === "revokeChatInviteLink")
      .map((c) => c.args[1]);
    const exo1 = await prisma.inviteLink.findFirstOrThrow({
      where: { landingPageId: page.id, landingSource: "exo1" },
    });
    expect(revoked.sort()).toEqual(
      [exo1.telegramInviteLink, ...goneLinks.map((l) => l.telegramInviteLink)].sort(),
    );
    expect(await prisma.inviteLink.count({ where: { kind: "LANDING", isActive: true } })).toBe(
      2 + 3,
    );
    // Les liens de la page supprimée sont détachés (page null) mais gardent leur source.
    const detached = await prisma.inviteLink.findMany({
      where: { id: { in: goneLinks.map((l) => l.id) } },
    });
    expect(detached.every((l) => l.landingPageId === null && !l.isActive)).toBe(true);
  });
});

describe("reprise des liens manquants : chacune à son tour", () => {
  it("plus de pages en attente que la limite : chaque passage prend les pages essayées le moins récemment", async () => {
    const { channel } = await createBotAndChannel();
    // Aucun de nos bots administrateur : les liens échouent toujours (refus définitif, la reprise continue).
    await prisma.channelBotAdmin.updateMany({ data: { revokedAt: new Date() } });
    const pages = [];
    for (const slug of ["p-un", "p-deux", "p-trois"])
      pages.push(
        await prisma.landingPage.create({
          data: {
            slug,
            name: slug,
            channelId: channel.id,
            headline: "Accroche",
            sources: { create: [{ key: "" }] },
          },
        }),
      );
    const tg = fakeTelegram();
    const d = deps(tg, []);
    const first = await retryMissingLandingLinksWithDb({ deps: d, limit: 2 });
    expect(first).toMatchObject({ pages: 2, created: 0, failed: 2, stopped: false });
    const second = await retryMissingLandingLinksWithDb({ deps: d, limit: 2 });
    expect(second.pages).toBe(2);
    // Les trois pages ont été reprises en deux passages (la troisième n'attend pas derrière les deux premières).
    const tried = await prisma.landingSource.findMany({ where: { linkTriedAt: { not: null } } });
    expect(tried).toHaveLength(3);
    const third = await pagesMissingLandingLinks(1);
    expect(pages.map((p) => p.id)).toContain(third[0]);
    // Celle essayée le moins récemment passe en premier.
    const oldest = tried.sort((a, b) => a.linkTriedAt!.getTime() - b.linkTriedAt!.getTime())[0]!;
    expect(third).toEqual([oldest.landingPageId]);
  });
});

describe("pub figée sur le lien (D9)", () => {
  async function seedAds() {
    const a = await prisma.campaign.create({
      data: {
        name: "TikTok A",
        vertical: "CASINO",
        adSets: { create: [{ name: "Groupe 1", ads: { create: [{ name: "Pub X" }] } }] },
      },
      include: { adSets: { include: { ads: true } } },
    });
    const b = await prisma.campaign.create({
      data: {
        name: "Meta B",
        vertical: "CASINO",
        adSets: { create: [{ name: "Groupe 1", ads: { create: [{ name: "Pub Y" }] } }] },
      },
      include: { adSets: { include: { ads: true } } },
    });
    return { a: a.id, b: b.id, x: a.adSets[0]!.ads[0]!.id, y: b.adSets[0]!.ads[0]!.id };
  }

  let n = 0;
  async function request(channelId: string, inviteLinkId: string, at: Date) {
    const member = await prisma.member.create({
      data: { telegramUserId: BigInt(7_700_000 + ++n) },
    });
    await prisma.membership.create({
      data: {
        code: `lnd${n}x${Date.now().toString(36)}`,
        memberId: member.id,
        channelId,
        inviteLinkId,
        status: "APPROVED",
        requestedAt: at,
        approvedAt: at,
      },
    });
  }

  async function view(
    pageId: string,
    sourceKey: string,
    at: Date,
    over: { visitId?: string; isBot?: boolean; type?: "VIEW" | "CLICK" } = {},
  ) {
    await prisma.landingEvent.create({
      data: {
        landingPageId: pageId,
        sourceKey,
        type: over.type ?? "VIEW",
        visitId: over.visitId ?? `v${++n}x${Date.now().toString(36)}`,
        isBot: over.isBot ?? false,
        createdAt: at,
      },
    });
  }

  /** Somme d'une colonne de `DailyStat` sur tous les jours (aucune bascule de minuit possible dans le test). */
  async function total(dimension: string, field: "requests" | "approved" | "entryClicks") {
    const r = await prisma.dailyStat.aggregate({ where: { dimension }, _sum: { [field]: true } });
    return Number((r._sum as Record<string, unknown>)[field] ?? 0);
  }

  const back = (id: string, minutes: number) =>
    prisma.inviteLink.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - minutes * 60_000) },
    });

  /** Passage du worker une minute après la fin du délai des liens remplacés. */
  const afterGrace = () => new Date(Date.now() + LANDING_REPLACED_GRACE_MS + 60_000);

  it("pub reliée puis changée : nouveau lien à chaque fois, l'ancien révoqué garde sa pub, ses demandes et ses visites", async () => {
    const { channel } = await createBotAndChannel();
    const ids = await seedAds();
    const page = await seedPage(channel.id);
    const tg = fakeTelegram();
    const d = deps(tg, []);
    await runLandingLinkRepair({ deps: d });
    const tk01 = () =>
      prisma.landingSource.findUniqueOrThrow({
        where: { landingPageId_key: { landingPageId: page.id, key: "tk01" } },
        include: { inviteLink: true },
      });
    const l0 = (await tk01()).inviteLink!;
    expect(l0).toMatchObject({ landingAdId: null, campaignId: null });
    await back(l0.id, 60);

    // tk01 reliée à la pub X (campagne A) : un nouveau lien créé pour X ; l'ancien (sans pub) reste valable pendant le
    // délai des liens remplacés (visiteurs qui ont encore l'ancienne page), puis il est révoqué.
    await prisma.landingSource.update({ where: { id: (await tk01()).id }, data: { adId: ids.x } });
    const r1 = await runLandingLinkRepair({ deps: d });
    expect(r1.retry).toMatchObject({ pages: 1, created: 1, failed: 0 });
    expect(r1.detached).toMatchObject({ revoked: 0 });
    // L'historique ne change pas : aucun recalcul complet.
    expect(r1.recomputeQueued).toBe(false);
    expect((await runLandingLinkRepair({ deps: d, now: afterGrace() })).detached).toMatchObject({
      revoked: 1,
    });
    const l1 = (await tk01()).inviteLink!;
    expect(l1).toMatchObject({
      landingAdId: ids.x,
      campaignId: ids.a,
      landingSource: "tk01",
      isActive: true,
    });
    expect(await prisma.inviteLink.findUniqueOrThrow({ where: { id: l0.id } })).toMatchObject({
      isActive: false,
      landingAdId: null,
      campaignId: null,
      landingSource: "tk01",
    });
    await back(l1.id, 30);
    await request(channel.id, l0.id, new Date(Date.now() - 50 * 60_000));
    await request(channel.id, l1.id, new Date(Date.now() - 20 * 60_000));
    await view(page.id, "tk01", new Date(Date.now() - 50 * 60_000)); // bouton : lien sans pub
    await view(page.id, "tk01", new Date(Date.now() - 20 * 60_000), { visitId: "visite-x" }); // lien de X
    await view(page.id, "tk01", new Date(Date.now() - 19 * 60_000), { visitId: "visite-x" }); // même visite
    await view(page.id, "tk01", new Date(Date.now() - 18 * 60_000), { isBot: true }); // robot : jamais compté
    await view(page.id, "tk01", new Date(Date.now() - 17 * 60_000), { type: "CLICK" }); // clic : pas une visite

    // tk01 passe à la pub Y (campagne B) : nouveau lien pour Y ; l'ancien lien de X garde X et la campagne A.
    await prisma.landingSource.update({ where: { id: (await tk01()).id }, data: { adId: ids.y } });
    const r2 = await runLandingLinkRepair({ deps: d });
    expect(r2.retry.created).toBe(1);
    expect(r2.detached.revoked).toBe(0);
    expect(r2.recomputeQueued).toBe(false);
    expect((await runLandingLinkRepair({ deps: d, now: afterGrace() })).detached.revoked).toBe(1);
    const l2 = (await tk01()).inviteLink!;
    expect(l2).toMatchObject({ landingAdId: ids.y, campaignId: ids.b });
    expect(await prisma.inviteLink.findUniqueOrThrow({ where: { id: l1.id } })).toMatchObject({
      isActive: false,
      landingAdId: ids.x,
      campaignId: ids.a,
    });
    const revoked = tg.calls
      .filter((c) => c.method === "revokeChatInviteLink")
      .map((c) => c.args[1]);
    expect(revoked).toEqual([l0.telegramInviteLink, l1.telegramInviteLink]);
    await request(channel.id, l2.id, new Date());
    await view(page.id, "tk01", new Date());
    await view(page.id, "", new Date()); // lien principal, sans pub : pas un « clic pub »

    await recomputeDailyStats({ days: 2 });
    expect(await total("all", "requests")).toBe(3);
    expect(await total(`ad:${ids.x}`, "requests")).toBe(1);
    expect(await total(`ad:${ids.y}`, "requests")).toBe(1);
    expect(await total(`campaign:${ids.a}`, "requests")).toBe(1);
    expect(await total(`campaign:${ids.b}`, "requests")).toBe(1);
    // Visites de la page = « Clics pub » de la pub du lien affiché à ce moment-là (une par visite, robots exclus).
    expect(await total(`ad:${ids.x}`, "entryClicks")).toBe(1);
    expect(await total(`ad:${ids.y}`, "entryClicks")).toBe(1);
    expect(await total(`campaign:${ids.a}`, "entryClicks")).toBe(1);
    expect(await total(`campaign:${ids.b}`, "entryClicks")).toBe(1);
    expect(await total(`channel:${channel.id}`, "entryClicks")).toBe(2);
    expect(await total("all", "entryClicks")).toBe(2);
  });

  it("pub changée : l'ancien lien reste valable pendant le délai (page déjà affichée, cache du navigateur), puis révoqué ; source retirée : tout de suite", async () => {
    const { bot, channel } = await createBotAndChannel();
    const ids = await seedAds();
    const page = await seedPage(channel.id);
    const gone = await seedPage(channel.id, { slug: "supprimee" });
    const tg = fakeTelegram();
    const d = deps(tg, []);
    await runLandingLinkRepair({ deps: d });
    // Lien en trop (sans source) d'un passage concurrent sur la même page, jamais gardé par le délai des liens remplacés.
    const extra = await prisma.inviteLink.create({
      data: {
        channelId: channel.id,
        botId: bot.id,
        telegramInviteLink: `https://t.me/+entrop${Date.now().toString(36)}`,
        name: "Promo-tk01",
        kind: "LANDING",
        landingPageId: page.id,
      },
    });
    // Liens créés il y a une heure : seul le délai des liens remplacés peut les garder.
    await prisma.inviteLink.updateMany({ data: { createdAt: new Date(Date.now() - 3_600_000) } });
    // Page supprimée : ses liens (dont celui de sa source tk01) détachés, révoqués sans délai.
    const goneLinks = await prisma.inviteLink.findMany({ where: { landingPageId: gone.id } });
    await prisma.landingPage.delete({ where: { id: gone.id } });
    const key = (k: string) => ({ landingPageId_key: { landingPageId: page.id, key: k } });
    const linkOf = async (k: string) =>
      (
        await prisma.landingSource.findUniqueOrThrow({
          where: key(k),
          include: { inviteLink: true },
        })
      ).inviteLink!;
    const revokes = () =>
      tg.calls.filter((c) => c.method === "revokeChatInviteLink").map((c) => c.args[1]);
    expect(LANDING_REPLACED_GRACE_MS).toBeGreaterThanOrEqual(10 * 60_000);

    const old = await linkOf("tk01");
    await prisma.landingSource.update({ where: key("tk01"), data: { adId: ids.x } });
    // Passage du worker (nouveau lien) puis enregistrement sur le site (cette page seulement) : l'ancien est gardé ;
    // le lien en trop et ceux de la page supprimée (même clé tk01) sont révoqués tout de suite.
    const r = await runLandingLinkRepair({ deps: d });
    expect(r.retry.created).toBe(1);
    expect(r.detached).toMatchObject({ revoked: 1 + 3, disabledOnly: 0, retryLater: 0 });
    expect(revokes().sort()).toEqual(
      [extra.telegramInviteLink, ...goneLinks.map((l) => l.telegramInviteLink)].sort(),
    );
    tg.calls.length = 0;
    expect(await revokeDetachedLandingLinksWithDb({ deps: d, pageId: page.id })).toMatchObject({
      revoked: 0,
      disabledOnly: 0,
      retryLater: 0,
    });
    const almost = new Date(Date.now() + LANDING_REPLACED_GRACE_MS - 60_000);
    expect((await runLandingLinkRepair({ deps: d, now: almost })).detached.revoked).toBe(0);
    expect(await prisma.inviteLink.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      isActive: true,
      landingSource: "tk01",
      landingAdId: null,
    });
    expect(revokes()).toEqual([]);
    expect(await linkOf("tk01")).toMatchObject({ isActive: true, landingAdId: ids.x });

    // Délai passé : révoqué par le bot qui l'a créé ; il garde sa source (ses demandes restent rattachées).
    const after = await runLandingLinkRepair({ deps: d, now: afterGrace() });
    expect(after.detached).toMatchObject({ revoked: 1, disabledOnly: 0, retryLater: 0 });
    expect(revokes()).toEqual([old.telegramInviteLink]);
    expect(await prisma.inviteLink.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      isActive: false,
      landingSource: "tk01",
    });
    expect(await linkOf("tk01")).toMatchObject({ isActive: true, landingAdId: ids.x });

    // Pub d'exo1 changée puis source retirée aussitôt : l'ancien lien et le nouveau révoqués tout de suite à
    // l'enregistrement (une source retirée ne garde aucun lien).
    const oldExo = await linkOf("exo1");
    await prisma.landingSource.update({ where: key("exo1"), data: { adId: ids.y } });
    await ensureLandingLinks(d, page.id);
    const newExo = await linkOf("exo1");
    expect(newExo.id).not.toBe(oldExo.id);
    await prisma.landingSource.update({ where: key("exo1"), data: { isActive: false } });
    expect(await revokeDetachedLandingLinksWithDb({ deps: d, pageId: page.id })).toMatchObject({
      revoked: 2,
      disabledOnly: 0,
      retryLater: 0,
    });
    expect(
      await prisma.inviteLink.count({
        where: { id: { in: [oldExo.id, newExo.id] }, isActive: true },
      }),
    ).toBe(0);
    // Les autres sources gardent leur lien.
    expect((await linkOf("")).isActive).toBe(true);
  });

  it("pub supprimée : le lien garde sa campagne ; page supprimée : le lien garde sa pub", async () => {
    const { channel } = await createBotAndChannel();
    const ids = await seedAds();
    const page = await seedPage(channel.id);
    await prisma.landingSource.update({
      where: { landingPageId_key: { landingPageId: page.id, key: "tk01" } },
      data: { adId: ids.x },
    });
    await prisma.landingSource.update({
      where: { landingPageId_key: { landingPageId: page.id, key: "exo1" } },
      data: { adId: ids.y },
    });
    const tg = fakeTelegram();
    const d = deps(tg, []);
    await runLandingLinkRepair({ deps: d });
    const linkOf = (key: string) =>
      prisma.inviteLink.findFirstOrThrow({
        where: { landingSource: key, kind: "LANDING", isActive: true },
      });
    const lx = await linkOf("tk01");
    const ly = await linkOf("exo1");
    expect([lx.landingAdId, lx.campaignId, ly.landingAdId, ly.campaignId]).toEqual([
      ids.x,
      ids.a,
      ids.y,
      ids.b,
    ]);
    const at = new Date(Date.now() - 60_000);
    await request(channel.id, lx.id, at);
    await request(channel.id, ly.id, at);
    // Visite après la création du lien (le bouton n'affiche un lien qu'une fois créé).
    await view(page.id, "tk01", new Date());

    // Pub X supprimée (Campagnes → Pubs) : le lien perd sa pub mais reste dans la campagne A, rien n'est recréé.
    await prisma.ad.delete({ where: { id: ids.x } });
    const r = await runLandingLinkRepair({ deps: d });
    expect(r.retry.created).toBe(0);
    expect(r.ads).toEqual({ linksFixed: 0, recomputeNeeded: false });
    expect(await prisma.inviteLink.findUniqueOrThrow({ where: { id: lx.id } })).toMatchObject({
      isActive: true,
      landingAdId: null,
      campaignId: ids.a,
    });
    await recomputeDailyStats({ full: true });
    expect(await total(`campaign:${ids.a}`, "requests")).toBe(1);
    expect(await total(`campaign:${ids.a}`, "entryClicks")).toBe(1);

    // Page supprimée : ses liens gardent leur pub et leur campagne (la somme des pubs reste le total de la campagne).
    await prisma.landingPage.delete({ where: { id: page.id } });
    expect(await prisma.inviteLink.findUniqueOrThrow({ where: { id: ly.id } })).toMatchObject({
      landingPageId: null,
      landingAdId: ids.y,
      campaignId: ids.b,
    });
    expect((await runLandingLinkRepair({ deps: d })).recomputeQueued).toBe(false);
    await recomputeDailyStats({ full: true });
    expect(await total(`ad:${ids.y}`, "requests")).toBe(1);
    expect(await total(`campaign:${ids.b}`, "requests")).toBe(1);
    expect(await total(`campaign:${ids.a}`, "requests")).toBe(1);
  });

  it("campagne d'un lien actuel qui ne correspond plus à sa pub : corrigée, recalcul complet demandé", async () => {
    const { channel } = await createBotAndChannel();
    const ids = await seedAds();
    const page = await seedPage(channel.id);
    await prisma.landingSource.update({
      where: { landingPageId_key: { landingPageId: page.id, key: "tk01" } },
      data: { adId: ids.x },
    });
    const d = deps(fakeTelegram(), []);
    await runLandingLinkRepair({ deps: d });
    const lx = await prisma.inviteLink.findFirstOrThrow({
      where: { landingSource: "tk01", isActive: true },
    });
    await prisma.inviteLink.update({ where: { id: lx.id }, data: { campaignId: ids.b } });
    const r = await runLandingLinkRepair({ deps: d });
    expect(r.ads).toEqual({ linksFixed: 1, recomputeNeeded: true });
    expect(r.recomputeQueued).toBe(true);
    const job = capturedJobs("stats").at(-1)!;
    expect(job.data).toEqual({ type: "daily", full: true });
    expect(String(job.opts.jobId)).toMatch(new RegExp(`^${LANDING_STATS_JOB_PREFIX}-\\d+$`));
    expect((await prisma.inviteLink.findUniqueOrThrow({ where: { id: lx.id } })).campaignId).toBe(
      ids.a,
    );
    expect((await runLandingLinkRepair({ deps: d })).recomputeQueued).toBe(false);
  });

  it("deux passages en même temps : un seul lien posé par source ; le lien en trop sans source, sans pub ni campagne, révoqué", async () => {
    const { channel } = await createBotAndChannel();
    const ids = await seedAds();
    const page = await seedPage(channel.id);
    await prisma.landingSource.update({
      where: { landingPageId_key: { landingPageId: page.id, key: "tk01" } },
      data: { adId: ids.x },
    });
    const tg = fakeTelegram();
    // Telegram lent : les deux passages créent chacun leur lien avant que l'un d'eux ne l'enregistre.
    const slow = workerLandingDeps({
      apiFor: async (botId) => {
        const api = (await tg.apiFor(botId))!;
        return {
          ...api,
          createChatInviteLink: async (chatId, other) => {
            const r = await api.createChatInviteLink(chatId, other);
            await new Promise((ok) => setTimeout(ok, 50));
            return r;
          },
        };
      },
      publish: async () => true,
      sleep: async () => undefined,
    });
    await Promise.all([ensureLandingLinks(slow, page.id), ensureLandingLinks(slow, page.id)]);
    const links = await prisma.inviteLink.findMany({ where: { landingPageId: page.id } });
    expect(links).toHaveLength(6);
    const attached = await prisma.landingSource.findMany({ where: { landingPageId: page.id } });
    const current = new Set(attached.map((s) => s.inviteLinkId));
    const extra = links.filter((l) => !current.has(l.id));
    expect(extra).toHaveLength(3);
    expect(
      extra.every(
        (l) =>
          !l.isActive &&
          l.landingSource === null &&
          l.landingAdId === null &&
          l.campaignId === null,
      ),
    ).toBe(true);
    expect(
      links.filter((l) => current.has(l.id)).find((l) => l.landingSource === "tk01"),
    ).toMatchObject({
      isActive: true,
      landingAdId: ids.x,
      campaignId: ids.a,
    });
  });
});

describe("conservation des données personnelles", () => {
  it("visites et clics de plus de 24 mois supprimés par la purge nocturne, les autres gardés", async () => {
    const { channel } = await createBotAndChannel();
    const page = await seedPage(channel.id);
    const old = new Date(Date.now() - 25 * 31 * 86_400_000);
    await prisma.landingEvent.createMany({
      data: [
        {
          landingPageId: page.id,
          type: "VIEW",
          visitId: "visite-ancienne-1",
          ipHash: "h",
          createdAt: old,
        },
        { landingPageId: page.id, type: "CLICK", visitId: "visite-ancienne-1", createdAt: old },
        {
          landingPageId: page.id,
          type: "VIEW",
          visitId: "visite-recente-01",
          createdAt: new Date(),
        },
      ],
    });
    const r = await runPurge();
    expect(r.landingEventsDeleted).toBe(2);
    expect(await prisma.landingEvent.count()).toBe(1);
    const log = await prisma.auditLog.findFirst({
      where: { action: "maintenance.purge" },
      orderBy: { createdAt: "desc" },
    });
    expect((log?.metadata as { landingEventsDeleted?: number }).landingEventsDeleted).toBe(2);
  });
});
