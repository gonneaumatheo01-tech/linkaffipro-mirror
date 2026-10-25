/**
 * Phase 35, chantier A : file des travaux de lecture `BookmakerReadJob` (la base fait foi).
 * - `enqueueReadJob` dépose un travail (PENDING) ; jamais de secret dans `params` (refusé) ;
 * - `claimReadJob` le prend de façon atomique (PENDING → CLAIMED, comparaison du statut) ;
 * - `finishReadJob` rend le résultat (DONE, FAILED ou NEEDS_HUMAN) ;
 * - `waitReadJob` attend un résultat (attente injectable) ;
 * - `sweepReadJobs` : un travail pris depuis 15 min est rendu une fois (PENDING), puis abandonné (FAILED) ; un travail
 *   jamais pris depuis 24 h est abandonné ;
 * - battement du Mac : `Setting bookmakers.mac.heartbeat` (écrit à chaque passage du runner), muet depuis 2 min = absent.
 * Sortes : celles du contrat (`learn`, `events`, `markets`, `verify`, `capture`, `test`, `visible`) et les primitives du
 * transport (`fetch-api`, `page`, `record`) que le Mac exécute pour le serveur.
 */
import type { AgentsPrisma, Logger } from "../types";
import type { ReadJobKind, ReadTarget } from "./contract";

export type TransportJobKind = "fetch-api" | "page" | "record";
export type AnyReadJobKind = ReadJobKind | TransportJobKind;
export type ReadJobStatus = "PENDING" | "CLAIMED" | "DONE" | "FAILED" | "NEEDS_HUMAN";

export const READ_JOB_KINDS: readonly AnyReadJobKind[] = ["learn", "events", "markets", "verify", "capture", "test", "visible", "fetch-api", "page", "record"];
/** Primitives du navigateur : faites par le Mac pour le serveur (transport Mac). */
export const TRANSPORT_JOB_KINDS: readonly AnyReadJobKind[] = ["fetch-api", "page", "record", "visible"];
/** Travaux complets : orchestrés par le worker (recette, cache, base), qui lit par le serveur ou par le Mac. */
export const HIGH_LEVEL_JOB_KINDS: readonly AnyReadJobKind[] = ["learn", "events", "markets", "verify", "capture", "test"];

/** Un travail pris sans résultat depuis 15 min est rendu une fois, puis abandonné. */
export const READ_JOB_CLAIM_TTL_MS = 15 * 60_000;
/** Un travail jamais pris depuis 24 h est abandonné. */
export const READ_JOB_MAX_AGE_MS = 24 * 3600_000;
/** Mac muet depuis 2 min = absent. */
export const MAC_HEARTBEAT_MAX_AGE_MS = 2 * 60_000;
export const MAC_HEARTBEAT_KEY = "bookmakers.mac.heartbeat";

