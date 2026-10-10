import { describe, expect, it } from "vitest";
import {
  MTPROTO_LOCK_KEY,
  MtprotoLockBusy,
  MtprotoLockUnavailable,
  withMtprotoLock,
  type LockRedis,
} from "./mtproto-lock";

/** Redis en mémoire : SET NX PX et le script de libération (GET puis DEL si la valeur correspond). */
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

describe("verrou de la session Telegram (MTProto)", () => {
  it("prend le verrou (SET NX PX 60000), exécute, puis le libère", async () => {
    const redis = fakeRedis();
    const result = await withMtprotoLock(
      redis,
      async () => {
        expect(redis.store.get(MTPROTO_LOCK_KEY)?.value).toMatch(/^web:import:/);
        return 42;
      },
      { owner: "web:import" },
    );
    expect(result).toBe(42);
    expect(redis.store.has(MTPROTO_LOCK_KEY)).toBe(false);
  });

  it("libère aussi en cas d'erreur", async () => {
    const redis = fakeRedis();
    await expect(
      withMtprotoLock(redis, async () => Promise.reject(new Error("boum"))),
    ).rejects.toThrow("boum");
    expect(redis.store.has(MTPROTO_LOCK_KEY)).toBe(false);
  });

  it("verrou déjà pris : MtprotoLockBusy sans attendre, la fonction n'est pas appelée", async () => {
    const redis = fakeRedis();
    await redis.set(MTPROTO_LOCK_KEY, "worker:views:x", "PX", 60_000, "NX");
    let called = false;
    await expect(
      withMtprotoLock(redis, async () => {
        called = true;
      }),
    ).rejects.toBeInstanceOf(MtprotoLockBusy);
    expect(called).toBe(false);
    // Le verrou de l'autre n'est pas touché.
    expect(redis.store.get(MTPROTO_LOCK_KEY)?.value).toBe("worker:views:x");
  });

  it("attend la libération (waitMs) puis passe", async () => {
    const redis = fakeRedis();
    await redis.set(MTPROTO_LOCK_KEY, "autre", "PX", 60_000, "NX");
    setTimeout(() => redis.store.delete(MTPROTO_LOCK_KEY), 30);
    const r = await withMtprotoLock(redis, async () => "ok", { waitMs: 1000, pollMs: 10 });
    expect(r).toBe("ok");
  });

  it("deux appels simultanés ne tiennent jamais le verrou ensemble", async () => {
    const redis = fakeRedis();
    let inside = 0;
    let maxInside = 0;
    const task = () =>
      withMtprotoLock(
        redis,
        async () => {
          inside += 1;
          maxInside = Math.max(maxInside, inside);
          await new Promise((r) => setTimeout(r, 20));
          inside -= 1;
        },
        { waitMs: 2000, pollMs: 5 },
      );
    await Promise.all([task(), task(), task()]);
    expect(maxInside).toBe(1);
  });

  it("ne supprime jamais le verrou d'un autre (verrou expiré puis repris)", async () => {
    let t = 0;
    const redis = fakeRedis(() => t);
    await withMtprotoLock(redis, async () => {
      // Notre verrou expire, un autre processus le reprend pendant que nous travaillons encore.
      t = 70_000;
      redis.store.set(MTPROTO_LOCK_KEY, { value: "worker:views:autre", until: t + 60_000 });
    });
    expect(redis.store.get(MTPROTO_LOCK_KEY)?.value).toBe("worker:views:autre");
  });

  it("Redis muet : message simple pour l'utilisateur (pas de jargon) au lieu d'une attente sans fin", async () => {
    const redis: LockRedis = { set: () => new Promise(() => undefined), eval: async () => 0 };
    const err = await withMtprotoLock(redis, async () => 1, { commandTimeoutMs: 20 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MtprotoLockUnavailable);
    expect((err as Error).message).toBe(
      "Service momentanément indisponible, réessayez dans une minute.",
    );
    expect((err as Error).message).not.toMatch(/Redis|verrou|ms\)/);
  });

  it("Redis en erreur (connexion refusée) : même message simple", async () => {
    const redis: LockRedis = {
      set: async () => Promise.reject(new Error("connect ECONNREFUSED")),
      eval: async () => 0,
    };
    await expect(withMtprotoLock(redis, async () => 1)).rejects.toBeInstanceOf(
      MtprotoLockUnavailable,
    );
  });

  it("prise du verrou exécutée en retard (reconnexion Redis) : le verrou orphelin est rendu aussitôt", async () => {
    const redis = fakeRedis();
    // La commande SET reste en file pendant la reconnexion puis s'exécute après l'expiration du délai.
    const lateSet: LockRedis["set"] = (key, value, px, ttl, nx) =>
      new Promise((resolve) => {
        setTimeout(() => resolve(redis.set(key, value, px, ttl, nx)), 40);
      });
    const slow: LockRedis = { set: lateSet, eval: redis.eval };
    let called = false;
    await expect(
      withMtprotoLock(
        slow,
        async () => {
          called = true;
        },
        { commandTimeoutMs: 10 },
      ),
    ).rejects.toBeInstanceOf(MtprotoLockUnavailable);
    expect(called).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    // Personne ne détient ce verrou : il ne doit pas bloquer le worker (ou le site) pendant 60 s.
    expect(redis.store.has(MTPROTO_LOCK_KEY)).toBe(false);
  });

  it("travail plus long que la durée de vie : le verrou est prolongé, personne ne peut le prendre entre-temps", async () => {
    const redis = fakeRedis();
    let contender: unknown = null;
    await withMtprotoLock(
      redis,
      async () => {
        await new Promise((r) => setTimeout(r, 200));
        // 200 ms après la prise, la durée de vie (60 ms) est largement dépassée : sans prolongation, un autre la prendrait.
        contender = await withMtprotoLock(redis, async () => "volé", {
          owner: "worker:views",
        }).catch((e: unknown) => e);
      },
      { ttlMs: 60, renewMs: 15, owner: "web:import" },
    );
    expect(contender).toBeInstanceOf(MtprotoLockBusy);
    expect(redis.calls.filter((c) => c.startsWith("extend")).length).toBeGreaterThan(3);
    // Libéré à la fin, et plus prolongé ensuite.
    expect(redis.store.has(MTPROTO_LOCK_KEY)).toBe(false);
    const extends_ = redis.calls.filter((c) => c.startsWith("extend")).length;
    await new Promise((r) => setTimeout(r, 50));
    expect(redis.calls.filter((c) => c.startsWith("extend")).length).toBe(extends_);
  });
});
