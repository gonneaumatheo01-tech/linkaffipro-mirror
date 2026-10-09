import { headers } from "next/headers";
import { audit } from "@linkaffipro/db";
import { clearFailures, isThrottled, memoryStore, recordFailure, redisStore, throttleKeys, type ThrottleStore } from "./throttle";

let fallback: ThrottleStore | null = null;

/** Store Redis si disponible, sinon mémoire du process (et journalisation une fois). */
async function getStore(): Promise<ThrottleStore> {
  try {
    const { getRedis } = await import("@linkaffipro/queue");
    const redis = getRedis();
    if (redis.status === "ready" || redis.status === "connect" || redis.status === "connecting") return redisStore(redis);
  } catch (err) {
    console.warn("[auth] Redis indisponible pour la limitation des connexions :", (err as Error).message);
  }
  fallback ??= memoryStore();
  return fallback;
}

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    return fwd?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

export async function loginThrottleKeys(email: string): Promise<string[]> {
  return throttleKeys(email, await clientIp());
}

export async function loginIsThrottled(keys: string[], userId?: string | null): Promise<boolean> {
  const store = await getStore();
  const blocked = await isThrottled(store, keys);
  if (blocked) await audit({ userId: userId ?? null, action: "auth.login_throttled", entityType: "User", entityId: userId ?? undefined });
  return blocked;
}

export async function loginRecordFailure(keys: string[]): Promise<void> {
  await recordFailure(await getStore(), keys);
}

export async function loginClearFailures(keys: string[]): Promise<void> {
  await clearFailures(await getStore(), keys);
}
