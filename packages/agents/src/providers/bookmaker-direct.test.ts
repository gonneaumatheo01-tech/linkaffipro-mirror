/**
 * Phase 35, chantier C : fournisseur `bookmaker-direct` (contrat `OddsProvider`) sur le site local Celsius, résultats
 * par SportsGameOdds (faux), registre, migration des catégories, règlement d'un pari lu sur un site du client.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import { startLocalSites, type LocalSites } from "../bookmakers/testing/local-sites";
import { loadFixtureRecipe } from "../bookmakers/testing/fixtures";
import { memorySiteLock } from "../bookmakers/read/deps";
import { createLocalTransport } from "../bookmakers/read/test-transport";
import { recipeCaptureConfig } from "../bookmakers/read/capture-config";
import { parseRecipeRow } from "../bookmakers/read/recipe";
import { createBookmakerDirectProvider, matchOddsEvent, parseDirectEventId } from "./bookmaker-direct";
import { migrateCategoryMarketTypes, resolveOddsProvider } from "./odds-registry";
import type { OddsEvent, OddsProvider, OddsResult } from "./odds";
import { runSportsSettle } from "../sports/settle";
import { expandCategoryMarkets, toCategory } from "../sports/data";
import { SPORTS_THEMES, themeOfMarkets } from "../sports/themes";
import { unusualOddsOf } from "../agents/cotes/select";

const DAY = new Date("2026-10-25T09:00:00Z");
let local: LocalSites | null = null;
afterEach(async () => {
  await local?.stop();
  local = null;
});

function fakeSgo(o: { events?: OddsEvent[]; result?: OddsResult | null } = {}) {
  const calls: string[] = [];
  const sgo: OddsProvider = {
    name: "sportsgameodds",
    async listEvents() {
      calls.push("listEvents");
      return o.events ?? [];
    },
    async getMarkets(eventId, types) {
      calls.push(`getMarkets:${eventId}:${types.join(",")}`);
      return [{ marketId: "points-home-reg-ml3way-home", marketLabel: "1X2", selectionLabel: "home", line: null, byBookmaker: { pinnacle: 1.55, bet365: 1.62 }, fairOdds: 1.6 }];
    },
    async getResult(eventId) {
      calls.push(`getResult:${eventId}`);
      return o.result === undefined ? null : o.result ? { ...o.result, eventId } : null;
    },
    async listBookmakers() {
      return ["pinnacle", "bet365"];
    },
  };
  return { sgo, calls };
}

async function celsius(o: { status?: string } = {}) {
  const kit = createTestKit(DAY);
  local = await startLocalSites({ only: ["celsius"] });
  const s = local.sites.celsius;
  const recipe = loadFixtureRecipe("celsius", { origin: s.origin });
  await kit.prisma.bookmakerSite.create({ data: { key: "celsius", label: "Celsius", baseUrl: s.baseUrl, readTarget: "server", isActive: true, status: o.status ?? "READY" } as never });
  await kit.prisma.bookmakerRecipe.create({
    data: { siteKey: "celsius", version: 1, level: recipe.level, api: recipe.api as never, dom: recipe.dom as never, mapping: recipe.mapping as never, validation: { domains: ["127.0.0.1"] } as never, isActive: true, createdBy: "learn" } as never,
  });
  const transport = createLocalTransport({ now: kit.deps.now!, tokenUrl: { celsius: `${s.origin}/api/v2/auth/token` } });
  const bookmakers = { transport, withSiteLock: memorySiteLock, sleep: async (ms: number) => kit.advance(ms), llm: null };
  return { kit, bookmakers, transport };
}

const sgoEvent = (over: Partial<OddsEvent> = {}): OddsEvent => ({ eventId: "sgo-1", leagueId: "FR_LIGUE_1", homeTeam: "AS Mirabelle", awayTeam: "FC Lavande", startsAt: new Date("2026-10-25T13:10:00Z"), ...over });

describe("bookmaker-direct : contrat OddsProvider", () => {
  it("matchs du site (bm:<site>:<id>), correspondance SportsGameOdds écrite, cotes du site seules jouables", async () => {
    const { kit, bookmakers } = await celsius();
    const { sgo } = fakeSgo({ events: [sgoEvent()] });
    const p = createBookmakerDirectProvider({ ...kit.deps, bookmakers, sgo });
    expect(p.name).toBe("bookmaker-direct");
    expect(await p.listBookmakers()).toEqual(["celsius"]);
    const events = await p.listEvents({ sport: "SOCCER", leagues: [], from: DAY, to: new Date(DAY.getTime() + 48 * 3_600_000) });
    const ev = events.find((e) => e.homeTeam === "AS Mirabelle")!;
    expect(ev.eventId).toBe("bm:celsius:70101");
    expect(ev.leagueId).toBe("FR_LIGUE_1");
    expect(kit.tables("bookmakerEvent").find((r) => r.siteEventId === "70101")?.oddsEventId).toBe("sgo-1");
    const sel = await p.getMarkets(ev.eventId, ["resultat"]);
    const home = sel.find((x) => x.marketId === "points-home-reg-ml3way-home")!;
    expect(home.byBookmaker).toEqual({ celsius: 1.6 });
    expect(home.referenceBookmakers).toEqual({ pinnacle: 1.55, bet365: 1.62 });
    expect(home).toMatchObject({ marketLabel: "Match Result", selectionLabel: "AS Mirabelle", fairOdds: 1.6 });
  });

  it("résultat par la correspondance ; sans correspondance : null (jamais deviné)", async () => {
    const { kit, bookmakers } = await celsius();
    const result: OddsResult = { eventId: "x", finalized: true, cancelled: false, homeScore: 2, awayScore: 1, marketScores: {}, stats: {} };
    const { sgo, calls } = fakeSgo({ events: [sgoEvent()], result });
    const p = createBookmakerDirectProvider({ ...kit.deps, bookmakers, sgo });
    await p.listEvents({ sport: "SOCCER", leagues: [], from: DAY, to: new Date(DAY.getTime() + 48 * 3_600_000) });
    expect(await p.getResult("bm:celsius:70101")).toMatchObject({ eventId: "bm:celsius:70101", homeScore: 2, finalized: true });
    expect(calls).toContain("getResult:sgo-1");
    expect(await p.getResult("bm:celsius:70102")).toBeNull();
    expect(await p.getResult("pas-un-id-direct")).toBeNull();
  });

  it("correspondance : deux équipes et coup d'envoi ± 15 min, un seul candidat", () => {
    const e = { homeTeam: "AS Mirabelle", awayTeam: "FC Lavande", startsAt: new Date("2026-10-25T13:00:00Z") };
    expect(matchOddsEvent(e, [sgoEvent()])?.eventId).toBe("sgo-1");
    expect(matchOddsEvent(e, [sgoEvent({ startsAt: new Date("2026-10-25T13:20:00Z") })])).toBeNull();
    expect(matchOddsEvent(e, [sgoEvent(), sgoEvent({ eventId: "sgo-2" })])).toBeNull();
    expect(parseDirectEventId("bm:celsius:a:b")).toEqual({ siteKey: "celsius", siteEventId: "a:b" });
  });
});

describe("registre des fournisseurs", () => {
  it("catégorie visant un site READY → bookmaker-direct ; site pas prêt → SportsGameOdds (ici sans clé : aucun)", async () => {
    const { kit, bookmakers } = await celsius();
    const r = await resolveOddsProvider({ ...kit.deps, bookmakers }, { maxCalls: 100, bookmakers: ["Celsius"] });
    expect(r?.provider.name).toBe("bookmaker-direct");
    await kit.prisma.bookmakerSite.update({ where: { key: "celsius" }, data: { status: "DEGRADED" } });
    expect(await resolveOddsProvider({ ...kit.deps, bookmakers }, { maxCalls: 100, bookmakers: ["celsius"] })).toBeNull();
    // Un pari déjà lu sur le site reste lu sur ce site (résultats).
    expect((await resolveOddsProvider({ ...kit.deps, bookmakers }, { maxCalls: 100, siteKey: "celsius" }))?.provider.name).toBe("bookmaker-direct");
  });

  it("relecture adverse : catégorie mêlant un site du client et un bookmaker de SportsGameOdds → les deux sont lus", async () => {
    const { kit, bookmakers } = await celsius();
    const { sgo, calls } = fakeSgo({ events: [sgoEvent({ eventId: "sgo-9", homeTeam: "Équipe X", awayTeam: "Équipe Y" })] });
    const cat = await kit.prisma.betCategory.create({ data: { key: "mix", name: "Résultat", sport: "SOCCER", marketTypes: ["points-home-reg-ml3way-home"], leagues: [], bookmakers: ["celsius", "bet365"], minOdds: 1.2, maxOdds: 5, maxOddsDriftPct: 5, minMinutesBeforeKickoff: 30, picksPerDay: 1, channelIds: ["real"], active: true } as never });
    const { agent } = await import("../agents/cotes/index");
    const mission = { id: "m1", teamKey: "sports", isTest: false, channelId: "real", payload: { categoryId: cat.id }, steps: [] } as never;
    const ctx = { ...kit.deps, now: kit.deps.now!, providers: { sgo, llm: null }, settings: { settings: {} }, bookmakers } as never;
    await agent.run(mission, ctx).catch(() => undefined);
    expect(calls.some((c) => c.startsWith("getMarkets:sgo-9:"))).toBe(true);
  });

  it("cote du site à plus de 15 % du consensus : « cote inhabituelle » (signalée, pas bloquée)", () => {
    expect(unusualOddsOf(2.4, 2.0)).toMatchObject({ gapPct: 20 });
    expect(unusualOddsOf(2.2, 2.0)).toBeNull();
    expect(unusualOddsOf(2.2, null)).toBeNull();
  });
});

describe("catégories en clés internes", () => {
  const themes = SPORTS_THEMES;
  it("thème entièrement couvert → clé interne ; le reste gardé et listé ; relançable", () => {
    const corners = themes.find((t) => t.key === "corners")!.marketTypes;
    const m = migrateCategoryMarketTypes([...corners, "shots_onGoal-all-game-ou-over"], themes);
    expect(m.marketTypes).toEqual(["corners", "shots_onGoal-all-game-ou-over"]);
    expect(m.unmatched).toEqual(["shots_onGoal-all-game-ou-over"]);
    expect(m.changed).toBe(true);
    const again = migrateCategoryMarketTypes(m.marketTypes, themes);
    expect(again.changed).toBe(false);
    expect(again.marketTypes).toEqual(m.marketTypes);
  });

  it("la clé interne redonne exactement les marchés (même sens qu'avant la migration)", () => {
    const shots = themes.find((t) => t.key === "tirs-cadres")!.marketTypes;
    const m = migrateCategoryMarketTypes([...shots], themes);
    expect(m.marketTypes).toEqual(["tirs-cadres"]);
    expect(expandCategoryMarkets(m.marketTypes)).toEqual(shots);
    expect(toCategory({ id: "c", key: "k", name: "n", marketTypes: ["tirs-cadres", "x-all-game-ou-over"] }).marketTypes).toEqual([...shots, "x-all-game-ou-over"]);
    expect(themeOfMarkets(["tirs-cadres"])?.key).toBe("tirs-cadres");
  });
});

describe("règlement d'un pari lu sur un site du client", () => {
  async function seedPick(kit: ReturnType<typeof createTestKit>, siteEventId: string, oddsEventId: string | null) {
    await kit.prisma.bookmakerEvent.create({ data: { siteKey: "celsius", siteEventId, league: "L", homeTeam: "AS Mirabelle", awayTeam: "FC Lavande", startsAt: new Date(DAY.getTime() - 4 * 3_600_000), fetchedAt: DAY, oddsEventId } as never });
    return kit.prisma.bettingPick.create({
      data: {
        categoryId: "cat",
        eventId: `bm:celsius:${siteEventId}`,
        siteKey: "celsius",
        siteEventId,
        homeTeam: "AS Mirabelle",
        awayTeam: "FC Lavande",
        league: "L",
        kickoffAt: new Date(DAY.getTime() - 4 * 3_600_000),
        marketId: "points-home-reg-ml3way-home",
        marketLabel: "Match Result",
        selectionLabel: "AS Mirabelle",
        line: null,
        bookmaker: "celsius",
        odds: 1.6,
        reasoning: {},
        status: "PUBLISHED",
      } as never,
    });
  }

  it("résultat trouvé par la correspondance → réglé ; sans correspondance → attend, jamais réglé au hasard", async () => {
    const { kit, bookmakers } = await celsius();
    const won = await seedPick(kit, "70101", "sgo-1");
    const waiting = await seedPick(kit, "70109", null);
    const result: OddsResult = { eventId: "x", finalized: true, cancelled: false, homeScore: 2, awayScore: 1, marketScores: {}, stats: {} };
    const { sgo } = fakeSgo({ result });
    const r = await runSportsSettle({ ...kit.deps, bookmakers, providers: { sgo } });
    expect(r.settled).toBe(1);
    expect(kit.tables("bettingPick").find((p) => p.id === won.id)?.status).toBe("WON");
    expect(kit.tables("bettingPick").find((p) => p.id === waiting.id)?.status).toBe("PUBLISHED");
  });

  it("sans fournisseur de résultats : rien n'est réglé", async () => {
    const { kit, bookmakers } = await celsius();
    const p = await seedPick(kit, "70101", "sgo-1");
    const r = await runSportsSettle({ ...kit.deps, bookmakers });
    expect(r.settled).toBe(0);
    expect(kit.tables("bettingPick").find((x) => x.id === p.id)?.status).toBe("PUBLISHED");
  });
});

describe("capture par la recette apprise", () => {
  it("sélecteurs de la recette dom (bloc = parent direct du titre), domaines du site", () => {
    const recipe = loadFixtureRecipe("sportaza", { origin: "http://127.0.0.1:4000" });
    const active = parseRecipeRow({ id: "r", version: 2, level: recipe.level, dom: recipe.dom, api: null, mapping: recipe.mapping, validation: { domains: ["127.0.0.1"] } })!;
    const cfg = recipeCaptureConfig({ key: "sportaza", label: "Sportaza", baseUrl: "http://127.0.0.1:4000/fr/sports" }, active)!;
    expect(cfg.selectors.marketBlock).toContain(":has(> .sz-market__name)");
    expect(cfg.selectors.marketBlock).not.toContain("section h4");
    expect(cfg.selectors.selectionRow).toBe(".sz-outcome");
    expect(cfg.selectors.selectionOdds).toBe(".sz-outcome__odd");
    expect(cfg.selectors.marketTitle).toBe(".sz-market__name, section h4");
    expect(cfg.allowedHosts).toEqual(["127.0.0.1"]);
    expect(recipeCaptureConfig({ key: "x", label: "X", baseUrl: "https://x.example" }, { ...active, dom: null })).toBeNull();
  });
});
