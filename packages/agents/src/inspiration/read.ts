/**
 * Phase 27 (chantier A, lecture) — lecture d'un canal de référence (tâche `agents-algo` `inspiration-read`) et
 * relectures hebdomadaires (`inspiration-reread`). Règles 2 et 6 :
 * - voie : aperçu web si le nom public est connu et l'aperçu ouvert ; sinon un compte réel déjà membre et libre ;
 *   sinon `UNAVAILABLE` avec la raison (Kevin demande alors des posts transférés). Une référence FORWARDED n'est pas
 *   « lue » : ses posts arrivent par transfert ;
 * - une lecture à la fois (verrou en base `Setting` `inspiration.readLock`, posé par une création atomique, détenteur
 *   unique PAR TÂCHE : jeton aléatoire, jamais repris par une autre tâche de la même référence ; renouvelé à chaque
 *   page, lot ou attente ; libéré seulement par son détenteur ; abandonné après 15 minutes sans renouvellement) et
 *   5 lectures par jour de Paris au plus (`Setting` `inspiration.readsToday`) ;
 * - rythme vers t.me tenu d'une lecture à l'autre (`io.tmeThrottle`, mémoire du processus par défaut, Redis côté worker) ;
 * - reprenable : une lecture interrompue (état READING) recommence proprement, sans doublon (rangement par numéro) et
 *   sans compter deux fois dans le quota ;
 * - à la fin : `afterReferenceRead` (Kevin, chantier C) — y compris quand le canal est indisponible, pour que Kevin
 *   demande des posts transférés ; relecture : `afterReferenceReread` (chantier C), qui décide s'il faut dire quelque
 *   chose. Jamais d'application automatique ici.
 */
import { randomUUID } from "node:crypto";
import type { AgentsDeps } from "../types";
import { addDaysToDay, parisDay, parisDayStart } from "../rules/time";
import { INSPIRATION_LIMITS, type AccountHistoryReader, type InspirationFetch, type ReferenceReadResult, type ReferenceViaName } from "./contract";
import { readWithAccount } from "./sources/account";
import { createDefaultAccountReader } from "./sources/userbot-mailbox";
import { createInspirationFetch, processTmeThrottle, readWebPreview, type TmeThrottle } from "./sources/web-preview";
import { storeReferencePosts } from "./store";

export type ReferenceReadIo = {
  fetch?: InspirationFetch;
  accountReader?: AccountHistoryReader | null;
  sleep?: (ms: number) => Promise<void>;
  /** Kevin, chantier C (par défaut : celle de `./kevin`). */
  afterRead?: (deps: AgentsDeps, referenceChannelId: string) => Promise<void>;
  /** Kevin, chantier C (par défaut : celle de `./kevin`). */
  afterReread?: (deps: AgentsDeps, referenceChannelId: string) => Promise<void>;
  /** Heure de la dernière requête vers t.me, partagée entre les lectures (défaut : mémoire du processus). */
  tmeThrottle?: TmeThrottle;
  /** Détenteur du verrou (défaut : jeton aléatoire, un par appel). */
  lockHolder?: string;
};

/** Raison d'un report (`retryInMs`) : autre lecture en cours, quota du jour, Telegram indisponible, verrou perdu. */
export type ReadRetryReason = "busy" | "quota" | "error" | "lock_lost";

export type ReferenceReadOutcome = {
  ok: boolean;
  message: string;
  /** Lecture à refaire plus tard (verrou pris, quota du jour atteint, Telegram indisponible) : délai conseillé. */
  retryInMs?: number;
  retryReason?: ReadRetryReason;
  via?: ReferenceViaName;
  status?: "READY" | "UNAVAILABLE" | "READING";
  created?: number;
  updated?: number;
};

export const INSPIRATION_LOCK_KEY = "inspiration.readLock";
export const INSPIRATION_READS_KEY = "inspiration.readsToday";
/** Un verrou plus vieux que 15 minutes est abandonné (lecture interrompue). */
export const INSPIRATION_LOCK_TTL_MS = 15 * 60_000;
/** Lecture interrompue (READING sans activité depuis 1 h) : reprise par le passage quotidien. */
export const INSPIRATION_STUCK_MS = 60 * 60_000;
export const INSPIRATION_REREAD_DAYS = 7;
/** Verrou pris : nouvel essai dans une minute ; Telegram indisponible : dans 10 minutes. */
const BUSY_RETRY_MS = 60_000;
const ERROR_RETRY_MS = 10 * 60_000;

