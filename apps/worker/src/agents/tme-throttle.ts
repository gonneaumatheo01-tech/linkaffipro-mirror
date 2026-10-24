/**
 * Phase 27 — heure de la dernière requête vers t.me (aperçu web des canaux de référence) dans Redis : une requête
 * toutes les 3 secondes, d'une lecture à l'autre et entre les tâches. Redis en panne : l'erreur est ignorée par la
 * lecture (seul le rythme entre les pages d'une lecture reste tenu).
 */
import type { TmeThrottle } from "@linkaffipro/agents";
import { getRedis } from "@linkaffipro/queue";

export const TME_LAST_REQUEST_KEY = "inspiration:tme:last";

export function createRedisTmeThrottle(redis: () => { get(k: string): Promise<string | null>; set(k: string, v: string, mode: "PX", ms: number): Promise<unknown> } = getRedis): TmeThrottle {
  return {
    async lastRequestAt() {
      const v = Number(await redis().get(TME_LAST_REQUEST_KEY));
      return Number.isFinite(v) && v > 0 ? v : null;
    },
    async markRequest(at) {
      await redis().set(TME_LAST_REQUEST_KEY, String(at), "PX", 60_000);
    },
  };
}
