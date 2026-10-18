import { randomUUID } from "node:crypto";

/**
 * Verrou Redis générique (SET NX PX + prolongation + libération par son seul détenteur).
 * Utilisé pour la session Telegram du compte connecté (`withMtprotoLock`, un seul client MTProto à la fois entre le site
 * et le worker) et pour l'assistant de conversation (`chat:lock:<conversationId>`, phase 17 : un seul tour à la fois par
 * conversation). Le verrou expire tout seul après `ttlMs` si le processus qui le tient s'arrête ; il est prolongé pendant
 * le travail ; une commande Redis lente ou coupée ne bloque jamais l'appelant (délai maximal par commande).
 */

/** Client Redis minimal (sous-ensemble d'ioredis) : facile à simuler dans les tests. */
export interface LockRedis {
  set(key: string, value: string, px: "PX", ttlMs: number, nx: "NX"): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

/** Le verrou est tenu par un autre détenteur au-delà de l'attente permise. */
export class RedisLockBusy extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`Verrou « ${key} » déjà pris.`);
    this.name = "RedisLockBusy";
    this.key = key;
  }
}

/** Redis ne répond pas (reconnexion, panne) : le travail n'est pas fait. Détail technique dans `cause`. */
export class RedisLockUnavailable extends Error {
  readonly key: string;
  constructor(key: string, cause?: unknown) {
    super(`Verrou « ${key} » indisponible : Redis ne répond pas.`, { cause });
    this.name = "RedisLockUnavailable";
    this.key = key;
  }
}

/** Libère seulement si la valeur est encore la nôtre (un verrou expiré puis repris par un autre n'est jamais supprimé). */
export const RELEASE_LOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
/** Prolonge seulement si la valeur est encore la nôtre. */
export const EXTEND_LOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end';

export type RedisLockOptions = {
  /** Durée de vie du verrou (libéré tout seul si le processus qui le tient s'arrête). */
  ttlMs: number;
  /** Attente maximale si le verrou est pris (0 : on abandonne tout de suite). */
  waitMs?: number;
  /** Intervalle entre deux essais pendant l'attente. */
  pollMs?: number;
  /** Délai maximal d'une commande Redis (une connexion coupée ne doit jamais bloquer l'appelant). */
  commandTimeoutMs?: number;
  /** Intervalle de prolongation pendant le travail (par défaut un tiers de `ttlMs`). */
  renewMs?: number;
  /** Détenteur, pour le diagnostic (`web:import`, `worker:chat`). */
  owner?: string;
  /** Nom du verrou dans les messages techniques (« verrou Telegram »). */
  label?: string;
  /** Erreur levée quand le verrou reste pris (par défaut `RedisLockBusy`). */
  busyError?: () => Error;
  /** Erreur levée quand Redis ne répond pas (par défaut `RedisLockUnavailable`). */
  unavailableError?: (cause: unknown) => Error;
};

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis ne répond pas (${what}, ${ms} ms)`)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

/** Libération par comparaison du jeton, sans jamais lever (une commande restée en file s'exécute plus tard, sans danger). */
function release(
  redis: LockRedis,
  key: string,
  token: string,
  timeoutMs: number,
  label: string,
): Promise<void> {
  return withTimeout(
    Promise.resolve().then(() => redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token)),
    timeoutMs,
    `libération du ${label}`,
  ).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Exécute `fn` en tenant le verrou `key`. Lève `busyError()` (par défaut `RedisLockBusy`) si le verrou reste pris
 * au-delà de `waitMs`, `unavailableError(cause)` (par défaut `RedisLockUnavailable`) si Redis ne répond pas (dans ce cas,
 * une prise exécutée en retard est rendue aussitôt). Pendant `fn`, le verrou est prolongé toutes les `renewMs` ; il est
 * toujours libéré à la fin (succès ou erreur). Les erreurs de `fn` remontent telles quelles.
 */
export async function withRedisLock<T>(
  redis: LockRedis,
  key: string,
  fn: () => Promise<T>,
  opts: RedisLockOptions,
): Promise<T> {
  const ttlMs = opts.ttlMs;
  const pollMs = opts.pollMs ?? 500;
  const commandTimeoutMs = opts.commandTimeoutMs ?? 5_000;
  const renewMs = Math.max(1, opts.renewMs ?? Math.floor(ttlMs / 3));
  const label = opts.label ?? "verrou";
  const busy = opts.busyError ?? (() => new RedisLockBusy(key));
  const unavailable =
    opts.unavailableError ?? ((cause: unknown) => new RedisLockUnavailable(key, cause));
  const token = `${opts.owner ?? "?"}:${randomUUID()}`;
  const deadline = Date.now() + Math.max(0, opts.waitMs ?? 0);
  for (;;) {
    const attempt = Promise.resolve().then(() => redis.set(key, token, "PX", ttlMs, "NX"));
    let ok: string | null;
    try {
      ok = await withTimeout(attempt, commandTimeoutMs, `prise du ${label}`);
    } catch (err) {
      // La commande est peut-être restée en file (reconnexion) : si elle aboutit plus tard, personne ne tiendrait ce verrou.
      void attempt.then(
        (late) => (late === "OK" ? release(redis, key, token, commandTimeoutMs, label) : undefined),
        () => undefined,
      );
      throw unavailable(err);
    }
    if (ok === "OK") break;
    const left = deadline - Date.now();
    if (left <= 0) throw busy();
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, left)));
  }
  // Prolongation pendant le travail (une à la fois ; un échec ponctuel est rattrapé au tour suivant).
  let renewing = false;
  const renewTimer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void withTimeout(
      Promise.resolve().then(() => redis.eval(EXTEND_LOCK_SCRIPT, 1, key, token, String(ttlMs))),
      commandTimeoutMs,
      `prolongation du ${label}`,
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
    await release(redis, key, token, commandTimeoutMs, label);
  }
}