export type ReadJobRow = {
  id: string;
  siteKey: string;
  kind: string;
  target: string;
  status: string;
  params: unknown;
  result: unknown;
  attempts: number;
  claimedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

type Deps = { prisma: AgentsPrisma; now?: () => Date; logger?: Logger };
const nowOf = (deps: { now?: () => Date }) => (deps.now ? deps.now() : new Date());

// Noms de champs qui ne doivent jamais voyager dans `params` (identifiants, sessions, jetons).
const SECRET_FIELD = /pass(word)?|mot.?de.?passe|login|identifiant|credential|cookie|session|storage.?state|token|jeton|secret|authorization|bearer|api.?key/i;
// Valeurs qui ressemblent à un secret (jeton du runner, en-tête d'autorisation, JWT).
const SECRET_VALUE = /^(Bearer\s+\S+|lapcr_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*)$/;

/** Pur : chemin du premier champ secret trouvé dans `params` (noms d'en-têtes permis dans `headers`), sinon null. */
export function secretInParams(v: unknown, path = "params", depth = 0): string | null {
  if (depth > 8 || v === null || v === undefined) return null;
  if (typeof v === "string") return SECRET_VALUE.test(v.trim()) ? path : null;
  if (Array.isArray(v)) {
    // Liste de NOMS d'en-têtes (`headers: ["authorization"]`) : des noms, jamais des valeurs.
    if (/\.headers$/.test(path) && v.every((x) => typeof x === "string" && /^[a-z0-9-]{1,60}$/i.test(x))) return null;
    for (const [i, x] of v.entries()) {
      const hit = secretInParams(x, `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_FIELD.test(k) && x !== null && x !== undefined && x !== false && x !== "") return `${path}.${k}`;
      const hit = secretInParams(x, `${path}.${k}`, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Appelé après chaque dépôt d'un travail « serveur » (worker : tâche BullMQ immédiate) ; sinon le balayage de 15 s. */
let kick: ((job: ReadJobRow) => Promise<void>) | null = null;
export function setReadJobKick(fn: ((job: ReadJobRow) => Promise<void>) | null): void {
  kick = fn;
}

export type EnqueueReadJobInput = {
  siteKey: string;
  kind: AnyReadJobKind;
  target: ReadTarget;
  params?: Record<string, unknown>;
};

/** Dépose un travail de lecture (PENDING). Refuse tout secret dans `params`. */
export async function enqueueReadJob(deps: Deps, i: EnqueueReadJobInput): Promise<ReadJobRow> {
  if (!READ_JOB_KINDS.includes(i.kind)) throw new Error(`sorte de travail inconnue : ${i.kind}`);
  if (i.target !== "server" && i.target !== "mac") throw new Error(`cible inconnue : ${String(i.target)}`);
  const params = i.params ?? {};
  const secret = secretInParams(params);
  if (secret) throw new Error(`secret refusé dans les paramètres d'un travail de lecture (${secret})`);
  const row = (await deps.prisma.bookmakerReadJob.create({
    data: { siteKey: i.siteKey, kind: i.kind, target: i.target, status: "PENDING", params: params as never, createdAt: nowOf(deps) },
  })) as unknown as ReadJobRow;
  if (i.target === "server" && kick) await kick(row).catch((err) => deps.logger?.warn({ err: (err as Error).message }, "[bookmakers] mise en file immédiate impossible"));
  return row;
}

export async function readReadJob(deps: Deps, id: string): Promise<ReadJobRow | null> {
  return (await deps.prisma.bookmakerReadJob.findUnique({ where: { id } })) as unknown as ReadJobRow | null;
}

/**
 * Prend le plus ancien travail en attente pour cette cible (et ces sortes) ; atomique : deux preneurs ne prennent
 * jamais le même travail. `siteKeys` exclus : sites déjà en cours de lecture ailleurs.
 */
export async function claimReadJob(
  deps: Deps,
  o: { target: ReadTarget; kinds?: readonly string[]; excludeSites?: readonly string[]; id?: string },
): Promise<ReadJobRow | null> {
  const now = nowOf(deps);
  const where: Record<string, unknown> = { target: o.target, status: "PENDING" };
  if (o.id) where.id = o.id;
  if (o.kinds) where.kind = { in: [...o.kinds] };
  if (o.excludeSites?.length) where.siteKey = { notIn: [...o.excludeSites] };
  const candidates = (await deps.prisma.bookmakerReadJob.findMany({ where: where as never, orderBy: { createdAt: "asc" }, take: 20 })) as unknown as ReadJobRow[];
  for (const c of candidates) {
    const r = await deps.prisma.bookmakerReadJob.updateMany({
      where: { id: c.id, status: "PENDING" },
      data: { status: "CLAIMED", claimedAt: now, attempts: { increment: 1 } },
    });
    if (r.count === 1) return { ...c, status: "CLAIMED", claimedAt: now, attempts: c.attempts + 1 };
  }
  return null;
}

/** Rend un travail pris sans le compter (site occupé ailleurs : il sera repris). */
export async function releaseReadJob(deps: Deps, id: string): Promise<void> {
  await deps.prisma.bookmakerReadJob.updateMany({ where: { id, status: "CLAIMED" }, data: { status: "PENDING", claimedAt: null, attempts: { decrement: 1 } } });
}

/** Résultat d'un travail (seulement s'il est encore pris : un travail abandonné puis repris n'est pas écrasé). */
export async function finishReadJob(
  deps: Deps,
  id: string,
  status: Exclude<ReadJobStatus, "PENDING" | "CLAIMED">,
  result: unknown,
  o: { fromStatuses?: ReadJobStatus[] } = {},
): Promise<boolean> {
  const r = await deps.prisma.bookmakerReadJob.updateMany({
    where: { id, status: { in: o.fromStatuses ?? ["CLAIMED"] } },
    data: { status, result: (result ?? null) as never, finishedAt: nowOf(deps) },
  });
  return r.count === 1;
}

export type WaitOptions = { timeoutMs: number; pollMs?: number; sleep?: (ms: number) => Promise<void> };
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Attend la fin d'un travail ; `null` si toujours en cours à l'échéance (horloge `deps.now`). */
export async function waitReadJob(deps: Deps, id: string, o: WaitOptions): Promise<ReadJobRow | null> {
  const sleep = o.sleep ?? realSleep;
  const start = nowOf(deps).getTime();
  for (;;) {
    const row = await readReadJob(deps, id);
    if (!row) return null;
    if (row.status !== "PENDING" && row.status !== "CLAIMED") return row;
    if (nowOf(deps).getTime() - start >= o.timeoutMs) return null;
    await sleep(o.pollMs ?? 1_000);
  }
}

/** Ménage : pris depuis 15 min → rendu une fois, puis abandonné ; jamais pris depuis 24 h → abandonné. */
export async function sweepReadJobs(deps: Deps): Promise<{ released: number; failed: number }> {
  const now = nowOf(deps);
  let released = 0;
  let failed = 0;
  const stale = (await deps.prisma.bookmakerReadJob.findMany({
    where: { status: "CLAIMED", claimedAt: { lt: new Date(now.getTime() - READ_JOB_CLAIM_TTL_MS) } },
    take: 200,
  })) as unknown as ReadJobRow[];
  for (const j of stale) {
    if (j.attempts <= 1) {
      const r = await deps.prisma.bookmakerReadJob.updateMany({ where: { id: j.id, status: "CLAIMED", claimedAt: j.claimedAt }, data: { status: "PENDING", claimedAt: null } });
      released += r.count;
    } else {
      const r = await deps.prisma.bookmakerReadJob.updateMany({
        where: { id: j.id, status: "CLAIMED", claimedAt: j.claimedAt },
        data: { status: "FAILED", finishedAt: now, result: { obstacle: "abandoned", message: "lecture abandonnée (lecteur arrêté deux fois)" } as never },
      });
      failed += r.count;
    }
  }
  const old = await deps.prisma.bookmakerReadJob.updateMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - READ_JOB_MAX_AGE_MS) } },
    data: { status: "FAILED", finishedAt: now, result: { obstacle: "abandoned", message: "lecture restée sans lecteur pendant 24 h" } as never },
  });
  failed += old.count;
  return { released, failed };
}

