/**
 * Vérification d'une page d'atterrissage (phase 15) dans de vrais moteurs de navigateur, avec les agents utilisateurs
 * des navigateurs intégrés de TikTok et d'Instagram sur iPhone (WebKit) et Android (Chromium), plus Safari et Chrome :
 *
 *   node --import tsx apps/web/scripts/landing-browser-check.ts --base http://localhost:3115 \
 *        --page "/j/<slug>?src=tk01" [--json /tmp/landing-browser.json] [--shots /tmp/landing-shots]
 *
 * Pour chaque environnement : affichage (visite envoyée), clic (façon d'ouvrir choisie, temps avant la tentative
 * d'ouverture ≤ 150 ms, aucune attente des envois), repli `https://t.me/+…` quand l'appli ne s'ouvre pas (simulé :
 * aucune appli Telegram dans un navigateur sans fenêtre ; t.me est intercepté, jamais appelé), puis un second
 * passage où la page passe en arrière-plan juste après le clic (Telegram « ouvert ») : envoi OPENED, et un troisième
 * où la vue web remplace la page juste après le clic (page d'erreur ou blanche, retour) : jamais d'OPENED. Les envois
 * `/j/_e` passent réellement au serveur (file `landing-events` de la base LOCALE). L'émulation ne reproduit pas le
 * passage de main à l'appli (décision du navigateur intégré) : ce sont les vrais chiffres « % d'ouverture » qui
 * départagent les méthodes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
  type Request as PwRequest,
} from "playwright";

type Env = { name: string; engine: "chromium" | "webkit"; ua: string };

const ENVS: Env[] = [
  {
    name: "TikTok iPhone",
    engine: "webkit",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/FR WKWebView/1 BytedanceWebview/d8a21c6",
  },
  {
    name: "Instagram iPhone",
    engine: "webkit",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 326.0.3.32.105 (iPhone14,5; iOS 17_4; fr_FR; fr; scale=3.00; 1170x2532; 584287262)",
  },
  {
    name: "TikTok Android",
    engine: "chromium",
    ua: "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 trill_330604 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/33.6.4 ByteLocale/fr BytedanceWebview/d8a21c6",
  },
  {
    name: "Instagram Android",
    engine: "chromium",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A.240305.019.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 Instagram 321.0.0.39.106 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; fr_FR; 573487456)",
  },
  {
    name: "Safari iPhone",
    engine: "webkit",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  {
    name: "Chrome Android",
    engine: "chromium",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  },
];

type Beacon = { at: number; t: string; m: string | null; v: string; s: string };

type RunResult = {
  env: string;
  engine: string;
  /** Façon d'ouvrir choisie par la page au clic (valeur du CLICK). */
  method: string | null;
  /** Adresse posée sur le lien au moment de la navigation native. */
  openUrl: string | null;
  /** Temps du gestionnaire de clic : de l'appui à la tentative d'ouverture (ms). */
  msBeforeOpenAttempt: number | null;
  /**
   * Navigation vers https://t.me/+… (ms après le clic) : tout de suite pour le lien https (lien universel / App Link),
   * repli après 1,5 s ou 2 s pour `tg://` et `intent://` quand l'appli ne s'ouvre pas ; null s'il n'y en a pas.
   * Vu par Playwright : inclut la latence du pilote (appui simulé et remontée des événements, 50 à 500 ms) ; le temps
   * réel avant la tentative d'ouverture est `msBeforeOpenAttempt`, mesuré dans la page.
   */
  tmeAfterMs: number | null;
  tmeUrl: string | null;
  beacons: string[];
  beaconStatuses: number[];
  /** Passage « Telegram ouvert » : envois reçus. */
  openedRun: string[];
  /** Passage « page remplacée juste après le clic » (page d'erreur d'une vue web) : envois reçus, jamais OPENED. */
  unloadRun: string[];
  cspViolations: string[];
  jsErrors: string[];
  firstPaintMs: number | null;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function newContext(browser: Browser, env: Env): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: env.ua,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: env.engine === "chromium",
    hasTouch: true,
    locale: "fr-FR",
  });
}

type ClickReport = { t0: number; t1: number; href: string | null };

