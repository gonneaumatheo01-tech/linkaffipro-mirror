/**
 * Vérification d'une page d'atterrissage dans de vrais moteurs de navigateur (phase 15, revue phase 16 « sortir du
 * navigateur intégré de TikTok »), sur un serveur qui tourne (local ou de production) :
 *
 *   node --import tsx apps/web/scripts/landing-browser-check.ts --base http://localhost:3115 \
 *        --page "/j/<slug>?src=tk01" [--json /tmp/landing-browser.json] [--captures docs/captures]
 *
 * Agents utilisateurs des navigateurs intégrés de TikTok, Instagram et Facebook sur iPhone (WebKit) et Android
 * (Chromium), plus Safari et Chrome :
 * - navigateur intégré : repère de la visite dans l'adresse dès l'affichage (`vid=…&tgt=…`) ; à l'appui, aide plein
 *   écran visible en moins de 100 ms (de l'appui à l'image suivante, horloge de la page), flèche placée d'après la
 *   table (`escapeSpotFor`), adresse marquée `tgo=1&vid=…&tgt=…`, tentative d'après la table (cadre caché `tg://` ;
 *   dans les applis Meta, `tg://` sur iPhone ou `intent://` sur Android demandé par la page) avec le code de cette
 *   façon d'ouvrir (`ESCAPE_OPEN_METHOD`), AUCUNE navigation vers t.me (ni tout de suite ni 2 s plus tard), envois
 *   VIEW, CLICK et HELP reçus (204) ;
 * - Safari, Chrome, navigateur intégré de Telegram : le lien natif part en moins de 100 ms (de l'appui à la fin du
 *   gestionnaire, juste avant l'action du lien), navigation vers https://t.me/+… (interceptée, jamais appelée) ; page
 *   ouverte SANS les repères de sortie (`ttclid`, `fbclid`, `tgo`, `vid`, `tgt`, `tgd` retirés de `--page`) : dans un
 *   navigateur ordinaire, `ttclid` / `fbclid` déclencheraient l'ouverture automatique (vérifiée à part) ;
 * - Safari puis Chrome rouverts avec le marqueur (`tgo=1&vid=…&tgt=…`, comme après « Ouvrir dans le navigateur ») :
 *   tentative d'ouverture au chargement (marque `lj:auto`) moins de 300 ms après la première réponse du serveur
 *   (`responseStart`), marqueur retiré de l'adresse (`tgd=1` à la place), envois ESCAPED et AUTO_OPEN de la même
 *   visite, aucune nouvelle tentative au rechargement ni dans un onglet neuf ouvert sur l'adresse laissée ;
 * - Safari puis Chrome avec seulement l'identifiant de clic pub (`ttclid` de `--page`, sinon un identifiant de test :
 *   appli qui rouvre l'adresse d'origine) : même tentative au chargement, `ttclid` gardé, `tgd=1` ajouté, envois VIEW,
 *   ESCAPED:TTCLID et AUTO_OPEN d'une même visite, jamais de boucle ;
 * - aucune violation de la CSP, aucune erreur JavaScript.
 * Les envois `/j/_e` passent réellement au serveur (file `landing-events` de la base visée : préférer la base locale).
 * `--captures <dossier>` : captures 390 px de l'aide TikTok iPhone et Android (`j-aide-tiktok-iphone-390.webp`,
 * `j-aide-tiktok-android-390.webp`). L'émulation ne reproduit pas le passage de main à une appli (décision du
 * navigateur intégré ou du téléphone) : ce sont les vrais chiffres (« Aide affichée », « Sortis de TikTok ») qui le
 * mesurent.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, webkit, type Browser, type BrowserContext, type Page } from "playwright";
import {
  ESCAPE_OPEN_METHOD,
  LANDING_AUTO_OPEN_MAX_MS,
  LANDING_TAP_REACTION_MS,
  escapeSpotFor,
  type EscapeApp,
  type EscapeSystem,
} from "@linkaffipro/core";
import { writeWebp } from "./lib/browser";

type Env = {
  name: string;
  engine: "chromium" | "webkit";
  ua: string;
  app: EscapeApp | null;
  system: EscapeSystem;
  /** Nom de la capture de l'aide (`--captures`). */
  capture?: string;
};

