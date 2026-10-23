/**
 * Cache des cotes dans Redis (phase 23) : clés `odds:*`, durée de vie posée à l'écriture (matchs 30 min, cotes 5 min).
 * Une panne de Redis n'empêche jamais la lecture des cotes (le cache des agents l'ignore).
 */
import type { OddsCache } from "@linkaffipro/agents";
import { getRedis } from "@linkaffipro/queue";

export function createRedisOddsCache(): OddsCache {
  return {
    async get(key) {
      return getRedis().get(key);
    },
    async set(key, value, ttlSeconds) {
      await getRedis().set(key, value, "EX", Math.max(1, Math.round(ttlSeconds)));
    },
  };
}
