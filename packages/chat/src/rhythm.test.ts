import { describe, expect, it } from "vitest";
import { createFakeTimers } from "./fake";
import { pauseBetweenMs, typingDelayMs, withTyping } from "./rhythm";

describe("rythme", () => {
  it("typingDelayMs : 1000 + 25 × longueur, entre 1 et 4 s", () => {
    expect(typingDelayMs("")).toBe(1000);
    expect(typingDelayMs("a".repeat(40))).toBe(2000);
    expect(typingDelayMs("a".repeat(500))).toBe(4000);
    expect(typingDelayMs("😊😊")).toBe(1050);
  });

  it("pauseBetweenMs : 1 à 2 s selon l'aléa", () => {
    expect(pauseBetweenMs(() => 0)).toBe(1000);
    expect(pauseBetweenMs(() => 0.5)).toBe(1500);
    expect(pauseBetweenMs(() => 0.9999)).toBe(2000);
    expect(pauseBetweenMs(() => 7)).toBe(2000);
  });

  it("withTyping : « écrit… » tout de suite, relancé toutes les 4 s, minuterie toujours arrêtée", async () => {
    const timers = createFakeTimers();
    let typing = 0;
    let tick: (() => void) | null = null;
    const spy = {
      ...timers,
      setInterval: (fn: () => void, ms: number) => {
        expect(ms).toBe(4000);
        tick = fn;
        return timers.setInterval(fn, ms);
      },
    };
    const result = await withTyping(
      async () => {
        typing++;
      },
      async () => {
        tick?.();
        tick?.();
        return 42;
      },
      spy,
    );
    expect(result).toBe(42);
    expect(typing).toBe(3);
    expect(timers.active()).toBe(0);

    await expect(
      withTyping(
        async () => {
          throw new Error("Telegram en panne");
        },
        async () => {
          throw new Error("échec");
        },
        timers,
      ),
    ).rejects.toThrow("échec");
    expect(timers.active()).toBe(0);
  });

  it("withTyping avec les vraies minuteries : aucune minuterie laissée derrière", async () => {
    let typing = 0;
    await withTyping(
      async () => {
        typing++;
      },
      async () => "ok",
    );
    expect(typing).toBe(1);
  });
});
