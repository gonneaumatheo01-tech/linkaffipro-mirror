import { describe, expect, it } from "vitest";
import { RedisLockBusy, RedisLockUnavailable, withRedisLock, type LockRedis } from "./redis-lock";

/** Redis en mémoire : SET NX PX et les scripts de libération / prolongation (GET puis DEL / PEXPIRE si la valeur correspond). */
function fakeRedis(now = () => Date.now()) {
  const store = new Map<string, { value: string; until: number }>();
  const calls: string[] = [];
  const redis: LockRedis & { store: typeof store; calls: string[] } = {
    store,
    calls,
    async set(key, value, _px, ttlMs, _nx) {
      calls.push(`set ${key}`);
      const cur = store.get(key);
      if (cur && cur.until > now()) return null;
      store.set(key, { value, until: now() + ttlMs });
      return "OK";
    },
    async eval(script, _n, key, token, ttl) {
      const cur = store.get(key!);
      if (script.includes("pexpire")) {
        calls.push(`extend ${key}`);
        if (cur && cur.value === token && cur.until > now()) {
          cur.until = now() + Number(ttl);
          return 1;
        }
        return 0;
      }
      calls.push(`release ${key}`);
      if (cur && cur.value === token) {
        store.delete(key!);
        return 1;
      }
      return 0;
    },
  };
  return redis;
}

describe("verrou Redis générique", () => {
  it("prend le verrou de la clé demandée avec sa durée de vie, exécute, puis le libère", async () => {
    const t = 1000;
    const redis = fakeRedis(() => t);
    const r = await withRedisLock(
      redis,
      "chat:lock:c1",
      async () => {
        const held = redis.store.get("chat:lock:c1");
        expect(held?.value).toMatch(/^worker:chat:/);
        expect(held?.until).toBe(t + 90_000);
        return "ok";
      },
      { ttlMs: 90_000, owner: "worker:chat" },
    );
    expect(r).toBe("ok");
    expect(redis.store.has("chat:lock:c1")).toBe(false);
  });

  it("deux clés différentes ne se gênent pas ; la même clé est exclusive", async () => {
    const redis = fakeRedis();
    let inside = 0;
    let maxInside = 0;
    const task = (key: string) =>
      withRedisLock(
        redis,
        key,
        async () => {
          inside += 1;
          maxInside = Math.max(maxInside, inside);
          await new Promise((r) => setTimeout(r, 15));
          inside -= 1;
        },
        { ttlMs: 5_000, waitMs: 2_000, pollMs: 5 },
      );
    await Promise.all([task("chat:lock:a"), task("chat:lock:b")]);
    expect(maxInside).toBe(2);
    maxInside = 0;
    await Promise.all([task("chat:lock:a"), task("chat:lock:a"), task("chat:lock:a")]);
    expect(maxInside).toBe(1);
  });

  it("verrou pris : RedisLockBusy sans attendre (porte la clé), la fonction n'est pas appelée", async () => {
    const redis = fakeRedis();
    await redis.set("chat:lock:c2", "autre", "PX", 60_000, "NX");
    let called = false;
    const err = await withRedisLock(
      redis,
      "chat:lock:c2",
      async () => {
        called = true;
      },
      { ttlMs: 90_000 },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedisLockBusy);
    expect((err as RedisLockBusy).key).toBe("chat:lock:c2");
    expect(called).toBe(false);
    expect(redis.store.get("chat:lock:c2")?.value).toBe("autre");
  });

  it("Redis en erreur : RedisLockUnavailable avec la cause", async () => {
    const boom = new Error("connect ECONNREFUSED");
    const redis: LockRedis = { set: async () => Promise.reject(boom), eval: async () => 0 };
    const err = await withRedisLock(redis, "k", async () => 1, { ttlMs: 1000 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RedisLockUnavailable);
    expect((err as Error).cause).toBeInstanceOf(Error);
  });

  it("erreurs personnalisées (busyError, unavailableError)", async () => {
    class Occupe extends Error {}
    const redis = fakeRedis();
    await redis.set("k", "x", "PX", 60_000, "NX");
    await expect(
      withRedisLock(redis, "k", async () => 1, {
        ttlMs: 1000,
        busyError: () => new Occupe("pris"),
      }),
    ).rejects.toBeInstanceOf(Occupe);
  });

  it("les erreurs de la fonction remontent telles quelles et le verrou est libéré", async () => {
    const redis = fakeRedis();
    const own = new RedisLockBusy("autre:clé");
    await expect(
      withRedisLock(redis, "k", async () => Promise.reject(own), {
        ttlMs: 1000,
        busyError: () => new Error("ne doit pas remplacer l'erreur de la fonction"),
      }),
    ).rejects.toBe(own);
    expect(redis.store.has("k")).toBe(false);
  });

  it("travail plus long que la durée de vie : prolongé, jamais volé", async () => {
    const redis = fakeRedis();
    let contender: unknown = null;
    await withRedisLock(
      redis,
      "chat:lock:long",
      async () => {
        await new Promise((r) => setTimeout(r, 150));
        contender = await withRedisLock(redis, "chat:lock:long", async () => "volé", {
          ttlMs: 60,
        }).catch((e: unknown) => e);
      },
      { ttlMs: 60, renewMs: 15 },
    );
    expect(contender).toBeInstanceOf(RedisLockBusy);
    expect(redis.calls.filter((c) => c.startsWith("extend")).length).toBeGreaterThan(3);
    expect(redis.store.has("chat:lock:long")).toBe(false);
  });
});
