/**
 * Limite de débit de l'API d'intégration Link Affi : 60 requêtes par minute et par clé (fenêtre glissante d'une
 * minute). Au-delà : 429 avec `Retry-After` (secondes jusqu'à ce qu'une place se libère). Les appels sans clé valide
 * sont limités de la même façon par adresse IP (un robot qui essaie des clés est vite arrêté).
 *
 * Magasin Redis en production (partagé entre les instances du site), mémoire du processus si Redis est indisponible
 * (et dans les tests). Logique sur un magasin abstrait : testée sans Redis.
 */
import { randomUUID } from "node:crypto";
import { getRedis } from "@linkaffipro/queue";

export const LINKAFFI_RATE_LIMIT = 60;
export const LINKAFFI_RATE_WINDOW_MS = 60_000;

export type RateDecision =
  | { allowed: true; remaining: number }
  | {
      allowed: false;
      /** Secondes à attendre avant le prochain appel accepté (au moins 1). */
      retryAfterSec: number;
      /** Premier refus de cette série (seul celui-ci est journalisé : pas de journal inondé). */
      firstRefusal: boolean;
    };

export interface RateLimitStore {
  hit(id: string, now: number, limit: number, windowMs: number): Promise<RateDecision>;
}

function retryAfter(oldest: number, now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}

/** Magasin en mémoire (tests, et repli si Redis est indisponible). Fenêtre glissante exacte. */
export function memoryRateStore(): RateLimitStore {
  const hits = new Map<string, number[]>();
  const refusedUntil = new Map<string, number>();
  return {
    async hit(id, now, limit, windowMs) {
      const live = (hits.get(id) ?? []).filter((t) => t > now - windowMs);
      if (live.length >= limit) {
        hits.set(id, live);
        const wait = retryAfter(live[0]!, now, windowMs);
        const first = (refusedUntil.get(id) ?? 0) <= now;
        if (first) refusedUntil.set(id, now + wait * 1000);
        return { allowed: false, retryAfterSec: wait, firstRefusal: first };
      }
      live.push(now);
      hits.set(id, live);
      return { allowed: true, remaining: limit - live.length };
    },
  };
}

/** Commandes Redis utilisées (sous-ensemble d'ioredis, simulable dans les tests). */
export type RateRedis = {
  zremrangebyscore(key: string, min: number, max: number): Promise<unknown>;
  zcard(key: string): Promise<number>;
  zrange(key: string, start: number, stop: number, withScores: "WITHSCORES"): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  pexpire(key: string, ms: number): Promise<unknown>;
  set(key: string, value: string, px: "PX", ms: number, nx: "NX"): Promise<string | null>;
};

const PREFIX = "integration:linkaffi:rate:";

/**
 * Magasin Redis : un ensemble trié par identifiant (horodatage de chaque appel accepté), purgé de ce qui a plus d'une
 * minute. Quelques allers-retours sans transaction : deux appels simultanés peuvent passer à 61 au pire, sans gravité.
 */
export function redisRateStore(redis: RateRedis): RateLimitStore {
  return {
    async hit(id, now, limit, windowMs) {
      const key = `${PREFIX}${id}`;
      await redis.zremrangebyscore(key, 0, now - windowMs);
      const count = await redis.zcard(key);
      if (count >= limit) {
        const oldest = Number((await redis.zrange(key, 0, 0, "WITHSCORES"))[1] ?? now);
        const wait = retryAfter(oldest, now, windowMs);
        const first = (await redis.set(`${key}:refused`, "1", "PX", wait * 1000, "NX")) === "OK";
        return { allowed: false, retryAfterSec: wait, firstRefusal: first };
      }
      await redis.zadd(key, now, `${now}:${randomUUID()}`);
      await redis.pexpire(key, windowMs);
      return { allowed: true, remaining: limit - count - 1 };
    },
  };
}

/**
 * Magasin qui essaie Redis puis se replie sur la mémoire (Redis lent ou en panne : l'API reste disponible, la limite
 * devient par instance). Délai maximal par appel Redis : `timeoutMs`.
 */
export function fallbackRateStore(
  primary: () => RateLimitStore | null,
  fallback: RateLimitStore,
  timeoutMs = 500,
): RateLimitStore {
  let warned = false;
  return {
    async hit(id, now, limit, windowMs) {
      let store: RateLimitStore | null = null;
      try {
        store = primary();
      } catch {
        store = null;
      }
      if (store) {
        let timer: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            store.hit(id, now, limit, windowMs),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Redis trop lent")), timeoutMs);
            }),
          ]);
        } catch (err) {
          if (!warned) {
            warned = true;
            console.warn(
              "[integration linkaffi] limite de débit en mémoire (Redis indisponible) :",
              err instanceof Error ? err.message : String(err),
            );
          }
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      return fallback.hit(id, now, limit, windowMs);
    },
  };
}

let shared: RateLimitStore | null = null;

/** Magasin du site : Redis partagé de BullMQ s'il est prêt, sinon mémoire du processus. */
export function linkaffiRateStore(): RateLimitStore {
  shared ??= fallbackRateStore(() => {
    // Les tests d'intégration remplacent `@linkaffipro/queue` : getRedis y lève une erreur (repli sur la mémoire).
    const redis = getRedis();
    if (redis.status !== "ready") return null;
    return redisRateStore(redis as unknown as RateRedis);
  }, memoryRateStore());
  return shared;
}
