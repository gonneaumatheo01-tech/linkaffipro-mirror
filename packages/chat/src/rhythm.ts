// Rythme naturel sans attente pénible (contrat §3.6) : « écrit… » avant chaque message et pendant l'appel au modèle,
// délai proportionnel à la longueur (1 à 4 s), 1 à 2 s entre deux messages.
import type { TypingTimers } from "./turn-types";

export const TYPING_MIN_MS = 1000;
export const TYPING_MAX_MS = 4000;
export const TYPING_MS_PER_CHAR = 25;
export const PAUSE_MIN_MS = 1000;
export const PAUSE_MAX_MS = 2000;
/** « écrit… » dure environ 5 s chez Telegram : relancé toutes les 4 s pendant l'appel au modèle. */
export const TYPING_REFRESH_MS = 4000;

/** Délai « écrit… » avant un message : clamp(1000 + 25 × longueur, 1000, 4000) ms. */
export function typingDelayMs(text: string): number {
  const len = Array.from(text).length;
  return Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, TYPING_MIN_MS + TYPING_MS_PER_CHAR * len));
}

/** Pause entre deux messages : 1000 à 2000 ms (aléa injectable, valeur dans [0, 1)). */
export function pauseBetweenMs(random: () => number): number {
  const r = Math.min(1, Math.max(0, random()));
  return Math.round(PAUSE_MIN_MS + r * (PAUSE_MAX_MS - PAUSE_MIN_MS));
}

const defaultTimers: TypingTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Exécute `task` en montrant « écrit… » : un premier envoi tout de suite, puis toutes les 4 s jusqu'à la fin de la
 * tâche. La minuterie est toujours arrêtée (aucune fuite), les erreurs de « écrit… » sont ignorées.
 */
export async function withTyping<T>(
  sendTyping: () => Promise<void>,
  task: () => Promise<T>,
  timers: TypingTimers = defaultTimers,
): Promise<T> {
  const typing = () => {
    try {
      sendTyping().catch(() => undefined);
    } catch {
      // « écrit… » est un confort : jamais bloquant
    }
  };
  typing();
  const handle = timers.setInterval(typing, TYPING_REFRESH_MS);
  try {
    return await task();
  } finally {
    timers.clearInterval(handle);
  }
}
