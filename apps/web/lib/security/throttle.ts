/**
 * Limitation des tentatives de connexion : au plus `limit` échecs par clé (e-mail, IP) sur une fenêtre glissante.
 * Logique pure sur un « store » abstrait (Redis en production, Map en test).
 */
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_MAX_FAILURES = 10;

export interface ThrottleStore {
  /** Incrémente le compteur de la clé et renvoie sa nouvelle valeur ; pose le TTL à la création. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
  del(key: string): Promise<void>;
}

export function throttleKeys(email: string, ip: string | null): string[] {
  const keys = [`login:fail:email:${email.trim().toLowerCase()}`];
  if (ip) keys.push(`login:fail:ip:${ip.trim()}`);
  return keys;
}

/** Vrai si l'une des clés a atteint le seuil (la tentative doit être refusée avant même de vérifier le mot de passe). */
export async function isThrottled(store: ThrottleStore, keys: string[], limit = LOGIN_MAX_FAILURES): Promise<boolean> {
  for (const k of keys) {
    if ((await store.get(k)) >= limit) return true;
  }
  return false;
}

/** Enregistre un échec sur toutes les clés ; renvoie le compteur le plus élevé. */
export async function recordFailure(store: ThrottleStore, keys: string[], windowSeconds = LOGIN_WINDOW_SECONDS): Promise<number> {
  let max = 0;
  for (const k of keys) max = Math.max(max, await store.incr(k, windowSeconds));
  return max;
}

/** Remet les compteurs à zéro après une connexion réussie. */
export async function clearFailures(store: ThrottleStore, keys: string[]): Promise<void> {
  for (const k of keys) await store.del(k);
}

/** Store en mémoire (tests, et repli si Redis est indisponible). */
export function memoryStore(now: () => number = Date.now): ThrottleStore {
  const data = new Map<string, { n: number; expiresAt: number }>();
  const live = (k: string) => {
    const e = data.get(k);
    if (!e || e.expiresAt <= now()) {
      data.delete(k);
      return undefined;
    }
    return e;
  };
  return {
    async incr(key, ttl) {
      const e = live(key);
      if (!e) {
        data.set(key, { n: 1, expiresAt: now() + ttl * 1000 });
        return 1;
      }
      e.n += 1;
      return e.n;
    },
    async get(key) {
      return live(key)?.n ?? 0;
    },
    async del(key) {
      data.delete(key);
    },
  };
}

/** Store Redis (ioredis) : INCR + EXPIRE à la première occurrence. */
export function redisStore(redis: { incr(k: string): Promise<number>; expire(k: string, s: number): Promise<unknown>; get(k: string): Promise<string | null>; del(k: string): Promise<unknown> }): ThrottleStore {
  return {
    async incr(key, ttl) {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, ttl);
      return n;
    },
    async get(key) {
      return Number((await redis.get(key)) ?? 0);
    },
    async del(key) {
      await redis.del(key);
    },
  };
}
