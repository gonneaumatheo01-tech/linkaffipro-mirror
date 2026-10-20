// Rythme naturel (contrat §3.6) : elle n'a pas le telephone dans la main.
// - ouverture : delai avant d'ouvrir le message, proportionnel au rythme de la personne ;
// - frappe : « ecrit... » proportionnel a la longueur, puis envoi ;
// - refus de l'app : elle ne discute plus ici, 1 a 3 h.
import type { TypingTimers } from "./turn-types";

export const TYPING_MIN_MS = 400;
export const TYPING_MAX_MS = 12_000;
export const TYPING_MS_PER_CHAR = 110;
/** « ecrit... » dure environ 5 s chez Telegram : relance toutes les 4 s. */
export const TYPING_REFRESH_MS = 4000;

export const OPENING_MIN_MS = 22_000;
export const OPENING_MAX_MS = 165_000;
export const OPENING_BASE_MS = 15_000;
/** Part du delai de la personne qui se retrouve dans le notre (0,35 = 35 %). */
export const OPENING_PER_PEER = 0.35;
export const OPENING_JITTER = 0.25;
export const OPENING_FIRST_MIN_MS = 15_000;
export const OPENING_FIRST_MAX_MS = 25_000;

/** Discussion chaude (interet eleve, ton dragueur) : elle repond plus vite. */
export const HOT_FACTOR = 0.5;
export const HOT_MIN_MS = 8_000;
export const HOT_MAX_MS = 90_000;
/** Interet bas ou apres un refus : elle traine. */
export const COLD_FACTOR = 1.3;

/** Refus de l'app : plus de discussion ici, 1 a 3 h. */
/** La personne a repondu dans la foulee : elle est dans la conversation, elle repond aussi sec. */
export const LIVE_WINDOW_MS = 2 * 60 * 1000;
export const LIVE_MIN_MS = 2000;
export const LIVE_MAX_MS = 6000;
export const LIVE_PAUSE_MIN_MS = 500;
export const LIVE_PAUSE_MAX_MS = 1500;
export const LIVE_TYPING_FACTOR = 0.7;

export const REFUSED_MIN_MS = 60 * 60 * 1000;
export const REFUSED_MAX_MS = 3 * 60 * 60 * 1000;

export const PAUSE_MIN_MS = 800;
export const PAUSE_MAX_MS = 2500;

function clamp01(r: number): number {
  return Math.min(1, Math.max(0, r));
}

/** Delai « ecrit... » avant un message : proportionnel a sa longueur. */
export function typingDelayMs(text: string, hot = false): number {
  const len = Array.from(text).length;
  const d = Math.min(TYPING_MAX_MS, TYPING_MIN_MS + TYPING_MS_PER_CHAR * len);
  return Math.round(hot ? d * 0.7 : d);
}

export type OpeningInput = {
  /** Temps que la personne a mis pour repondre (ms) ; null si inconnu. */
  peerDelayMs: number | null;
  /** La personne vient de repondre : elle est dans la conversation. */
  live: boolean;
  /** Premier message de la conversation : elle ouvre vite, par curiosite. */
  isFirst: boolean;
  /** Discussion chaude. */
  hot: boolean;
  /** Interet bas ou ton sec. */
  cold: boolean;
  /** La personne a refuse l'app : elle ne discute plus ici. */
  refused: boolean;
};

/** Delai avant d'ouvrir le message (sans « ecrit... »). `random` rend une valeur dans [0, 1). */
export function openingDelayMs(input: OpeningInput, random: () => number): number {
  if (input.live)
    return Math.round(LIVE_MIN_MS + clamp01(random()) * (LIVE_MAX_MS - LIVE_MIN_MS));
  if (input.refused)
    return Math.round(REFUSED_MIN_MS + clamp01(random()) * (REFUSED_MAX_MS - REFUSED_MIN_MS));
  if (input.isFirst)
    return Math.round(
      OPENING_FIRST_MIN_MS + clamp01(random()) * (OPENING_FIRST_MAX_MS - OPENING_FIRST_MIN_MS),
    );
  const peer = Math.max(0, input.peerDelayMs ?? OPENING_MIN_MS);
  const base = Math.min(
    OPENING_MAX_MS,
    Math.max(OPENING_MIN_MS, OPENING_BASE_MS + OPENING_PER_PEER * peer),
  );
  const tone = input.hot ? HOT_FACTOR : input.cold ? COLD_FACTOR : 1;
  const jitter = 1 - OPENING_JITTER + clamp01(random()) * 2 * OPENING_JITTER;
  const min = input.hot ? HOT_MIN_MS : OPENING_MIN_MS;
  const max = input.hot ? HOT_MAX_MS : OPENING_MAX_MS;
  return Math.round(Math.min(max, Math.max(min, base * tone * jitter)));
}

/** Pause entre deux messages : 800 a 2500 ms (alea injectable, valeur dans [0, 1)). */
export function pauseBetweenMs(random: () => number, live = false): number {
  if (live) {
    const r2 = clamp01(random());
    return Math.round(LIVE_PAUSE_MIN_MS + r2 * (LIVE_PAUSE_MAX_MS - LIVE_PAUSE_MIN_MS));
  }
  const r = clamp01(random());
  return Math.round(PAUSE_MIN_MS + r * (PAUSE_MAX_MS - PAUSE_MIN_MS));
}

const defaultTimers: TypingTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Execute `task` en montrant « ecrit... » : un premier envoi tout de suite, puis toutes les 4 s jusqu'a la fin de la
 * tache. La minuterie est toujours arretee (aucune fuite), les erreurs de « ecrit... » sont ignorees.
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
      // « ecrit... » est un confort : jamais bloquant
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
