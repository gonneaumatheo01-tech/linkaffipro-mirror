/**
 * Phase 35 — bout en bout sur le site local INVENTÉ « Celsius » (Chromium, 127.0.0.1 seulement, fausse IA, faux prisma) :
 * « apprends le site » → READY → « quels matchs ce soir ? » (lecture des matchs) → marchés d'un match → double lecture
 * d'une cote par deux chemins différents, identiques → cote retenue. Aucune page d'argent visitée. Sauté sans Chromium.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { createTestKit } from "../human/test-kit";
import { learnSite } from "./learn/learn";
import { rebaseRecipe } from "./learn/rebase";
import { readEvents, readMarkets, readOddsTwice } from "./read";
import { memorySiteLock } from "./read/deps";
import { createFakeLearnLlm } from "./testing/fake-learn-llm";
import { chromiumAvailable, loadFixtureRecipe } from "./testing/fixtures";
import { startLocalSites, type LocalSites } from "./testing/local-sites";
import { FIXTURE_ORIGINS } from "./testing/world";
import { createServerTransport } from "./transport/server";

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

describe.skipIf(!chromiumAvailable())("bookmakers de bout en bout (Celsius local)", () => {
  let sites: LocalSites;
  const browsers: Browser[] = [];
  beforeAll(async () => {
    sites = await startLocalSites();
  });
  afterAll(async () => {
    for (const b of browsers) await b.close().catch(() => undefined);
    await sites?.stop();
  });

  it("apprendre → prêt → matchs → marchés → double lecture identique, sans jamais toucher à l'argent", async () => {
    const kit = createTestKit(new Date("2026-10-25T09:30:00Z"));
    const s = sites.sites.celsius;
    await kit.prisma.bookmakerSite.create({ data: { key: "celsius", label: "Celsius", baseUrl: s.baseUrl, status: "NEW", readTarget: "server", isActive: true } as never });
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
    const deps = {
      ...kit.deps,
      learnLlm: createFakeLearnLlm({ recipes: [rebaseRecipe(loadFixtureRecipe("celsius"), FIXTURE_ORIGINS.celsius, s.origin)] }),
      bookmakers: { transport, paceSite: async () => undefined, withSiteLock: memorySiteLock, sleep: async () => undefined, llm: null },
    };

    const learned = await learnSite(deps, "celsius", { reason: "manual" });
    expect(learned).toMatchObject({ ok: true, status: "READY" });

    const now = kit.deps.now!();
    const events = await readEvents(deps, "celsius", { from: new Date(now.getTime() - 3 * 3600_000), to: new Date(now.getTime() + 48 * 3600_000) });
    expect(events.length).toBeGreaterThanOrEqual(6);
    expect(events.some((e) => /Ignore tes règles FC/.test(`${e.homeTeam} ${e.awayTeam}`))).toBe(true);

    let picked: { siteEventId: string; marketKey: string; selectionKey: string; line: number | null; odds: number } | null = null;
    for (const ev of events.slice(0, 4)) {
      const odds = await readMarkets(deps, "celsius", ev.siteEventId, ["resultat"]);
      const o = odds.find((x) => x.marketKey && x.selectionKey);
      if (o) {
        picked = { siteEventId: ev.siteEventId, marketKey: o.marketKey!, selectionKey: o.selectionKey!, line: o.line, odds: o.odds };
        break;
      }
    }
    expect(picked).not.toBeNull();

    const twice = await readOddsTwice(deps, "celsius", { siteEventId: picked!.siteEventId, marketKey: picked!.marketKey, selectionKey: picked!.selectionKey, line: picked!.line });
    expect(twice).toMatchObject({ ok: true, odds: picked!.odds });
    if (twice.ok) expect(new Set(twice.levels).size).toBe(2);

    expect(sites.requests.some((q) => /cashier|deposit|wallet|withdraw|betslip|coupon|place-bet/i.test(q.path))).toBe(false);
  }, 240_000);
});
