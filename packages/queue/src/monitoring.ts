/**
 * Surveillance partagée entre le worker (qui écrit) et le site (qui lit) : battement de cœur du worker
 * et compteur des tâches échouées par file, tous deux dans Redis.
 */
import type { Redis } from "ioredis";
import type { QueueName } from "./jobs";

/** Clé Redis du battement de cœur courant (expire si le worker s'arrête). */
export const HEARTBEAT_KEY = "worker:heartbeat";
/** Dernier battement connu, sans expiration : permet de mesurer la durée d'une absence après un redémarrage. */
export const HEARTBEAT_LAST_KEY = "worker:heartbeat:last";
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TTL_SEC = 180;
/** Au-delà de ce délai sans battement, le worker est considéré arrêté. */
export const WORKER_DOWN_AFTER_MS = 3 * 60_000;

export type Heartbeat = { at: string; version: string; startedAt: string; pid: number; commit?: string };

/** Écrit le battement (clé à durée de vie limitée) et sa copie persistante. */
export async function writeHeartbeat(redis: Redis, hb: Heartbeat): Promise<void> {
  const json = JSON.stringify(hb);
  await redis.multi().set(HEARTBEAT_KEY, json, "EX", HEARTBEAT_TTL_SEC).set(HEARTBEAT_LAST_KEY, json).exec();
}

export function parseHeartbeat(raw: string | null | undefined): Heartbeat | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Heartbeat>;
    if (typeof v.at !== "string" || Number.isNaN(Date.parse(v.at))) return null;
    return { at: v.at, version: String(v.version ?? "?"), startedAt: String(v.startedAt ?? v.at), pid: Number(v.pid ?? 0), ...(v.commit ? { commit: String(v.commit) } : {}) };
  } catch {
    return null;
  }
}

/**
 * Lit le battement : la clé vivante d'abord, sinon la copie persistante (le worker est alors absent
 * depuis plus de 3 minutes). `null` si le worker n'a jamais démarré.
 */
export async function readHeartbeat(redis: Redis): Promise<{ heartbeat: Heartbeat | null; alive: boolean }> {
  const [live, last] = await redis.mget(HEARTBEAT_KEY, HEARTBEAT_LAST_KEY);
  const hb = parseHeartbeat(live) ?? parseHeartbeat(last);
  return { heartbeat: hb, alive: parseHeartbeat(live) !== null };
}

/** Âge du battement en secondes (jamais négatif), ou null sans battement. */
export function heartbeatAgeSec(hb: Heartbeat | null, now = new Date()): number | null {
  if (!hb) return null;
  return Math.max(0, Math.round((now.getTime() - Date.parse(hb.at)) / 1000));
}

/** Le worker est-il considéré arrêté ? (battement absent ou plus vieux que 3 minutes) */
export function isWorkerDown(hb: Heartbeat | null, now = new Date()): boolean {
  const age = heartbeatAgeSec(hb, now);
  return age === null || age * 1000 > WORKER_DOWN_AFTER_MS;
}

/** Fenêtre d'observation des échecs répétés. */
export const FAILURE_WINDOW_MS = 15 * 60_000;

export function failuresKey(queue: QueueName): string {
  return `worker:failures:${queue}`;
}

/** Note un échec de tâche (ensemble trié par horodatage, nettoyé au-delà de la fenêtre). */
export async function recordJobFailure(redis: Redis, queue: QueueName, jobId: string | undefined, now = new Date()): Promise<void> {
  const key = failuresKey(queue);
  const t = now.getTime();
  await redis
    .multi()
    .zadd(key, t, `${jobId ?? "?"}:${t}`)
    .zremrangebyscore(key, 0, t - FAILURE_WINDOW_MS)
    .expire(key, Math.ceil((FAILURE_WINDOW_MS * 2) / 1000))
    .exec();
}

/** Nombre d'échecs dans la fenêtre glissante, par file. */
export async function countRecentFailures(redis: Redis, queues: readonly QueueName[], now = new Date(), windowMs = FAILURE_WINDOW_MS): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const since = now.getTime() - windowMs;
  for (const q of queues) out[q] = await redis.zcount(failuresKey(q), since, "+inf");
  return out;
}
