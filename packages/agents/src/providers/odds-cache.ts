/**
 * Cache des cotes (phase 23) : matchs 30 min, cotes 5 min, résultats 10 min, bookmakers 24 h. Le cache est injecté
 * (Redis dans le worker, mémoire en test et par défaut) : le paquet des agents reste sans Redis. Une panne du cache
 * n'empêche jamais la lecture (on interroge alors le fournisseur).
 */
import type { OddsEvent, OddsProvider, OddsResult, OddsSelection } from "./odds";
import type { BatchOddsProvider } from "./odds-batch";

export type OddsCache = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
};

export const ODDS_TTL = { events: 30 * 60, markets: 5 * 60, results: 10 * 60, bookmakers: 24 * 3600 } as const;

/** Cache en mémoire (tests, site, repli) ; horloge injectable. */
export function createMemoryOddsCache(now: () => Date = () => new Date()): OddsCache & { size(): number } {
  const store = new Map<string, { value: string; until: number }>();
  return {
    async get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (e.until <= now().getTime()) {
        store.delete(key);
        return null;
      }
      return e.value;
    },
    async set(key, value, ttl) {
      store.set(key, { value, until: now().getTime() + ttl * 1000 });
    },
    size: () => store.size,
  };
}

async function safeGet(cache: OddsCache, key: string): Promise<string | null> {
  try {
    return await cache.get(key);
  } catch {
    return null;
  }
}

async function safeSet(cache: OddsCache, key: string, value: unknown, ttl: number): Promise<void> {
  try {
    await cache.set(key, JSON.stringify(value), ttl);
  } catch {
    /* cache indisponible : sans conséquence */
  }
}

const reviveEvents = (s: string): OddsEvent[] =>
  (JSON.parse(s) as Array<OddsEvent & { startsAt: string }>).map((e) => ({ ...e, startsAt: new Date(e.startsAt) }));

/** Arrondi à l'heure : une même fenêtre de recherche réutilise le cache pendant l'heure. */
const hour = (d: Date) => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000).toISOString();

export function withOddsCache(p: OddsProvider, cache: OddsCache): BatchOddsProvider {
  const prefix = `odds:${p.name}`;
  const marketsKey = (id: string, types: string[]) => `${prefix}:markets:${id}:${[...types].sort().join(",")}`;
  return {
    name: p.name,
    async listEvents(q) {
      const key = `${prefix}:events:${q.sport}:${[...q.leagues].sort().join(",")}:${hour(q.from)}:${hour(q.to)}`;
      const hit = await safeGet(cache, key);
      const all = hit ? reviveEvents(hit) : await p.listEvents(q);
      if (!hit) await safeSet(cache, key, all, ODDS_TTL.events);
      return all.filter((e) => e.startsAt >= q.from && e.startsAt <= q.to);
    },
    async getMarkets(eventId, types) {
      const key = marketsKey(eventId, types);
      const hit = await safeGet(cache, key);
      if (hit) return JSON.parse(hit) as OddsSelection[];
      const v = await p.getMarkets(eventId, types);
      await safeSet(cache, key, v, ODDS_TTL.markets);
      return v;
    },
    async getMarketsMany(eventIds, types) {
      const out = new Map<string, OddsSelection[]>();
      const missing: string[] = [];
      for (const id of eventIds) {
        const hit = await safeGet(cache, marketsKey(id, types));
        if (hit) out.set(id, JSON.parse(hit) as OddsSelection[]);
        else missing.push(id);
      }
      if (missing.length) {
        const b = p as BatchOddsProvider;
        const fetched = b.getMarketsMany ? await b.getMarketsMany(missing, types) : new Map(await Promise.all(missing.map(async (id) => [id, await p.getMarkets(id, types)] as const)));
        for (const id of missing) {
          const v = fetched.get(id) ?? [];
          out.set(id, v);
          await safeSet(cache, marketsKey(id, types), v, ODDS_TTL.markets);
        }
      }
      return out;
    },
    async getMarketsFresh(eventId, types) {
      const b = p as BatchOddsProvider;
      const v = b.getMarketsFresh ? await b.getMarketsFresh(eventId, types) : await p.getMarkets(eventId, types);
      await safeSet(cache, marketsKey(eventId, types), v, ODDS_TTL.markets);
      return v;
    },
    async getResult(eventId) {
      const key = `${prefix}:result:${eventId}`;
      const hit = await safeGet(cache, key);
      if (hit) return JSON.parse(hit) as OddsResult | null;
      const v = await p.getResult(eventId);
      await safeSet(cache, key, v, ODDS_TTL.results);
      return v;
    },
    async listBookmakers() {
      const key = `${prefix}:bookmakers`;
      const hit = await safeGet(cache, key);
      if (hit) return JSON.parse(hit) as string[];
      const v = await p.listBookmakers();
      await safeSet(cache, key, v, ODDS_TTL.bookmakers);
      return v;
    },
  };
}
