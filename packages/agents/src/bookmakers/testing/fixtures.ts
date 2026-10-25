/**
 * Phase 35 (chantier B) — accès aux fixtures des bookmakers INVENTÉS pour les tests : enregistrements de référence
 * (`recording.json`, origines canoniques `https://<site>.test`), recettes correctes (`recipe.json`), et enregistrement
 * en direct d'un site local par Chromium (aucune requête hors de 127.0.0.1 : les scripts externes reçoivent une
 * réponse vide). Jamais importé en production.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Browser } from "playwright-core";
import { chromium } from "playwright-core";
import type { RecipeData, SiteRecording } from "../contract";
import { createPlaywrightRecordIo } from "../learn/playwright-io";
import { rebaseRecipe, rebaseRecording } from "../learn/rebase";
import { recordSite } from "../learn/record";
import { FIXTURES_DIR, type LocalSites } from "./local-sites";
import { FIXTURE_ORIGINS, type FixtureSiteKey } from "./world";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;

/** Enregistrement de référence d'un site (ou de sa variante `changed`), rebasé si une origine est donnée. */
export function loadFixtureRecording(site: FixtureSiteKey, opts: { variant?: "changed" | null; origin?: string | null } = {}): SiteRecording {
  const rec = read(`${FIXTURES_DIR}${site}/${opts.variant ? `${opts.variant}/` : ""}recording.json`) as SiteRecording;
  return opts.origin ? rebaseRecording(rec, opts.origin) : rec;
}

/** Recette correcte d'un site (ou de sa variante `changed`), rebasée si une origine est donnée. */
export function loadFixtureRecipe(site: FixtureSiteKey, opts: { variant?: "changed" | null; origin?: string | null } = {}): RecipeData {
  const r = read(`${FIXTURES_DIR}${site}/${opts.variant ? `${opts.variant}/` : ""}recipe.json`) as RecipeData;
  return opts.origin ? rebaseRecipe(r, FIXTURE_ORIGINS[site], opts.origin) : r;
}

export function hasFixtureRecording(site: FixtureSiteKey, variant?: "changed"): boolean {
  return existsSync(`${FIXTURES_DIR}${site}/${variant ? `${variant}/` : ""}recording.json`);
}

/** Chromium installé localement ? (sinon les tests navigateur se sautent). */
export function chromiumAvailable(): boolean {
  try {
    const p = chromium.executablePath();
    return !!p && existsSync(p);
  } catch {
    return false;
  }
}

export async function launchTestBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

/**
 * Enregistre un site local avec Chromium (rythme accéléré), sans aucune requête extérieure. `guardLog` reçoit chaque
 * action de la garde (aucun clic de cote ni de mise attendu).
 */
export async function recordLocalSite(
  browser: Browser,
  sites: LocalSites,
  site: FixtureSiteKey,
  opts: { guardLog?: (action: string, detail: string) => void; paceMs?: number } = {},
): Promise<{ result: SiteRecording | { obstacle: string }; betClicked: boolean; external: string[] }> {
  const ctx = await browser.newContext();
  const external: string[] = [];
  await ctx.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => {
      external.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    },
  );
  const page = await ctx.newPage();
  try {
    const s = sites.sites[site];
    const io = createPlaywrightRecordIo(page, {
      siteKey: site,
      baseUrl: s.baseUrl,
      allowedHosts: [s.host],
      pace: () => new Promise((r) => setTimeout(r, opts.paceMs ?? 30)),
      ...(opts.guardLog ? { guardLog: opts.guardLog } : {}),
    });
    const result = await recordSite(io, { afterLoadMs: 300 });
    const betClicked = await page.evaluate(() => (globalThis as unknown as { betClicked?: boolean }).betClicked === true).catch(() => false);
    return { result, betClicked, external };
  } finally {
    await ctx.close();
  }
}