/** Ménage : travaux terminés depuis plus de 7 jours. */
export async function purgeReadJobs(deps: Deps): Promise<number> {
  const r = await deps.prisma.bookmakerReadJob.deleteMany({
    where: { status: { in: ["DONE", "FAILED", "NEEDS_HUMAN"] }, finishedAt: { lt: new Date(nowOf(deps).getTime() - 7 * 86400_000) } },
  });
  return r.count;
}

export type MacHeartbeat = { at: string; kinds: string[]; version: string | null; visible: boolean };

/** Battement du Mac (à chaque passage du runner). */
export async function writeMacHeartbeat(deps: Deps, hb: { kinds: string[]; version?: string | null; visible?: boolean }): Promise<MacHeartbeat> {
  const value: MacHeartbeat = { at: nowOf(deps).toISOString(), kinds: hb.kinds.slice(0, 20).map((k) => String(k).slice(0, 20)), version: hb.version ?? null, visible: hb.visible ?? false };
  await deps.prisma.setting.upsert({ where: { key: MAC_HEARTBEAT_KEY }, create: { key: MAC_HEARTBEAT_KEY, value: value as never }, update: { value: value as never } });
  return value;
}

export async function readMacHeartbeat(deps: Deps): Promise<MacHeartbeat | null> {
  const row = await deps.prisma.setting.findUnique({ where: { key: MAC_HEARTBEAT_KEY } });
  const v = row?.value as MacHeartbeat | undefined;
  return v && typeof v.at === "string" ? { ...v, kinds: Array.isArray(v.kinds) ? v.kinds : [] } : null;
}

/** Pur : Mac vivant (battement de moins de 2 min) ? */
export function macHeartbeatFresh(hb: MacHeartbeat | null, now: Date): boolean {
  if (!hb) return false;
  const at = new Date(hb.at).getTime();
  return Number.isFinite(at) && now.getTime() - at < MAC_HEARTBEAT_MAX_AGE_MS;
}

export async function macAlive(deps: Deps): Promise<boolean> {
  return macHeartbeatFresh(await readMacHeartbeat(deps), nowOf(deps));
}
