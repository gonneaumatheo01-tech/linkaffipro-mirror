import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from "playwright";
import {
  ESCAPE_OPEN_METHOD,
  LANDING_AUTO_OPEN_MAX_MS,
  LANDING_TAP_REACTION_MS,
  escapeSpotFor,
  type EscapeApp,
  type EscapeSystem,
} from "@linkaffipro/core";
import { renderLandingHtml } from "@linkaffipro/core/landing-render";
import { LandingCache, type LandingPageRecord } from "./cache";
import { serveLandingPage } from "./serve";

/**
 * Phase 16 (sortir du navigateur intégré de TikTok), dans de vrais moteurs : WebKit avec les agents utilisateurs
 * iPhone, Chromium avec ceux d'Android. La page est servie par `serveLandingPage` avec ses vrais en-têtes (CSP
 * comprise) ; `/j/_e` et t.me sont interceptés (jamais appelés). Vérifie :
 * - navigateurs intégrés (TikTok, Instagram, Facebook × iPhone, Android) : repère de la visite dans l'adresse dès
 *   l'affichage, aide visible en moins de 100 ms après l'appui, flèche placée d'après la table, adresse marquée
 *   `tgo=1&vid=…&tgt=…`, tentative d'après la table (cadre caché `tg://` ; dans les applis Meta, `tg://` sur iPhone
 *   ou `intent://` sur Android demandé par la page, la page restant là) avec le code de cette façon d'ouvrir, aucune
 *   navigation vers t.me ;
 * - Safari et Chrome : le lien natif part en moins de 100 ms ;
 * - Safari puis Chrome avec le marqueur : tentative d'ouverture au chargement (< 300 ms après la première réponse),
 *   une seule fois, marqueur retiré ; aucune violation de la CSP ;
 * - pixels : PageView même après la tentative automatique, jamais de 2e ClickButton / Contact pour une personne
 *   sortie de l'appli (avec ou sans le repère), un seul au premier appui si elle est sortie avant d'appuyer ;
 * - aide dans un écran bas (paysage) : la flèche reste sur le bouton du menu quand l'aide défile ; « ⋮ » sans
 *   grand blanc dans la phrase.
 * Passé (sans échec) si les navigateurs de Playwright ne sont pas installés.
 */

const ENGINES: Record<"webkit" | "chromium", BrowserType> = { webkit, chromium };
const installed = (e: BrowserType) => {
  try {
    return existsSync(e.executablePath());
  } catch {
    return false;
  }
};
const available = installed(webkit) && installed(chromium);

type Env = {
  name: string;
  engine: "webkit" | "chromium";
  ua: string;
  app: EscapeApp | null;
  system: EscapeSystem;
};

const IOS = { engine: "webkit" as const, system: "IOS" as const };
const ANDROID = { engine: "chromium" as const, system: "ANDROID" as const };

const IN_APP: Env[] = [
  {
    ...IOS,
    name: "TikTok iPhone",
    app: "TIKTOK",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 musical_ly_47.1.0 BytedanceWebview/d8a21c6",
  },
  {
    ...ANDROID,
    name: "TikTok Android",
    app: "TIKTOK",
    ua: "Mozilla/5.0 (Linux; Android 14; SM-S921U Build/UP1A.231005.007; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.86 Mobile Safari/537.36 musical_ly_2024600020 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/46.0.2 ByteLocale/fr ByteFullLocale/fr Region/FR AppId/1233 Spark/1.7.2 AppVersion/46.0.2 PIA/2.5.3 BytedanceWebview/d8a21c6",
  },
  {
    ...IOS,
    name: "Instagram iPhone",
    app: "INSTAGRAM",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 326.0.3.32.105 (iPhone14,5; iOS 17_4; fr_FR; fr; scale=3.00; 1170x2532; 584287262)",
  },
  {
    ...ANDROID,
    name: "Instagram Android",
    app: "INSTAGRAM",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A.240305.019.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 Instagram 321.0.0.39.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; fr_FR; 573487456)",
  },
  {
    ...IOS,
    name: "Facebook iPhone",
    app: "FACEBOOK",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.38.108;FBBV/564431005;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.3.1;FBSS/3;FBID/phone;FBLC/fr_FR;FBOP/5]",
  },
  {
    ...ANDROID,
    name: "Facebook Android",
    app: "FACEBOOK",
    ua: "Mozilla/5.0 (Linux; Android 10; M2003J15SC Build/QP1A.190711.020; ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.7151.117 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/516.0.0.73.90;]",
  },
];

