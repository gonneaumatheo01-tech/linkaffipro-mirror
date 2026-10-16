/**
 * Phase 16, « Sortie de TikTok » dans la rubrique Pages, sur la base réelle : envois de la page par la vraie route
 * `/j/_e` (agents utilisateurs simulés de TikTok, Instagram, Facebook, Safari et Chrome), écriture par le worker (même
 * code que la file `landing-events`), puis chiffres par source, pour toute la page et par système (iPhone, Android) :
 * « Aide affichée », « Sortis de TikTok », « % sortis » et « Telegram ouvert après la sortie ».
 * - HELP puis ESCAPED avec le même `vid` (page rouverte dans Safari) : 1 visite, 1 aide, 1 sortie, 100 % ;
 * - un 2e appui, une 2e aide ou une sortie renvoyée ne comptent pas deux fois ; robots jamais comptés ;
 * - % sortis = visites aidées puis sorties ÷ visites aidées : une sortie sans aide (nouvelle visite reconnue par
 *   `ttclid` / `fbclid`, ou page ouverte dans Safari ou Chrome avant l'appui) est comptée à part, jamais dans le % ;
 *   une sortie par `ttclid` d'une visite aidée (même identifiant de clic, repère `vid` perdu, 30 min au plus après
 *   l'aide) est rattachée à cette visite, par le worker ou par les chiffres ; une aide à 23 h 59 et une sortie à
 *   0 h 01 comptent le jour de l'aide ;
 * - Safari sur iPad se présente comme un Mac : la sortie reste comptée pour l'iPhone (système de l'aide) ;
 * - l'ouverture automatique (AUTO_TG / AUTO_INTENT) n'entre jamais dans « Telegram ouvert après le clic », ni une
 *   ouverture vue dans l'appli juste avant la sortie (la page cachée par le passage à Safari) ; « Telegram ouvert après
 *   la sortie » compte toute ouverture hors de l'appli après la sortie (tout seul ou par un appui) ;
 * - export CSV : les mêmes chiffres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import { parisMidnightUtc, resolvePeriod, shiftDay } from "@/lib/periods";
import { capturedJobs, createBotAndChannel, flushAfter, resetDb } from "./helpers";

const { loadLandingTables } = await import("@/lib/landing/stats");
const { landingCsv } = await import("@/lib/landing/csv");
const { LandingCache, prismaLandingStore, setLandingCacheForTests } =
  await import("@/lib/landing/cache");
const { POST: eventPOST } = await import("@/app/j/%5Fe/route");
const { writeLandingEvent } = await import("../../../worker/src/landing/events");

const UA = {
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR WKWebView/1 BytedanceWebview/d8a21c6",
  tiktokIpad:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR",
  tiktokAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 trill_360500 BytedanceWebview/d8a21c6",
  instagramAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A.240305.019.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 Instagram 321.0.0.39.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; fr_FR; 573487456)",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/482.0.0.40.79;]",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/23F77 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  safariIpad:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  robot: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
};

type Kind = "VIEW" | "CLICK" | "OPENED" | "HELP" | "ESCAPED" | "AUTO_OPEN";

describe("rubrique Pages : sortie de TikTok (base réelle, page simulée)", () => {
  const ids = { page: "", channel: "", page2: "" };
  const today = resolvePeriod({ range: "today" });
  let ip = 0;

  /** Un envoi de la page (même corps que `LANDING_SCRIPT`), depuis une adresse par visiteur. */
  const send = (
    visitor: { s: string; v: string; ip: string },
    t: Kind,
    ua: string,
    m: string | null = null,
    q = `?src=${visitor.s}`,
    page: string | null = null,
  ) =>
    eventPOST(
      new Request("https://go.goolink.eu/j/_e", {
        method: "POST",
        headers: {
          host: "go.goolink.eu",
          origin: "https://go.goolink.eu",
          "content-type": "text/plain;charset=UTF-8",
          "user-agent": ua,
          "x-forwarded-for": visitor.ip,
        },
        body: JSON.stringify({ p: page ?? ids.page, s: visitor.s, v: visitor.v, t, m, q }),
      }),
    );
  const visitor = (s: string, v: string) => ({ s, v, ip: `90.84.2.${++ip}` });

  beforeAll(async () => {
    await prisma.landingSource.deleteMany();
    await prisma.landingPage.deleteMany();
    await resetDb();
    const { channel } = await createBotAndChannel({ title: "Casino VIP" });
    ids.channel = channel.id;
    const page = await prisma.landingPage.create({
      data: {
        slug: "sortie-test",
        name: "Sortie",
        channelId: channel.id,
        headline: "Les meilleurs bonus",
        sources: { create: [{ key: "" }, { key: "tk01" }, { key: "tk03" }, { key: "tab" }] },
      },
    });
    ids.page = page.id;
    const page2 = await prisma.landingPage.create({
      data: {
        slug: "sortie-rattachement",
        name: "Rattachement",
        channelId: channel.id,
        headline: "Les meilleurs bonus",
        sources: { create: [{ key: "" }, { key: "tk01" }] },
      },
    });
    ids.page2 = page2.id;
    setLandingCacheForTests(new LandingCache({ store: prismaLandingStore() }));
  });

  afterAll(async () => {
    setLandingCacheForTests(null);
    await prisma.landingSource.deleteMany();
    await prisma.landingPage.deleteMany();
    await resetDb();
  });

  it("envois de la page acceptés et écrits par le worker (aide, sortie, ouverture automatique)", async () => {
    (globalThis.__jobs ??= []).length = 0;
    const marked = (s: string, v: string) => `?src=${s}&ttclid=TT-${v}&tgo=1&vid=${v}`;
    // A (tk03) : TikTok sur iPhone, deux appuis (l'aide revient), puis la page rouverte dans Safari avec le même
    // `vid` : sortie (renvoyée une 2e fois), ouverture automatique, Telegram ouvert.
    const a = visitor("tk03", "visitA-escape-0001");
    await send(a, "VIEW", UA.tiktokIos);
    await send(a, "CLICK", UA.tiktokIos, "TG_FRAME", marked("tk03", a.v));
    await send(a, "HELP", UA.tiktokIos, "TIKTOK", marked("tk03", a.v));
    await send(a, "CLICK", UA.tiktokIos, "TG_FRAME", marked("tk03", a.v));
    await send(a, "HELP", UA.tiktokIos, "TIKTOK", marked("tk03", a.v));
    await send(a, "ESCAPED", UA.safariIos, "TGO");
    await send(a, "ESCAPED", UA.safariIos, "TGO");
    await send(a, "AUTO_OPEN", UA.safariIos, "AUTO_TG");
    await send(a, "OPENED", UA.safariIos, "AUTO_TG");
    // tk01 : F (TikTok iPhone), B (TikTok Android) et E (Facebook Android) voient l'aide sans sortir ; C (Instagram
    // Android) sort vers Chrome, l'ouverture automatique est tentée mais Telegram ne s'ouvre pas.
    for (const [v, ua, m, app] of [
      ["visitF-escape-0001", UA.tiktokIos, "TG_FRAME", "TIKTOK"],
      ["visitB-escape-0001", UA.tiktokAndroid, "TG_FRAME", "TIKTOK"],
      ["visitE-escape-0001", UA.facebookAndroid, "INTENT_HELP", "FACEBOOK"],
      ["visitC-escape-0001", UA.instagramAndroid, "INTENT_HELP", "INSTAGRAM"],
    ] as const) {
      const x = visitor("tk01", v);
      await send(x, "VIEW", ua);
      await send(x, "CLICK", ua, m, marked("tk01", v));
      await send(x, "HELP", ua, app, marked("tk01", v));
    }
    const c = { s: "tk01", v: "visitC-escape-0001", ip: "90.84.3.1" };
    await send(c, "ESCAPED", UA.chromeAndroid, "TGO");
    await send(c, "AUTO_OPEN", UA.chromeAndroid, "AUTO_INTENT");
    // Robot (aperçu de lien) : aide et sortie enregistrées, jamais comptées.
    const r = visitor("tk01", "robot-escape-00001");
    await send(r, "HELP", UA.robot, "OTHER");
    await send(r, "ESCAPED", UA.robot, "TGO");
    // D (lien principal) : la page rouverte dans Chrome sans le marqueur, avec l'identifiant de clic de TikTok :
    // nouvelle visite, sortie reconnue par `ttclid`, sans aide dans cette visite.
    const d = visitor("", "visitD-escape-0001");
    await send(d, "VIEW", UA.chromeAndroid, null, "?ttclid=TT-D");
    await send(d, "ESCAPED", UA.chromeAndroid, "TTCLID", "?ttclid=TT-D");
    await send(d, "AUTO_OPEN", UA.chromeAndroid, "AUTO_INTENT", "?ttclid=TT-D");
    // G (source « tab ») : TikTok sur iPad, puis Safari sur iPad, qui se présente comme un Mac.
    const g = visitor("tab", "visitG-escape-0001");
    await send(g, "VIEW", UA.tiktokIpad);
    await send(g, "CLICK", UA.tiktokIpad, "TG_FRAME", marked("tab", g.v));
    await send(g, "HELP", UA.tiktokIpad, "TIKTOK", marked("tab", g.v));
    await send(g, "ESCAPED", UA.safariIpad, "TGO");
    await send(g, "AUTO_OPEN", UA.safariIpad, "AUTO_TG");

    await flushAfter();
    const jobs = capturedJobs("landing-events");
    expect(jobs).toHaveLength(33);
    for (const j of jobs) await writeLandingEvent((j.data as { event: never }).event);
    const rows = await prisma.landingEvent.findMany({ where: { landingPageId: ids.page } });
    expect(rows).toHaveLength(33);
    expect(
      rows
        .filter((e) => e.isBot)
        .map((e) => e.type)
        .sort(),
    ).toEqual(["ESCAPED", "HELP"]);
    // La sortie est écrite avec la même visite, hors de l'appli (Safari) ; sur iPad, Safari passe pour un Mac.
    expect(
      rows.filter((e) => e.visitId === a.v).map((e) => [e.type, e.os, e.inApp ?? "", e.method]),
    ).toEqual(
      expect.arrayContaining([
        ["HELP", "IOS", "TIKTOK", "TIKTOK"],
        ["ESCAPED", "IOS", "", "TGO"],
        ["AUTO_OPEN", "IOS", "", "AUTO_TG"],
        ["OPENED", "IOS", "", "AUTO_TG"],
      ]),
    );
    expect(rows.find((e) => e.visitId === g.v && e.type === "ESCAPED")?.os).toBe("OTHER");
  });

  it("HELP puis ESCAPED avec le même vid : 1 visite, 1 aide, 1 sortie, 100 %", async () => {
    const t = (await loadLandingTables([ids.page], today)).get(ids.page)!;
    const tk03 = t.sources.find((s) => s.key === "tk03")!;
    expect(tk03).toMatchObject({ visits: 1, clicks: 1 });
    const one = {
      help: 1,
      escaped: 1,
      helpedEscaped: 1,
      direct: 0,
      rate: 1,
      autoTried: 1,
      openedAfter: 1,
      autoOpened: 1,
    };
    expect(tk03.escape).toEqual({ ...one, systems: [{ os: "IOS", ...one }] });
    // L'ouverture automatique (dans Safari) n'est pas une ouverture « après le clic » dans TikTok.
    expect(tk03.opened.map((o) => [o.os, o.clicks, o.opened])).toEqual([["IOS", 1, 0]]);
  });

  it("par source et pour toute la page, détail iPhone / Android ; robots exclus ; iPad compté pour l'iPhone", async () => {
    const t = (await loadLandingTables([ids.page], today)).get(ids.page)!;
    const row = (k: string) => t.sources.find((s) => s.key === k)!;
    expect(row("tk01")).toMatchObject({ visits: 4, clicks: 4 });
    expect(row("tk01").escape).toMatchObject({
      help: 4,
      escaped: 1,
      rate: 0.25,
      autoTried: 1,
      autoOpened: 0,
    });
    expect(row("tk01").escape.systems.map((s) => [s.os, s.help, s.escaped, s.rate])).toEqual([
      ["IOS", 1, 0, 0],
      ["ANDROID", 3, 1, 1 / 3],
    ]);
    // Sortie par l'identifiant de clic de la pub, sans aucune aide avant elle : comptée à part (« sans l'aide »),
    // jamais dans le % (« — »).
    expect(row("").escape).toMatchObject({
      help: 0,
      escaped: 1,
      helpedEscaped: 0,
      direct: 1,
      rate: null,
      autoTried: 1,
    });
    expect(row("").visits).toBe(1);
    // iPad : la sortie (Safari, présenté comme un Mac) suit le système de l'aide.
    expect(row("tab").escape.systems.map((s) => [s.os, s.help, s.escaped])).toEqual([
      ["IOS", 1, 1],
    ]);
    // Toute la page : 7 visites (A, B, C, D, E, F, G ; la visite rouverte dans Safari n'en fait pas une 2e), 6 clics
    // (D n'a pas appuyé).
    expect(t.totals).toMatchObject({ visits: 7, clicks: 6 });
    // % sortis : A, C et G sont sorties après l'aide (3 sur 6 visites aidées) ; D, sortie sans l'aide, compte
    // dans les sortis mais pas dans le %.
    expect(t.totals.escape).toMatchObject({
      help: 6,
      escaped: 4,
      helpedEscaped: 3,
      direct: 1,
      rate: 3 / 6,
      autoTried: 4,
      openedAfter: 1,
      autoOpened: 1,
    });
    expect(
      t.totals.escape.systems.map((s) => [s.os, s.help, s.escaped, s.helpedEscaped, s.rate]),
    ).toEqual([
      ["IOS", 3, 2, 2, 2 / 3],
      ["ANDROID", 3, 2, 1, 1 / 3],
    ]);
    // « Telegram ouvert après le clic » : 6 premiers appuis dans les applis, aucune ouverture (l'ouverture
    // automatique dans Safari n'y entre pas).
    expect(t.totals.opened.reduce((s, o) => s + o.clicks, 0)).toBe(6);
    expect(t.totals.opened.reduce((s, o) => s + o.opened, 0)).toBe(0);

    // Une autre période : rien.
    const yesterday = (
      await loadLandingTables([ids.page], resolvePeriod({ range: "yesterday" }))
    ).get(ids.page)!;
    expect(yesterday.totals.escape).toMatchObject({ help: 0, escaped: 0, rate: null, systems: [] });
  });

  it("export CSV : aide affichée, sortis et % sortis, iPhone et Android, Telegram ouvert après la sortie", async () => {
    const table = (await loadLandingTables([ids.page], today)).get(ids.page)!;
    const csv = landingCsv({
      page: {
        name: "Sortie",
        slug: "sortie-test",
        sources: ["", "tk01", "tk03", "tab"].map((key) => ({ key, ad: null })),
      },
      table,
      periodText: "Aujourd'hui",
      trackingBase: "https://go.goolink.eu",
    });
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    const tail = (label: string) =>
      lines
        .find((l) => l.split(";")[2] === label)!
        .split(";")
        .slice(14);
    // Aide, sortis, dont après l'aide, dont sans l'aide, % sortis ; iPhone puis Android (aide, sortis après
    // l'aide, %) ; Telegram ouvert après la sortie, dont tout seul.
    expect(tail("tk03")).toEqual([
      "1",
      "1",
      "1",
      "0",
      "100,0",
      "1",
      "1",
      "100,0",
      "0",
      "0",
      "",
      "1",
      "1",
    ]);
    expect(tail("tk01")).toEqual([
      "4",
      "1",
      "1",
      "0",
      "25,0",
      "1",
      "0",
      "0,0",
      "3",
      "1",
      "33,3",
      "0",
      "0",
    ]);
    expect(tail("Lien principal")).toEqual([
      "0",
      "1",
      "0",
      "1",
      "",
      "0",
      "0",
      "",
      "0",
      "0",
      "",
      "0",
      "0",
    ]);
    expect(tail("Toute la page")).toEqual([
      "6",
      "4",
      "3",
      "1",
      "50,0",
      "3",
      "2",
      "66,7",
      "3",
      "1",
      "33,3",
      "1",
      "1",
    ]);
  });

  it("sortie rattachée par l'identifiant de clic, ouverture vue juste avant la sortie, Telegram ouvert par un appui", async () => {
    (globalThis.__jobs ??= []).length = 0;
    const p2 = ids.page2;
    const marked = (s: string, v: string) => `?src=${s}&ttclid=TT-${v}&tgo=1&vid=${v}`;
    // H : aide dans TikTok sur iPhone ; la page rouverte dans Chrome a perdu `tgo` et `vid` mais garde `ttclid` :
    // sortie TTCLID rattachée à l'aide de H (par le worker, qui reprend la visite de l'appli, ou par les chiffres, par
    // le même identifiant de clic). Chrome iPhone refuse l'ouverture automatique : la personne appuie sur le bouton,
    // Telegram s'ouvre (CLICK puis OPENED HTTPS).
    const h = visitor("tk01", "visitH-link-000001");
    await send(h, "VIEW", UA.tiktokIos, null, "?src=tk01&ttclid=TT-visitH-link-000001", p2);
    await send(h, "CLICK", UA.tiktokIos, "TG_FRAME", marked("tk01", h.v), p2);
    await send(h, "HELP", UA.tiktokIos, "TIKTOK", marked("tk01", h.v), p2);
    const h2 = visitor("tk01", "visitH2-link-00001");
    const q2 = `?src=tk01&ttclid=TT-${h.v}`;
    await send(h2, "VIEW", UA.chromeIos, null, q2, p2);
    await send(h2, "ESCAPED", UA.chromeIos, "TTCLID", q2, p2);
    await send(h2, "AUTO_OPEN", UA.chromeIos, "AUTO_TG", q2, p2);
    await send(h2, "CLICK", UA.chromeIos, "HTTPS", q2, p2);
    await send(h2, "OPENED", UA.chromeIos, "HTTPS", q2, p2);
    // I : dans TikTok sur iPhone, l'appui puis tout de suite « Ouvrir dans le navigateur » : la page de TikTok est
    // cachée moins de 2 s après l'appui (OPENED TG_FRAME), mais c'était la sortie, pas Telegram. Dans Safari,
    // l'ouverture automatique marche.
    const i = visitor("tk01", "visitI-link-000001");
    await send(i, "VIEW", UA.tiktokIos, null, undefined, p2);
    await send(i, "CLICK", UA.tiktokIos, "TG_FRAME", marked("tk01", i.v), p2);
    await send(i, "HELP", UA.tiktokIos, "TIKTOK", marked("tk01", i.v), p2);
    await send(i, "OPENED", UA.tiktokIos, "TG_FRAME", marked("tk01", i.v), p2);
    await send(i, "ESCAPED", UA.safariIos, "TGO", `?src=tk01&ttclid=TT-${i.v}`, p2);
    await send(i, "AUTO_OPEN", UA.safariIos, "AUTO_TG", `?src=tk01&ttclid=TT-${i.v}`, p2);
    await send(i, "OPENED", UA.safariIos, "AUTO_TG", `?src=tk01&ttclid=TT-${i.v}`, p2);
    // J : Facebook sur Android, Telegram s'ouvre vraiment depuis l'appli (aucune sortie) : ouverture comptée.
    const j = visitor("tk01", "visitJ-link-000001");
    await send(j, "VIEW", UA.facebookAndroid, null, undefined, p2);
    await send(j, "CLICK", UA.facebookAndroid, "INTENT_HELP", `?src=tk01&tgo=1&vid=${j.v}`, p2);
    await send(j, "HELP", UA.facebookAndroid, "FACEBOOK", `?src=tk01&tgo=1&vid=${j.v}`, p2);
    await send(j, "OPENED", UA.facebookAndroid, "INTENT_HELP", `?src=tk01&tgo=1&vid=${j.v}`, p2);
    // K : lien Meta ouvert directement dans Chrome (fbclid, aucune aide) : sortie à part.
    const k = visitor("", "visitK-link-000001");
    await send(k, "VIEW", UA.chromeAndroid, null, "?fbclid=FB-K", p2);
    await send(k, "ESCAPED", UA.chromeAndroid, "FBCLID", "?fbclid=FB-K", p2);
    await flushAfter();
    const jobs = capturedJobs("landing-events");
    expect(jobs).toHaveLength(21);
    for (const job of jobs) await writeLandingEvent((job.data as { event: never }).event);
    // M et N (écrits tels quels, sans le rattachement du worker : envois d'avant, ou repère introuvable) : sortie
    // TTCLID sous une autre visite, avec le même identifiant de clic que l'aide. M sort 3 min après l'aide : rattachée
    // à l'aide ; N sort 40 min après : trop tard (30 min au plus), sortie sans l'aide, et l'aide de N reste sans sortie.
    const start = parisMidnightUtc(resolvePeriod({ range: "today" }).from).getTime();
    const base = { landingPageId: p2, sourceKey: "", isBot: false };
    const atMin = (m: number) => new Date(start + m * 60_000);
    await prisma.landingEvent.createMany({
      data: [
        {
          ...base,
          visitId: "visitM-link-000001",
          type: "VIEW",
          os: "ANDROID",
          inApp: "TIKTOK",
          ttclid: "TT-M",
          createdAt: atMin(120),
        },
        {
          ...base,
          visitId: "visitM-link-000001",
          type: "HELP",
          os: "ANDROID",
          inApp: "TIKTOK",
          method: "TIKTOK",
          ttclid: "TT-M",
          createdAt: atMin(121),
        },
        {
          ...base,
          visitId: "visitM2-link-00001",
          type: "ESCAPED",
          os: "ANDROID",
          method: "TTCLID",
          ttclid: "TT-M",
          createdAt: atMin(124),
        },
        {
          ...base,
          visitId: "visitM2-link-00001",
          type: "AUTO_OPEN",
          os: "ANDROID",
          method: "AUTO_INTENT",
          ttclid: "TT-M",
          createdAt: atMin(124),
        },
        {
          ...base,
          visitId: "visitM2-link-00001",
          type: "OPENED",
          os: "ANDROID",
          method: "AUTO_INTENT",
          ttclid: "TT-M",
          createdAt: atMin(124.05),
        },
        {
          ...base,
          visitId: "visitN-link-000001",
          type: "HELP",
          os: "IOS",
          inApp: "TIKTOK",
          method: "TIKTOK",
          ttclid: "TT-N",
          createdAt: atMin(60),
        },
        {
          ...base,
          visitId: "visitN2-link-00001",
          type: "ESCAPED",
          os: "IOS",
          method: "TTCLID",
          ttclid: "TT-N",
          createdAt: atMin(100),
        },
      ],
    });
    // L : aide à 23 h 59 min 30 s (heure de Paris), sortie à 0 h 0 min 30 s le lendemain.
    const day = shiftDay(resolvePeriod({ range: "today" }).from, -2);
    const midnight = parisMidnightUtc(day).getTime();
    const l = {
      landingPageId: p2,
      sourceKey: "tk01",
      visitId: "visitL-link-000001",
      os: "IOS",
      isBot: false,
    };
    await prisma.landingEvent.createMany({
      data: [
        { ...l, type: "VIEW", inApp: "TIKTOK", createdAt: new Date(midnight - 40_000) },
        {
          ...l,
          type: "HELP",
          inApp: "TIKTOK",
          method: "TIKTOK",
          createdAt: new Date(midnight - 30_000),
        },
        { ...l, type: "ESCAPED", method: "TGO", createdAt: new Date(midnight + 30_000) },
      ],
    });

    const t = (await loadLandingTables([p2], today)).get(p2)!;
    const row = (key: string) => t.sources.find((s) => s.key === key)!;
    // tk01 : 3 visites aidées (H, I sur iPhone, J sur Android), H et I sorties ; Telegram ouvert après la sortie pour
    // les deux (I tout seul, H par un appui dans Chrome).
    expect(row("tk01").escape).toMatchObject({
      help: 3,
      escaped: 2,
      helpedEscaped: 2,
      direct: 0,
      rate: 2 / 3,
      autoTried: 2,
      openedAfter: 2,
      autoOpened: 1,
    });
    expect(row("tk01").escape.systems.map((s) => [s.os, s.help, s.helpedEscaped, s.rate])).toEqual([
      ["IOS", 2, 2, 1],
      ["ANDROID", 1, 0, 0],
    ]);
    // Lien principal : M (aide, sortie par le même identifiant de clic 3 min après, Telegram ouvert tout seul) et N
    // (aide sans sortie) ; K et N2 sorties sans l'aide.
    expect(row("").escape).toMatchObject({
      help: 2,
      helpedEscaped: 1,
      direct: 2,
      escaped: 3,
      rate: 0.5,
      openedAfter: 1,
      autoOpened: 1,
    });
    expect(row("").escape.systems.map((s) => [s.os, s.help, s.helpedEscaped, s.direct])).toEqual([
      ["IOS", 1, 0, 1],
      ["ANDROID", 1, 1, 1],
    ]);
    expect(t.totals.escape).toMatchObject({
      help: 5,
      helpedEscaped: 3,
      direct: 2,
      escaped: 5,
      rate: 3 / 5,
    });
    // « Telegram ouvert après le clic » : premiers appuis H et I dans TikTok, J dans Facebook ; l'ouverture vue pour I
    // juste avant sa sortie (la page de TikTok cachée par le passage à Safari) n'est pas comptée, celle de J (vraie
    // ouverture depuis l'appli) l'est.
    const browsers = t.totals.opened.flatMap((o) => o.browsers);
    const tiktok = browsers.find((b) => b.key === "IOS:TIKTOK")!;
    expect([tiktok.clicks, tiktok.opened]).toEqual([2, 0]);
    const facebook = browsers.find((b) => b.key === "ANDROID:FACEBOOK")!;
    expect([facebook.clicks, facebook.opened]).toEqual([1, 1]);

    // Aide la veille à 23 h 59, sortie à 0 h 01 : comptée le jour de l'aide, jamais une sortie sans aide le lendemain.
    const at = (d: string) =>
      loadLandingTables([p2], resolvePeriod({ from: d, to: d })).then((m) => m.get(p2)!);
    expect((await at(shiftDay(day, -1))).totals.escape).toMatchObject({
      help: 1,
      escaped: 1,
      helpedEscaped: 1,
      direct: 0,
      rate: 1,
    });
    expect((await at(day)).totals.escape).toMatchObject({ help: 0, escaped: 0, direct: 0 });
  });
});
