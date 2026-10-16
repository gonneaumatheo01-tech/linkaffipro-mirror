/**
 * Phase 15 (pages d'atterrissage, page publique) sur la base réelle :
 * - `/j/<slug>?src=` servi depuis la mémoire : aucune requête à la base pour une page connue, aucune écriture, aucune
 *   redirection ; lien de la source (ou lien par défaut) ; mêmes octets quel que soit le visiteur (robot, TikTok,
 *   sans agent) ; HEAD, ETag / 304, page inconnue puis créée, titre du canal changé ;
 * - `/j/_e` : 204 tout de suite, puis mise en file `landing-events` (pays par la base locale, empreinte, système,
 *   navigateur intégré, ttclid), jamais l'adresse IP ; envoi trop gros, d'ailleurs ou d'une page inconnue : rien ;
 *   la ligne écrite par le worker (même code que la file) ;
 * - `/j/_p/<canal>.jpg` : photo du canal depuis la mémoire.
 * Telegram n'est jamais appelé (liens d'invitation déjà créés en base).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import { GET as pageGET, HEAD as pageHEAD } from "@/app/j/[slug]/route";
import { POST as eventPOST } from "@/app/j/%5Fe/route";
import { GET as photoGET } from "@/app/j/%5Fp/[file]/route";
import {
  LandingCache,
  prismaLandingStore,
  setLandingCacheForTests,
  type LandingStore,
} from "@/lib/landing/cache";
import { capturedJobs, createBotAndChannel, ctx, flushAfter, resetDb } from "./helpers";

const UA = {
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR WKWebView/1 BytedanceWebview/d8a21c6",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A.240305.019.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 Instagram 321.0.0.39.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; fr_FR; 573487456)",
  facebookPreview: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
};

/** Base réelle, appels comptés : prouve qu'une page connue ne coûte aucune lecture. */
function countingStore() {
  const real = prismaLandingStore();
  const calls = { loadActive: 0, loadBySlug: 0, pageExists: 0, loadPhotos: 0 };
  const store: LandingStore = {
    loadActive: () => (calls.loadActive++, real.loadActive()),
    loadBySlug: (s) => (calls.loadBySlug++, real.loadBySlug(s)),
    pageExists: (id) => (calls.pageExists++, real.pageExists(id)),
    loadPhotos: (ids) => (calls.loadPhotos++, real.loadPhotos(ids)),
  };
  return { store, calls };
}

let ids: { pageId: string; channelId: string; botId: string };

async function seed() {
  const { bot, channel } = await createBotAndChannel({ title: "Casino VIP 🎰" });
  const page = await prisma.landingPage.create({
    data: {
      slug: "promo-test",
      name: "Promo test",
      channelId: channel.id,
      headline: "Les meilleurs bonus du jour",
      subtext: "Rejoins les membres",
      footnote: "Gratuit · 1 clic · via Telegram",
    },
  });
  for (const key of ["", "tk01", "tk03", "exo1"]) {
    const link = await prisma.inviteLink.create({
      data: {
        channelId: channel.id,
        botId: bot.id,
        telegramInviteLink: `https://t.me/+Land${key || "Default"}Xyz`,
        name: key ? `Promo test-${key}` : "Promo test",
        kind: "LANDING",
        createsJoinRequest: true,
        landingPageId: page.id,
        landingSource: key,
      },
    });
    await prisma.landingSource.create({
      data: { landingPageId: page.id, key, inviteLinkId: link.id, isActive: key !== "exo1" },
    });
  }
  ids = { pageId: page.id, channelId: channel.id, botId: bot.id };
}

function pageReq(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://go.goolink.eu${path}`, {
    headers: { host: "go.goolink.eu", ...headers },
  });
}

function beaconReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://go.goolink.eu/j/_e", {
    method: "POST",
    headers: {
      host: "go.goolink.eu",
      origin: "https://go.goolink.eu",
      "content-type": "text/plain;charset=UTF-8",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("page d'atterrissage publique (base réelle)", () => {
  let counting: ReturnType<typeof countingStore>;

  beforeAll(async () => {
    await resetDb();
    await seed();
  });
  beforeEach(() => {
    counting = countingStore();
    setLandingCacheForTests(new LandingCache({ store: counting.store }));
  });
  afterAll(() => setLandingCacheForTests(null));

  it("sert la page de la source depuis la mémoire, sans redirection, sans écriture ni lecture répétée", async () => {
    const eventsBefore = await prisma.event.count();
    const res = await pageGET(
      pageReq("/j/promo-test?src=tk01&ttclid=TT1"),
      ctx({ slug: "promo-test" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'sha256-/);
    const html = await res.text();
    expect(html).toContain('<a id="b" href="https://t.me/+Landtk01Xyz">');
    expect(html).toContain('class="n">Casino VIP 🎰<');
    expect(html).toContain("<h1>Les meilleurs bonus du jour</h1>");
    expect(Buffer.byteLength(html)).toBeLessThan(15 * 1024);
    for (let i = 0; i < 30; i++) {
      const again = await pageGET(
        pageReq(`/j/promo-test?src=${["tk01", "tk03", "", "zz"][i % 4]}`),
        ctx({ slug: "promo-test" }),
      );
      expect(again.status).toBe(200);
    }
    expect(counting.calls).toEqual({ loadActive: 1, loadBySlug: 0, pageExists: 0, loadPhotos: 0 });
    await flushAfter();
    expect(await prisma.event.count()).toBe(eventsBefore);
    expect(await prisma.landingEvent.count()).toBe(0);
    expect(capturedJobs("landing-events")).toHaveLength(0);
  });

  it("mêmes octets pour un robot, une personne dans TikTok ou Instagram, et sans agent utilisateur", async () => {
    const variants: Array<Record<string, string>> = [
      { "user-agent": UA.facebookPreview },
      { "user-agent": UA.tiktokIos, "x-forwarded-for": "90.84.1.1", "accept-language": "fr-FR" },
      {
        "user-agent": UA.instagramAndroid,
        "x-forwarded-for": "2a01:cb00::1",
        "cf-ipcountry": "US",
      },
      {},
    ];
    const bodies = await Promise.all(
      variants.map(async (h) => {
        const r = await pageGET(pageReq("/j/promo-test?src=tk03", h), ctx({ slug: "promo-test" }));
        return {
          body: await r.text(),
          etag: r.headers.get("etag"),
          csp: r.headers.get("content-security-policy"),
        };
      }),
    );
    expect(new Set(bodies.map((b) => b.body)).size).toBe(1);
    expect(new Set(bodies.map((b) => b.etag)).size).toBe(1);
    expect(new Set(bodies.map((b) => b.csp)).size).toBe(1);
    expect(bodies[0]!.body).toContain('href="https://t.me/+Landtk03Xyz"');
  });

  it("phase 16 : même page avec ou sans le marqueur de sortie (tgo, vid, tgt, tgd), aide et scripts d'ouverture compris", async () => {
    const get = async (path: string, ua: string) =>
      pageGET(pageReq(path, { "user-agent": ua }), ctx({ slug: "promo-test" }));
    const safari =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/23F77 Safari/604.1";
    const plain = await get("/j/promo-test?src=tk01", UA.tiktokIos);
    const marked = await get(
      "/j/promo-test?src=tk01&ttclid=TT1&tgo=1&vid=a1b2c3d4e5f6a7b8c9d0e1f2&tgt=hs71j&tgd=1",
      safari,
    );
    // Jamais de redirection selon le navigateur (règle 7) : 200, mêmes octets, même ETag.
    expect(marked.status).toBe(200);
    expect(marked.headers.get("location")).toBeNull();
    const html = await plain.text();
    expect(await marked.text()).toBe(html);
    expect(marked.headers.get("etag")).toBe(plain.headers.get("etag"));
    // Code d'invitation pour l'ouverture automatique, aide cachée avec la table, deux scripts autorisés par la CSP.
    expect(html).toContain('<html lang="fr" data-k="Landtk01Xyz">');
    expect(html).toContain('<div id="h" class="h" role="dialog"');
    expect(html.match(/<script>/g)).toHaveLength(2);
    const csp = plain.headers.get("content-security-policy")!;
    expect(csp.match(/'sha256-/g)!.length).toBeGreaterThanOrEqual(3); // 2 scripts + CSS
    expect(csp).toContain("frame-src tg:;");
    expect(Buffer.byteLength(html)).toBeLessThan(15 * 1024);
  });

  it("source inconnue ou retirée : lien par défaut, exactement la page sans ?src=", async () => {
    const plain = await (
      await pageGET(pageReq("/j/promo-test"), ctx({ slug: "promo-test" }))
    ).text();
    const unknown = await (
      await pageGET(pageReq("/j/promo-test?src=inconnue"), ctx({ slug: "promo-test" }))
    ).text();
    const removed = await (
      await pageGET(pageReq("/j/promo-test?src=exo1"), ctx({ slug: "promo-test" }))
    ).text();
    expect(unknown).toBe(plain);
    expect(removed).toBe(plain);
    expect(plain).toContain('href="https://t.me/+LandDefaultXyz"');
    expect(plain).not.toContain("inconnue");
  });

  it("HEAD sans corps, ETag puis 304", async () => {
    const get = await pageGET(pageReq("/j/promo-test"), ctx({ slug: "promo-test" }));
    const head = await pageHEAD(pageReq("/j/promo-test"), ctx({ slug: "promo-test" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(get.headers.get("etag"));
    const cached = await pageGET(
      pageReq("/j/promo-test", { "if-none-match": get.headers.get("etag")! }),
      ctx({ slug: "promo-test" }),
    );
    expect(cached.status).toBe(304);
  });

  it("page inconnue : 404 ; créée ensuite : visible dès l'invalidation de son enregistrement", async () => {
    const miss = await pageGET(pageReq("/j/nouvelle-page"), ctx({ slug: "nouvelle-page" }));
    expect(miss.status).toBe(404);
    expect(miss.headers.get("cache-control")).toBe("no-store");
    const created = await prisma.landingPage.create({
      data: {
        slug: "nouvelle-page",
        name: "Nouvelle",
        channelId: ids.channelId,
        headline: "Nouvelle accroche",
      },
    });
    const link = await prisma.inviteLink.create({
      data: {
        channelId: ids.channelId,
        botId: ids.botId,
        telegramInviteLink: "https://t.me/+NouvelleXyz",
        name: "Nouvelle",
        kind: "LANDING",
        landingPageId: created.id,
        landingSource: "",
      },
    });
    await prisma.landingSource.create({
      data: { landingPageId: created.id, key: "", inviteLinkId: link.id },
    });
    // Message Redis `landing:invalidate` reçu (publié par l'enregistrement de la page).
    const { landingCache } = await import("@/lib/landing/cache");
    landingCache().invalidate({ pageId: created.id });
    const hit = await pageGET(pageReq("/j/nouvelle-page"), ctx({ slug: "nouvelle-page" }));
    expect(hit.status).toBe(200);
    expect(await hit.text()).toContain('href="https://t.me/+NouvelleXyz"');
  });

  it("titre du canal changé chez Telegram : la page montre le nouveau titre après l'invalidation du canal", async () => {
    const { landingCache } = await import("@/lib/landing/cache");
    expect(
      await (await pageGET(pageReq("/j/promo-test"), ctx({ slug: "promo-test" }))).text(),
    ).toContain("<title>Casino VIP 🎰</title>");
    await prisma.channel.update({
      where: { id: ids.channelId },
      data: { title: "Casino VIP Officiel" },
    });
    landingCache().invalidate({ channelId: ids.channelId });
    const html = await (
      await pageGET(pageReq("/j/promo-test"), ctx({ slug: "promo-test" }))
    ).text();
    expect(html).toContain("<title>Casino VIP Officiel</title>");
    await prisma.channel.update({ where: { id: ids.channelId }, data: { title: "Casino VIP 🎰" } });
  });

  it("en production, l'adresse du site ne sert ni la page, ni la photo, ni les envois (deuxième barrière)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRACKING_HOST", "go.goolink.eu");
    try {
      const site = { host: "app.linkaffipro.com" };
      const page = await pageGET(
        new Request("https://app.linkaffipro.com/j/promo-test?src=tk01", { headers: site }),
        ctx({ slug: "promo-test" }),
      );
      expect(page.status).toBe(404);
      expect(await page.text()).not.toContain("t.me");
      const photo = await photoGET(
        new Request(`https://app.linkaffipro.com/j/_p/${ids.channelId}.jpg`, { headers: site }),
        ctx({ file: `${ids.channelId}.jpg` }),
      );
      expect(photo.status).toBe(404);
      (globalThis.__jobs ??= []).length = 0;
      const sent = await eventPOST(
        new Request("https://app.linkaffipro.com/j/_e", {
          method: "POST",
          headers: { ...site, origin: "https://app.linkaffipro.com" },
          body: JSON.stringify({ p: ids.pageId, s: "tk01", v: "teamvisit0000001", t: "VIEW" }),
        }),
      );
      expect(sent.status).toBe(204);
      await flushAfter();
      expect(capturedJobs("landing-events")).toHaveLength(0);
      // Sur go.goolink.eu, rien ne change.
      const ok = await pageGET(pageReq("/j/promo-test?src=tk01"), ctx({ slug: "promo-test" }));
      expect(ok.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("photo du canal : seulement si la page l'affiche, servie depuis la mémoire", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    await prisma.channel.update({ where: { id: ids.channelId }, data: { photoSmall: jpeg } });
    const before = await (
      await pageGET(pageReq("/j/promo-test"), ctx({ slug: "promo-test" }))
    ).text();
    expect(before).not.toContain("<img");
    expect(
      (await photoGET(pageReq(`/j/_p/${ids.channelId}.jpg`), ctx({ file: `${ids.channelId}.jpg` })))
        .status,
    ).toBe(404);
    await prisma.landingPage.update({
      where: { id: ids.pageId },
      data: { showPhoto: true, version: { increment: 1 } },
    });
    const { landingCache } = await import("@/lib/landing/cache");
    landingCache().invalidate({ pageId: ids.pageId });
    const html = await (
      await pageGET(pageReq("/j/promo-test"), ctx({ slug: "promo-test" }))
    ).text();
    const src = /<img class="i" src="([^"]+)" width="88" height="88"/.exec(html)?.[1];
    expect(src).toMatch(new RegExp(`^/j/_p/${ids.channelId}\\.jpg\\?v=`));
    const v = new URL(src!, "https://go.goolink.eu").searchParams.get("v")!;
    const photo = await photoGET(pageReq(src!), ctx({ file: `${ids.channelId}.jpg` }));
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect(photo.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await photo.arrayBuffer())).toEqual(jpeg);
    expect(v).toBeTruthy();
    await prisma.landingPage.update({ where: { id: ids.pageId }, data: { showPhoto: false } });
  });
});

describe("envoi des visites et clics /j/_e (base réelle)", () => {
  const visitId = "a1b2c3d4e5f6a7b8c9d0e1f2";

  beforeAll(async () => {
    await resetDb();
    await seed();
  });
  beforeEach(() => {
    (globalThis.__jobs ??= []).length = 0;
    setLandingCacheForTests(new LandingCache({ store: prismaLandingStore() }));
  });
  afterAll(() => setLandingCacheForTests(null));

  it("répond 204 tout de suite, puis met en file la visite et le clic (pays, empreinte, système), jamais l'adresse IP", async () => {
    const headers = { "user-agent": UA.tiktokIos, "x-forwarded-for": "90.84.1.1, 100.64.0.1" };
    const q = "?src=tk01&ttclid=E.C.P.TT123&fbclid=FB9";
    const view = await eventPOST(
      beaconReq({ p: ids.pageId, s: "tk01", v: visitId, t: "VIEW", m: null, q }, headers),
    );
    expect(view.status).toBe(204);
    expect(await view.text()).toBe("");
    expect(view.headers.get("cache-control")).toBe("no-store");
    // Rien n'est fait avant la fin de la réponse.
    expect(capturedJobs("landing-events")).toHaveLength(0);
    const click = await eventPOST(
      beaconReq({ p: ids.pageId, s: "tk01", v: visitId, t: "CLICK", m: "TG_SCHEME", q }, headers),
    );
    expect(click.status).toBe(204);
    await flushAfter();
    const jobs = capturedJobs("landing-events");
    expect(jobs).toHaveLength(2);
    const events = jobs.map((j) => (j.data as { event: Record<string, unknown> }).event);
    expect(events.map((e) => e.type)).toEqual(["VIEW", "CLICK"]);
    expect(events[1]).toMatchObject({
      landingPageId: ids.pageId,
      sourceKey: "tk01",
      visitId,
      method: "TG_SCHEME",
      os: "IOS",
      inApp: "TIKTOK",
      country: "FR",
      isBot: false,
      ttclid: "E.C.P.TT123",
      fbclid: "FB9",
      rawSrc: null,
    });
    expect(events[1]!.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(jobs)).not.toContain("90.84.1.1");
    expect(jobs[0]!.opts.jobId).toBe(`landing-event:${events[0]!.id as string}`);
    expect(await prisma.landingEvent.count()).toBe(0); // écrit par le worker, jamais par le site

    // Le worker écrit ce que le site a mis en file (même code que la file `landing-events`).
    const { writeLandingEvent } = await import("../../../worker/src/landing/events");
    for (const j of jobs) await writeLandingEvent((j.data as { event: never }).event);
    const rows = await prisma.landingEvent.findMany({ orderBy: { type: "asc" } });
    expect(rows.map((r) => `${r.type}:${r.sourceKey}:${r.country}`).sort()).toEqual([
      "CLICK:tk01:FR",
      "VIEW:tk01:FR",
    ]);
  });

  it("phase 16 : aide affichée, sortie de l'appli et ouverture automatique mises en file puis écrites (même visite)", async () => {
    const safari =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/23F77 Safari/604.1";
    const v = "visit_tiktok_00001";
    const inTikTok = { "user-agent": UA.tiktokIos, "x-forwarded-for": "90.84.1.1" };
    const inSafari = { "user-agent": safari, "x-forwarded-for": "90.84.1.1" };
    const q = "?src=tk01&ttclid=TT-ESC";
    const sends = [
      [{ p: ids.pageId, s: "tk01", v, t: "VIEW", m: null, q }, inTikTok],
      [
        { p: ids.pageId, s: "tk01", v, t: "CLICK", m: "TG_FRAME", q: `${q}&tgo=1&vid=${v}` },
        inTikTok,
      ],
      [{ p: ids.pageId, s: "tk01", v, t: "HELP", m: "TIKTOK", q: `${q}&tgo=1&vid=${v}` }, inTikTok],
      [{ p: ids.pageId, s: "tk01", v, t: "ESCAPED", m: "TGO", q }, inSafari],
      [{ p: ids.pageId, s: "tk01", v, t: "AUTO_OPEN", m: "AUTO_TG", q }, inSafari],
    ] as const;
    for (const [body, headers] of sends) {
      const res = await eventPOST(beaconReq(body, headers));
      expect(res.status).toBe(204);
    }
    await flushAfter();
    const jobs = capturedJobs("landing-events");
    const events = jobs.map((j) => (j.data as { event: Record<string, unknown> }).event);
    expect(events.map((e) => `${e.type}:${e.method ?? ""}:${e.inApp ?? ""}`)).toEqual([
      "VIEW::TIKTOK",
      "CLICK:TG_FRAME:TIKTOK",
      "HELP:TIKTOK:TIKTOK",
      "ESCAPED:TGO:",
      "AUTO_OPEN:AUTO_TG:",
    ]);
    expect(new Set(events.map((e) => e.visitId))).toEqual(new Set([v]));
    expect(events.every((e) => e.sourceKey === "tk01" && e.ttclid === "TT-ESC")).toBe(true);
    const { writeLandingEvent } = await import("../../../worker/src/landing/events");
    for (const j of jobs) await writeLandingEvent((j.data as { event: never }).event);
    const rows = await prisma.landingEvent.findMany({ where: { visitId: v } });
    expect(rows.map((r) => r.type).sort()).toEqual(
      ["AUTO_OPEN", "CLICK", "ESCAPED", "HELP", "VIEW"].sort(),
    );
    expect(rows.find((r) => r.type === "ESCAPED")).toMatchObject({ os: "IOS", inApp: null });
  });

  it("robot connu : mis en file mais marqué ; source non suivie gardée pour le diagnostic", async () => {
    await eventPOST(
      beaconReq(
        { p: ids.pageId, s: "", v: visitId, t: "VIEW", m: null, q: "?src=inconnue" },
        { "user-agent": UA.facebookPreview, "x-forwarded-for": "2a01:cb00::1" },
      ),
    );
    await flushAfter();
    const [job] = capturedJobs("landing-events");
    expect((job!.data as { event: Record<string, unknown> }).event).toMatchObject({
      isBot: true,
      sourceKey: "",
      rawSrc: "inconnue",
      country: "FR",
    });
  });

  it("envoi trop gros, illisible, d'une autre origine ou d'une page inconnue : 204 et rien en file", async () => {
    const ok = { p: ids.pageId, s: "tk01", v: visitId, t: "VIEW", m: null, q: "" };
    const responses = await Promise.all([
      eventPOST(beaconReq("x".repeat(5000))),
      eventPOST(beaconReq("pas du json")),
      eventPOST(beaconReq(ok, { origin: "https://evil.example" })),
      eventPOST(beaconReq({ ...ok, p: "cm_page_inconnue" })),
      eventPOST(beaconReq({ ...ok, t: "PURCHASE" })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([204, 204, 204, 204, 204]);
    await flushAfter();
    expect(capturedJobs("landing-events")).toHaveLength(0);
  });
});