const SAFARI: Env = {
  ...IOS,
  name: "Safari iPhone",
  app: null,
  ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/23F77 Safari/604.1",
};
const CHROME: Env = {
  ...ANDROID,
  name: "Chrome Android",
  app: null,
  ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};

/** Navigateur intégré de Telegram : Telegram ouvre lui-même le lien, jamais d'aide (lien natif, comme Chrome). */
const TELEGRAM: Env = {
  ...ANDROID,
  name: "Telegram Android (navigateur intégré)",
  app: null,
  ua: "Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Telegram-Android/11.2.3 (Samsung SM-A546B; Android 14; SDK 34; AVERAGE)",
};

const ORIGIN = "https://go.goolink.eu";
const CODE = "AbCdEf123_-x";

function record(slug = "promo"): LandingPageRecord {
  const pixels = slug === "pix";
  return {
    id: pixels ? "p2" : "p1",
    slug,
    version: 1,
    channelId: "ch1",
    channelTitle: "Casino VIP",
    language: "fr",
    headline: "Les meilleurs bonus du jour",
    subtext: "Rejoins les membres",
    buttonText: null,
    footnote: "Gratuit · 1 clic · via Telegram",
    showPhoto: false,
    cookieBanner: false,
    tiktokPixelId: pixels ? "CD2UC93C77U35BVUO310" : null,
    metaPixelId: pixels ? "1070571443971391" : null,
    isActive: true,
    sources: [
      { key: "", isActive: true, inviteLink: `https://t.me/+${CODE}` },
      { key: "tk01", isActive: true, inviteLink: `https://t.me/+${CODE}` },
    ],
  };
}

const cache = new LandingCache({
  store: {
    loadActive: async () => [record(), record("pix")],
    loadBySlug: async (slug) => (slug === "pix" ? record("pix") : record()),
    pageExists: async () => true,
    loadPhotos: async () => [],
  },
});

type Beacon = { t: string; m: string | null; v: string };
type Session = {
  ctx: BrowserContext;
  page: Page;
  beacons: Beacon[];
  tme: string[];
  /** Demandes vers une appli (`tg:`, `intent:`) : cadre caché ou demande de la page. */
  apps: string[];
  /** Scripts des pixels demandés (TikTok, Meta), servis vides. */
  pixels: string[];
  errors: string[];
};

/** Repère `tgt` tel que la page l'écrit (minute en base 36), `minutesAgo` minutes avant maintenant. */
const tgtNow = (minutesAgo = 0) => (Math.floor(Date.now() / 6e4) - minutesAgo).toString(36);

/**
 * Mesures prises dans la page (horloge de la page) : appui, image suivante, fin du gestionnaire. Demandes d'adresse de
 * la page relevées par l'API Navigation (`navs`) : WebKit ne signale à Playwright ni un cadre `tg:` ni une demande
 * `tg:` de la page elle-même.
 */
const INIT = `(function(){
  var w=window;w.__lj={csp:[],taps:[],frames:[],navs:[]};
  if(w.navigation)w.navigation.addEventListener("navigate",function(e){w.__lj.navs.push(e.destination.url)});
  new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(x){if(x.tagName==="IFRAME")w.__lj.frames.push(x.src)})})}).observe(document,{childList:true,subtree:true});
  document.addEventListener("securitypolicyviolation",function(e){w.__lj.csp.push(e.violatedDirective+" "+e.blockedURI)});
  w.addEventListener("click",function(e){var t={ts:e.timeStamp,t0:performance.now(),frame:0,bubble:0};w.__lj.taps.push(t);
    requestAnimationFrame(function(){t.frame=performance.now()})},true);
  w.addEventListener("click",function(){var t=w.__lj.taps[w.__lj.taps.length-1];if(t)t.bubble=performance.now()});
})()`;

