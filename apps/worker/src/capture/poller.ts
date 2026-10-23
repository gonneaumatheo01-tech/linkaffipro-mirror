/**
 * Demandes de capture « serveur » en base (phase 23) : tests de connexion lancés par le site ou par le bot, captures
 * mises en file. Toutes les 15 s, le worker en prend une, la fait avec son navigateur et range le résultat ; un test
 * lancé par le bot est suivi d'un message à l'admin (résultat, et la parade si le site bloque le serveur).
 */
import {
  claimNextCaptureRequest,
  completeCaptureRequest,
  connectionMessage,
  purgeCaptureRequests,
  toCaptureRequest,
  type BrowserScreenshotProvider,
  type CaptureResult,
  type StoredCaptureRequest,
} from "@linkaffipro/agents";
import { prisma } from "@linkaffipro/db";
import { createAdminMessenger } from "@linkaffipro/telegram";
import { logger } from "../logger";

export const CAPTURE_POLL_INTERVAL_MS = 15_000;

/** Traite une demande prise (exporté pour les tests). */
export async function handleCaptureRequest(
  provider: BrowserScreenshotProvider,
  s: StoredCaptureRequest,
  notify: (html: string, assetId: string | null) => Promise<void>,
): Promise<StoredCaptureRequest | null> {
  let result: CaptureResult;
  if (s.kind === "test") result = await provider.testConnection(s.bookmaker);
  else {
    const req = toCaptureRequest(s);
    result = req ? await provider.capture(req) : { ok: false, kind: "unknown", message: "demande de capture vide" };
  }
  const done = await completeCaptureRequest(prisma, s.id, result);
  if (s.notifyAdmin) {
    const assetId = done?.result?.ok ? done.result.assetId : null;
    await notify(connectionMessage(s.bookmaker, result), assetId).catch((err) => logger.warn({ err: (err as Error).message }, "[capture] message admin non envoyé"));
  }
  return done;
}

export function startCapturePoller(provider: BrowserScreenshotProvider): { stop(): void } {
  const admin = createAdminMessenger();
  let busy = false;
  let lastPurge = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const s = await claimNextCaptureRequest(prisma, "server", "worker");
      if (s) await handleCaptureRequest(provider, s, async (html, assetId) => void (await admin.send(html, { mediaAssetId: assetId })));
      if (Date.now() - lastPurge > 6 * 3600_000) {
        lastPurge = Date.now();
        await purgeCaptureRequests(prisma);
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[capture] demande non traitée");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), CAPTURE_POLL_INTERVAL_MS);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
