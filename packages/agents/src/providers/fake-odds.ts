/**
 * Faux fournisseur de cotes (tests, « Produire un pari de test », simulation sans clé) : rejoue les fixtures
 * `fixtures/odds/*.json`, écrites dans la forme exacte des réponses SportsGameOdds et lues par le MÊME code de lecture
 * que le vrai client. Les dates sont recalées sur l'horloge : un match prévu 30 h après l'ancre des fixtures commence
 * 30 h après la création du fournisseur. Le décalage est figé (`shiftMs`) et gardé dans le pari : les étapes
 * suivantes et le règlement voient les mêmes heures de match. Résultat : connu 2 h après le coup d'envoi. Aucun réseau.
 * Les tests modifient une cote (`setOdds`) ou retirent un marché pour simuler un mouvement.
 */
import eventsFixture from "../../fixtures/odds/events.json";
import resultsFixture from "../../fixtures/odds/results.json";
import type { OddsEvent, OddsResult } from "./odds";
import type { BatchOddsProvider } from "./odds-batch";
import { mapEvent, mapResult, mapSelections, type SgoEvent } from "./sportsgameodds-map";

export const FAKE_ODDS_ANCHOR = new Date((eventsFixture as { anchor: string }).anchor);
/** Résultat lisible après ce délai depuis le coup d'envoi. */
export const FAKE_RESULT_AFTER_MS = 2 * 3_600_000;

export type FakeOddsProvider = BatchOddsProvider & {
  name: "fake";
  /** Cote décimale d'un bookmaker (null = cote retirée) ; `line` pour une ligne précise. */
  setOdds(eventId: string, marketId: string, bookmaker: string, decimal: number | null): void;
  removeMarket(eventId: string, marketId: string): void;
  calls: string[];
  /** Décalage appliqué aux dates des fixtures (ms). */
  shiftMs: number;
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Décimal → américain (forme du fournisseur). */
function toAmerican(d: number): string {
  return d >= 2 ? `+${Math.round((d - 1) * 100)}` : `${Math.round(-100 / (d - 1))}`;
}

export function createFakeOddsProvider(opts: { now?: () => Date; shiftMs?: number | null } = {}): FakeOddsProvider {
  const clock = opts.now ?? (() => new Date());
  // Décalage à la minute près, figé à la création.
  const shiftMs = typeof opts.shiftMs === "number" && Number.isFinite(opts.shiftMs) ? opts.shiftMs : Math.floor((clock().getTime() - FAKE_ODDS_ANCHOR.getTime()) / 60_000) * 60_000;
  const raw = clone((eventsFixture as unknown as { data: SgoEvent[] }).data);
  const results = clone((resultsFixture as unknown as { data: SgoEvent[] }).data);
  const calls: string[] = [];
  const shift = () => shiftMs;
  const rebased = (e: SgoEvent): SgoEvent => {
    const at = e.status?.startsAt ? new Date(new Date(e.status.startsAt).getTime() + shift()).toISOString() : undefined;
    return { ...e, status: { ...e.status, ...(at ? { startsAt: at } : {}) } };
  };
  const find = (id: string) => raw.find((e) => e.eventID === id);

  return {
    name: "fake",
    calls,
    shiftMs,
    async listEvents(q): Promise<OddsEvent[]> {
      calls.push("listEvents");
      return raw
        .map((e) => mapEvent(rebased(e)))
        .filter((e): e is OddsEvent => e !== null)
        .filter((e) => (!q.leagues.length || q.leagues.includes(e.leagueId)) && e.startsAt >= q.from && e.startsAt <= q.to);
    },
    async getMarkets(eventId, marketTypes) {
      calls.push("getMarkets");
      const e = find(eventId);
      return e ? mapSelections(rebased(e), marketTypes) : [];
    },
    async getMarketsMany(eventIds, marketTypes) {
      calls.push("getMarketsMany");
      const out = new Map<string, ReturnType<typeof mapSelections>>();
      for (const id of eventIds) {
        const e = find(id);
        out.set(id, e ? mapSelections(rebased(e), marketTypes) : []);
      }
      return out;
    },
    async getMarketsFresh(eventId, marketTypes) {
      calls.push("getMarketsFresh");
      const e = find(eventId);
      return e ? mapSelections(rebased(e), marketTypes) : [];
    },
    async getResult(eventId): Promise<OddsResult | null> {
      calls.push("getResult");
      const e = find(eventId);
      const r = results.find((x) => x.eventID === eventId);
      if (!e || !r) return null;
      const startsAt = new Date(new Date(e.status!.startsAt!).getTime() + shift());
      if (clock().getTime() < startsAt.getTime() + FAKE_RESULT_AFTER_MS)
        return { eventId, finalized: false, cancelled: false, homeScore: null, awayScore: null, marketScores: {}, stats: {} };
      return mapResult(r);
    },
    async listBookmakers() {
      calls.push("listBookmakers");
      const set = new Set<string>();
      for (const e of raw) for (const o of Object.values(e.odds ?? {})) for (const b of Object.keys(o.byBookmaker ?? {})) set.add(b);
      return [...set].sort();
    },
    setOdds(eventId, marketId, bookmaker, decimal) {
      const o = find(eventId)?.odds?.[marketId];
      if (!o) return;
      o.byBookmaker ??= {};
      if (decimal === null) delete o.byBookmaker[bookmaker];
      else o.byBookmaker[bookmaker] = { ...(o.byBookmaker[bookmaker] ?? {}), odds: toAmerican(decimal), available: true };
    },
    removeMarket(eventId, marketId) {
      const e = find(eventId);
      if (e?.odds) delete e.odds[marketId];
    },
  };
}
