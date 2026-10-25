import { describe, expect, it } from "vitest";
import { createEngineKit } from "../testing/engine-kit";
import { createMarketListOddsProvider, MARKETS_WITH_OFFSIDES, MARKETS_WITHOUT_OFFSIDES } from "../testing/odds-markets";
import { createFakeOddsProvider } from "../providers/fake-odds";
import { listBetThemes, marketsAvailable, resolveTheme, SPORTS_THEMES, themeOfMarkets } from "./themes";
import { parseMarketId } from "./labels";

const START = new Date("2026-10-24T08:00:00Z");

describe("thèmes de paris (phase 33)", () => {
  it("chaque thème a des marchés au format BetCategory (oddID en 5 parties)", () => {
    expect(SPORTS_THEMES.length).toBeGreaterThanOrEqual(15);
    for (const t of SPORTS_THEMES) {
      expect(t.marketTypes.length).toBeGreaterThan(0);
      for (const m of t.marketTypes) expect(parseMarketId(m), `${t.key} ${m}`).not.toBeNull();
    }
    expect(listBetThemes().map((t) => t.key)).toContain("hors-jeux");
  });

  it("résout le français courant, les synonymes et l'anglais", () => {
    expect(resolveTheme("les hors-jeux")?.key).toBe("hors-jeux");
    expect(resolveTheme("Hors jeu")?.key).toBe("hors-jeux");
    expect(resolveTheme("offsides")?.key).toBe("hors-jeux");
    expect(resolveTheme("Corners")?.key).toBe("corners");
    expect(resolveTheme("cartons jaunes")?.key).toBe("cartons-jaunes");
    expect(resolveTheme("cartons")?.key).toBe("cartons");
    expect(resolveTheme("red cards")?.key).toBe("cartons-rouges");
    expect(resolveTheme("tirs cadrés")?.key).toBe("tirs-cadres");
    expect(resolveTheme("both teams to score")?.key).toBe("les-deux-equipes-marquent");
    expect(resolveTheme("buteur")?.key).toBe("buteurs");
    expect(resolveTheme("double chance")?.key).toBe("double-chance");
    expect(resolveTheme("score exact")?.key).toBe("score-exact");
    expect(resolveTheme("handicap asiatique")?.key).toBe("handicap");
    expect(resolveTheme("mi-temps")?.key).toBe("mi-temps");
    expect(resolveTheme("1N2")?.key).toBe("resultat");
    expect(resolveTheme("pétanque")).toBeNull();
    expect(resolveTheme("")).toBeNull();
  });

  it("relie une catégorie existante à son thème", () => {
    expect(themeOfMarkets(["corners-all-game-ou-over"])?.key).toBe("corners");
    expect(themeOfMarkets(["points-PLAYER_ID-game-yn-yes"])?.key).toBe("buteurs");
  });

  it("fournisseur AVEC hors-jeux : thème disponible", async () => {
    const kit = createEngineKit({ start: START });
    const odds = createMarketListOddsProvider({ now: () => START, markets: MARKETS_WITH_OFFSIDES });
    const r = await marketsAvailable({ ...kit.deps, providers: { odds } } as never, "hors-jeux", { start: "2026-10-24", days: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.withOdds).toBeGreaterThan(0);
  });

  it("fournisseur SANS hors-jeux : raison précise et replis = thèmes qui ont des cotes", async () => {
    const kit = createEngineKit({ start: START });
    const odds = createMarketListOddsProvider({ now: () => START, markets: MARKETS_WITHOUT_OFFSIDES });
    const r = await marketsAvailable({ ...kit.deps, providers: { odds } } as never, "hors-jeux", { start: "2026-10-24", days: 3 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("no_market");
    expect(r.reason).toContain("hors-jeux");
    expect(r.available.map((t) => t.key)).toEqual(expect.arrayContaining(["corners", "cartons", "tirs-cadres"]));
    expect(r.available.map((t) => t.key)).not.toContain("hors-jeux");
  });

  it("thème inconnu : « je ne connais pas » + liste", async () => {
    const kit = createEngineKit({ start: START });
    const odds = createMarketListOddsProvider({ now: () => START, markets: MARKETS_WITH_OFFSIDES });
    const r = await marketsAvailable({ ...kit.deps, providers: { odds } } as never, "pétanque", { start: "2026-10-24", days: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("unknown_theme");
      expect(r.reason).toMatch(/Je ne connais pas/);
      expect(r.available.length).toBeGreaterThan(0);
    }
  });

  it("vraies fixtures du fournisseur : corners oui, hors-jeux non", async () => {
    const kit = createEngineKit({ start: START });
    const odds = createFakeOddsProvider({ now: () => START });
    const deps = { ...kit.deps, providers: { odds } } as never;
    expect((await marketsAvailable(deps, "corners", { start: "2026-10-24", days: 2 })).ok).toBe(true);
    const off = await marketsAvailable(deps, "hors-jeux", { start: "2026-10-24", days: 2 });
    expect(off.ok).toBe(false);
  });
});
