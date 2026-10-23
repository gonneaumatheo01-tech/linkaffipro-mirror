/**
 * Adaptateur Sportaza sur une page HTML locale qui imite un site de bookmaker (aucun réseau externe) : connexion
 * simulée, recherche, lecture de cote, surlignage, capture, garde « jamais de mise », erreurs classées, image de
 * repli. Sans Chromium installé (`pnpm --filter web exec playwright install chromium`), ces tests se sautent.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CaptureRequest } from "../screenshot";
import { createSelectorAdapter } from "./adapter";
import { mergeBookmakerConfig } from "./adapters";
import { CaptureError } from "./errors";
import { GuardedPage } from "./guard";
import { createBrowserScreenshotProvider, type CaptureEnv } from "./provider";
import type { BrowserStorageState } from "./session";
import { SPORTAZA_CONFIG } from "./sportaza";
import { renderFallbackHtml } from "./template";
import { pngSize } from "./store";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/bookmaker/", import.meta.url));
const ROUTES: Record<string, string> = {
  "/fr/sports": "home.html",
  "/fr/sports/match/psg-om": "event.html",
  "/captcha.html": "captcha.html",
  "/geo.html": "geo.html",
  "/fr/deposit": "deposit.html",
};

let chromiumPath: string | null = null;
try {
  chromiumPath = chromium.executablePath();
} catch {
  chromiumPath = null;
}
const hasChromium = !!chromiumPath && existsSync(chromiumPath);

let server: Server;
let base = "";

beforeAll(async () => {
  if (!hasChromium) return;
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const file = ROUTES[path];
    if (!file) {
      res.writeHead(404).end("introuvable");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(FIXTURES + file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
});

function localConfig(over: Record<string, unknown> = {}) {
  return mergeBookmakerConfig(SPORTAZA_CONFIG, { baseUrl: `${base}/fr/sports`, allowedHosts: ["localhost"], stepTimeoutMs: 3000, ...over });
}

function memoryEnv(creds: { login: string; password: string } | null) {
  const sessions: BrowserStorageState[] = [];
  const env: CaptureEnv = {
    credentials: async () => creds,
    loadSession: async () => sessions.at(-1) ?? null,
    saveSession: async (_b, s) => {
      sessions.push(s);
    },
    proxy: async () => null,
    sites: async () => null,
  };
  return { env, sessions };
}

const launch = () => chromium.launch({ headless: true });

const REQ: CaptureRequest = {
  bookmaker: "sportaza",
  homeTeam: "Paris Saint-Germain",
  awayTeam: "Olympique de Marseille",
  kickoffAt: new Date("2026-10-25T19:45:00Z"),
  marketLabel: "Tirs cadrés",
  selectionLabel: "Plus de",
  line: 8.5,
  expectedOdds: 2.1,
};

describe.skipIf(!hasChromium)("capture sur la page locale", () => {
  it("connexion simulée, recherche, lecture de cote, surlignage et capture recadrée ; session rangée", async () => {
    const { env, sessions } = memoryEnv({ login: "demo@test.local", password: "secret-de-test" });
    const provider = createBrowserScreenshotProvider({ env, launch, adapter: () => createSelectorAdapter(localConfig()) });
    const r = await provider.capture(REQ);
    expect(r).toMatchObject({ ok: true, readOdds: 2.1 });
    if (!r.ok) return;
    expect(r.pageUrl).toContain("/fr/sports/match/psg-om");
    if (process.env.CAPTURE_DUMP) (await import("node:fs")).writeFileSync(process.env.CAPTURE_DUMP, r.png);
    const size = pngSize(r.png);
    expect(size && size.width < 1280 && size.height < 900).toBe(true); // recadrée sur le marché
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.cookies.some((c) => c.name === "lapsession")).toBe(true);
    // Deuxième passage : la session rangée suffit (déjà connecté).
    const again = await provider.capture({ ...REQ, marketLabel: "Corners", line: 9.5, expectedOdds: 1.95 });
    expect(again).toMatchObject({ ok: true, readOdds: 1.95 });
  }, 60_000);

  it("le bouton « Parier » est refusé et jamais cliqué ; aucune cote cliquée", async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      const guarded = new GuardedPage(page, ["localhost"]);
      await guarded.goto(`${base}/fr/sports/match/psg-om`);
      await expect(guarded.click(guarded.find("#bet"), "market_tab")).rejects.toMatchObject({ kind: "forbidden_action" });
      await expect(guarded.click(guarded.find(".odds-button"), "search_result")).rejects.toMatchObject({ kind: "forbidden_action" });
      await expect(guarded.goto(`${base}/fr/deposit`)).rejects.toMatchObject({ kind: "forbidden_action" });
      await expect(guarded.goto("https://example.com/")).rejects.toMatchObject({ kind: "forbidden_action" });
      expect(await page.evaluate(() => (globalThis as unknown as { betClicked: boolean }).betClicked)).toBe(false);
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("liens interdits sur l'accueil (dépôt, inscription) refusés", async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      const guarded = new GuardedPage(page, ["localhost"]);
      await guarded.goto(`${base}/fr/sports`);
      await expect(guarded.click(guarded.find(".deposit-link"), "open_login")).rejects.toBeInstanceOf(CaptureError);
      await expect(guarded.click(guarded.find("a[href='/fr/register']"), "open_login")).rejects.toMatchObject({ kind: "forbidden_action" });
      expect(page.url()).toContain("/fr/sports");
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("erreurs classées : captcha, code de vérification, mot de passe refusé, blocage géographique, match introuvable", async () => {
    const run = async (creds: { login: string; password: string } | null, over: Record<string, unknown> = {}, req = REQ) => {
      const { env } = memoryEnv(creds);
      return createBrowserScreenshotProvider({ env, launch, adapter: () => createSelectorAdapter(localConfig(over)) }).capture(req);
    };
    expect(await run({ login: "captcha@test.local", password: "x" })).toMatchObject({ ok: false, kind: "captcha" });
    expect(await run({ login: "otp@test.local", password: "x" })).toMatchObject({ ok: false, kind: "two_factor" });
    expect(await run({ login: "demo@test.local", password: "faux" })).toMatchObject({ ok: false, kind: "login_failed" });
    expect(await run(null, { baseUrl: `${base}/geo.html` })).toMatchObject({ ok: false, kind: "geo_blocked" });
    expect(await run(null, {}, { ...REQ, homeTeam: "Real Madrid", awayTeam: "FC Barcelone" })).toMatchObject({ ok: false, kind: "not_found" });
    expect(await run(null, {}, { ...REQ, marketLabel: "Cartons" })).toMatchObject({ ok: false, kind: "market_missing" });
  }, 120_000);

  it("test de connexion : capture de l'accueil une fois connecté ; sans identifiants : refus clair", async () => {
    const { env } = memoryEnv({ login: "demo@test.local", password: "secret-de-test" });
    const provider = createBrowserScreenshotProvider({ env, launch, adapter: () => createSelectorAdapter(localConfig()) });
    const ok = await provider.testConnection("sportaza");
    expect(ok.ok).toBe(true);
    const none = await createBrowserScreenshotProvider({ env: memoryEnv(null).env, launch, adapter: () => createSelectorAdapter(localConfig()) }).testConnection("sportaza");
    expect(none).toMatchObject({ ok: false, kind: "login_failed" });
  }, 60_000);

  it("image de repli : gabarit rendu en PNG 1080 × 1080", async () => {
    const provider = createBrowserScreenshotProvider({ env: memoryEnv(null).env, launch });
    const png = await provider.renderTemplate(renderFallbackHtml({ ...REQ, odds: 2.1, league: "Ligue 1" }));
    expect(pngSize(png)).toEqual({ width: 1080, height: 1080 });
  }, 30_000);
});
