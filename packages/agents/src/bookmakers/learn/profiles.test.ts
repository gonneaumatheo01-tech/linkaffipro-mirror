/**
 * Phase 35 (suite) — fiches fournisseur de bout en bout sur les faux sites « à widget » (Chromium, 127.0.0.1
 * seulement, faux prisma, IA SANS réponse) : « apprends le site » → enregistrement (shadow DOM, routeur mémoire, iframe,
 * flux par manifeste) → fiche du moteur validée sur l'enregistrement → contrôle réel → READY sans aucun appel à l'IA →
 * matchs du jour et du lendemain → marchés d'un match (résultat, buts avec ligne). Aucune mise, aucune page d'argent.
 * Sauté sans Chromium.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { createTestKit } from "../../human/test-kit";
import { readEvents, readMarkets } from "../read";
import { memorySiteLock } from "../read/deps";
import { createFakeLearnLlm } from "../testing/fake-learn-llm";
import { chromiumAvailable } from "../testing/fixtures";
import { startWidgetSites, type WidgetSiteKey, type WidgetSites } from "../testing/widget-sites";
import { FIXTURE_MATCHES } from "../testing/world";
import { createServerTransport } from "../transport/server";
import { learnSite } from "./learn";

const PROFILE: Record<WidgetSiteKey, string> = { altenaria: "altenar", betbia: "betby", celsia: "matches-api" };
const LABEL: Record<WidgetSiteKey, string> = { altenaria: "Altenaria", betbia: "Betbia", celsia: "Celsia" };

async function localOnlyBrowser(): Promise<Browser> {
  const b = await chromium.launch({ headless: true, args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"] });
  const orig = b.newContext.bind(b);
  (b as unknown as { newContext: (o?: unknown) => Promise<BrowserContext> }).newContext = async (o?: unknown) => {
    const ctx = await orig(o as never);
    await ctx.route((u) => u.hostname !== "127.0.0.1", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "" }));
    return ctx;
  };
  return b;
}

describe.skipIf(!chromiumAvailable())("fiches fournisseur (Altenar, Betby, API « matches ») sur les faux sites à widget", () => {
  let sites: WidgetSites;
  const browsers: Browser[] = [];
  beforeAll(async () => {
    sites = await startWidgetSites();
  });
  afterAll(async () => {
    for (const b of browsers) await b.close().catch(() => undefined);
    await sites?.stop();
  });

  it.each(["altenaria", "betbia", "celsia"] as const)(
    "%s : appris par sa fiche sans IA, matchs et cotes lus, aucune mise",
    async (site) => {
      const kit = createTestKit(new Date("2026-10-25T09:30:00Z"));
      const s = sites.sites[site];
      await kit.prisma.bookmakerSite.create({ data: { key: site, label: LABEL[site], baseUrl: s.baseUrl, status: "NEW", readTarget: "server", isActive: true } as never });
      const transport = createServerTransport(kit.deps, {
        launch: async () => {
          const b = await localOnlyBrowser();
          browsers.push(b);
          return b;
        },
        pace: async () => undefined,
        login: null,
        stepTimeoutMs: 4000,
      });
      // L'IA n'a RIEN à proposer : seule la fiche du moteur peut réussir.
      const llm = createFakeLearnLlm({ recipes: [] });
      const deps = { ...kit.deps, learnLlm: llm, bookmakers: { transport, paceSite: async () => undefined, withSiteLock: memorySiteLock, sleep: async () => undefined, llm: null } };
      const before = sites.requests.length;

      const learned = await learnSite(deps, site, { reason: "manual" });
      expect(learned, learned.message).toMatchObject({ ok: true, status: "READY" });
      expect(learned.message).toContain(`fiche ${PROFILE[site]} sans IA`);
      expect(llm.calls).toHaveLength(0);
      const recipe = kit.tables("bookmakerRecipe").find((x) => x.siteKey === site)!;
      expect(recipe.isActive).toBe(true);
      expect(recipe.validation).toMatchObject({ source: "builtin", profile: PROFILE[site] });
      expect(recipe.level).toBe(site === "celsia" ? "api" : "dom");

      // Matchs d'aujourd'hui et de demain (le monde inventé en compte 14, dont un piège d’injection).
      const now = kit.deps.now!();
      const events = await readEvents(deps, site, { from: new Date(now.getTime() - 3 * 3600_000), to: new Date(now.getTime() + 48 * 3600_000) });
      const expected = FIXTURE_MATCHES.map((m) => `${m.home} / ${m.away}`).sort();
      const got = events.map((e) => `${e.homeTeam} / ${e.awayTeam}`).sort();
      expect(got).toEqual(expected);
      for (const e of events) expect(e.url, `adresse de la fiche ${e.homeTeam}`).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(events.filter((e) => e.startsAt.toISOString().slice(0, 10) === "2026-10-26").length).toBeGreaterThanOrEqual(2);

      // Marchés du premier match : résultat et buts (avec la ligne), aux cotes du monde inventé.
      const first = events.find((e) => e.homeTeam === FIXTURE_MATCHES[0]!.home)!;
      const odds = await readMarkets(deps, site, first.siteEventId, ["resultat", "buts"]);
      expect(odds.filter((o) => o.marketKey === "resultat").length).toBeGreaterThanOrEqual(3);
      expect(odds.some((o) => o.marketKey === "buts" && o.line === 2.5 && /-over$/.test(o.selectionKey ?? ""))).toBe(true);
      expect(odds.some((o) => o.marketKey === "buts" && o.line === 2.5 && /-under$/.test(o.selectionKey ?? ""))).toBe(true);
      expect(odds.every((o) => o.odds > 1 && o.odds < 100)).toBe(true);

      // Jamais de mise ni de page d'argent, sur aucun des serveurs du site.
      const seen = sites.requests.slice(before).filter((q) => q.site === site);
      expect(seen.some((q) => q.method === "POST" || /\/bet\b|cashier|deposit|wallet|withdraw/i.test(q.path))).toBe(false);
    },
    240_000,
  );
});
