import { describe, expect, it } from "vitest";
import { createFakeTimers } from "./fake";
import { openingDelayMs, pauseBetweenMs, typingDelayMs, withTyping } from "./rhythm";

const neutre = {
  peerDelayMs: 30_000,
  isFirst: false,
  hot: false,
  cold: false,
  refused: false,
  live: false,
};

describe("rythme", () => {
  it("typingDelayMs : 400 + 110 × longueur, plafonné à 12 s, plus rapide si chaud", () => {
    expect(typingDelayMs("")).toBe(400);
    expect(typingDelayMs("a".repeat(40))).toBe(4800);
    expect(typingDelayMs("a".repeat(500))).toBe(12000);
    expect(typingDelayMs("a".repeat(40), true)).toBe(3360);
  });

  it("openingDelayMs : suit le rythme de la personne, jamais sous 22 s", () => {
    expect(openingDelayMs(neutre, () => 0.5)).toBe(25500);
    expect(openingDelayMs(neutre, () => 0)).toBe(22000);
    expect(openingDelayMs({ ...neutre, peerDelayMs: 300_000 }, () => 0.5)).toBe(120000);
    expect(openingDelayMs({ ...neutre, peerDelayMs: 3_600_000 }, () => 0.5)).toBe(165000);
  });

  it("openingDelayMs : chaud va plus vite, refus passe à 1-3 h, premier message est curieux", () => {
    expect(openingDelayMs({ ...neutre, hot: true }, () => 0.5)).toBe(12750);
    expect(openingDelayMs({ ...neutre, hot: true }, () => 0)).toBe(9563);
    expect(openingDelayMs({ ...neutre, refused: true }, () => 0.5)).toBe(7200000);
    expect(openingDelayMs({ ...neutre, isFirst: true }, () => 0.5)).toBe(20000);
  });

  it("en direct : elle repond aussitot et colle ses messages", () => {
    expect(openingDelayMs({ ...neutre, live: true }, () => 0.5)).toBe(4000);
    expect(openingDelayMs({ ...neutre, live: true }, () => 0)).toBe(2000);
    expect(pauseBetweenMs(() => 0.5, true)).toBe(1000);
  });

  it("pauseBetweenMs : 0,8 à 2,5 s selon l'aléa", () => {
    expect(pauseBetweenMs(() => 0)).toBe(800);
    expect(pauseBetweenMs(() => 0.5)).toBe(1650);
    expect(pauseBetweenMs(() => 7)).toBe(2500);
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
