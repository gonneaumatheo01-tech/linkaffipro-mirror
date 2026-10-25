/**
 * Phase 35 (règle 2) : UN SEUL lecteur à la fois par site (une seule session, jamais deux navigateurs sur le même compte).
 * Verrou en base : `Setting bookmakers.lock.<site>` = `{ token, owner, expiresAt }` ; pris par création (clé unique) ou
 * par comparaison de `updatedAt` quand l'ancien a expiré ; prolongé chaque minute pendant le travail ; abandonné
 * (repris par un autre) s'il n'a pas été prolongé depuis 10 min (processus arrêté) ; libéré par son seul détenteur.
 * Réentrant dans une même chaîne d'appels (`AsyncLocalStorage`) : le worker tient le verrou d'un travail et la lecture
 * qu'il appelle peut le redemander sans s'attendre elle-même.
 * Décision : la base seule (pas Redis) pour que le site, le worker et les scripts partagent toujours le MÊME verrou.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { AgentsPrisma } from "../../types";

export const SITE_LOCK_PREFIX = "bookmakers.lock.";
/** Sans prolongation pendant 10 min, le verrou est abandonné. */
export const SITE_LOCK_TTL_MS = 10 * 60_000;
export const SITE_LOCK_RENEW_MS = 60_000;
/** Attente par défaut quand le site est déjà en lecture (une page prend quelques secondes, un apprentissage 6 min). */
export const SITE_LOCK_WAIT_MS = 7 * 60_000;

export class SiteLockBusy extends Error {
  readonly siteKey: string;
  constructor(siteKey: string) {
    super(`lecture déjà en cours sur ${siteKey}`);
    this.name = "SiteLockBusy";
    this.siteKey = siteKey;
  }
}

type LockValue = { token: string; owner: string; expiresAt: string };
type Row = { key: string; value: unknown; updatedAt: Date };

export type SiteLockOptions = {
  waitMs?: number;
  pollMs?: number;
  owner?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  renewMs?: number;
};

const held = new AsyncLocalStorage<ReadonlySet<string>>();

function parse(v: unknown): LockValue | null {
  const o = v as LockValue | null;
  return o && typeof o.token === "string" && typeof o.expiresAt === "string" ? o : null;
}

async function tryAcquire(prisma: AgentsPrisma, key: string, token: string, owner: string, now: Date): Promise<boolean> {
  const value: LockValue = { token, owner, expiresAt: new Date(now.getTime() + SITE_LOCK_TTL_MS).toISOString() };
  const row = (await prisma.setting.findUnique({ where: { key } })) as Row | null;
  if (!row) {
    try {
      await prisma.setting.create({ data: { key, value: value as never } });
      return true;
    } catch {
      return false; // pris par un autre au même instant
    }
  }
  const cur = parse(row.value);
  if (cur && new Date(cur.expiresAt).getTime() > now.getTime()) return false;
  const r = await prisma.setting.updateMany({ where: { key, updatedAt: row.updatedAt }, data: { value: value as never } });
  return r.count === 1;
}

async function renew(prisma: AgentsPrisma, key: string, token: string, owner: string, now: Date): Promise<boolean> {
  const row = (await prisma.setting.findUnique({ where: { key } })) as Row | null;
  if (parse(row?.value)?.token !== token || !row) return false;
  const value: LockValue = { token, owner, expiresAt: new Date(now.getTime() + SITE_LOCK_TTL_MS).toISOString() };
  const r = await prisma.setting.updateMany({ where: { key, updatedAt: row.updatedAt }, data: { value: value as never } });
  return r.count === 1;
}

async function release(prisma: AgentsPrisma, key: string, token: string): Promise<void> {
  const row = (await prisma.setting.findUnique({ where: { key } })) as Row | null;
  if (!row || parse(row.value)?.token !== token) return;
  await prisma.setting.deleteMany({ where: { key, updatedAt: row.updatedAt } });
}

/** Ce site est-il en lecture (verrou valide) ? */
export async function siteLocked(deps: { prisma: AgentsPrisma; now?: () => Date }, siteKey: string): Promise<boolean> {
  const row = (await deps.prisma.setting.findUnique({ where: { key: `${SITE_LOCK_PREFIX}${siteKey}` } })) as Row | null;
  const cur = parse(row?.value);
  return !!cur && new Date(cur.expiresAt).getTime() > (deps.now?.() ?? new Date()).getTime();
}

/**
 * Exécute `fn` en tenant le verrou du site. Lève `SiteLockBusy` si le site reste en lecture au-delà de `waitMs`
 * (`waitMs: 0` : abandon immédiat). Les erreurs de `fn` remontent telles quelles ; le verrou est toujours rendu.
 */
export async function withSiteLock<T>(deps: { prisma: AgentsPrisma; now?: () => Date }, siteKey: string, fn: () => Promise<T>, opts: SiteLockOptions = {}): Promise<T> {
  const mine = held.getStore();
  if (mine?.has(siteKey)) return fn();
  const now = opts.now ?? deps.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const key = `${SITE_LOCK_PREFIX}${siteKey}`;
  const owner = opts.owner ?? "lecture";
  const token = `${owner}:${randomUUID()}`;
  const waitMs = opts.waitMs ?? SITE_LOCK_WAIT_MS;
  const start = now().getTime();
  while (!(await tryAcquire(deps.prisma, key, token, owner, now()))) {
    if (now().getTime() - start >= waitMs) throw new SiteLockBusy(siteKey);
    await sleep(opts.pollMs ?? 1_000);
  }
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void renew(deps.prisma, key, token, owner, now())
      .catch(() => false)
      .finally(() => {
        renewing = false;
      });
  }, opts.renewMs ?? SITE_LOCK_RENEW_MS);
  timer.unref?.();
  try {
    return await held.run(new Set([...(mine ?? []), siteKey]), fn);
  } finally {
    clearInterval(timer);
    await release(deps.prisma, key, token).catch(() => undefined);
  }
}