const nowOf = (deps: Pick<AgentsDeps, "now">) => deps.now?.() ?? new Date();

/**
 * Suites de lecture de Kevin (chantier C) : par défaut `afterReferenceRead` / `afterReferenceReread` de `./kevin`
 * (import différé : Kevin importe déjà la lecture). `setReferenceReadHooks` permet de les remplacer (tests, outils).
 */
export type ReferenceReadHooks = {
  afterRead?: (deps: AgentsDeps, referenceChannelId: string) => Promise<void>;
  afterReread?: (deps: AgentsDeps, referenceChannelId: string) => Promise<void>;
  /** Lecture reportée (par défaut : `notifyReadPostponed` de `./kevin`). */
  onPostponed?: (deps: AgentsDeps, referenceChannelId: string, reason: string) => Promise<void>;
  /** Lecture abandonnée après les essais (par défaut : `notifyReadFailed` de `./kevin`). */
  onFailed?: (deps: AgentsDeps, referenceChannelId: string, reason: string) => Promise<void>;
};

let hooks: ReferenceReadHooks = {};

export function setReferenceReadHooks(next: ReferenceReadHooks): void {
  hooks = { ...hooks, ...next };
}

async function defaultAfterRead(deps: AgentsDeps, id: string): Promise<void> {
  if (hooks.afterRead) return hooks.afterRead(deps, id);
  const kevin = await import("./kevin");
  await kevin.afterReferenceRead(deps, id);
}

async function defaultAfterReread(deps: AgentsDeps, id: string): Promise<void> {
  if (hooks.afterReread) return hooks.afterReread(deps, id);
  const kevin = await import("./kevin");
  await kevin.afterReferenceReread(deps, id);
}

// ——— Verrou : une lecture à la fois ———

type LockValue = { holder: string; referenceChannelId?: string; until: string };

/** Le verrou n'est plus à cette tâche (abandonné puis repris par une autre) : la lecture s'arrête et sera refaite. */
export class ReadLockLost extends Error {
  constructor() {
    super("Verrou de lecture perdu : une autre lecture a pris la main.");
    this.name = "ReadLockLost";
  }
}

const lockValue = (deps: Pick<AgentsDeps, "now">, holder: string, referenceChannelId?: string): LockValue => ({
  holder,
  ...(referenceChannelId ? { referenceChannelId } : {}),
  until: new Date(nowOf(deps).getTime() + INSPIRATION_LOCK_TTL_MS).toISOString(),
});

/**
 * Pose le verrou (création atomique de la ligne) ; rend faux si une autre tâche le tient encore. Détenteur unique :
 * une autre tâche de la MÊME référence (relecture et lecture demandée en parallèle) attend aussi. Un verrou abandonné
 * (plus de 15 minutes sans renouvellement) est repris par une écriture conditionnelle (une seule tâche gagne).
 */
export async function acquireReadLock(deps: Pick<AgentsDeps, "prisma" | "now">, holder: string, referenceChannelId?: string): Promise<boolean> {
  const value = lockValue(deps, holder, referenceChannelId);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await deps.prisma.setting.create({ data: { key: INSPIRATION_LOCK_KEY, value } });
      return true;
    } catch {
      const cur = await deps.prisma.setting.findUnique({ where: { key: INSPIRATION_LOCK_KEY } });
      if (!cur) continue;
      const v = cur.value as Partial<LockValue> | null;
      if (v?.holder === holder) return renewReadLock(deps, holder);
      const until = v?.until ? Date.parse(v.until) : 0;
      if (Number.isFinite(until) && until >= nowOf(deps).getTime()) return false;
      const r = await deps.prisma.setting.updateMany({ where: { key: INSPIRATION_LOCK_KEY, updatedAt: cur.updatedAt }, data: { value } });
      return r.count === 1;
    }
  }
  return false;
}