async function instrument(
  page: Page,
  o: {
    beacons: Beacon[];
    statuses: number[];
    t0: () => number;
    clicks: ClickReport[];
    /** Navigation vers t.me : page de repli simulée (200) ou « l'appli s'ouvre, la page reste » (204). */
    tme: 200 | 204;
  },
) {
  await page.route("**/j/_e", async (route) => {
    const req = route.request();
    try {
      const b = JSON.parse(req.postData() ?? "{}") as Beacon;
      o.beacons.push({ ...b, at: Date.now() - o.t0() });
    } catch {
      // envoi illisible : compté comme rien
    }
    const res = await route.fetch();
    o.statuses.push(res.status());
    await route.fulfill({ response: res });
  });
  // t.me n'est jamais appelé : intercepté.
  await page.route("https://t.me/**", (route) =>
    o.tme === 204
      ? route.fulfill({ status: 204, body: "" })
      : route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<p>t.me (repli simulé)</p>",
        }),
  );
  await page.exposeFunction("__lpReport", (r: ClickReport) => o.clicks.push(r));
  // Mesures dans la page : capture (avant le gestionnaire de la page) et bulle (après lui, juste avant l'action
  // par défaut du lien, c'est-à-dire la tentative d'ouverture), envoyées aussitôt (avant toute navigation).
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (w.__csp as string[]).push(`${e.violatedDirective} ${e.blockedURI}`),
    );
    window.addEventListener("click", () => (w.__t0 = performance.now()), true);
    window.addEventListener("click", () => {
      const report = w.__lpReport as (r: unknown) => void;
      report({
        t0: w.__t0,
        t1: performance.now(),
        href: (document.getElementById("b") as HTMLAnchorElement | null)?.href ?? null,
      });
    });
  });
}

async function runEnv(
  browser: Browser,
  env: Env,
  url: string,
  shots: string | null,
): Promise<RunResult> {
  const result: RunResult = {
    env: env.name,
    engine: env.engine,
    method: null,
    openUrl: null,
    msBeforeOpenAttempt: null,
    tmeAfterMs: null,
    tmeUrl: null,
    beacons: [],
    beaconStatuses: [],
    openedRun: [],
    unloadRun: [],
    cspViolations: [],
    jsErrors: [],
    firstPaintMs: null,
  };

  // 1. Affichage, clic, repli (aucune appli Telegram).
  {
    const ctx = await newContext(browser, env);
    const page = await ctx.newPage();
    const beacons: Beacon[] = [];
    const clicks: ClickReport[] = [];
    let clickAt = 0;
    await instrument(page, {
      beacons,
      statuses: result.beaconStatuses,
      t0: () => clickAt,
      clicks,
      tme: 200,
    });
    page.on("pageerror", (e) => result.jsErrors.push(e.message));
    let tme: { at: number; url: string } | null = null;
    page.on("request", (r: PwRequest) => {
      if (r.url().startsWith("https://t.me/") && r.isNavigationRequest() && !tme && clickAt)
        tme = { at: Date.now() - clickAt, url: r.url() };
    });
    await page.goto(url, { waitUntil: "load" });
    result.firstPaintMs = await page.evaluate(() => {
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return fcp ? Math.round(fcp.startTime) : null;
    });
    await page.waitForTimeout(300);
    if (shots)
      await page.screenshot({ path: path.join(shots, `${env.name.replace(/\W+/g, "-")}.png`) });
    clickAt = Date.now();
    await page
      .locator("#b")
      .tap({ noWaitAfter: true })
      .catch(async () => {
        await page.locator("#b").click({ noWaitAfter: true });
      });
    // Repli à 2 s (iPhone) ou 1,5 s (Android) après le clic, plus la latence du pilote WebKit (jusqu'à ~700 ms).
    await page.waitForTimeout(3500);
    const c = clicks[0];
    if (c) {
      result.msBeforeOpenAttempt = Math.round((c.t1 - c.t0) * 100) / 100;
      result.openUrl = c.href;
    }
    const f = tme as { at: number; url: string } | null;
    if (f) {
      result.tmeAfterMs = f.at;
      result.tmeUrl = f.url;
    }
    result.method = beacons.find((b) => b.t === "CLICK")?.m ?? null;
    result.beacons = beacons.map(
      (b) => `${b.t}${b.m ? `:${b.m}` : ""}@${b.t === "VIEW" ? "affichage" : `${b.at}ms`}`,
    );
    await ctx.close();
  }

  // 2. Telegram « s'ouvre » : la page passe en arrière-plan 300 ms après le clic.
  {
    const ctx = await newContext(browser, env);
    const page = await ctx.newPage();
    const beacons: Beacon[] = [];
    let clickAt = 0;
    await instrument(page, {
      beacons,
      statuses: result.beaconStatuses,
      t0: () => clickAt,
      clicks: [],
      tme: 204,
    });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(200);
    // CSP : relevé avant tout clic (la page de repli simulée n'a pas la même politique).
    result.cspViolations = await page
      .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
      .catch(() => []);
    clickAt = Date.now();
    await page
      .locator("#b")
      .tap({ noWaitAfter: true })
      .catch(() => page.locator("#b").click({ noWaitAfter: true }));
    await page.waitForTimeout(300);
    // Code passé en texte : `tsx` ajouterait un utilitaire (`__name`) absent de la page à une fonction.
    await page.evaluate(
      `Object.defineProperty(document, "visibilityState", { configurable: true, get: function () { return "hidden"; } });
       document.dispatchEvent(new Event("visibilitychange"));`,
    );
    await page.waitForTimeout(2500);
    result.openedRun = beacons.map((b) => `${b.t}${b.m ? `:${b.m}` : ""}`);
    await ctx.close();
  }

  // 3. La vue web remplace la page 80 ms après le clic (page d'erreur ou blanche, retour) : pas « Telegram ouvert ».
  {
    const ctx = await newContext(browser, env);
    const page = await ctx.newPage();
    const beacons: Beacon[] = [];
    let clickAt = 0;
    await instrument(page, {
      beacons,
      statuses: result.beaconStatuses,
      t0: () => clickAt,
      clicks: [],
      tme: 204,
    });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(200);
    await page.evaluate(
      `document.getElementById("b").addEventListener("click", function () {
         setTimeout(function () { location.replace("/j/_page-erreur-simulee"); }, 80);
       });`,
    );
    clickAt = Date.now();
    await page
      .locator("#b")
      .tap({ noWaitAfter: true })
      .catch(() => page.locator("#b").click({ noWaitAfter: true }));
    await page.waitForTimeout(2500);
    result.unloadRun = beacons.map((b) => `${b.t}${b.m ? `:${b.m}` : ""}`);
    await ctx.close();
  }
  return result;
}

