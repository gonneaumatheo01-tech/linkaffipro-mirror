import { describe, expect, it } from "vitest";
import {
  fallbackRateStore,
  LINKAFFI_RATE_LIMIT,
  LINKAFFI_RATE_WINDOW_MS,
  memoryRateStore,
  redisRateStore,
  type RateLimitStore,
  type RateRedis,
} from "./rate-limit";

/** Faux Redis : ensembles triés et clés avec expiration, en mémoire (seulement les commandes utilisées). */
function fakeRedis(clock: () => number): RateRedis & { zsets: Map<string, Map<string, number>> } {
  const zsets = new Map<string, Map<string, number>>();
  const strings = new Map<string, { v: string; until: number }>();
  const z = (k: string) => zsets.get(k) ?? zsets.set(k, new Map()).get(k)!;
  return {
    zsets,
    async zremrangebyscore(key, min, max) {
      for (const [m, s] of z(key)) if (s >= min && s <= max) z(key).delete(m);
      return 0;
    },
    async zcard(key) {
      return z(key).size;
    },
    async zrange(key, start) {
      const sorted = [...z(key).entries()].sort((a, b) => a[1] - b[1]);
      const e = sorted[start];
      return e ? [e[0], String(e[1])] : [];
    },
    async zadd(key, score, member) {
      z(key).set(member, score);
      return 1;
    },
    async pexpire() {
      return 1;
    },
    async set(key, value, _px, ms) {
      const cur = strings.get(key);
      if (cur && cur.until > clock()) return null;
      strings.set(key, { v: value, until: clock() + ms });
      return "OK";
    },
  };
}

async function burst(store: RateLimitStore, id: string, n: number, at: number) {
  const out = [];
  for (let i = 0; i < n; i++)
    out.push(await store.hit(id, at + i, LINKAFFI_RATE_LIMIT, LINKAFFI_RATE_WINDOW_MS));
  return out;
}

for (const [name, make] of [
  ["mémoire", (_clock: () => number) => memoryRateStore()],
  ["Redis", (clock: () => number) => redisRateStore(fakeRedis(clock))],
] as const) {
  describe(`limite de débit : 60 requêtes par minute et par clé (${name})`, () => {
    it("la 61e requête de la minute est refusée, avec l'attente avant la prochaine place", async () => {
      let now = 1_000_000;
      const store = make(() => now);
      const first = await burst(store, "key:a", 60, now);
      expect(first.every((d) => d.allowed)).toBe(true);
      expect(first[59]).toEqual({ allowed: true, remaining: 0 });
      now += 60;
      const refused = await store.hit("key:a", now, 60, 60_000);
      expect(refused.allowed).toBe(false);
      if (refused.allowed) return;
      // La plus ancienne requête (t = 1 000 000) libère sa place à 1 060 000 : ~60 s d'attente.
      expect(refused.retryAfterSec).toBe(60);
      expect(refused.firstRefusal).toBe(true);
      const again = await store.hit("key:a", now + 1, 60, 60_000);
      expect(again).toMatchObject({ allowed: false, firstRefusal: false });
    });

    it("une autre clé a sa propre limite ; une place se libère après une minute glissante", async () => {
      let now = 2_000_000;
      const store = make(() => now);
      await burst(store, "key:b", 60, now);
      expect((await store.hit("key:c", now + 100, 60, 60_000)).allowed).toBe(true);
      expect((await store.hit("key:b", now + 100, 60, 60_000)).allowed).toBe(false);
      now += 60_001;
      expect((await store.hit("key:b", now, 60, 60_000)).allowed).toBe(true);
    });

    it("un refus ne prend pas de place (les appels refusés ne prolongent pas l'attente)", async () => {
      const now = 3_000_000;
      const store = make(() => now);
      await burst(store, "key:d", 60, now);
      for (let i = 0; i < 20; i++) await store.hit("key:d", now + 100 + i, 60, 60_000);
      expect((await store.hit("key:d", now + 60_001, 60, 60_000)).allowed).toBe(true);
    });
  });
}

describe("repli sur la mémoire si Redis est indisponible", () => {
  it("Redis en erreur ou trop lent : la limite s'applique quand même (par instance)", async () => {
    const broken: RateLimitStore = {
      hit: () => Promise.reject(new Error("ECONNREFUSED")),
    };
    const slow: RateLimitStore = { hit: () => new Promise(() => undefined) };
    for (const primary of [broken, slow, null]) {
      const store = fallbackRateStore(() => primary, memoryRateStore(), 20);
      const all = await burst(store, "key:e", 61, 5_000_000);
      expect(all.filter((d) => d.allowed)).toHaveLength(60);
      expect(all[60]!.allowed).toBe(false);
    }
  });

  it("getRedis qui lève une erreur (tests, Redis absent) : mémoire", async () => {
    const store = fallbackRateStore(() => {
      throw new Error("REDIS_URL manquante");
    }, memoryRateStore());
    expect((await store.hit("key:f", 1, 60, 60_000)).allowed).toBe(true);
  });
});
