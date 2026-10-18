/**
 * Limite du bouton « Tester » (phase 17) : 30 messages d'essai par heure et par personne, en fenêtre glissante.
 *
 * La place est RÉSERVÉE avant l'appel à l'IA, de façon atomique : des demandes envoyées en même temps (deux onglets,
 * un script) ne peuvent pas passer toutes à la fois, même si chaque essai dure plusieurs secondes. Le journal
 * (`persona.tested`, écrit après l'essai) reste le compte durable, relu en plus par la route.
 *
 * Magasin Redis en production (un ensemble trié par personne : ajout, purge et compte dans une seule transaction
 * MULTI, puis retrait de la place si la limite est dépassée), mémoire du processus si Redis est indisponible (et dans
 * les tests). Logique sur un magasin abstrait : testée sans Redis.
 */
import { randomUUID } from "node:crypto";
import { getRedis } from "@linkaffipro/queue";

export const TEST_SLOT_WINDOW_MS = 3_600_000;

export type TestSlotDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** Minutes à attendre avant qu'une place se libère (au moins 1). */
      retryAfterMin: number;
    };

export interface TestSlotStore {
  /** Réserve une place pour cette personne (comptée tout de suite, même si l'essai échoue ensuite). */
  reserve(userId: string, now: number, limit: number, windowMs: number): Promise<TestSlotDecision>;
}

function retryAfterMin(oldest: number, now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 60_000));
}

/** Magasin en mémoire : vérification et ajout sans attente entre les deux (atomique dans le processus). */
export function memoryTestSlotStore(): TestSlotStore {
  const slots = new Map<string, number[]>();
  return {
    async reserve(userId, now, limit, windowMs) {
      const live = (slots.get(userId) ?? []).filter((t) => t > now - windowMs);
      if (live.length >= limit) {
        slots.set(userId, live);
        return { allowed: false, retryAfterMin: retryAfterMin(live[0]!, now, windowMs) };
      }
      live.push(now);
      slots.set(userId, live);
      return { allowed: true };
    },
  };
}

/** Commandes Redis utilisées (sous-ensemble d'ioredis, simulable dans les tests). */
export type TestSlotRedis = {
  multi(): {
    zremrangebyscore(key: string, min: number, max: number): unknown;
    zadd(key: string, score: number, member: string): unknown;
    zcard(key: string): unknown;
    pexpire(key: string, ms: number): unknown;
    exec(): Promise<Array<[Error | null, unknown]> | null>;
  };
  zrem(key: string, member: string): Promise<unknown>;
  zrange(key: string, start: number, stop: number, withScores: "WITHSCORES"): Promise<string[]>;
};

const PREFIX = "assistant:test-slots:";

/**
 * Magasin Redis : la place est ajoutée PUIS comptée dans la même transaction (MULTI) ; au-delà de la limite, elle est
 * retirée et l'essai refusé. Deux demandes simultanées ne peuvent donc jamais dépasser la limite à elles deux (au pire,
 * l'une est refusée un instant de trop).
 */
export function redisTestSlotStore(redis: TestSlotRedis): TestSlotStore {
  return {
    async reserve(userId, now, limit, windowMs) {
      const key = `${PREFIX}${userId}`;
      const member = `${now}:${randomUUID()}`;
      const tx = redis.multi();
      tx.zremrangebyscore(key, 0, now - windowMs);
      tx.zadd(key, now, member);
      tx.zcard(key);
      tx.pexpire(key, windowMs);
      const results = await tx.exec();
      if (!results) throw new Error("transaction Redis annulée");
      const failed = results.find(([err]) => err);
      if (failed) throw failed[0]!;
      const count = Number(results[2]?.[1] ?? 0);
      if (count <= limit) return { allowed: true };
      await redis.zrem(key, member);
      const oldest = Number((await redis.zrange(key, 0, 0, "WITHSCORES"))[1] ?? now);
      return { allowed: false, retryAfterMin: retryAfterMin(oldest, now, windowMs) };
    },
  };
}

/**
 * Magasin qui essaie Redis puis se replie sur la mémoire (Redis lent ou en panne : le bouton reste utilisable, la
 * limite devient par instance du site). Délai maximal par appel Redis : `timeoutMs`.
 */
export function fallbackTestSlotStore(
  primary: () => TestSlotStore | null,
  fallback: TestSlotStore,
  timeoutMs = 500,
): TestSlotStore {
  let warned = false;
  return {
    async reserve(userId, now, limit, windowMs) {
      let store: TestSlotStore | null = null;
      try {
        store = primary();
      } catch {
        store = null;
      }
      if (store) {
        let timer: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            store.reserve(userId, now, limit, windowMs),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Redis trop lent")), timeoutMs);
            }),
          ]);
        } catch (err) {
          if (!warned) {
            warned = true;
            console.warn(
              "[assistant] limite des essais en mémoire (Redis indisponible) :",
              err instanceof Error ? err.message : String(err),
            );
          }
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      return fallback.reserve(userId, now, limit, windowMs);
    },
  };
}

let shared: TestSlotStore | null = null;

/** Magasin du site : Redis partagé de BullMQ s'il est prêt, sinon mémoire du processus. */
function defaultTestSlotStore(): TestSlotStore {
  shared ??= fallbackTestSlotStore(() => {
    // Tests d'intégration : `@linkaffipro/queue` est remplacé, getRedis y lève une erreur (repli sur la mémoire).
    const redis = getRedis();
    if (redis.status !== "ready") return null;
    return redisTestSlotStore(redis as unknown as TestSlotRedis);
  }, memoryTestSlotStore());
  return shared;
}

let override: TestSlotStore | null = null;

/** Magasin utilisé par la route « Tester ». */
export function testSlotStore(): TestSlotStore {
  return override ?? defaultTestSlotStore();
}

/** Tests : remplace le magasin ; `null` remet celui du site. */
export function setTestSlotStore(next: TestSlotStore | null): void {
  override = next;
}
