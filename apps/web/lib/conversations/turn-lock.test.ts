import { describe, expect, it, vi } from "vitest";
import type { LockRedis } from "@linkaffipro/queue";
import { turnLockKey, underTurnLock } from "./turn-lock";

/** Redis simulé : SET NX PX + libération par comparaison du jeton (seul le détenteur libère). */
function fakeRedis(
  held: Map<string, string> = new Map(),
): LockRedis & { held: Map<string, string> } {
  return {
    held,
    async set(key, value) {
      if (held.has(key)) return null;
      held.set(key, value);
      return "OK";
    },
    async eval(_script, _n, key, token) {
      if (key !== undefined && held.get(key) === token) held.delete(key);
      return 1;
    },
  };
}

describe("verrou du tour de l'assistante (rendre la main)", () => {
  it("même clé que le worker et la réception", () => {
    expect(turnLockKey("c1")).toBe("chat:lock:c1");
  });

  it("verrou libre : le travail se fait sous le verrou, puis il est libéré", async () => {
    const redis = fakeRedis();
    const seen: boolean[] = [];
    const r = await underTurnLock(
      "c1",
      async () => {
        seen.push(redis.held.has("chat:lock:c1"));
        return 42;
      },
      { redis: () => redis },
    );
    expect(r).toEqual({ busy: false, value: 42, locked: true });
    expect(seen).toEqual([true]);
    expect(redis.held.size).toBe(0);
  });

  it("tour en cours au-delà de l'attente : rien n'est fait (busy)", async () => {
    const redis = fakeRedis(new Map([["chat:lock:c1", "worker:chat:x"]]));
    const fn = vi.fn(async () => 1);
    const r = await underTurnLock("c1", fn, { redis: () => redis, waitMs: 30, pollMs: 10 });
    expect(r).toEqual({ busy: true });
    expect(fn).not.toHaveBeenCalled();
    // Le verrou du worker n'est jamais retiré par le site.
    expect(redis.held.get("chat:lock:c1")).toBe("worker:chat:x");
  });

  it("tour qui se termine pendant l'attente : le travail se fait après lui", async () => {
    const redis = fakeRedis(new Map([["chat:lock:c1", "worker:chat:x"]]));
    setTimeout(() => redis.held.delete("chat:lock:c1"), 20);
    const r = await underTurnLock("c1", async () => "ok", {
      redis: () => redis,
      waitMs: 1_000,
      pollMs: 5,
    });
    expect(r).toEqual({ busy: false, value: "ok", locked: true });
  });

  it("Redis injoignable : le travail se fait sans le verrou, une seule fois ; ses erreurs remontent", async () => {
    const fn = vi.fn(async () => "fait");
    const r = await underTurnLock("c1", fn, {
      redis: () => {
        throw new Error("Redis absent");
      },
    });
    expect(r).toEqual({ busy: false, value: "fait", locked: false });
    expect(fn).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => {
      throw new Error("base");
    });
    await expect(underTurnLock("c1", failing, { redis: () => fakeRedis() })).rejects.toThrow(
      "base",
    );
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
