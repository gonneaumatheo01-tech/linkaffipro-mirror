/**
 * Fournisseur de captures du worker (phase 23) : navigateur local, secrets en base, verrou Redis `capture:lock`
 * (un seul Chromium à la fois, worker et scripts confondus). Appelé une fois au démarrage.
 */
import { createBrowserScreenshotProvider, dbCaptureEnv, registerScreenshotProvider, type BrowserScreenshotProvider } from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { withRedisLock, type LockRedis } from "@linkaffipro/queue";
import { logger } from "../logger";
import { hasChromium, launchChromium } from "./browser";

export const CAPTURE_LOCK_KEY = "capture:lock";

export function createWorkerScreenshotProvider(redis: LockRedis): BrowserScreenshotProvider {
  return createBrowserScreenshotProvider({
    env: dbCaptureEnv(prisma),
    launch: launchChromium,
    lock: (fn) => withRedisLock(redis, CAPTURE_LOCK_KEY, fn, { ttlMs: 180_000, waitMs: 120_000, pollMs: 1_000, owner: "worker:capture", label: "verrou des captures" }),
    logger: { info: (o, m) => logger.info(o, m), warn: (o, m) => logger.warn(o, m), error: (o, m) => logger.error(o, m) },
    name: "chromium",
  });
}

/** Enregistre le navigateur du worker ; sans Chromium (développement), la capture passe par la file / le repli. */
export function installCaptureProvider(redis: LockRedis): BrowserScreenshotProvider | null {
  if (!hasChromium()) {
    logger.warn({}, "[capture] Chromium absent : captures indisponibles dans ce processus");
    return null;
  }
  const p = createWorkerScreenshotProvider(redis);
  registerScreenshotProvider(p);
  return p;
}
