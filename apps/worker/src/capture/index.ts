/** Captures du worker (phase 23) : navigateur enregistré + traitement des demandes en base. Un appel au démarrage. */
import type { LockRedis } from "@linkaffipro/queue";
import { installCaptureProvider } from "./install";
import { startCapturePoller } from "./poller";

export function startCapture(redis: LockRedis): { stop(): void } {
  const provider = installCaptureProvider(redis);
  return provider ? startCapturePoller(provider) : { stop: () => undefined };
}
