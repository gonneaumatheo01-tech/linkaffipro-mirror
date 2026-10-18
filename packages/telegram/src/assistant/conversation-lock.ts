// Verrou d'une conversation de l'assistant (phase 17) côté webhook : le même que celui que le worker tient pendant tout
// un tour (`chat:lock:<conversationId>`, voir `chatLockKey` dans apps/worker/src/assistant/rules.ts). Un /reset pris
// sous ce verrou ne tombe jamais au milieu d'un tour : la réponse en préparation part d'abord, puis tout est effacé
// (ses messages compris), et le tour suivant repart d'une conversation vide.
import { getRedis, RedisLockBusy, withRedisLock, type LockRedis } from "@linkaffipro/queue";

/** Même clé que le worker (une seule écriture à la fois par conversation). */
export function conversationLockKey(conversationId: string): string {
  return `chat:lock:${conversationId}`;
}

/** Attente maximale dans le webhook (un tour de l'assistant dure souvent quelques secondes). */
export const RESET_LOCK_WAIT_MS = 8_000;
/** Durée de vie du verrou pris par le webhook (libéré tout de suite après l'effacement). */
export const RESET_LOCK_TTL_MS = 30_000;

/** `locked` : faux quand le travail a dû se faire sans le verrou (tour trop long, Redis injoignable). */
export type ConversationLock = <T>(
  conversationId: string,
  fn: (locked: boolean) => Promise<T>,
) => Promise<{ value: T; locked: boolean }>;

export type ConversationLockOptions = {
  /** Client Redis (par défaut celui des files) ; une erreur ici = Redis injoignable. */
  redis?: () => LockRedis;
  waitMs?: number;
  ttlMs?: number;
  pollMs?: number;
  /** Prévenu quand le travail se fait sans le verrou. */
  onFallback?: (info: { conversationId: string; reason: "busy" | "unavailable" }) => void;
};

/**
 * Exécute `fn` sous le verrou de la conversation, en attendant au plus `waitMs` qu'un tour en cours se termine. Verrou
 * toujours pris au-delà de l'attente, ou Redis injoignable : `fn` s'exécute quand même, sans le verrou (la demande de la
 * personne passe avant tout), une seule fois. Les erreurs de `fn` remontent telles quelles (jamais de second essai).
 */
export function createConversationLock(opts: ConversationLockOptions = {}): ConversationLock {
  const redisOf: () => LockRedis = opts.redis ?? (() => getRedis());
  return async <T>(conversationId: string, fn: (locked: boolean) => Promise<T>) => {
    let started = false;
    const run = async (locked: boolean) => {
      started = true;
      return fn(locked);
    };
    let reason: "busy" | "unavailable" = "unavailable";
    try {
      const value = await withRedisLock(
        redisOf(),
        conversationLockKey(conversationId),
        () => run(true),
        {
          ttlMs: opts.ttlMs ?? RESET_LOCK_TTL_MS,
          waitMs: opts.waitMs ?? RESET_LOCK_WAIT_MS,
          pollMs: opts.pollMs ?? 250,
          owner: "web:assistant",
          label: "verrou de la conversation",
        },
      );
      return { value, locked: true };
    } catch (err) {
      // Erreur du travail lui-même : jamais refait.
      if (started) throw err;
      reason = err instanceof RedisLockBusy ? "busy" : "unavailable";
    }
    opts.onFallback?.({ conversationId, reason });
    return { value: await run(false), locked: false };
  };
}
