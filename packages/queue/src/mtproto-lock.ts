import { randomUUID } from "node:crypto";

/**
 * Verrou Redis partagé de la session Telegram (compte utilisateur MTProto, phase 7).
 * Le site (import des canaux du compte) et le worker (relevé des vues) utilisent la même session depuis deux régions :
 * deux connexions simultanées peuvent faire invalider la clé par Telegram (AUTH_KEY_DUPLICATED, reconnexion par code SMS).
 * Le verrou garantit une seule connexion à la fois : SET NX PX (expiration de sécurité), prolongé pendant le travail,
 * libéré par son seul détenteur. Redis absent ou lent : `MtprotoLockUnavailable` (message simple), jamais de verrou orphelin.
 */

/** Clé Redis du verrou. */
export const MTPROTO_LOCK_KEY = "mtproto:lock";
/** Durée de vie du verrou : libéré tout seul si le processus qui le tient s'arrête. */
export const MTPROTO_LOCK_TTL_MS = 60_000;

/** Client Redis minimal (sous-ensemble d'ioredis) : facile à simuler dans les tests. */
export interface LockRedis {
  set(key: string, value: string, px: "PX", ttlMs: number, nx: "NX"): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

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

/** Libère seulement si la valeur est encore la nôtre (un verrou expiré puis repris par un autre n'est jamais supprimé). */
const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
/** Prolonge seulement si la valeur est encore la nôtre. */
const EXTEND_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end';

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis ne répond pas (${what}, ${ms} ms)`)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

/** Libération par comparaison du jeton, sans jamais lever (une commande restée en file s'exécute plus tard, sans danger). */
function release(redis: LockRedis, token: string, timeoutMs: number): Promise<void> {
  return withTimeout(
    Promise.resolve().then(() => redis.eval(RELEASE_SCRIPT, 1, MTPROTO_LOCK_KEY, token)),
    timeoutMs,
    "libération du verrou Telegram",
  ).then(
    () => undefined,
    () => undefined,
  );
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
  const ttlMs = opts.ttlMs ?? MTPROTO_LOCK_TTL_MS;
  const pollMs = opts.pollMs ?? 500;
  const commandTimeoutMs = opts.commandTimeoutMs ?? 5_000;
  const renewMs = Math.max(1, opts.renewMs ?? Math.floor(ttlMs / 3));
  const token = `${opts.owner ?? "?"}:${randomUUID()}`;
  const deadline = Date.now() + Math.max(0, opts.waitMs ?? 0);
  for (;;) {
    const attempt = Promise.resolve().then(() =>
      redis.set(MTPROTO_LOCK_KEY, token, "PX", ttlMs, "NX"),
    );
    let ok: string | null;
    try {
      ok = await withTimeout(attempt, commandTimeoutMs, "prise du verrou Telegram");
    } catch (err) {
      // La commande est peut-être restée en file (reconnexion) : si elle aboutit plus tard, personne ne tiendrait ce verrou.
      void attempt.then(
        (late) => (late === "OK" ? release(redis, token, commandTimeoutMs) : undefined),
        () => undefined,
      );
      throw new MtprotoLockUnavailable(err);
    }
    if (ok === "OK") break;
    const left = deadline - Date.now();
    if (left <= 0) throw new MtprotoLockBusy();
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, left)));
  }
  // Prolongation pendant le travail (une à la fois ; un échec ponctuel est rattrapé au tour suivant).
  let renewing = false;
  const renewTimer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void withTimeout(
      Promise.resolve().then(() =>
        redis.eval(EXTEND_SCRIPT, 1, MTPROTO_LOCK_KEY, token, String(ttlMs)),
      ),
      commandTimeoutMs,
      "prolongation du verrou Telegram",
    )
      .catch(() => undefined)
      .finally(() => {
        renewing = false;
      });
  }, renewMs);
  renewTimer.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(renewTimer);
    await release(redis, token, commandTimeoutMs);
  }
}
