import { describe, expect, it, vi } from "vitest";
import {
  TEST_SLOT_WINDOW_MS,
  fallbackTestSlotStore,
  memoryTestSlotStore,
  redisTestSlotStore,
  type TestSlotRedis,
} from "./test-limit";

const H = TEST_SLOT_WINDOW_MS;

/** Faux Redis : ensembles triés en mémoire, transaction MULTI exécutée d'un bloc (comme Redis). */
function fakeRedis() {
  const sets = new Map<string, Array<{ score: number; member: string }>>();
  const get = (k: string) => sets.get(k) ?? [];
  const redis: TestSlotRedis & { sets: typeof sets } = {
    sets,
    multi() {
      const ops: Array<() => unknown> = [];
      const tx = {
        zremrangebyscore(key: string, min: number, max: number) {
          ops.push(() =>
            sets.set(
              key,
              get(key).filter((e) => e.score < min || e.score > max),
            ),
          );
          return tx;
        },
        zadd(key: string, score: number, member: string) {
          ops.push(() =>
            sets.set(
              key,
              [...get(key), { score, member }].sort((a, b) => a.score - b.score),
            ),
          );
          return tx;
        },
        zcard(key: string) {
          ops.push(() => get(key).length);
          return tx;
        },
        pexpire() {
          ops.push(() => 1);
          return tx;
        },
        async exec() {
          return ops.map((op) => [null, op()] as [Error | null, unknown]);
        },
      };
      return tx;
    },
    async zrem(key, member) {
      sets.set(
        key,
        get(key).filter((e) => e.member !== member),
      );
      return 1;
    },
    async zrange(key, start) {
      const e = get(key)[start];
      return e ? [e.member, String(e.score)] : [];
    },
  };
  return redis;
}

describe("places d'essai en mémoire", () => {
  it("30 par heure et par personne, fenêtre glissante", async () => {
    const store = memoryTestSlotStore();
    const t0 = 1_000_000;
    // Un essai toutes les minutes.
    for (let i = 0; i < 30; i++)
      expect((await store.reserve("u1", t0 + i * 60_000, 30, H)).allowed).toBe(true);
    const refused = await store.reserve("u1", t0 + 30 * 60_000, 30, H);
    expect(refused).toEqual({ allowed: false, retryAfterMin: 30 });
    expect((await store.reserve("u2", t0 + 30 * 60_000, 30, H)).allowed).toBe(true);
    // Une heure après le premier essai, une place se libère.
    expect((await store.reserve("u1", t0 + H + 1, 30, H)).allowed).toBe(true);
    expect((await store.reserve("u1", t0 + H + 2, 30, H)).allowed).toBe(false);
  });

  it("demandes simultanées : jamais plus que la limite", async () => {
    const store = memoryTestSlotStore();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.reserve("u1", 5_000, 3, H)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });
});

describe("places d'essai dans Redis", () => {
  it("ajout puis compte dans la même transaction ; place retirée si la limite est dépassée", async () => {
    const redis = fakeRedis();
    const store = redisTestSlotStore(redis);
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++)
      expect((await store.reserve("u1", t0 + i, 3, H)).allowed).toBe(true);
    const refused = await store.reserve("u1", t0 + 10, 3, H);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterMin).toBe(60);
    // La place refusée n'est pas gardée : 3 places seulement.
    expect(redis.sets.get("assistant:test-slots:u1")).toHaveLength(3);
    // Les places de plus d'une heure sont purgées.
    expect((await store.reserve("u1", t0 + H + 5, 3, H)).allowed).toBe(true);
  });

  it("demandes simultanées : jamais plus que la limite", async () => {
    const store = redisTestSlotStore(fakeRedis());
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.reserve("u1", 9_000, 3, H)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });
});

describe("repli sur la mémoire", () => {
  it("Redis absent, en panne ou trop lent : la limite reste tenue (dans le processus)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const absent = fallbackTestSlotStore(() => {
      throw new Error("REDIS_URL manquante");
    }, memoryTestSlotStore());
    for (let i = 0; i < 2; i++) expect((await absent.reserve("u1", 1, 2, H)).allowed).toBe(true);
    expect((await absent.reserve("u1", 2, 2, H)).allowed).toBe(false);

    const broken = fallbackTestSlotStore(
      () => ({
        reserve: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
      memoryTestSlotStore(),
    );
    expect((await broken.reserve("u1", 1, 1, H)).allowed).toBe(true);
    expect((await broken.reserve("u1", 2, 1, H)).allowed).toBe(false);

    const slow = fallbackTestSlotStore(
      () => ({ reserve: () => new Promise(() => {}) }),
      memoryTestSlotStore(),
      10,
    );
    expect((await slow.reserve("u1", 1, 1, H)).allowed).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
