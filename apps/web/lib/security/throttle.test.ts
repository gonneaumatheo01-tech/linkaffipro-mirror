import { describe, expect, it } from "vitest";
import { clearFailures, isThrottled, memoryStore, recordFailure, throttleKeys } from "./throttle";

describe("limitation des tentatives de connexion", () => {
  it("construit les clés par e-mail et par IP", () => {
    expect(throttleKeys(" A@B.com ", "1.2.3.4")).toEqual(["login:fail:email:a@b.com", "login:fail:ip:1.2.3.4"]);
    expect(throttleKeys("a@b.com", null)).toHaveLength(1);
  });
  it("bloque après le seuil et libère après la fenêtre", async () => {
    let t = 1_000_000;
    const store = memoryStore(() => t);
    const keys = throttleKeys("a@b.com", "9.9.9.9");
    for (let i = 0; i < 9; i++) await recordFailure(store, keys, 900);
    expect(await isThrottled(store, keys, 10)).toBe(false);
    await recordFailure(store, keys, 900);
    expect(await isThrottled(store, keys, 10)).toBe(true);
    t += 901 * 1000;
    expect(await isThrottled(store, keys, 10)).toBe(false);
  });
  it("bloque par IP même avec des e-mails différents", async () => {
    const store = memoryStore();
    for (let i = 0; i < 10; i++) await recordFailure(store, throttleKeys(`u${i}@x.fr`, "5.5.5.5"), 900);
    expect(await isThrottled(store, throttleKeys("autre@x.fr", "5.5.5.5"))).toBe(true);
    expect(await isThrottled(store, throttleKeys("autre@x.fr", "6.6.6.6"))).toBe(false);
  });
  it("remet à zéro après succès", async () => {
    const store = memoryStore();
    const keys = throttleKeys("a@b.com", "1.1.1.1");
    for (let i = 0; i < 10; i++) await recordFailure(store, keys, 900);
    await clearFailures(store, keys);
    expect(await isThrottled(store, keys)).toBe(false);
  });
});