async function main(): Promise<number> {
  const base = (arg("base") ?? "http://localhost:3115").replace(/\/$/, "");
  const pagePath = arg("page");
  if (!pagePath) {
    console.error(
      'Usage : --base http://localhost:3115 --page "/j/<slug>?src=tk01" [--json f] [--shots dossier]',
    );
    return 2;
  }
  const shots = arg("shots") ?? null;
  if (shots) mkdirSync(shots, { recursive: true });
  const url = `${base}${pagePath}`;
  const browsers = { chromium: await chromium.launch(), webkit: await webkit.launch() };
  const results: RunResult[] = [];
  try {
    for (const env of ENVS) results.push(await runEnv(browsers[env.engine], env, url, shots));
  } finally {
    await browsers.chromium.close();
    await browsers.webkit.close();
  }
  const failures: string[] = [];
  for (const r of results) {
    if (r.msBeforeOpenAttempt === null || r.msBeforeOpenAttempt > 150)
      failures.push(
        `${r.env} : tentative d'ouverture après ${r.msBeforeOpenAttempt} ms (limite 150)`,
      );
    if (!r.beacons.some((b) => b.startsWith("VIEW")))
      failures.push(`${r.env} : visite non envoyée`);
    if (!r.beacons.some((b) => b.startsWith("CLICK"))) failures.push(`${r.env} : clic non envoyé`);
    if (!r.tmeUrl?.startsWith("https://t.me/+"))
      failures.push(`${r.env} : pas de navigation vers https://t.me/+… (${r.method})`);
    if (!r.openedRun.some((b) => b.startsWith("OPENED")))
      failures.push(`${r.env} : OPENED non envoyé`);
    if (r.unloadRun.some((b) => b.startsWith("OPENED")))
      failures.push(`${r.env} : OPENED envoyé alors que la page a été remplacée`);
    if (r.beaconStatuses.some((s) => s !== 204))
      failures.push(`${r.env} : /j/_e n'a pas répondu 204`);
    if (r.cspViolations.length) failures.push(`${r.env} : CSP ${r.cspViolations.join(", ")}`);
    if (r.jsErrors.length) failures.push(`${r.env} : erreurs ${r.jsErrors.join(" | ")}`);
  }
  const report = { url, at: new Date().toISOString(), results, failures };
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