/** Prolonge le verrou de 15 minutes, seulement pour son détenteur ; faux si le verrou n'est plus à lui. */
export async function renewReadLock(deps: Pick<AgentsDeps, "prisma" | "now">, holder: string): Promise<boolean> {
  const cur = await deps.prisma.setting.findUnique({ where: { key: INSPIRATION_LOCK_KEY } });
  const v = cur?.value as Partial<LockValue> | null | undefined;
  if (!cur || v?.holder !== holder) return false;
  const r = await deps.prisma.setting.updateMany({
    where: { key: INSPIRATION_LOCK_KEY, updatedAt: cur.updatedAt },
    data: { value: lockValue(deps, holder, v.referenceChannelId) },
  });
  return r.count === 1;
}

export async function releaseReadLock(deps: Pick<AgentsDeps, "prisma">, holder: string): Promise<void> {
  const cur = await deps.prisma.setting.findUnique({ where: { key: INSPIRATION_LOCK_KEY } });
  if (cur && (cur.value as Partial<LockValue> | null)?.holder === holder)
    await deps.prisma.setting.deleteMany({ where: { key: INSPIRATION_LOCK_KEY, updatedAt: cur.updatedAt } });
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Entrées des lecteurs qui gardent le verrou vivant : renouvelé à chaque page / lot, avant et après chaque attente. */
function lockedIo(deps: Pick<AgentsDeps, "prisma" | "now">, holder: string, io: ReferenceReadIo) {
  const keep = async () => {
    if (!(await renewReadLock(deps, holder))) throw new ReadLockLost();
  };
  const base = io.sleep ?? defaultSleep;
  return {
    keep,
    sleep: async (ms: number) => {
      await keep();
      await base(ms);
      await keep();
    },
  };
}

// ——— Quota : 5 lectures par jour de Paris ———

type ReadsToday = { day: string; ids: string[] };

async function readsToday(deps: Pick<AgentsDeps, "prisma">, day: string): Promise<ReadsToday> {
  const row = await deps.prisma.setting.findUnique({ where: { key: INSPIRATION_READS_KEY } });
  const v = row?.value as Partial<ReadsToday> | null | undefined;
  return v?.day === day && Array.isArray(v.ids) ? { day, ids: v.ids.filter((x): x is string => typeof x === "string") } : { day, ids: [] };
}

/** Lectures déjà faites aujourd'hui (jour de Paris). */
export async function readsUsedToday(deps: Pick<AgentsDeps, "prisma" | "now">): Promise<number> {
  return (await readsToday(deps, parisDay(nowOf(deps)))).ids.length;
}

/**
 * Compte une lecture dans le quota du jour. Une reprise (`resume`) d'une référence déjà comptée aujourd'hui ne compte
 * pas deux fois. Rend faux si le quota est atteint.
 */
async function takeQuota(deps: Pick<AgentsDeps, "prisma" | "now">, id: string, resume: boolean): Promise<boolean> {
  const day = parisDay(nowOf(deps));
  const cur = await readsToday(deps, day);
  if (resume && cur.ids.includes(id)) return true;
  if (cur.ids.length >= INSPIRATION_LIMITS.maxReadsPerDay) return false;
  const value = { day, ids: [...cur.ids, id] };
  await deps.prisma.setting.upsert({ where: { key: INSPIRATION_READS_KEY }, create: { key: INSPIRATION_READS_KEY, value }, update: { value } });
  return true;
}

function msToNextParisDay(now: Date): number {
  return Math.max(60_000, parisDayStart(addDaysToDay(parisDay(now), 1)).getTime() - now.getTime() + 5 * 60_000);
}

// ——— Lecture ———

type RefRow = {
  id: string;
  username: string | null;
  telegramChatId: bigint | null;
  via: ReferenceViaName;
  status: "READING" | "READY" | "UNAVAILABLE";
  removedAt: Date | null;
  accountId: string | null;
};

const REF_SELECT = { id: true, username: true, telegramChatId: true, via: true, status: true, removedAt: true, accountId: true } as const;

type ReadAttempt =
  | { kind: "read"; via: "WEB" | "ACCOUNT"; result: Extract<ReferenceReadResult, { ok: true }>; accountId?: string }
  | { kind: "unavailable"; message: string }
  | { kind: "retry"; message: string };

/** Choisit la voie et lit (aperçu web d'abord, puis compte réel membre). */
async function attemptRead(
  deps: AgentsDeps,
  ref: RefRow,
  io: ReferenceReadIo,
  opts: { maxPosts?: number; sinceId?: number },
  lock: ReturnType<typeof lockedIo>,
): Promise<ReadAttempt> {
  const now = nowOf(deps);
  const messages: string[] = [];
  const paced = { sleep: lock.sleep };
  if (ref.username) {
    const web = await readWebPreview(io.fetch ?? createInspirationFetch(), ref.username, {
      now,
      ...paced,
      ...opts,
      throttle: io.tmeThrottle ?? processTmeThrottle,
      onPage: lock.keep,
    });
    if (web.ok) return { kind: "read", via: "WEB", result: web };
    if (web.reason === "error" || web.reason === "rate_limited") return { kind: "retry", message: web.message };
    messages.push(web.message);
  }
  const reader = io.accountReader === undefined ? await createDefaultAccountReader(deps.prisma, { now: () => nowOf(deps) }) : io.accountReader;
  if (reader) {
    const acc = await readWithAccount(
      reader,
      { username: ref.username, chatId: ref.telegramChatId },
      { now, ...paced, ...opts, onBatch: lock.keep, ...(ref.accountId ? { accountId: ref.accountId } : {}) },
    );
    if (acc.ok) return { kind: "read", via: "ACCOUNT", result: acc, ...(acc.accountId ? { accountId: acc.accountId } : {}) };
    if (acc.reason === "error" || acc.reason === "rate_limited") return { kind: "retry", message: acc.message };
    // Compte imposé plus libre : un autre compte membre peut lire.
    if (ref.accountId && acc.reason === "no_account") {
      const again = await readWithAccount(reader, { username: ref.username, chatId: ref.telegramChatId }, { now, ...paced, ...opts, onBatch: lock.keep });
      if (again.ok) return { kind: "read", via: "ACCOUNT", result: again, ...(again.accountId ? { accountId: again.accountId } : {}) };
    }
    messages.push(acc.message);
  }
  return { kind: "unavailable", message: messages.join(" ") || "Je ne peux pas lire ce canal : transfère-moi 10 à 30 de ses posts." };
}

/**
 * Lit une référence (voie choisie), range les posts, puis prévient Kevin. Une seule à la fois, 5 par jour au plus ;
 * `retryInMs` indique quand réessayer (le worker ré-enfile).
 */
export async function runReferenceRead(deps: AgentsDeps, referenceChannelId: string, io: ReferenceReadIo = {}): Promise<ReferenceReadOutcome> {
  const ref = (await deps.prisma.referenceChannel.findUnique({ where: { id: referenceChannelId }, select: REF_SELECT })) as RefRow | null;
  if (!ref || ref.removedAt) return { ok: false, message: "Référence introuvable ou retirée." };
  if (ref.via === "FORWARDED" && !ref.username) return { ok: true, message: "Posts transférés : rien à lire.", via: "FORWARDED", status: ref.status };
  const holder = io.lockHolder ?? randomUUID();
  if (!(await acquireReadLock(deps, holder, referenceChannelId)))
    return { ok: false, message: "Une autre lecture est en cours.", retryInMs: BUSY_RETRY_MS, retryReason: "busy" };
  const lock = lockedIo(deps, holder, io);
  let outcome: ReferenceReadOutcome;
  try {
    const resume = ref.status === "READING";
    if (!(await takeQuota(deps, referenceChannelId, resume)))
      return { ok: false, message: "Déjà 5 lectures aujourd'hui : je lis celle-ci demain.", retryInMs: msToNextParisDay(nowOf(deps)), retryReason: "quota" };
    if (ref.status !== "READING") await deps.prisma.referenceChannel.update({ where: { id: ref.id }, data: { status: "READING" } });
    let attempt: ReadAttempt;
    try {
      attempt = await attemptRead(deps, ref, io, {}, lock);
    } catch (err) {
      if (err instanceof ReadLockLost) return { ok: false, message: err.message, retryInMs: BUSY_RETRY_MS, retryReason: "lock_lost", status: "READING" };
      throw err;
    }
    if (attempt.kind === "retry") return { ok: false, message: attempt.message, retryInMs: ERROR_RETRY_MS, retryReason: "error", status: "READING" };
    const now = nowOf(deps);
    if (attempt.kind === "unavailable") {
      await deps.prisma.referenceChannel.update({
        where: { id: ref.id },
        data: { status: "UNAVAILABLE", unavailableReason: attempt.message.slice(0, 500), lastReadAt: now, nextReadAt: null },
      });
      outcome = { ok: false, message: attempt.message, status: "UNAVAILABLE" };
    } else {
      // Dernier contrôle avant d'écrire : le verrou est toujours à cette tâche.
      await lock.keep();
      const r = attempt.result;
      const stored = await storeReferencePosts(deps, ref.id, r.posts, attempt.via, { title: r.title, username: r.username, chatId: r.chatId });
      await deps.prisma.referenceChannel.update({
        where: { id: ref.id },
        data: {
          via: attempt.via,
          nextReadAt: new Date(now.getTime() + INSPIRATION_REREAD_DAYS * 86_400_000),
          ...(attempt.accountId ? { accountId: attempt.accountId } : {}),
        },
      });
      outcome = {
        ok: true,
        message: `${r.posts.length} posts lus${"partial" in r && r.partial ? " (lecture arrêtée par Telegram)" : ""}.`,
        via: attempt.via,
        status: "READY",
        created: stored.created,
        updated: stored.updated,
      };
    }
  } catch (err) {
    if (err instanceof ReadLockLost) return { ok: false, message: err.message, retryInMs: BUSY_RETRY_MS, retryReason: "lock_lost", status: "READING" };
    throw err;
  } finally {
    await releaseReadLock(deps, holder);
  }
  try {
    await (io.afterRead ?? defaultAfterRead)(deps, referenceChannelId);
  } catch (err) {
    deps.logger?.error({ referenceChannelId, err: String((err as Error)?.message ?? err) }, "[inspiration] suite de la lecture en échec");
  }
  return outcome;
}

// ——— Lecture reportée ou abandonnée : Kevin prévient ———

export const INSPIRATION_POSTPONED_KEY = "inspiration.postponedNotified";

/**
 * Lecture reportée (quota du jour, autre lecture en cours, Telegram indisponible) : Kevin prévient (`notifyReadPostponed`
 * de `./kevin`), une seule fois par référence et par jour de Paris (`Setting inspiration.postponedNotified`). Rend vrai
 * si le crochet a été appelé. Ne lève jamais.
 */
export async function reportReadPostponed(deps: AgentsDeps, referenceChannelId: string, reason: string): Promise<boolean> {
  try {
    const day = parisDay(nowOf(deps));
    const row = await deps.prisma.setting.findUnique({ where: { key: INSPIRATION_POSTPONED_KEY } });
    const v = row?.value as { day?: string; ids?: unknown } | null | undefined;
    const ids = v?.day === day && Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === "string") : [];
    if (ids.includes(referenceChannelId)) return false;
    const value = { day, ids: [...ids, referenceChannelId] };
    await deps.prisma.setting.upsert({ where: { key: INSPIRATION_POSTPONED_KEY }, create: { key: INSPIRATION_POSTPONED_KEY, value }, update: { value } });
    if (hooks.onPostponed) await hooks.onPostponed(deps, referenceChannelId, reason);
    else await (await import("./kevin")).notifyReadPostponed(deps, referenceChannelId, reason);
    return true;
  } catch (err) {
    deps.logger?.error({ referenceChannelId, err: String((err as Error)?.message ?? err) }, "[inspiration] report non signalé");
    return false;
  }
}

