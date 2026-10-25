/**
 * Parcours guidé sur les trois sites locaux INVENTÉS (Chromium, 127.0.0.1 seulement ; sauté sans Chromium).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import type { SiteRecording } from "../contract";
import { BOOKMAKER_LIMITS } from "../contract";
import {
  chromiumAvailable,
  launchTestBrowser,
  loadFixtureRecipe,
  recordLocalSite,
} from "../testing/fixtures";
import { startLocalSites, type LocalSites } from "../testing/local-sites";
import { CELSIUS_TEST_TOKEN, FIXTURE_SITE_KEYS } from "../testing/world";
import { maskRecording } from "./mask";
import { marketTabsOf, responseKind, usefulHeaders } from "./record";
import { rebaseRecipe } from "./rebase";
import { validateRecipe } from "./validate";

describe("règles pures du parcours", () => {
  it("en-têtes utiles, valeurs secrètes remplacées", () => {
    expect(
      usefulHeaders({
        Authorization: "Bearer abc",
        Cookie: "a=b",
        Accept: "application/json",
        "X-Session-Id": "s",
        "User-Agent": "UA",
        Referer: "r",
      }),
    ).toEqual({
      authorization: "[secret]",
      cookie: "[secret]",
      accept: "application/json",
      "x-session-id": "[secret]",
    });
  });
  it("réponses gardées : JSON, GraphQL, documents ; jamais les mouchards", () => {
    expect(
      responseKind({
        url: "https://site.test/api/x",
        contentType: "application/json",
        resourceType: "fetch",
        requestBody: null,
      }),
    ).toBe("json");
    expect(
      responseKind({
        url: "https://site.test/graphql",
        contentType: "application/json",
        resourceType: "fetch",
        requestBody: null,
      }),
    ).toBe("graphql");
    expect(
      responseKind({
        url: "https://site.test/",
        contentType: "text/html",
        resourceType: "document",
        requestBody: null,
      }),
    ).toBe("html");
    expect(
      responseKind({
        url: "https://www.google-analytics.com/g/collect",
        contentType: "application/json",
        resourceType: "fetch",
        requestBody: null,
      }),
    ).toBeNull();
    expect(
      responseKind({
        url: "https://site.test/a.png",
        contentType: "image/png",
        resourceType: "image",
        requestBody: null,
      }),
    ).toBeNull();
  });
  it("onglets de marchés : buts, corners, cartons d'abord ; jamais une cote", () => {
    const html = `<div role="tablist"><button role="tab" aria-selected="true">Principal</button><button role="tab">Spéciaux</button><button role="tab">Corners</button><button role="tab">Buts</button><button role="tab">1,85</button></div>`;
    expect(marketTabsOf(html).map((n) => n.children.map((c) => c.text).join(""))).toEqual([
      "Buts",
      "Corners",
      "Spéciaux",
    ]);
  });
});

describe.skipIf(!chromiumAvailable())(
  "recordSite sur les sites locaux (garde « jamais de mise »)",
  () => {
    let sites: LocalSites;
    let browser: Browser;
    beforeAll(async () => {
      sites = await startLocalSites();
      browser = await launchTestBrowser();
    }, 60_000);
    afterAll(async () => {
      await browser?.close();
      await sites?.stop();
    });

    it.each(FIXTURE_SITE_KEYS)(
      "%s : parcours complet, réseau capté, cotes lues sur la page, aucune mise ni caisse",
      async (site) => {
        sites.setVariant(site, null);
        const actions: Array<[string, string]> = [];
        const before = sites.requests.length;
        const { result, betClicked, external } = await recordLocalSite(browser, sites, site, {
          guardLog: (a, d) => actions.push([a, d]),
        });
        expect("obstacle" in result ? result.obstacle : null).toBeNull();
        const rec = result as SiteRecording;
        expect(betClicked).toBe(false);
        expect(rec.pages.map((p) => p.step)).toEqual([
          "home",
          "football",
          "list-today",
          "event",
          "market-1",
          "market-2",
          "market-3",
          "list-tomorrow",
          "search",
        ]);
        expect(new Set(rec.pageOdds.map((o) => o.market)).size).toBeGreaterThanOrEqual(4);
        expect(
          rec.responses.every(
            (r) => Buffer.byteLength(r.body) <= BOOKMAKER_LIMITS.recordBodyMaxBytes,
          ),
        ).toBe(true);
        if (site === "celsius")
          expect(rec.responses.some((r) => r.kind === "json" && r.url.includes("/markets"))).toBe(
            true,
          );
        if (site === "betportal")
          expect(rec.responses.some((r) => r.kind === "websocket" && r.method === "WS")).toBe(true);
        // Seuls les cookies et des onglets de marchés ont été cliqués ; aucune page d'argent demandée.
        expect(
          actions
            .filter(([a]) => a === "click")
            .every(([, d]) => d === "cookie_accept" || d === "market_tab"),
        ).toBe(true);
        const paths = sites.requests.slice(before).map((r) => r.path);
        expect(paths.some((p) => /cashier|deposit|wallet|withdraw|bet/.test(p))).toBe(false);
        // Aucune requête hors de 127.0.0.1 n'est sortie (scripts externes servis vides par la route du test).
        expect(external.every((u) => !u.includes("127.0.0.1"))).toBe(true);
        // La recette correcte passe sur l'enregistrement fait en direct (origine locale).
        expect(
          validateRecipe(
            rebaseRecipe(loadFixtureRecipe(site), `https://${site}.test`, sites.sites[site].origin),
            maskRecording(rec),
          ).passed,
        ).toBe(true);
        if (site === "celsius") {
          expect(JSON.stringify(rec)).toContain(CELSIUS_TEST_TOKEN);
          expect(JSON.stringify(maskRecording(rec))).not.toContain(CELSIUS_TEST_TOKEN);
        }
      },
      120_000,
    );

    it.each([
      ["celsius", "captcha", "captcha"],
      ["sportaza", "geo", "geo_blocked"],
      ["betportal", "expired", "logged_out"],
    ] as const)(
      "%s, variante %s → obstacle %s (jamais forcé)",
      async (site, variant, obstacle) => {
        sites.setVariant(site, variant);
        try {
          const { result } = await recordLocalSite(browser, sites, site);
          expect("obstacle" in result && result.obstacle).toBe(obstacle);
        } finally {
          sites.setVariant(site, null);
        }
      },
      60_000,
    );
  },
);
