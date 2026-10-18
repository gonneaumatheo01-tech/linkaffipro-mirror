import { describe, expect, it, vi } from "vitest";
import type { LockRedis } from "@linkaffipro/queue";
import { conversationLockKey, createConversationLock } from "./conversation-lock";

// Verrou de la conversation pris par le webhook pour /reset : le même que celui du worker pendant un tour. Redis simulé.

function fakeRedis(held: Map<string, string> = new Map()) {
  const sets: string[] = [];
  const redis: LockRedis = {
    async set(key, value) {
      sets.push(key);
      if (held.has(key)) return null;
      held.set(key, value);
      return "OK";
    },
    async eval(_script, _n, key, token) {
      if (held.get(key!) === token) held.delete(key!);
      return 1;
    },
  };
  return { redis, held, sets };
}

describe("verrou de la conversation (webhook)", () => {
  it("même clé que le worker", () => {
    expect(conversationLockKey("conv_1")).toBe("chat:lock:conv_1");
  });

  it("verrou libre : le travail se fait sous le verrou, puis il est rendu", async () => {
    const { redis, held, sets } = fakeRedis();
    const lock = createConversationLock({ redis: () => redis, waitMs: 50, pollMs: 5 });
    let heldDuring = false;
    const r = await lock("conv_1", async (locked) => {
      heldDuring = held.has("chat:lock:conv_1");
      return locked ? "sous verrou" : "sans";
    });
    expect(r).toEqual({ value: "sous verrou", locked: true });
    expect(heldDuring).toBe(true);
    expect(sets).toEqual(["chat:lock:conv_1"]);
    expect(held.size).toBe(0);
  });

  it("tour en cours qui se termine pendant l'attente : le travail passe après lui", async () => {
    const { redis, held } = fakeRedis(new Map([["chat:lock:conv_1", "worker:chat:x"]]));
    setTimeout(() => held.delete("chat:lock:conv_1"), 20);
    const lock = createConversationLock({ redis: () => redis, waitMs: 1_000, pollMs: 5 });
    const r = await lock("conv_1", async () => "fait");
    expect(r).toEqual({ value: "fait", locked: true });
  });

  it("tour trop long : le travail se fait quand même (une fois), sans le verrou, et c'est signalé", async () => {
    const { redis, held } = fakeRedis(new Map([["chat:lock:conv_1", "worker:chat:x"]]));
    const onFallback = vi.fn();
    const fn = vi.fn(async (locked: boolean) => locked);
    const lock = createConversationLock({ redis: () => redis, waitMs: 20, pollMs: 5, onFallback });
    const r = await lock("conv_1", fn);
    expect(r).toEqual({ value: false, locked: false });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith({ conversationId: "conv_1", reason: "busy" });
    // Le verrou du worker n'est jamais touché.
    expect(held.get("chat:lock:conv_1")).toBe("worker:chat:x");
  });

  it("Redis injoignable : le travail se fait sans le verrou", async () => {
    const onFallback = vi.fn();
    const lock = createConversationLock({
      redis: () => {
        throw new Error("Redis indisponible");
      },
      onFallback,
    });
    expect(await lock("conv_1", async (locked) => locked)).toEqual({ value: false, locked: false });
    expect(onFallback).toHaveBeenCalledWith({ conversationId: "conv_1", reason: "unavailable" });
  });

  it("erreur du travail : remontée telle quelle, jamais refait", async () => {
    const { redis, held } = fakeRedis();
    const fn = vi.fn(async () => {
      throw new Error("base indisponible");
    });
    const lock = createConversationLock({ redis: () => redis });
    await expect(lock("conv_1", fn)).rejects.toThrow("base indisponible");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(held.size).toBe(0);
  });
});
