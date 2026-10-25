/**
 * Phase 35, chantier C : équipe Paris sur les cotes d'un site du client — double lecture au Contrôle et avant la
 * publication, tolérance d'écart (sélection refaite), attente humaine avec crochet, capture refaite si elle affiche
 * une autre cote. Faux transport (API + page), faux prisma, aucune IA, aucun réseau.
 */
import { describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import { memorySiteLock, type BookmakerHookEvent } from "../bookmakers/read/deps";
import type { BookmakerTransport, RecipeData } from "../bookmakers/contract";
import type { AgentContext, Mission, TeamSettings } from "../types";
import { sameCapturedOdds, verifyDirectOdds, MAX_RESELECTIONS } from "./direct-odds";
import { sportsControl, sportsPublication } from "./steps";
import type { PickRow } from "./data";

const DAY = new Date("2026-10-25T09:00:00Z");

const RECIPE: RecipeData = {
  level: "api",
  api: { endpoints: [{ purpose: "markets", method: "GET", urlTemplate: "https://site.example/api/event/{eventId}", auth: "cookie", responseShape: { market: "markets[].name", selection: "markets[].outcomes[].label", odds: "markets[].outcomes[].price" } }] },
  dom: {
    eventList: { candidates: [{ css: "a.ev" }] },
    eventRow: { home: { candidates: [{ css: ".h" }] }, away: { candidates: [{ css: ".a" }] }, startsAt: { candidates: [{ css: "time" }] } },
    market: { name: { candidates: [{ css: ".m" }] }, selection: { candidates: [{ css: ".s" }] }, odds: { candidates: [{ css: ".p" }] } },
  },
  mapping: { marketMap: { "Match Result": "resultat" }, selectionMap: { Home: "home" }, oddsFormat: "decimal", timezone: "Europe/Paris" },
};

function transport(o: { api: () => number | null; page: () => number | null }): BookmakerTransport & { reads: number } {
  const t = {
    target: "server" as const,
    reads: 0,
    async fetchApi() {
      t.reads++;
      const v = o.api();
      return { status: 200, body: JSON.stringify({ markets: v === null ? [] : [{ name: "Match Result", outcomes: [{ label: "Home", price: v }] }] }) };
    },
    async page() {
      t.reads++;
      const v = o.page();
      const sel = v === null ? `<div class="s">Away <b class="p">3.00</b></div>` : `<div class="s">Home <b class="p">${v.toFixed(2)}</b></div>`;
      return { url: "https://site.example/match/1", html: `<section><h3 class="m">Match Result</h3>${sel}</section>`, text: "" };
    },
    async record() {
      return { obstacle: "non" };
    },
  };
  return t;
}

const SETTINGS: TeamSettings = {
  teamKey: "sports",
  simulation: true,
  paused: false,
  autonomyLevel: 2,
  monthlyBudgetCents: {},
  styleGuidelines: "",
  forbiddenWords: [],
  maxTextLength: 900,
  quietHours: [],
  models: { fast: "x", strong: "y" },
  similarityThreshold: 0.8,
  settings: {},
};

async function setup(o: { api: () => number | null; page: () => number | null; pickOdds?: number; payload?: Record<string, unknown> }) {
  const kit = createTestKit(DAY);
  await kit.prisma.bookmakerSite.create({ data: { key: "site", label: "Site", baseUrl: "https://site.example/", readTarget: "server", isActive: true, status: "READY" } as never });
  await kit.prisma.bookmakerRecipe.create({ data: { siteKey: "site", version: 1, level: "api", api: RECIPE.api as never, dom: RECIPE.dom as never, mapping: RECIPE.mapping as never, validation: { domains: ["site.example"] } as never, isActive: true, createdBy: "learn" } as never });
  await kit.prisma.bookmakerEvent.create({ data: { siteKey: "site", siteEventId: "1", league: "L", homeTeam: "A", awayTeam: "B", startsAt: new Date(DAY.getTime() + 5 * 3_600_000), url: "https://site.example/match/1", fetchedAt: DAY } as never });
  const cat = await kit.prisma.betCategory.create({ data: { key: "k", name: "Résultat", marketTypes: ["resultat"], leagues: [], bookmakers: ["site"], minOdds: 1.2, maxOdds: 5, maxOddsDriftPct: 5, minMinutesBeforeKickoff: 30, channelIds: ["real"], active: true } as never });
  const missionRow = await kit.prisma.agentMission.create({ data: { teamKey: "sports", status: "RUNNING", channelId: "real", payload: { ...(o.payload ?? {}) } } as never });
  const pick = await kit.prisma.bettingPick.create({
    data: {
      missionId: missionRow.id,
      categoryId: cat.id,
      eventId: "bm:site:1",
      siteKey: "site",
      siteEventId: "1",
      homeTeam: "A",
      awayTeam: "B",
      league: "L",
      kickoffAt: new Date(DAY.getTime() + 5 * 3_600_000),
      marketId: "points-home-reg-ml3way-home",
      marketLabel: "Match Result",
      selectionLabel: "Home",
      line: null,
      bookmaker: "site",
      odds: o.pickOdds ?? 2.1,
      reasoning: { source: "live" },
      status: "PROPOSED",
    } as never,
  });
  await kit.prisma.agentMission.update({ where: { id: missionRow.id }, data: { payload: { ...(o.payload ?? {}), pickId: pick.id } } });
  const hooks: BookmakerHookEvent[] = [];
  const t = transport(o);
  const ctx = {
    ...kit.deps,
    now: kit.deps.now!,
    providers: { llm: null },
    settings: SETTINGS,
    bookmakers: { transport: t, withSiteLock: memorySiteLock, sleep: async (ms: number) => kit.advance(ms), llm: null, onBookmakerEvent: (e: BookmakerHookEvent) => void hooks.push(e) },
  } as unknown as AgentContext;
  const mission = async (): Promise<Mission> => {
    const m = kit.tables("agentMission").find((x) => x.id === missionRow.id)!;
    return { ...(m as unknown as Mission), payload: (m.payload ?? {}) as Mission["payload"], steps: [] };
  };
  const pickRow = () => kit.tables("bettingPick").find((x) => x.id === pick.id) as unknown as PickRow & { siteKey: string };
  return { kit, ctx, hooks, t, mission, pickRow, category: { maxOddsDriftPct: 5 } };
}

describe("double lecture avant publication", () => {
  it("deux chemins identiques → cote vérifiée, lectures et niveaux gardés sur le pari", async () => {
    const s = await setup({ api: () => 2.1, page: () => 2.1 });
    const r = await verifyDirectOdds(await s.mission(), s.ctx, s.pickRow(), s.category, "controle");
    expect(r).toMatchObject({ ok: true, odds: 2.1, levels: "api+dom" });
    const p = s.pickRow();
    expect(p.oddsAtSend).toBe(2.1);
    expect(p.oddsLevel).toBe("api+dom");
    expect((p.oddsReadIds as string[]).length).toBe(2);
  });

  it("deux lectures différentes → mission en attente d'un humain, Kevin prévenu par le crochet", async () => {
    const s = await setup({ api: () => 2.1, page: () => 2.2 });
    const r = await verifyDirectOdds(await s.mission(), s.ctx, s.pickRow(), s.category, "controle");
    expect("result" in r && r.result.goTo).toBe("controle");
    expect((await s.mission()).status).toBe("WAITING_HUMAN");
    expect(s.hooks.find((h) => h.type === "double_read_failed")).toMatchObject({ siteKey: "site", reason: expect.stringMatching(/diffèrent/) });
    expect(s.pickRow().status).toBe("PROPOSED");
  });

  it("attente humaine : une question de relecture part (reprise au Contrôle) ; après 2 attentes, pari écarté", async () => {
    const s = await setup({ api: () => 2.1, page: () => 2.2 });
    const r = await verifyDirectOdds(await s.mission(), s.ctx, s.pickRow(), s.category, "controle");
    expect("result" in r && r.result.output).toMatchObject({ oddsHolds: 1 });
    const req = s.kit.tables("humanRequest").find((x) => x.key === `bookmakers.odds.${s.pickRow().id}`);
    expect(req).toMatchObject({ kind: "CONFIRM", missionId: (await s.mission()).id });
    const again = await setup({ api: () => 2.1, page: () => 2.2, payload: { oddsHolds: 2 } });
    await verifyDirectOdds(await again.mission(), again.ctx, again.pickRow(), again.category, "controle");
    expect(again.pickRow().status).toBe("SKIPPED");
    expect(again.kit.tables("humanRequest")).toHaveLength(0);
  });

  it("cote changée au-delà de la tolérance → sélection refaite (puis pari écarté après 2 essais)", async () => {
    const s = await setup({ api: () => 2.5, page: () => 2.5 });
    const r = await verifyDirectOdds(await s.mission(), s.ctx, s.pickRow(), s.category, "controle");
    expect("result" in r && r.result.goTo).toBe("cotes");
    expect("result" in r && r.result.output).toMatchObject({ pickId: null, reselections: 1 });
    expect(s.pickRow()).toMatchObject({ status: "SKIPPED", skipReason: "odds_moved" });

    const s2 = await setup({ api: () => 2.5, page: () => 2.5, payload: { reselections: MAX_RESELECTIONS } });
    const r2 = await verifyDirectOdds(await s2.mission(), s2.ctx, s2.pickRow(), s2.category, "controle");
    expect("result" in r2 && r2.result.goTo).toBeUndefined();
    expect((await s2.mission()).status).toBe("CANCELLED");
  });

  it("sélection disparue des deux chemins → pari écarté", async () => {
    const s = await setup({ api: () => null, page: () => null });
    await verifyDirectOdds(await s.mission(), s.ctx, s.pickRow(), s.category, "controle");
    expect(s.pickRow()).toMatchObject({ status: "SKIPPED", skipReason: "market_missing" });
  });

  it("capture qui affiche une autre cote → capture refaite", async () => {
    const s = await setup({ api: () => 2.1, page: () => 2.1, payload: { capture: { status: "captured", readOdds: 2.05 } } });
    const r = await verifyDirectOdds(await s.mission(), s.ctx, s.pickRow(), s.category, "controle");
    expect("result" in r && r.result.goTo).toBe("capture");
  });

  it("relecture adverse : cote fractionnaire (5/6) lue au centième sur la capture = même cote que la double lecture (1,8333)", () => {
    expect(sameCapturedOdds(1.83, 1 + 5 / 6)).toBe(true);
    expect(sameCapturedOdds(1.73, 1.7273)).toBe(true); // 8/11
    expect(sameCapturedOdds(2.05, 2.1)).toBe(false);
  });
});

describe("chaîne Paris : Contrôle et Publication branchés sur la double lecture", () => {
  it("Contrôle : la cote vient de la double lecture du site (jamais de SportsGameOdds)", async () => {
    const s = await setup({ api: () => 2.1, page: () => 2.1 });
    const r = await sportsControl(await s.mission(), s.ctx);
    expect(r.output).toMatchObject({ oddsAtControl: 2.1 });
    expect(s.pickRow().oddsLevel).toBe("api+dom");
  });

  it("Publication : contrôle de plus de 3 min → cote relue deux fois ; écart → sélection refaite", async () => {
    const s = await setup({ api: () => 2.1, page: () => 2.1, payload: { text: "Pari", oddsAtControl: 2.1, controlCheckedAt: DAY.toISOString() } });
    s.kit.advance(4 * 60_000);
    const before = s.t.reads;
    await sportsPublication(await s.mission(), s.ctx);
    expect(s.t.reads).toBeGreaterThan(before);

    const s2 = await setup({ api: () => 2.6, page: () => 2.6, payload: { text: "Pari", oddsAtControl: 2.1, controlCheckedAt: DAY.toISOString() } });
    s2.kit.advance(4 * 60_000);
    const r2 = await sportsPublication(await s2.mission(), s2.ctx);
    expect(r2.goTo).toBe("cotes");
  });

  it("Publication juste après le Contrôle (moins de 3 min) : pas de relecture inutile", async () => {
    const s = await setup({ api: () => 2.1, page: () => 2.1, payload: { text: "Pari", oddsAtControl: 2.1, controlCheckedAt: DAY.toISOString() } });
    s.kit.advance(60_000);
    const before = s.t.reads;
    await sportsPublication(await s.mission(), s.ctx).catch(() => undefined);
    expect(s.t.reads).toBe(before);
  });
});
