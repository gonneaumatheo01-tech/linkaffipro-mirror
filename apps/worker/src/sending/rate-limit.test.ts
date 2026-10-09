import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

function fakeRedis() {
  const store = new Map<string, { n: number; exp: number }>();
  let clock = 0;
  const redis = {
    async incr(k: string) {
      const e = store.get(k);
      if (!e || e.exp <= clock) {
        store.set(k, { n: 1, exp: Number.POSITIVE_INFINITY });
        return 1;
      }
      e.n++;
      return e.n;
    },
    async pexpire(k: string, ms: number) {
      const e = store.get(k);
      if (e) e.exp = clock + ms;
      return 1;
    },
    async pttl(k: string) {
      const e = store.get(k);
      return e ? e.exp - clock : -2;
    },
  };
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    clock += ms;
  };
  return { redis, sleep, sleeps };
}

describe("limiteur de débit", () => {
  it("laisse passer max opérations puis attend la fin de la fenêtre", async () => {
    const { redis, sleep, sleeps } = fakeRedis();
    const rl = new RateLimiter(redis as never, sleep);
    for (let i = 0; i < 3; i++) await rl.acquire("k", 3, 1000);
    expect(sleeps).toEqual([]);
    await rl.acquire("k", 3, 1000);
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(1000);
  });
});