async function open(
  browser: Browser,
  env: Env,
  path: string,
  // Avec la tentative automatique, un moteur sans appli Telegram peut ne jamais finir le chargement (« load ») :
  // seule la lecture du HTML compte (la page reste entière, vérifié plus bas).
  waitUntil: "load" | "domcontentloaded" = "load",
): Promise<Session> {
  const ctx = await browser.newContext({
    userAgent: env.ua,
    viewport: env.system === "IOS" ? { width: 393, height: 750 } : { width: 412, height: 800 },
    deviceScaleFactor: 2,
    isMobile: env.engine === "chromium",
    hasTouch: true,
    locale: "fr-FR",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const s: Session = { ctx, page, beacons: [], tme: [], apps: [], pixels: [], errors: [] };
  page.on("request", (r) => {
    if (/^(tg|intent):/.test(r.url())) s.apps.push(r.url());
  });
  for (const host of ["https://analytics.tiktok.com/**", "https://connect.facebook.net/**"])
    await page.route(host, (route) => {
      s.pixels.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
    });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST" && url.pathname === "/j/_e") {
      try {
        s.beacons.push(JSON.parse(req.postData() ?? "{}") as Beacon);
      } catch {
        // envoi illisible : ignoré
      }
      return route.fulfill({ status: 204, body: "" });
    }
    const slug = url.pathname.replace(/^\/j\//, "");
    const res = await serveLandingPage(slug, url.searchParams.get("src"), null, "GET", cache);
    return route.fulfill({
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: Buffer.from(await res.arrayBuffer()),
    });
  });
  await page.route("https://t.me/**", (route) => {
    s.tme.push(route.request().url());
    return route.fulfill({ status: 204, body: "" });
  });
  page.on("pageerror", (e) => s.errors.push(e.message));
  await page.addInitScript(INIT);
  await page.goto(`${ORIGIN}${path}`, { waitUntil });
  return s;
}

/** Appels des pixels dans la page (scripts servis vides : les files d'attente des pixels restent lisibles). */
async function pixelCalls(
  page: Page,
): Promise<{ pageView: number; clickButton: number; contact: number; metaPageView: number }> {
  return (await page.evaluate(`(function(){var t=window.ttq||[],q=window.fbq&&window.fbq.queue||[];return {
    pageView:t.filter(function(x){return x[0]==="page"}).length,
    clickButton:t.filter(function(x){return x[0]==="track"&&x[1]==="ClickButton"}).length,
    metaPageView:[].filter.call(q,function(a){return a[1]==="PageView"}).length,
    contact:[].filter.call(q,function(a){return a[1]==="Contact"}).length}})()`)) as {
    pageView: number;
    clickButton: number;
    contact: number;
    metaPageView: number;
  };
}

type Tap = { ts: number; t0: number; frame: number; bubble: number };

/** Attend une condition (sans délai fixe : sous la charge de `pnpm test`, tout peut prendre plus de temps). */
async function until(
  cond: () => boolean | Promise<boolean>,
  page: Page,
  ms = 5000,
): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await page.waitForTimeout(50);
  }
  return cond();
}

async function tap(s: Session): Promise<Tap> {
  await s.page.locator("#b").tap({ noWaitAfter: true });
  let last: Tap | undefined;
  await until(async () => {
    const taps = (await s.page.evaluate("window.__lj.taps")) as Tap[];
    last = taps[taps.length - 1];
    return !!last && last.frame > 0 && last.bubble > 0;
  }, s.page);
  return last!;
}

const kinds = (s: Session) => s.beacons.map((b) => `${b.t}${b.m ? `:${b.m}` : ""}`);

