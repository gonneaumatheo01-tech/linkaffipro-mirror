/**
 * Fournisseur de captures du processus courant. Le worker (et le `capture-runner` du Mac) enregistre son navigateur
 * au démarrage ; le site n'en a pas : il passe par la file en base (`requests.ts`), traitée par le worker.
 */
import type { BrowserScreenshotProvider } from "./provider";

let local: BrowserScreenshotProvider | null = null;

export function registerScreenshotProvider(p: BrowserScreenshotProvider | null): void {
  local = p;
}

export function localScreenshotProvider(): BrowserScreenshotProvider | null {
  return local;
}
