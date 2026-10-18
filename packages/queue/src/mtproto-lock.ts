import { withRedisLock, type LockRedis } from "./redis-lock";

/**
 * Verrou Redis partagé de la session Telegram (compte utilisateur MTProto, phase 7).
 * Le site (import des canaux du compte) et le worker (relevé des vues) utilisent la même session depuis deux régions :
 * deux connexions simultanées peuvent faire invalider la clé par Telegram (AUTH_KEY_DUPLICATED, reconnexion par code SMS).
 * Le verrou garantit une seule connexion à la fois : SET NX PX (expiration de sécurité), prolongé pendant le travail,
 * libéré par son seul détenteur. Redis absent ou lent : `MtprotoLockUnavailable` (message simple), jamais de verrou orphelin.
 * Mécanique commune : `withRedisLock` (`redis-lock.ts`).
 */

export type { LockRedis };

/** Clé Redis du verrou. */
export const MTPROTO_LOCK_KEY = "mtproto:lock";
/** Durée de vie du verrou : libéré tout seul si le processus qui le tient s'arrête. */
export const MTPROTO_LOCK_TTL_MS = 60_000;

/** Le verrou est tenu par un autre processus (import en cours sur le site, ou relevé des vues du worker). */
export class MtprotoLockBusy extends Error {
  constructor() {
    super(
      "Le compte Telegram connecté est déjà utilisé (relevé des vues ou import en cours) : réessayez dans une minute.",
    );
    this.name = "MtprotoLockBusy";
  }
}

/**
 * Redis ne répond pas (reconnexion, panne) : la session Telegram n'est pas utilisée. Message affiché tel quel à l'utilisateur ;
 * le détail technique est dans `cause` (journaux).
 */
export class MtprotoLockUnavailable extends Error {
  constructor(cause?: unknown) {
    super("Service momentanément indisponible, réessayez dans une minute.", { cause });
    this.name = "MtprotoLockUnavailable";
  }
}

export type MtprotoLockOptions = {
  /** Attente maximale si le verrou est pris (0 : on abandonne tout de suite). */
  waitMs?: number;
  /** Intervalle entre deux essais pendant l'attente. */
  pollMs?: number;
  /** Durée de vie du verrou. */
  ttlMs?: number;
  /** Délai maximal d'une commande Redis (une connexion coupée ne doit jamais bloquer une page). */
  commandTimeoutMs?: number;
  /** Intervalle de prolongation du verrou pendant le travail (par défaut un tiers de `ttlMs`, soit 20 s). */
  renewMs?: number;
  /** Détenteur, pour le diagnostic (`web:import`, `worker:views`). */
  owner?: string;
};

/**
 * Exécute `fn` en tenant le verrou de la session Telegram. Lève `MtprotoLockBusy` si le verrou reste pris au-delà de `waitMs`,
 * `MtprotoLockUnavailable` si Redis ne répond pas (dans ce cas, une prise exécutée en retard est rendue aussitôt).
 * Pendant `fn`, le verrou est prolongé toutes les `renewMs` (un travail long, comme 500 dialogues lus, ne le perd pas) ;
 * il est toujours libéré à la fin (succès ou erreur). Si le processus s'arrête, il expire seul après `ttlMs`.
 */
export async function withMtprotoLock<T>(
  redis: LockRedis,
  fn: () => Promise<T>,
  opts: MtprotoLockOptions = {},
): Promise<T> {
  return withRedisLock(redis, MTPROTO_LOCK_KEY, fn, {
    ...opts,
    ttlMs: opts.ttlMs ?? MTPROTO_LOCK_TTL_MS,
    label: "verrou Telegram",
    busyError: () => new MtprotoLockBusy(),
    unavailableError: (cause) => new MtprotoLockUnavailable(cause),
  });
}
