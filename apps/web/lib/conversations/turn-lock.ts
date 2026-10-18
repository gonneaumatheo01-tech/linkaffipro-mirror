/**
 * Verrou du tour de l'assistante côté site (phase 17) : le même que celui que le worker tient pendant tout un tour
 * (`chat:lock:<conversationId>`, voir `chatLockKey` dans apps/worker/src/assistant/rules.ts et
 * `conversationLockKey` dans packages/telegram/src/assistant/conversation-lock.ts).
 *
 * « Rendre à l'assistante » passe sous ce verrou : un tour commencé AVANT la prise de main (réponse en préparation chez
 * l'IA) se termine d'abord — il voit l'équipe aux commandes avant d'envoyer et se tait — puis la main est rendue. Sans
 * lui, une prise de main suivie d'un rendu pendant la préparation laisserait partir la réponse préparée sans le message
 * de l'équipe, en double.
 */
import { getRedis, RedisLockBusy, withRedisLock, type LockRedis } from "@linkaffipro/queue";

/** Même clé que le worker et la réception. */
export function turnLockKey(conversationId: string): string {
  return `chat:lock:${conversationId}`;
}

/** Attente maximale dans le site (un tour de l'assistante dure souvent quelques secondes). */
export const TURN_LOCK_WAIT_MS = 8_000;
/** Durée de vie du verrou pris par le site (libéré tout de suite après la décision). */
export const TURN_LOCK_TTL_MS = 30_000;

export type TurnLockOptions = {
  /** Client Redis (par défaut celui des files) ; une erreur ici = Redis injoignable. */
  redis?: () => LockRedis;
  waitMs?: number;
  pollMs?: number;
};

/** `busy` : un tour tient encore le verrou au-delà de l'attente, rien n'a été fait. */
export type TurnLockOutcome<T> = { busy: false; value: T; locked: boolean } | { busy: true };

/**
 * Exécute `fn` sous le verrou du tour, en attendant au plus `waitMs` qu'un tour en cours se termine. Verrou toujours
 * pris au-delà de l'attente : rien n'est fait (`busy`). Redis injoignable : `fn` s'exécute sans le verrou (aucun tour
 * ne peut alors tourner : les files du worker vivent dans le même Redis). Les erreurs de `fn` remontent telles quelles.
 */
export async function underTurnLock<T>(
  conversationId: string,
  fn: () => Promise<T>,
  opts: TurnLockOptions = {},
): Promise<TurnLockOutcome<T>> {
  let started = false;
  const run = () => {
    started = true;
    return fn();
  };
  try {
    const redis = (opts.redis ?? (() => getRedis()))();
    const value = await withRedisLock(redis, turnLockKey(conversationId), run, {
      ttlMs: TURN_LOCK_TTL_MS,
      waitMs: opts.waitMs ?? TURN_LOCK_WAIT_MS,
      pollMs: opts.pollMs ?? 250,
      owner: "web:conversations",
      label: "verrou de la conversation",
    });
    return { busy: false, value, locked: true };
  } catch (err) {
    // Erreur du travail lui-même : jamais refait.
    if (started) throw err;
    if (err instanceof RedisLockBusy) return { busy: true };
  }
  return { busy: false, value: await run(), locked: false };
}
