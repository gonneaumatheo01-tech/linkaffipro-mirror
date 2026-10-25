/**
 * Bout en bout sur les sites locaux INVENTÉS avec le VRAI transport serveur du chantier A (Chromium, 127.0.0.1
 * seulement : toute autre adresse est servie vide par le navigateur du test), fausse IA, faux prisma.
 * « apprends le site » → enregistrement → recette → validation → contrôle réel → READY. Sauté sans Chromium.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext } from "playwright-core";
import { createTestKit } from "../../human/test-kit";
import { memorySiteLock } from "../read/deps";
import { createFakeLearnLlm } from "../testing/fake-learn-llm";
import { chromium } from "playwright-core";
import { chromiumAvailable, loadFixtureRecipe } from "../testing/fixtures";
import { startLocalSites, type LocalSites } from "../testing/local-sites";
import { FIXTURE_ORIGINS, type FixtureSiteKey } from "../testing/world";
import { createServerTransport } from "../transport/server";
import { learnSite } from "./learn";
import { rebaseRecipe } from "./rebase";

const LABELS: Record<FixtureSiteKey, string> = {
  celsius: "Celsius",
  sportaza: "Sportaza",
  betportal: "Bet Portal",
};

/**
 * Navigateur du test : chaque contexte coupe toute adresse hors de 127.0.0.1 (aucun réseau). Chromium refuse sinon le
 * WebSocket local d'une page servie par la garde de navigation (`route.fetch` → « local network access checks ») :
 * artefact des sites locaux seulement (un vrai site n'est pas sur 127.0.0.1).
 */
async function localOnlyBrowser(external: string[]): Promise<Browser> {
  const b = await chromium.launch({
    headless: true,
    args: [
      "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests",
    ],
  });
  const orig = b.newContext.bind(b);
  (b as unknown as { newContext: (o?: unknown) => Promise<BrowserContext> }).newContext = async (
    o?: unknown,
  ) => {
    const ctx = await orig(o as never);
    await ctx.route(
      (u) => u.hostname !== "127.0.0.1",
      (route) => {
        external.push(route.request().url());
        return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      },
    );
    return ctx;
  };
  return b;
}

describe.skipIf(!chromiumAvailable())(
  "learnSite de bout en bout (transport serveur, sites locaux)",
  () => {
    let sites: LocalSites;
    const external: string[] = [];
    const browsers: Browser[] = [];
    beforeAll(async () => {
      sites = await startLocalSites();
    });
    afterAll(async () => {
      for (const b of browsers) await b.close().catch(() => undefined);
      await sites?.stop();
    });

    it.each(["celsius", "sportaza", "betportal"] as const)(
      "%s : appris et prêt, sans aucune mise",
      async (site) => {
        const kit = createTestKit(new Date("2026-10-25T09:30:00Z"));
        const s = sites.sites[site];
        await kit.prisma.bookmakerSite.create({
          data: {
            key: site,
            label: LABELS[site],
            baseUrl: s.baseUrl,
            status: "NEW",
            readTarget: "server",
            isActive: true,
          } as never,
        });
        const transport = createServerTransport(kit.deps, {
          launch: async () => {
            const b = await localOnlyBrowser(external);
            browsers.push(b);
            return b;
          },
          pace: async () => undefined,
          login: null,
          stepTimeoutMs: 4000,
        });
        const llm = createFakeLearnLlm({
          recipes: [rebaseRecipe(loadFixtureRecipe(site), FIXTURE_ORIGINS[site], s.origin)],
        });
        const before = sites.requests.length;
        const r = await learnSite(
          {
            ...kit.deps,
            learnLlm: llm,
            bookmakers: {
              transport,
              paceSite: async () => undefined,
              withSiteLock: memorySiteLock,
            },
          },
          site,
          { reason: "manual" },
        );
        expect(r.message).toMatch(/appris/);
        expect(r).toMatchObject({ ok: true, status: "READY" });
        const recipe = kit.tables("bookmakerRecipe").find((x) => x.siteKey === site)!;
        expect(recipe.isActive).toBe(true);
        expect(
          sites.requests.slice(before).some((q) => /cashier|deposit|wallet|withdraw/.test(q.path)),
        ).toBe(false);
        expect(external.every((u) => !u.includes("127.0.0.1"))).toBe(true);
      },
      180_000,
    );

    it("site en variante « captcha » : non appris, BLOCKED avec le geste, aucune IA appelée", async () => {
      sites.setVariant("celsius", "captcha");
      try {
        const kit = createTestKit(new Date("2026-10-25T09:30:00Z"));
        const s = sites.sites.celsius;
        await kit.prisma.bookmakerSite.create({
          data: {
            key: "celsius",
            label: "Celsius",
            baseUrl: s.baseUrl,
            status: "NEW",
            readTarget: "server",
            isActive: true,
          } as never,
        });
        const transport = createServerTransport(kit.deps, {
          launch: async () => {
            const b = await localOnlyBrowser(external);
            browsers.push(b);
            return b;
          },
          pace: async () => undefined,
          login: null,
        });
        const llm = createFakeLearnLlm({ recipes: [loadFixtureRecipe("celsius")] });
        const r = await learnSite(
          {
            ...kit.deps,
            learnLlm: llm,
            bookmakers: {
              transport,
              paceSite: async () => undefined,
              withSiteLock: memorySiteLock,
            },
          },
          "celsius",
          { reason: "manual" },
        );
        expect(r).toMatchObject({ ok: false, status: "BLOCKED" });
        expect(llm.calls).toHaveLength(0);
      } finally {
        sites.setVariant("celsius", null);
      }
    }, 60_000);
  },
);