const IOS = { engine: "webkit" as const, system: "IOS" as const };
const ANDROID = { engine: "chromium" as const, system: "ANDROID" as const };

/** Agents relevés en production (docs/tiktok-captures/agents-utilisateurs-reels.md) ou de référence. */
const IN_APP: Env[] = [
  {
    ...IOS,
    name: "TikTok iPhone",
    app: "TIKTOK",
    capture: "j-aide-tiktok-iphone-390.webp",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 musical_ly_47.1.0 BytedanceWebview/d8a21c6",
  },
  {
    ...ANDROID,
    name: "TikTok Android",
    app: "TIKTOK",
    capture: "j-aide-tiktok-android-390.webp",
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

const NORMAL: Env[] = [
  {
    ...IOS,
    name: "Safari iPhone",
    app: null,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/23F77 Safari/604.1",
  },
  {
    ...ANDROID,
    name: "Chrome Android",
    app: null,
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  },
];

/** Navigateur intégré de Telegram : lien natif comme Chrome (Telegram l'ouvre lui-même), jamais d'aide. */
const TELEGRAM_IN_APP: Env = {
  ...ANDROID,
  name: "Telegram Android (navigateur intégré)",
  app: null,
  ua: "Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Telegram-Android/11.2.3 (Samsung SM-A546B; Android 14; SDK 34; AVERAGE)",
};

type Beacon = { t: string; m: string | null; v: string };

type Result = {
  env: string;
  kind: "aide" | "lien natif" | "ouverture automatique" | "ouverture automatique (ttclid seul)";
  /** Appui → aide visible (image suivante) ou appui → départ du lien ; ou première réponse → tentative auto. */
  ms: number | null;
  /** Ouverture automatique : tous les relevés (onglets neufs), `ms` étant le meilleur. */
  samples?: number[];
  beacons: string[];
  beaconStatuses: number[];
  tme: string[];
  url: string | null;
  /** Tentatives vers l'appli Telegram vues par le moteur (cadre `tg:` ajouté, demande `tg:` / `intent:` de la page). */
  attempts: string[];
  arrow: { x: number; tip: number; wantX: number; wantTip: number } | null;
  cspViolations: string[];
  jsErrors: string[];
  failures: string[];
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

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

type Session = {
  ctx: BrowserContext;
  page: Page;
  beacons: Beacon[];
  statuses: number[];
  tme: string[];
  /** Demandes vers une appli (`tg:`, `intent:`) signalées par le moteur. */
  apps: string[];
  errors: string[];
};

/** Repère `tgt` tel que la page l'écrit (minute en base 36). */
const tgtNow = () => Math.floor(Date.now() / 6e4).toString(36);

/** Repères de sortie de l'appli que la page lit dans l'adresse (identifiants de clic pub compris). */
const ESCAPE_PARAMS = ["ttclid", "fbclid", "tgo", "vid", "tgt", "tgd"] as const;

/** Adresse sans les repères `names` (autres paramètres gardés, dans l'ordre). */
function withoutParams(url: string, names: readonly string[] = ESCAPE_PARAMS): string {
  const u = new URL(url);
  for (const n of names) u.searchParams.delete(n);
  return u.href;
}

/** Ajoute des paramètres à une adresse (`a=1&b=2`). */
function withQuery(url: string, query: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

async function open(
  browser: Browser,
  env: Env,
  url: string,
  opts: { width?: number; height?: number; waitUntil?: "load" | "domcontentloaded" } = {},
): Promise<Session> {
  const ctx = await browser.newContext({
    userAgent: env.ua,
    viewport: {
      width: opts.width ?? (env.system === "IOS" ? 393 : 412),
      height: opts.height ?? (env.system === "IOS" ? 750 : 800),
    },
    deviceScaleFactor: 2,
    isMobile: env.engine === "chromium",
    hasTouch: true,
    locale: "fr-FR",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const s: Session = { ctx, page, beacons: [], statuses: [], tme: [], apps: [], errors: [] };
  page.on("request", (req) => {
    if (/^(tg|intent):/.test(req.url())) s.apps.push(req.url());
  });
  await page.route("**/j/_e", async (route) => {
    try {
      s.beacons.push(JSON.parse(route.request().postData() ?? "{}") as Beacon);
    } catch {
      // envoi illisible : compté comme rien
    }
    const res = await route.fetch();
    s.statuses.push(res.status());
    await route.fulfill({ response: res });
  });
  // t.me n'est jamais appelé : intercepté (l'appli « s'ouvre », la page reste).
  await page.route("https://t.me/**", (route) => {
    s.tme.push(route.request().url());
    return route.fulfill({ status: 204, body: "" });
  });
  page.on("pageerror", (e) => s.errors.push(e.message));
  await page.addInitScript(INIT);
  await page.goto(url, { waitUntil: opts.waitUntil ?? "load" });
  return s;
}

type Tap = { ts: number; t0: number; frame: number; bubble: number };

async function tap(s: Session): Promise<Tap | null> {
  await s.page
    .locator("#b")
    .tap({ noWaitAfter: true })
    .catch(() => s.page.locator("#b").click({ noWaitAfter: true }));
  await s.page.waitForTimeout(150);
  const taps = (await s.page.evaluate("window.__lj.taps")) as Tap[];
  return taps[taps.length - 1] ?? null;
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Attend une condition (sans délai fixe) : dans WebKit, Playwright met 0,4 à 1,2 s à intercepter la navigation vers
 * t.me, même pour une page sans aucun script (mesuré le 16 octobre 2026) ; l'appui de la page, lui, finit en 1 ms.
 */
async function until(cond: () => boolean, page: Page, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await page.waitForTimeout(25);
  return cond();
}
const kinds = (beacons: Beacon[]) => beacons.map((b) => `${b.t}${b.m ? `:${b.m}` : ""}`);

async function checkInApp(
  browser: Browser,
  env: Env,
  url: string,
  captures: string | null,
): Promise<Result> {
  const r: Result = {
    env: env.name,
    kind: "aide",
    ms: null,
    beacons: [],
    beaconStatuses: [],
    tme: [],
    url: null,
    attempts: [],
    arrow: null,
    cspViolations: [],
    jsErrors: [],
    failures: [],
  };
  const s = await open(browser, env, url);
  try {
    await s.page.waitForTimeout(200);
    const shown = (await s.page.evaluate("location.search")) as string;
    if (!/[?&]vid=[\w-]{8,64}&tgt=[0-9a-z]+$/.test(shown) || /[?&]tgo=/.test(shown))
      r.failures.push(`repère de la visite absent à l'affichage : ${shown}`);
    const t = await tap(s);
    if (t) r.ms = round(t.frame - t.ts);
    if (r.ms === null || !(r.ms < LANDING_TAP_REACTION_MS))
      r.failures.push(`aide visible après ${r.ms} ms (limite ${LANDING_TAP_REACTION_MS})`);
    const visible = (await s.page.evaluate(
      `(function(){var h=document.getElementById("h");return !!h&&!h.hidden&&getComputedStyle(h).display!=="none"})()`,
    )) as boolean;
    if (!visible) r.failures.push("aide invisible");
    const box = (await s.page.evaluate(
      `(function(){var r=document.getElementById("ha").getBoundingClientRect();return {x:r.left+r.width/2,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}})()`,
    )) as { x: number; top: number; bottom: number; w: number; h: number };
    const spot = escapeSpotFor(env.app, env.system);
    const wantX = spot.corner.endsWith("right") ? box.w - spot.x : spot.x;
    const tip = spot.corner.startsWith("top") ? box.top : box.h - box.bottom;
    r.arrow = { x: round(box.x), tip: round(tip), wantX, wantTip: spot.y };
    if (Math.abs(box.x - wantX) > 1.5 || Math.abs(tip - spot.y) > 1.5)
      r.failures.push(`flèche en (${r.arrow.x}, ${r.arrow.tip}) au lieu de (${wantX}, ${spot.y})`);
    r.url = (await s.page.evaluate("location.pathname+location.search")) as string;
    if (!/[?&]tgo=1&vid=[\w-]{8,64}&tgt=[0-9a-z]+$/.test(r.url))
      r.failures.push(`adresse non marquée : ${r.url}`);
    if (captures && env.capture) {
      // Capture 390 px de l'aide (flèche immobile : mouvements réduits).
      const shot = await open(browser, env, url, { width: 390, height: 844 });
      try {
        await shot.page.waitForTimeout(200);
        await tap(shot);
        await shot.page.waitForTimeout(300);
        const png = await shot.page.screenshot();
        await writeWebp(png, path.join(captures, env.capture), 390);
      } finally {
        await shot.ctx.close();
      }
    }
    // Aucune navigation vers t.me, ni tout de suite ni plus tard.
    await s.page.waitForTimeout(2000);
    r.tme = s.tme;
    if (s.tme.length) r.failures.push(`navigation vers ${s.tme.join(", ")}`);
    const frames = (await s.page.evaluate("window.__lj.frames")) as string[];
    const navs = ((await s.page.evaluate("window.__lj.navs")) as string[]).filter(
      (u) => !/^https?:/.test(u),
    );
    r.attempts = [...new Set([...frames, ...navs, ...s.apps])];
    const wantApp =
      spot.open === "INTENT" ? /^intent:\/\/join\?invite=[\w-]+/ : /^tg:\/\/join\?invite=[\w-]+$/;
    if (!r.attempts.length || !r.attempts.every((u) => wantApp.test(u)))
      r.failures.push(`tentative vers Telegram inattendue : ${r.attempts.join(", ") || "aucune"}`);
    if (spot.open !== "TG" && frames.length)
      r.failures.push("cadre caché au lieu de la demande de la page");
    if (spot.open === "TG" && navs.length)
      r.failures.push(`demande de la page au lieu du cadre caché : ${navs.join(", ")}`);
    r.beacons = kinds(s.beacons);
    r.beaconStatuses = s.statuses;
    const method = ESCAPE_OPEN_METHOD[spot.open];
    for (const want of ["VIEW", `CLICK:${method}`, `HELP:${env.app}`])
      if (!r.beacons.includes(want)) r.failures.push(`${want} non envoyé`);
    r.cspViolations = (await s.page.evaluate("window.__lj.csp")) as string[];
    r.jsErrors = s.errors;
  } finally {
    await s.ctx.close();
  }
  return r;
}

async function checkNormal(browser: Browser, env: Env, pageUrl: string): Promise<Result> {
  // Lien natif : page sans repère de sortie (avec `ttclid` / `fbclid`, un navigateur ordinaire tenterait d'ouvrir
  // Telegram dès le chargement, et « load » n'arriverait jamais : cas vérifié par `checkAutoOpenAdOnly`).
  const url = withoutParams(pageUrl);
  const r: Result = {
    env: env.name,
    kind: "lien natif",
    ms: null,
    beacons: [],
    beaconStatuses: [],
    tme: [],
    url: null,
    attempts: [],
    arrow: null,
    cspViolations: [],
    jsErrors: [],
    failures: [],
  };
  const s = await open(browser, env, url);
  try {
    await s.page.waitForTimeout(200);
    r.cspViolations = (await s.page.evaluate("window.__lj.csp")) as string[];
    const t = await tap(s);
    if (t) r.ms = round(t.bubble - t.ts);
    if (r.ms === null || !(r.ms < LANDING_TAP_REACTION_MS))
      r.failures.push(`départ du lien après ${r.ms} ms (limite ${LANDING_TAP_REACTION_MS})`);
    await until(() => s.tme.length > 0 && kinds(s.beacons).includes("CLICK:HTTPS"), s.page);
    r.tme = s.tme;
    if (!s.tme[0]?.startsWith("https://t.me/+"))
      r.failures.push(`pas de départ vers https://t.me/+… (${s.tme.join(", ")})`);
    r.beacons = kinds(s.beacons);
    r.beaconStatuses = s.statuses;
    if (!r.beacons.includes("CLICK:HTTPS")) r.failures.push("CLICK:HTTPS non envoyé");
    if (r.beacons.some((b) => b.startsWith("HELP"))) r.failures.push("aide affichée à tort");
    r.jsErrors = s.errors;
  } finally {
    await s.ctx.close();
  }
  return r;
}

/** Première réponse du serveur → tentative automatique (marque `lj:auto`), dans la page ; null : aucune tentative. */
async function autoDelay(page: Page): Promise<number | null> {
  return (await page.evaluate(
    `(function(){var a=performance.getEntriesByName("lj:auto")[0],n=performance.getEntriesByType("navigation")[0];return a&&n?a.startTime-n.responseStart:null})()`,
  )) as number | null;
}

/**
 * Relevés de la tentative automatique : le premier, puis jusqu'à 2 onglets neufs (adresse `fresh()`) tant que la limite
 * est dépassée ; le meilleur est retenu, comme pour toute mesure de vitesse sur une machine partagée (tous gardés).
 */
async function bestAutoDelay(
  browser: Browser,
  env: Env,
  first: number,
  fresh: () => string,
): Promise<{ best: number; samples: number[] }> {
  const samples = [round(first)];
  for (let i = 0; i < 2 && !(Math.min(...samples) < LANDING_AUTO_OPEN_MAX_MS); i++) {
    const x = await open(browser, env, fresh(), { waitUntil: "domcontentloaded" });
    try {
      await x.page.waitForTimeout(400);
      const d = await autoDelay(x.page);
      if (d !== null) samples.push(round(d));
    } finally {
      await x.ctx.close();
    }
  }
  return { best: Math.min(...samples), samples };
}

async function checkAutoOpen(browser: Browser, env: Env, url: string): Promise<Result> {
  const r: Result = {
    env: env.name,
    kind: "ouverture automatique",
    ms: null,
    beacons: [],
    beaconStatuses: [],
    tme: [],
    url: null,
    attempts: [],
    arrow: null,
    cspViolations: [],
    jsErrors: [],
    failures: [],
  };
  const vid = `check_${randomBytes(8).toString("hex")}`;
  // Comme après « Ouvrir dans le navigateur » : identifiants de clic pub gardés, repères de l'appli ajoutés.
  const marked = withQuery(
    withoutParams(url, ["tgo", "vid", "tgt", "tgd"]),
    `tgo=1&vid=${vid}&tgt=${tgtNow()}`,
  );
  // Sans appli Telegram, un moteur peut ne jamais finir le chargement : seule la lecture du HTML est attendue.
  const s = await open(browser, env, marked, { waitUntil: "domcontentloaded" });
  try {
    await s.page.waitForTimeout(600);
    const m = (await s.page.evaluate(
      `(function(){var a=performance.getEntriesByName("lj:auto")[0],n=performance.getEntriesByType("navigation")[0];return {auto:a?a.startTime:null,responseStart:n?n.responseStart:null,url:location.pathname+location.search,button:!!document.getElementById("b")}})()`,
    )) as { auto: number | null; responseStart: number | null; url: string; button: boolean };
    r.url = m.url;
    if (m.auto === null || m.responseStart === null)
      r.failures.push("aucune tentative au chargement");
    else {
      const fresh = () =>
        withQuery(
          withoutParams(url, ["tgo", "vid", "tgt", "tgd"]),
          `tgo=1&vid=check_${randomBytes(8).toString("hex")}&tgt=${tgtNow()}`,
        );
      const { best, samples } = await bestAutoDelay(browser, env, m.auto - m.responseStart, fresh);
      r.ms = best;
      r.samples = samples;
      if (!(r.ms < LANDING_AUTO_OPEN_MAX_MS))
        r.failures.push(
          `tentative ${samples.join(" / ")} ms après la première réponse (limite ${LANDING_AUTO_OPEN_MAX_MS})`,
        );
    }
    if (/[?&](tgo|vid|tgt)=/.test(m.url) || !/[?&]tgd=1(&|$)/.test(m.url))
      r.failures.push(`marqueur encore dans l'adresse, ou tentative non notée : ${m.url}`);
    if (!m.button) r.failures.push("page incomplète (bouton absent)");
    const method = env.system === "IOS" ? "AUTO_TG" : "AUTO_INTENT";
    r.beacons = kinds(s.beacons);
    for (const want of ["ESCAPED:TGO", `AUTO_OPEN:${method}`])
      if (!r.beacons.includes(want)) r.failures.push(`${want} non envoyé`);
    if (r.beacons.includes("VIEW")) r.failures.push("visite comptée deux fois (VIEW)");
    if (s.beacons.some((b) => b.v !== vid))
      r.failures.push("envoi d'une autre visite que celle de l'appli");
    r.cspViolations = (await s.page.evaluate("window.__lj.csp")) as string[];
    await s.page.reload({ waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(400);
    const again = (await s.page.evaluate(
      `performance.getEntriesByName("lj:auto").length`,
    )) as number;
    if (again !== 0) r.failures.push("nouvelle tentative au rechargement (boucle)");
    // Onglet neuf sur l'adresse laissée (onglet restauré sans sa mémoire, adresse recopiée) : rien.
    const copy = await open(browser, env, new URL(m.url, url).href);
    try {
      await copy.page.waitForTimeout(300);
      const n = (await copy.page.evaluate(
        `performance.getEntriesByName("lj:auto").length`,
      )) as number;
      if (n !== 0) r.failures.push("nouvelle tentative dans un onglet neuf sur l'adresse laissée");
      if (copy.beacons.some((b) => b.t === "ESCAPED"))
        r.failures.push("nouvelle sortie comptée dans un onglet neuf sur l'adresse laissée");
    } finally {
      await copy.ctx.close();
    }
    r.beaconStatuses = s.statuses;
    r.tme = s.tme;
    r.jsErrors = s.errors;
  } finally {
    await s.ctx.close();
  }
  return r;
}

/**
 * Safari ou Chrome avec seulement l'identifiant de clic pub (appli qui rouvre l'adresse d'origine, sans le repère
 * `vid`) : tentative au chargement, une seule fois ; le worker rattache ensuite la visite à celle de l'appli (même
 * identifiant, même système).
 */
async function checkAutoOpenAdOnly(browser: Browser, env: Env, url: string): Promise<Result> {
  const r: Result = {
    env: env.name,
    kind: "ouverture automatique (ttclid seul)",
    ms: null,
    beacons: [],
    beaconStatuses: [],
    tme: [],
    url: null,
    attempts: [],
    arrow: null,
    cspViolations: [],
    jsErrors: [],
    failures: [],
  };
  const given = new URL(url).searchParams.get("ttclid");
  const ttclid = given || `CHECK.${randomBytes(6).toString("hex")}`;
  const adOnly = withQuery(withoutParams(url), `ttclid=${encodeURIComponent(ttclid)}`);
  const s = await open(browser, env, adOnly, { waitUntil: "domcontentloaded" });
  try {
    await s.page.waitForTimeout(600);
    const m = (await s.page.evaluate(
      `(function(){var a=performance.getEntriesByName("lj:auto")[0],n=performance.getEntriesByType("navigation")[0];return {auto:a?a.startTime:null,responseStart:n?n.responseStart:null,search:location.search,url:location.pathname+location.search,button:!!document.getElementById("b")}})()`,
    )) as {
      auto: number | null;
      responseStart: number | null;
      search: string;
      url: string;
      button: boolean;
    };
    r.url = m.url;
    if (m.auto === null || m.responseStart === null)
      r.failures.push("aucune tentative au chargement");
    else {
      // Onglet neuf, même adresse (sans `tgd`) : nouvelle tentative, autre visite.
      const { best, samples } = await bestAutoDelay(
        browser,
        env,
        m.auto - m.responseStart,
        () => adOnly,
      );
      r.ms = best;
      r.samples = samples;
      if (!(r.ms < LANDING_AUTO_OPEN_MAX_MS))
        r.failures.push(
          `tentative ${samples.join(" / ")} ms après la première réponse (limite ${LANDING_AUTO_OPEN_MAX_MS})`,
        );
    }
    const left = new URLSearchParams(m.search);
    if (
      left.get("ttclid") !== ttclid ||
      left.get("tgd") !== "1" ||
      /[?&](tgo|vid|tgt)=/.test(m.search)
    )
      r.failures.push(`adresse après la tentative : ${m.url}`);
    if (!m.button) r.failures.push("page incomplète (bouton absent)");
    const method = env.system === "IOS" ? "AUTO_TG" : "AUTO_INTENT";
    r.beacons = kinds(s.beacons);
    for (const want of ["VIEW", "ESCAPED:TTCLID", `AUTO_OPEN:${method}`])
      if (!r.beacons.includes(want)) r.failures.push(`${want} non envoyé`);
    if (new Set(s.beacons.map((b) => b.v)).size !== 1)
      r.failures.push("envois de plusieurs visites pour un seul chargement");
    r.cspViolations = (await s.page.evaluate("window.__lj.csp")) as string[];
    await s.page.reload({ waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(400);
    const again = (await s.page.evaluate(
      `performance.getEntriesByName("lj:auto").length`,
    )) as number;
    if (again !== 0) r.failures.push("nouvelle tentative au rechargement (boucle)");
    r.beaconStatuses = s.statuses;
    r.tme = s.tme;
    if (s.tme.length) r.failures.push(`navigation vers ${s.tme.join(", ")}`);
    r.jsErrors = s.errors;
  } finally {
    await s.ctx.close();
  }
  return r;
}

async function main(): Promise<number> {
  const base = (arg("base") ?? "http://localhost:3115").replace(/\/$/, "");
  const pagePath = arg("page");
  if (!pagePath) {
    console.error(
      'Usage : --base http://localhost:3115 --page "/j/<slug>?src=tk01" [--json f] [--captures dossier]',
    );
    return 2;
  }
  const captures = arg("captures") ?? null;
  if (captures) mkdirSync(captures, { recursive: true });
  const url = `${base}${pagePath}`;
  const browsers = { chromium: await chromium.launch(), webkit: await webkit.launch() };
  const results: Result[] = [];
  try {
    for (const env of IN_APP)
      results.push(await checkInApp(browsers[env.engine], env, url, captures));
    for (const env of [...NORMAL, TELEGRAM_IN_APP])
      results.push(await checkNormal(browsers[env.engine], env, url));
    for (const env of NORMAL) results.push(await checkAutoOpen(browsers[env.engine], env, url));
    for (const env of NORMAL)
      results.push(await checkAutoOpenAdOnly(browsers[env.engine], env, url));
  } finally {
    await browsers.chromium.close();
    await browsers.webkit.close();
  }
  const failures: string[] = [];
  for (const r of results) {
    for (const f of r.failures) failures.push(`${r.env} (${r.kind}) : ${f}`);
    if (r.beaconStatuses.some((s) => s !== 204))
      failures.push(`${r.env} (${r.kind}) : /j/_e n'a pas répondu 204`);
    if (r.cspViolations.length)
      failures.push(`${r.env} (${r.kind}) : CSP ${r.cspViolations.join(", ")}`);
    if (r.jsErrors.length)
      failures.push(`${r.env} (${r.kind}) : erreurs ${r.jsErrors.join(" | ")}`);
  }
  const measures = results.map(
    (r) =>
      `${r.env} — ${r.kind} : ${r.ms} ms${r.samples && r.samples.length > 1 ? ` (relevés ${r.samples.join(" / ")} ms)` : ""}`,
  );
  const report = { url, at: new Date().toISOString(), measures, results, failures };
  console.log(JSON.stringify(report, null, 2));
  const json = arg("json");
  if (json) writeFileSync(json, JSON.stringify(report, null, 2));
  return failures.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