/** Lecture abandonnée après tous les essais : Kevin prévient (`notifyReadFailed` de `./kevin`). Ne lève jamais. */
export async function reportReadFailed(deps: AgentsDeps, referenceChannelId: string, reason: string): Promise<void> {
  try {
    if (hooks.onFailed) await hooks.onFailed(deps, referenceChannelId, reason);
    else await (await import("./kevin")).notifyReadFailed(deps, referenceChannelId, reason);
  } catch (err) {
    deps.logger?.error({ referenceChannelId, err: String((err as Error)?.message ?? err) }, "[inspiration] échec non signalé");
  }
}

export type RereadSummary = { reread: number; resumed: number; skipped: number; stoppedBy: "lock" | "quota" | null };

/**
 * Passage quotidien : références vivantes (READY, non retirées, lues par l'aperçu ou un compte) dont la relecture est
 * due → 50 nouveaux posts au plus (plus récents que le dernier connu), relecture suivante dans 7 jours, puis
 * `afterReferenceReread` (Kevin décide s'il faut dire quelque chose). Les lectures interrompues sont ré-enfilées.
 */
export async function runWeeklyRereads(deps: AgentsDeps, io: ReferenceReadIo = {}): Promise<RereadSummary> {
  const now = nowOf(deps);
  const summary: RereadSummary = { reread: 0, resumed: 0, skipped: 0, stoppedBy: null };
  const stuck = await deps.prisma.referenceChannel.findMany({
    where: { status: "READING", removedAt: null, updatedAt: { lt: new Date(now.getTime() - INSPIRATION_STUCK_MS) } },
    select: { id: true },
    take: 20,
  });
  for (const s of stuck) {
    await enqueueReferenceRead(deps, s.id);
    summary.resumed++;
  }
  const due = await deps.prisma.referenceChannel.findMany({
    where: { status: "READY", removedAt: null, via: { in: ["WEB", "ACCOUNT"] }, nextReadAt: { lte: now } },
    orderBy: { nextReadAt: "asc" },
    select: REF_SELECT,
    take: INSPIRATION_LIMITS.maxReadsPerDay,
  });
  for (const ref of due as RefRow[]) {
    const holder = io.lockHolder ?? randomUUID();
    if (!(await acquireReadLock(deps, holder, ref.id))) {
      summary.stoppedBy = "lock";
      break;
    }
    const lock = lockedIo(deps, holder, io);
    let reread = false;
    try {
      if (!(await takeQuota(deps, ref.id, false))) {
        summary.stoppedBy = "quota";
        break;
      }
      const last = await deps.prisma.referencePost.findFirst({
        where: { referenceChannelId: ref.id, externalId: { gt: 0 } },
        orderBy: { externalId: "desc" },
        select: { externalId: true },
      });
      let attempt: ReadAttempt;
      try {
        attempt = await attemptRead(deps, ref, io, { maxPosts: INSPIRATION_LIMITS.rereadMaxPosts, ...(last ? { sinceId: last.externalId } : {}) }, lock);
      } catch (err) {
        if (!(err instanceof ReadLockLost)) throw err;
        summary.stoppedBy = "lock";
        break;
      }
      const at = nowOf(deps);
      if (attempt.kind === "read") {
        await lock.keep();
        const r = attempt.result;
        await storeReferencePosts(deps, ref.id, r.posts, attempt.via, { title: r.title, username: r.username, chatId: r.chatId });
        await deps.prisma.referenceChannel.update({
          where: { id: ref.id },
          data: { via: attempt.via, nextReadAt: new Date(at.getTime() + INSPIRATION_REREAD_DAYS * 86_400_000), ...(attempt.accountId ? { accountId: attempt.accountId } : {}) },
        });
        summary.reread++;
        reread = true;
      } else {
        // Aperçu fermé ou Telegram indisponible : on garde ce qui est lu et on réessaie demain (jamais d'entrée en force).
        await deps.prisma.referenceChannel.update({
          where: { id: ref.id },
          data: { nextReadAt: new Date(at.getTime() + 86_400_000), unavailableReason: attempt.message.slice(0, 500) },
        });
        summary.skipped++;
      }
    } catch (err) {
      if (!(err instanceof ReadLockLost)) throw err;
      summary.stoppedBy = "lock";
      break;
    } finally {
      await releaseReadLock(deps, holder);
    }
    if (reread) {
      try {
        await (io.afterReread ?? defaultAfterReread)(deps, ref.id);
      } catch (err) {
        deps.logger?.error({ referenceChannelId: ref.id, err: String((err as Error)?.message ?? err) }, "[inspiration] suite de la relecture en échec");
      }
    }
  }
  return summary;
}

/** Identifiant de la tâche de lecture (« : » remplacé par la file). */
export function referenceReadJobId(referenceChannelId: string): string {
  return `inspiration-read:${referenceChannelId}`;
}

/**
 * Met une lecture en file (Kevin, chantier C ; site). Passe par la file du Grand Chef (`inspiration-read`), qui la
 * transmet aussitôt à la file `agents-algo` (même identifiant) : aucune dépendance à Redis ici.
 */
export async function enqueueReferenceRead(deps: Pick<AgentsDeps, "enqueue">, referenceChannelId: string, opts: { delayMs?: number } = {}): Promise<void> {
  await deps.enqueue.orchestrator(
    { type: "inspiration-read", referenceChannelId },
    { jobId: referenceReadJobId(referenceChannelId), ...(opts.delayMs ? { delayMs: opts.delayMs } : {}) },
  );
}
