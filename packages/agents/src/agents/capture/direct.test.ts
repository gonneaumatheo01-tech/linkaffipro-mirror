/**
 * Phase 35, chantier C : agent Capture pour un pari lu sur un site du client — demande construite avec la recette
 * `dom` apprise et l'adresse de la fiche lue par le lecteur ; cote bougée → sélection refaite. Avec Chromium installé,
 * capture réelle sur le site local Sportaza (127.0.0.1) avec ces sélecteurs ; sinon le test navigateur se saute.
 */
import { afterAll, describe, expect, it } from "vitest";
import { chromium } from "playwright-core";
import { createTestKit } from "../../human/test-kit";
import { startLocalSites, type LocalSites } from "../../bookmakers/testing/local-sites";
import { chromiumAvailable, loadFixtureRecipe } from "../../bookmakers/testing/fixtures";
import { recipeCaptureConfig } from "../../bookmakers/read/capture-config";
import { parseRecipeRow } from "../../bookmakers/read/recipe";
import type { CaptureRequest, ScreenshotProvider } from "../../providers/screenshot";
import { createBrowserScreenshotProvider } from "../../providers/screenshot/provider";
import type { AgentContext, Mission, TeamSettings } from "../../types";
import { agent as capture } from "./index";

const DAY = new Date("2026-10-25T09:00:00Z");
const SETTINGS = { teamKey: "sports", simulation: true, paused: false, autonomyLevel: 0, monthlyBudgetCents: {}, styleGuidelines: "", forbiddenWords: [], maxTextLength: 900, quietHours: [], models: { fast: "x", strong: "y" }, similarityThreshold: 0.8, settings: {} } as TeamSettings;

let local: LocalSites | null = null;
afterAll(async () => {
  await local?.stop();
});

async function setup(readOdds: number) {
  const kit = createTestKit(DAY);
  local ??= await startLocalSites({ only: ["sportaza"] });
  const s = local.sites.sportaza;
  const recipe = loadFixtureRecipe("sportaza", { origin: s.origin });
  await kit.prisma.bookmakerSite.create({ data: { key: "sportaza", label: "Sportaza", baseUrl: s.baseUrl, readTarget: "server", isActive: true, status: "READY" } as never });
  await kit.prisma.bookmakerRecipe.create({ data: { siteKey: "sportaza", version: 3, level: "dom", api: null, dom: recipe.dom as never, mapping: recipe.mapping as never, validation: { domains: ["127.0.0.1"] } as never, isActive: true, createdBy: "learn" } as never });
  await kit.prisma.bookmakerEvent.create({ data: { siteKey: "sportaza", siteEventId: "m-4401", league: "Championnat Azur", homeTeam: "AS Mirabelle", awayTeam: "FC Lavande", startsAt: new Date("2026-10-25T13:00:00Z"), url: `${s.origin}/fr/sports/match/m-4401`, fetchedAt: DAY } as never });
  await kit.prisma.betCategory.create({ data: { id: "cat", key: "buts", name: "Buts", marketTypes: ["buts"], maxOddsDriftPct: 5 } as never });
  const m = await kit.prisma.agentMission.create({ data: { teamKey: "sports", status: "RUNNING", channelId: "real", payload: {} } as never });
  const pick = await kit.prisma.bettingPick.create({
    data: { missionId: m.id, categoryId: "cat", eventId: "bm:sportaza:m-4401", siteKey: "sportaza", siteEventId: "m-4401", homeTeam: "AS Mirabelle", awayTeam: "FC Lavande", league: "Championnat Azur", kickoffAt: new Date("2026-10-25T13:00:00Z"), marketId: "points-all-game-ou-over", marketLabel: "Plus/Moins de buts", selectionLabel: "Plus de 2,5", line: 2.5, bookmaker: "sportaza", odds: 1.9, reasoning: { source: "live" }, status: "PROPOSED", screenshotAssetId: null } as never,
  });
  const requests: CaptureRequest[] = [];
  const shot: ScreenshotProvider = {
    name: "faux",
    async capture(req) {
      requests.push(req);
      return { ok: true, png: new Uint8Array([137, 80, 78, 71]), readOdds, pageUrl: req.eventUrl ?? "" };
    },
    async testConnection() {
      return { ok: false, kind: "unknown", message: "non" };
    },
  };
  const ctx = { ...kit.deps, now: kit.deps.now!, providers: { llm: null, screenshot: shot }, settings: SETTINGS } as unknown as AgentContext;
  const mission = { ...(m as unknown as Mission), payload: { pickId: pick.id }, steps: [] } as Mission;
  return { kit, ctx, mission, requests, origin: s.origin, recipe };
}

describe("Capture d'un pari lu sur un site du client", () => {
  it("la demande suit la recette apprise et ouvre la fiche lue par le lecteur", async () => {
    const s = await setup(1.9);
    const r = await capture.run(s.mission, s.ctx);
    expect(r.ok).toBe(true);
    const req = s.requests[0]!;
    expect(req.eventUrl).toBe(`${s.origin}/fr/sports/match/m-4401`);
    expect(req.config?.selectors.selectionOdds).toBe(".sz-outcome__odd");
    expect(req.config?.allowedHosts).toEqual(["127.0.0.1"]);
  });

  it("cote bougée au-delà de la tolérance → sélection refaite (pas un simple pari écarté)", async () => {
    const s = await setup(2.4);
    const r = await capture.run(s.mission, s.ctx);
    expect(r.goTo).toBe("cotes");
    expect(r.output).toMatchObject({ pickId: null, reselections: 1 });
  });

  it.skipIf(!chromiumAvailable())("navigateur réel : la recette retrouve le marché et lit la cote affichée", async () => {
    const s = await setup(1.9);
    const active = parseRecipeRow({ id: "r", version: 3, level: "dom", dom: s.recipe.dom, api: null, mapping: s.recipe.mapping, validation: { domains: ["127.0.0.1"] } })!;
    const config = recipeCaptureConfig({ key: "sportaza", label: "Sportaza", baseUrl: `${s.origin}/fr/sports` }, active)!;
    const provider = createBrowserScreenshotProvider({
      env: { credentials: async () => null, loadSession: async () => null, saveSession: async () => undefined, proxy: async () => null, sites: async () => null },
      launch: () => chromium.launch({ headless: true }),
    });
    const r = await provider.capture({
      bookmaker: "sportaza",
      homeTeam: "AS Mirabelle",
      awayTeam: "FC Lavande",
      kickoffAt: new Date("2026-10-25T13:00:00Z"),
      marketLabel: "Plus/Moins de buts",
      selectionLabel: "Plus de 2,5",
      line: 2.5,
      expectedOdds: 1.9,
      eventUrl: `${s.origin}/fr/sports/match/m-4401`,
      config: { ...config, stepTimeoutMs: 3000 },
    });
    expect(r).toMatchObject({ ok: true, readOdds: 1.9 });
  }, 60_000);
});
