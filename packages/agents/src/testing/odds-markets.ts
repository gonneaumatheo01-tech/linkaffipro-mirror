/**
 * Faux fournisseur de cotes à liste de marchés (tests de la phase 33, jamais en production) : les matchs des fixtures
 * (recalés sur l'horloge) et, pour chaque match, une sélection par marché de la liste (deux bookmakers). Sert à
 * simuler un fournisseur qui a (ou n'a pas) les hors-jeux. Aucun réseau.
 */
import { createFakeOddsProvider } from "../providers/fake-odds";
import type { OddsSelection } from "../providers/odds";
import type { BatchOddsProvider } from "../providers/odds-batch";
import { marketMatches } from "../rules/bets";

export function createMarketListOddsProvider(opts: { now: () => Date; markets: readonly string[]; bookmakers?: string[] }): BatchOddsProvider & { name: "fake"; calls: string[] } {
  const base = createFakeOddsProvider({ now: opts.now });
  const books = opts.bookmakers ?? ["bet365", "unibet"];
  const calls: string[] = [];
  const selections = (types: readonly string[]): OddsSelection[] =>
    opts.markets
      .filter((m) => !types.length || types.some((t) => marketMatches(m, t)))
      .map((m) => ({ marketId: m, marketLabel: m, selectionLabel: "Plus de 2,5", line: 2.5, byBookmaker: Object.fromEntries(books.map((b, i) => [b, 1.85 + i * 0.05])), fairOdds: 1.9 }));
  return {
    name: "fake",
    calls,
    listEvents: async (q) => {
      calls.push("listEvents");
      return base.listEvents(q);
    },
    getMarkets: async (_id, types) => selections(types),
    getMarketsMany: async (ids, types) => {
      calls.push("getMarketsMany");
      return new Map(ids.map((id) => [id, selections(types)]));
    },
    getMarketsFresh: async (_id, types) => selections(types),
    getResult: (id) => base.getResult(id),
    listBookmakers: async () => [...books],
  };
}

/** Marchés « avec hors-jeux » et « sans hors-jeux » (corners, cartons, tirs cadrés, buts). */
export const MARKETS_WITH_OFFSIDES = [
  "offsides-all-game-ou-over",
  "corners-all-game-ou-over",
  "cards-all-game-ou-over",
  "shots_onGoal-all-game-ou-over",
  "points-all-game-ou-over",
] as const;
export const MARKETS_WITHOUT_OFFSIDES = MARKETS_WITH_OFFSIDES.filter((m) => !m.startsWith("offsides"));
