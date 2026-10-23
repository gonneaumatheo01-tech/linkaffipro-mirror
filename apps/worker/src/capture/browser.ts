/**
 * Lancement de Chromium pour les captures (phase 23). Dans l'image du worker : Chromium d'Alpine
 * (`apk add chromium`, `/usr/bin/chromium-browser`) piloté par `playwright-core` ; ailleurs (Mac, tests) : Chromium
 * de Playwright s'il est installé. `CHROMIUM_PATH` force un exécutable.
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import type { BrowserLauncher } from "@linkaffipro/agents";

const SYSTEM_PATHS = ["/usr/bin/chromium-browser", "/usr/bin/chromium"];

export function chromiumExecutable(): string | undefined {
  const forced = process.env.CHROMIUM_PATH;
  if (forced && existsSync(forced)) return forced;
  for (const p of SYSTEM_PATHS) if (existsSync(p)) return p;
  return undefined; // Chromium de Playwright (cache utilisateur)
}

export function hasChromium(): boolean {
  if (chromiumExecutable()) return true;
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export const launchChromium: BrowserLauncher = ({ proxy }) =>
  chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
    // Conteneur sans bac à sable utilisateur ni /dev/shm confortable ; un seul onglet, mémoire contenue.
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--mute-audio", "--js-flags=--max-old-space-size=256"],
    ...(proxy ? { proxy } : {}),
  });