describe.skipIf(!available)("page d'atterrissage : sortir de l'appli (vrais moteurs)", () => {
  const browsers = new Map<string, Browser>();
  const measures: string[] = [];
  beforeAll(async () => {
    for (const [name, engine] of Object.entries(ENGINES)) browsers.set(name, await engine.launch());
  }, 60_000);
  afterAll(async () => {
    await Promise.allSettled([...browsers.values()].map((b) => b.close()));
    console.info(`[phase 16] mesures :\n${measures.join("\n")}`);
  }, 60_000);

  it(
    "navigateurs intégrés : aide en moins de 100 ms, flèche d'après la table, adresse marquée, aucun saut vers t.me",
    { timeout: 120_000, retry: 1 },
    async () => {
      const failures: string[] = [];
      for (const env of IN_APP) {
        const s = await open(browsers.get(env.engine)!, env, "/j/promo?src=tk01&ttclid=E.C.P.TT1");
        try {
          await s.page.waitForTimeout(100);
          // Dès l'affichage : repère de la visite (sans tgo), pour une sortie avant tout appui.
          const before = (await s.page.evaluate("location.search")) as string;
          if (!/^\?src=tk01&ttclid=E\.C\.P\.TT1&vid=[\w-]{8,64}&tgt=[0-9a-z]+$/.test(before))
            failures.push(`${env.name} : repère à l'affichage ${before}`);
          const t = await tap(s);
          const visible = (await s.page.evaluate(
            `(function(){var h=document.getElementById("h");return !h.hidden&&getComputedStyle(h).display!=="none"})()`,
          )) as boolean;
          if (!visible) failures.push(`${env.name} : aide invisible`);
          // Part de la page : du début du traitement de l'appui à l'image suivante (le temps de remontée de l'appui
          // simulé jusqu'à la page dépend de la machine de test ; mesuré à part, depuis l'horodatage de l'appui).
          // Sous la charge de `pnpm test` (tous les paquets en parallèle), la machine de test retarde parfois l'image
          // elle-même : l'aide revenant à chaque appui, jusqu'à 4 nouveaux appuis (après « Fermer ») et le meilleur
          // temps retenu, comme pour toute mesure de vitesse.
          const round = (n: number) => Math.round(n * 10) / 10;
          let best = t;
          for (let i = 0; i < 4 && !(best.frame - best.t0 < LANDING_TAP_REACTION_MS); i++) {
            await s.page.evaluate(`document.getElementById("hx").click()`);
            await s.page.waitForTimeout(50);
            const again = await tap(s);
            if (again.frame - again.t0 < best.frame - best.t0) best = again;
          }
          const help = round(best.frame - best.t0);
          const fromTap = round(best.frame - best.ts);
          measures.push(
            `${env.name} : appui → aide visible (image suivante) ${help} ms (${fromTap} ms depuis l'horodatage de l'appui)`,
          );
          if (!(help < LANDING_TAP_REACTION_MS))
            failures.push(`${env.name} : aide après ${help} ms`);
          // Flèche : pointe (milieu du haut) sur le bouton du menu de l'appli, d'après la table.
          const box = (await s.page.evaluate(
            `(function(){var r=document.getElementById("ha").getBoundingClientRect();return {x:r.left+r.width/2,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}})()`,
          )) as { x: number; top: number; bottom: number; w: number; h: number };
          const spot = escapeSpotFor(env.app, env.system);
          const wantX = spot.corner.endsWith("right") ? box.w - spot.x : spot.x;
          const tipY = spot.corner.startsWith("top") ? box.top : box.h - box.bottom;
          if (Math.abs(box.x - wantX) > 1.5 || Math.abs(tipY - spot.y) > 1.5)
            failures.push(
              `${env.name} : flèche en (${box.x}, ${tipY}) au lieu de (${wantX}, ${spot.y})`,
            );
          const search = (await s.page.evaluate("location.search")) as string;
          if (!/^\?src=tk01&ttclid=E\.C\.P\.TT1&tgo=1&vid=[\w-]{8,64}&tgt=[0-9a-z]+$/.test(search))
            failures.push(`${env.name} : adresse ${search}`);
          const method = ESCAPE_OPEN_METHOD[spot.open];
          const wanted = ["VIEW", `CLICK:${method}`, `HELP:${env.app}`];
          await until(() => wanted.every((w) => kinds(s).includes(w)), s.page);
          // Aucune navigation, ni tout de suite ni plus tard ; une seule tentative vers l'appli Telegram, d'après la
          // table (cadre caché tg://, ou demande tg:// / intent:// de la page, que l'appli Meta passe au téléphone).
          await s.page.waitForTimeout(1000);
          if (s.tme.length) failures.push(`${env.name} : navigation vers ${s.tme.join(", ")}`);
          // (WebKit ne signale pas la demande d'un cadre `tg:` : le cadre ajouté est relevé dans la page.)
          const frames = (await s.page.evaluate("window.__lj.frames")) as string[];
          const navs = ((await s.page.evaluate("window.__lj.navs")) as string[]).filter(
            (u) => !/^https?:/.test(u),
          );
          const tries =
            spot.open === "TG"
              ? [...frames, ...s.apps.filter((u) => u.startsWith("tg:"))]
              : [...new Set([...navs, ...s.apps])];
          const wantApp =
            spot.open === "INTENT" ? `intent://join?invite=${CODE}` : `tg://join?invite=${CODE}`;
          if (!(tries.length >= 1 && tries.every((u) => u.startsWith(wantApp))))
            failures.push(`${env.name} : tentative ${tries.join(", ") || "absente"}`);
          if (spot.open !== "TG" && frames.length)
            failures.push(`${env.name} : cadre caché au lieu de la demande de la page`);
          if (spot.open === "TG" && navs.length)
            failures.push(
              `${env.name} : demande de la page au lieu du cadre caché (${navs.join(", ")})`,
            );
          if (!((await s.page.evaluate("location.pathname")) as string).startsWith("/j/promo"))
            failures.push(`${env.name} : page quittée`);
          const types = kinds(s);
          for (const want of wanted)
            if (!types.includes(want))
              failures.push(`${env.name} : ${want} absent (${types.join(", ")})`);
          const csp = (await s.page.evaluate("window.__lj.csp")) as string[];
          if (csp.length) failures.push(`${env.name} : CSP ${csp.join(", ")}`);
          if (s.errors.length) failures.push(`${env.name} : erreurs ${s.errors.join(" | ")}`);
        } finally {
          await s.ctx.close();
        }
      }
      // Un seul nouvel essai (`retry`) : sous la charge de `pnpm test` (tous les paquets en parallèle), une image peut
      // être retardée par la machine de test elle-même.
      expect(failures).toEqual([]);
    },
  );

  it(
    "Safari, Chrome et Telegram : le lien natif vers Telegram part en moins de 100 ms, sans aide",
    { timeout: 60_000, retry: 1 },
    async () => {
      const failures: string[] = [];
      for (const env of [SAFARI, CHROME, TELEGRAM]) {
        const s = await open(browsers.get(env.engine)!, env, "/j/promo?src=tk01");
        try {
          await s.page.waitForTimeout(100);
          const t = await tap(s);
          const go = Math.round((t.bubble - t.t0) * 10) / 10;
          const fromTap = Math.round((t.bubble - t.ts) * 10) / 10;
          measures.push(
            `${env.name} : appui → départ du lien ${go} ms (${fromTap} ms depuis l'horodatage de l'appui)`,
          );
          if (!(go < LANDING_TAP_REACTION_MS)) failures.push(`${env.name} : départ après ${go} ms`);
          await until(() => s.tme.length > 0, s.page);
          if (s.tme[0] !== `https://t.me/+${CODE}`)
            failures.push(`${env.name} : pas de départ vers t.me (${s.tme.join(", ")})`);
          const help = (await s.page.evaluate(`document.getElementById("h").hidden`)) as boolean;
          if (!help) failures.push(`${env.name} : aide affichée`);
          if (s.errors.length) failures.push(`${env.name} : erreurs ${s.errors.join(" | ")}`);
        } finally {
          await s.ctx.close();
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it(
    "Safari puis Chrome avec le marqueur : tentative au chargement (< 300 ms), une seule fois, marqueur retiré",
    { timeout: 90_000, retry: 1 },
    async () => {
      const failures: string[] = [];
      for (const env of [SAFARI, CHROME]) {
        const s = await open(
          browsers.get(env.engine)!,
          env,
          `/j/promo?src=tk01&ttclid=E.C.P.TT1&tgo=1&vid=visit_tiktok_00001&tgt=${tgtNow()}`,
          "domcontentloaded",
        );
        try {
          await until(() => kinds(s).includes("ESCAPED:TGO") && s.beacons.length >= 2, s.page);
          const m = (await s.page.evaluate(
            `(function(){var a=performance.getEntriesByName("lj:auto")[0],n=performance.getEntriesByType("navigation")[0];return {auto:a?a.startTime:null,responseStart:n?n.responseStart:null,search:location.search,body:!!document.getElementById("b")}})()`,
          )) as {
            auto: number | null;
            responseStart: number | null;
            search: string;
            body: boolean;
          };
          if (m.auto === null || m.responseStart === null) {
            failures.push(`${env.name} : aucune tentative au chargement`);
            continue;
          }
          let delay = Math.round((m.auto - m.responseStart) * 10) / 10;
          // Sous la charge de `pnpm test`, jusqu'à 2 nouveaux chargements (onglets neufs, autre visite) : meilleur temps.
          for (let i = 2; i <= 3 && !(delay < LANDING_AUTO_OPEN_MAX_MS); i++) {
            const x = await open(
              browsers.get(env.engine)!,
              env,
              `/j/promo?src=tk01&tgo=1&vid=visit_tiktok_0000${i}&tgt=${tgtNow()}`,
              "domcontentloaded",
            );
            try {
              await until(
                () =>
                  kinds(x).includes(
                    "AUTO_OPEN:" + (env.system === "IOS" ? "AUTO_TG" : "AUTO_INTENT"),
                  ),
                x.page,
              );
              const d = (await x.page.evaluate(
                `(function(){var a=performance.getEntriesByName("lj:auto")[0],n=performance.getEntriesByType("navigation")[0];return a&&n?a.startTime-n.responseStart:null})()`,
              )) as number | null;
              if (d !== null) delay = Math.min(delay, Math.round(d * 10) / 10);
            } finally {
              await x.ctx.close();
            }
          }
          measures.push(`${env.name} : première réponse → tentative automatique ${delay} ms`);
          if (!(delay < LANDING_AUTO_OPEN_MAX_MS))
            failures.push(`${env.name} : tentative après ${delay} ms`);
          if (m.search !== "?src=tk01&ttclid=E.C.P.TT1&tgd=1")
            failures.push(`${env.name} : marqueur encore là (${m.search})`);
          // La page reste entière (le bouton suffit si rien ne s'ouvre).
          if (!m.body) failures.push(`${env.name} : page incomplète après la tentative`);
          const types = kinds(s);
          const method = env.system === "IOS" ? "AUTO_TG" : "AUTO_INTENT";
          for (const want of ["ESCAPED:TGO", `AUTO_OPEN:${method}`])
            if (!types.includes(want))
              failures.push(`${env.name} : ${want} absent (${types.join(", ")})`);
          if (types.includes("VIEW")) failures.push(`${env.name} : visite comptée deux fois`);
          if (s.beacons.some((b) => b.v !== "visit_tiktok_00001"))
            failures.push(`${env.name} : autre visite que celle de l'appli`);
          // Rechargement : plus de tentative (jamais de boucle).
          await s.page.reload({ waitUntil: "domcontentloaded" });
          await s.page.waitForTimeout(200);
          const again = (await s.page.evaluate(
            `performance.getEntriesByName("lj:auto").length`,
          )) as number;
          if (again !== 0) failures.push(`${env.name} : nouvelle tentative au rechargement`);
          // Adresse laissée, rouverte dans un onglet neuf (onglet restauré sans sa mémoire, adresse recopiée) : ni
          // tentative ni nouvelle sortie.
          const copy = await open(browsers.get(env.engine)!, env, `/j/promo${m.search}`);
          try {
            await copy.page.waitForTimeout(300);
            const n = (await copy.page.evaluate(
              `performance.getEntriesByName("lj:auto").length`,
            )) as number;
            if (n !== 0 || kinds(copy).some((k) => k.startsWith("ESCAPED")))
              failures.push(
                `${env.name} : adresse recopiée, nouvelle tentative (${kinds(copy).join(", ")})`,
              );
          } finally {
            await copy.ctx.close();
          }
          if (s.tme.length)
            failures.push(`${env.name} : navigation vers t.me (${s.tme.join(", ")})`);
          const csp = (await s.page.evaluate("window.__lj.csp")) as string[];
          if (csp.length) failures.push(`${env.name} : CSP ${csp.join(", ")}`);
        } finally {
          await s.ctx.close();
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it(
    "pixels : PageView même après la tentative automatique ; aucun 2e ClickButton / Contact pour une personne sortie de l'appli",
    { timeout: 120_000, retry: 1 },
    async () => {
      const failures: string[] = [];
      for (const [app, normal, ad] of [
        [IN_APP[0]!, SAFARI, "ttclid=E.C.P.TT1"],
        [IN_APP[1]!, CHROME, "ttclid=E.C.P.TT1"],
        [IN_APP[3]!, CHROME, "fbclid=IwAR.1"],
      ] as const) {
        const name = `${app.name} → ${normal.name}`;
        // Dans l'appli : appui, 1er ClickButton et 1er Contact.
        const a = await open(browsers.get(app.engine)!, app, `/j/pix?src=tk01&${ad}`);
        let marked = "";
        try {
          await a.page.waitForTimeout(150);
          await tap(a);
          await a.page.waitForTimeout(150);
          const c = await pixelCalls(a.page);
          if (c.clickButton !== 1 || c.contact !== 1)
            failures.push(`${name} : dans l'appli ${JSON.stringify(c)}`);
          marked = (await a.page.evaluate("location.pathname+location.search")) as string;
        } finally {
          await a.ctx.close();
        }
        // L'appli rouvre l'adresse d'origine (sans repère), ou l'adresse marquée : dans les deux cas, PageView
        // (malgré la tentative automatique, qui empêche « load ») et aucun pixel du clic à l'appui.
        for (const path of [`/j/pix?src=tk01&${ad}`, marked]) {
          const b = await open(browsers.get(normal.engine)!, normal, path, "domcontentloaded");
          try {
            const ok = await until(async () => (await pixelCalls(b.page)).pageView === 1, b.page);
            const c0 = await pixelCalls(b.page);
            if (!ok || c0.metaPageView !== 1)
              failures.push(
                `${name} (${path}) : pixels non chargés après la tentative ${JSON.stringify(c0)}`,
              );
            if (!b.pixels.some((u) => u.includes("analytics.tiktok.com")))
              failures.push(`${name} (${path}) : script du pixel TikTok non demandé`);
            await tap(b);
            await b.page.waitForTimeout(150);
            const c = await pixelCalls(b.page);
            if (c.clickButton !== 0 || c.contact !== 0)
              failures.push(`${name} (${path}) : 2e pixel du clic ${JSON.stringify(c)}`);
          } finally {
            await b.ctx.close();
          }
        }
      }
      // Sortie AVANT tout appui (repère vid sans tgo) : même visite, et le 1er appui dans Safari fait le pixel du clic.
      const a = await open(browsers.get("webkit")!, IN_APP[0]!, "/j/pix?src=tk01&ttclid=E.C.P.TT9");
      let early = "";
      let visit = "";
      try {
        await a.page.waitForTimeout(150);
        early = (await a.page.evaluate("location.pathname+location.search")) as string;
        visit = a.beacons[0]?.v ?? "";
      } finally {
        await a.ctx.close();
      }
      const b = await open(browsers.get("webkit")!, SAFARI, early, "domcontentloaded");
      try {
        await until(() => kinds(b).includes("ESCAPED:VID"), b.page);
        if (kinds(b).includes("VIEW") || b.beacons.some((x) => x.v !== visit))
          failures.push(`sortie avant l'appui : autre visite (${kinds(b).join(", ")})`);
        await tap(b);
        await b.page.waitForTimeout(150);
        await tap(b);
        await b.page.waitForTimeout(150);
        const c = await pixelCalls(b.page);
        if (c.clickButton !== 1 || c.contact !== 1)
          failures.push(`sortie avant l'appui : pixel du clic ${JSON.stringify(c)}`);
      } finally {
        await b.ctx.close();
      }
      expect(failures).toEqual([]);
    },
  );

  it(
    "aide dans un écran bas (paysage) : la flèche reste sur le bouton du menu quand l'aide défile ; « ⋮ » sans grand blanc",
    { timeout: 60_000, retry: 1 },
    async () => {
      const failures: string[] = [];
      // TikTok iPhone en paysage, aide en allemand (la plus haute) : l'aide défile, la flèche ne bouge pas.
      const env = IN_APP[0]!;
      const ctx = await browsers.get(env.engine)!.newContext({
        userAgent: env.ua,
        viewport: { width: 844, height: 340 },
        hasTouch: true,
        reducedMotion: "reduce",
      });
      try {
        const page = await ctx.newPage();
        const html = renderLandingHtml({
          pageId: "p1",
          lang: "de",
          channelTitle: "Casino VIP",
          headline: "Die besten Boni des Tages",
          inviteLink: `https://t.me/+${CODE}`,
          sourceKey: "tk01",
        });
        await page.route(`${ORIGIN}/**`, (route) =>
          route.request().method() === "POST"
            ? route.fulfill({ status: 204, body: "" })
            : route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
        );
        await page.goto(`${ORIGIN}/j/promo?src=tk01`);
        await page.locator("#b").tap({ noWaitAfter: true });
        await page.waitForTimeout(100);
        const m =
          (await page.evaluate(`(function(){var h=document.getElementById("h"),a=document.getElementById("ha");
          var t0=a.getBoundingClientRect().top;h.scrollTop=1e4;
          return {scroll:h.scrollHeight>h.clientHeight,moved:h.scrollTop,t0:t0,t1:a.getBoundingClientRect().top}})()`)) as {
            scroll: boolean;
            moved: number;
            t0: number;
            t1: number;
          };
        if (!m.scroll || m.moved <= 0) failures.push(`l'aide ne défile pas (${JSON.stringify(m)})`);
        if (Math.abs(m.t1 - m.t0) > 0.5 || Math.abs(m.t0) > 1.5)
          failures.push(`flèche déplacée par le défilement (${JSON.stringify(m)})`);
      } finally {
        await ctx.close();
      }
      // Instagram Android en espagnol : « ⋮ » occupe la place d'un point dans « Toca ⋮ », lu « ⋮ ».
      const ig = IN_APP[3]!;
      const s = await open(browsers.get(ig.engine)!, ig, "/j/promo?src=tk01");
      try {
        await tap(s);
        const v = (await s.page
          .evaluate(`(function(){var e=document.querySelector("#ht .hs"),cs=getComputedStyle(e),
          q=document.createRange(),fs=parseFloat(cs.fontSize),r;q.selectNodeContents(e);r=q.getBoundingClientRect();
          return {room:(e.offsetWidth+parseFloat(cs.marginLeft)+parseFloat(cs.marginRight))/fs,tall:r.height>r.width,
            role:e.getAttribute("role"),label:e.getAttribute("aria-label")}})()`)) as {
          room: number;
          tall: boolean;
          role: string | null;
          label: string | null;
        };
        if (!(v.room < 0.6) || !v.tall || v.role !== "img" || v.label !== "⋮")
          failures.push(`« ⋮ » : ${JSON.stringify(v)}`);
      } finally {
        await s.ctx.close();
      }
      expect(failures).toEqual([]);
    },
  );
});
