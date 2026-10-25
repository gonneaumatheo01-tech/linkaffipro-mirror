/**
 * Phase 35, chantier C : dépendances du lecteur des bookmakers. Tout ce qui touche au réseau, au verrou et au rythme
 * est INJECTÉ (`deps.bookmakers`) : le worker y branche le transport du chantier A (`pickTransport`, `withSiteLock`,
 * `paceSite`), l'apprentissage du chantier B (`learnSite`) et le message de Kevin du chantier D (`onBookmakerEvent`).
 * À défaut, des replis sûrs : verrou par site en mémoire, rythme humain en mémoire (horloge et attente injectables),
 * aucune lecture sans transport. Les tests passent un faux transport et une fausse IA ; aucun réseau.
 */
import { BOOKMAKER_LIMITS, type BookmakerTransport, type BookmakersApi, type PageDiagnosis, type ReadLevel, type SiteOdds } from "../contract";
import { parisParts } from "../../rules/time";
import { withSiteLock } from "../transport/lock";
import { paceSite } from "../transport/pace";
import type { AgentsDeps, LlmProvider } from "../../types";

/** Ligne `BookmakerSite` (lecture tolérante). */
export type ReadSite = {
  key: string;
  label: string;
  baseUrl: string | null;
  readTarget: string;
  isActive: boolean;
  status: string;
  providerHint?: string | null;
};

/** Événements remontés au chantier D (Kevin, santé) : jamais de secret, jamais de texte de page. */
export type BookmakerHookEvent =
  | { type: "double_read_failed"; siteKey: string; missionId: string | null; pickId: string | null; reason: string; captureAssetId: string | null; reads: SiteOdds[] }
  | { type: "needs_human"; siteKey: string; diagnosis: PageDiagnosis; gesture: string; missionId?: string | null }
  | { type: "switched_to_mac"; siteKey: string; diagnosis: PageDiagnosis }
  | { type: "relearn"; siteKey: string; ok: boolean; message: string }
  | { type: "read_failed"; siteKey: string; what: "events" | "markets" | "odds"; reason: string; level: ReadLevel | null };

export type SiteLock = <T>(siteKey: string, fn: () => Promise<T>) => Promise<T>;
export type SitePace = (siteKey: string, kind: "api" | "page") => Promise<void>;

export type BookmakerHooks = {
  /** Transport imposé (tests), ou choisi par site (worker : `pickTransport` du chantier A). */
  transport?: BookmakerTransport | null;
  pickTransport?: (deps: AgentsDeps, site: ReadSite) => Promise<BookmakerTransport | null> | BookmakerTransport | null;
  /** Un seul lecteur à la fois par site (chantier A ; repli : verrou en mémoire du processus). */
  withSiteLock?: SiteLock;
  /** Rythme humain (chantier A ; repli : rythme en mémoire). */
  paceSite?: SitePace;
  /** Ré-apprentissage (chantier B). */
  learnSite?: BookmakersApi["learnSite"];
  /** Bascule d'un site sur le Mac (chantier A) ; repli : `BookmakerSite.readTarget = "mac"`. */
  switchToMac?: (siteKey: string, reason: string) => Promise<void>;
  /** Message de Kevin (chantier D). */
  onBookmakerEvent?: (e: BookmakerHookEvent) => Promise<void> | void;
  /** IA (diagnostic : Sonnet ; image : Opus). Par défaut : `providers.llm` du contexte s'il n'est pas faux. */
  llm?: LlmProvider | null;
  /** Attente injectable (tests : aucune vraie attente). */
  sleep?: (ms: number) => Promise<void>;
  /** Lecture permise la nuit (ordre explicite). */
  force?: boolean;
};

export type BookmakerReadDeps = AgentsDeps & {
  bookmakers?: BookmakerHooks;
  /** Contexte d'agent : son IA sert si aucune n'est imposée. */
  providers?: { llm?: LlmProvider | null; odds?: unknown };
};

export class BookmakerReadError extends Error {
  readonly code: string;
  readonly diagnosis: PageDiagnosis | null;
  constructor(code: string, message: string, diagnosis: PageDiagnosis | null = null) {
    super(message);
    this.name = "BookmakerReadError";
    this.code = code;
    this.diagnosis = diagnosis;
  }
}

export const nowOfDeps = (deps: Pick<AgentsDeps, "now">): Date => (deps.now ? deps.now() : new Date());

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Nuit de Paris (1 h - 7 h) : aucune lecture sauf ordre (règle 2). Pur. */
export function isNightInParis(at: Date): boolean {
  const h = parisParts(at).hour;
  return h >= BOOKMAKER_LIMITS.nightStartHour && h < BOOKMAKER_LIMITS.nightEndHour;
}

export function assertDaytime(deps: BookmakerReadDeps, force?: boolean): void {
  if (force || deps.bookmakers?.force) return;
  if (isNightInParis(nowOfDeps(deps))) throw new BookmakerReadError("night", "aucune lecture la nuit (1 h - 7 h, heure de Paris) sauf ordre");
}

// --- Verrou par site (repli en mémoire) -------------------------------------------------------------------------
const memoryLocks = new Map<string, Promise<unknown>>();

export const memorySiteLock: SiteLock = async (siteKey, fn) => {
  const prev = memoryLocks.get(siteKey) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  memoryLocks.set(siteKey, chained);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (memoryLocks.get(siteKey) === chained) memoryLocks.delete(siteKey);
  }
};

// --- Rythme humain (repli en mémoire) ---------------------------------------------------------------------------
/** Écart minimal entre deux appels d'API vers un même site (≤ 60 par minute). */
export const API_MIN_DELAY_MS = 1000;

/**
 * Rythme d'un site (pur à l'horloge et à l'attente près) : une page toutes les 2 s au moins (5 s au plus : on ne
 * traîne pas), un appel d'API toutes les secondes, jamais plus de 60 requêtes sur 60 s glissantes.
 */
export function createMemoryPace(o: { now: () => Date; sleep: (ms: number) => Promise<void>; jitter?: () => number }): SitePace & { log: Array<{ siteKey: string; kind: string; at: number }> } {
  const last = new Map<string, number>();
  const windows = new Map<string, number[]>();
  const log: Array<{ siteKey: string; kind: string; at: number }> = [];
  const jitter = o.jitter ?? (() => 0);
  const pace = (async (siteKey: string, kind: "api" | "page") => {
    let t = o.now().getTime();
    const prev = last.get(siteKey);
    const span = BOOKMAKER_LIMITS.maxPageDelayMs - BOOKMAKER_LIMITS.minPageDelayMs;
    const min = kind === "page" ? BOOKMAKER_LIMITS.minPageDelayMs + Math.round(Math.max(0, Math.min(1, jitter())) * span) : API_MIN_DELAY_MS;
    if (prev !== undefined && t - prev < min) {
      await o.sleep(min - (t - prev));
      t = Math.max(o.now().getTime(), prev + min);
    }
    const w = (windows.get(siteKey) ?? []).filter((x) => t - x < 60_000);
    if (w.length >= BOOKMAKER_LIMITS.maxRequestsPerMinute) {
      const wait = 60_000 - (t - w[0]!);
      await o.sleep(wait);
      t = Math.max(o.now().getTime(), w[0]! + 60_000);
      w.shift();
    }
    w.push(t);
    windows.set(siteKey, w);
    last.set(siteKey, t);
    log.push({ siteKey, kind, at: t });
  }) as SitePace & { log: typeof log };
  pace.log = log;
  return pace;
}

let processPace: SitePace | null = null;

/** Verrou : imposé, sinon celui du chantier A (en base, réentrant), sinon en mémoire. */
export function lockOf(deps: BookmakerReadDeps): SiteLock {
  if (deps.bookmakers?.withSiteLock) return deps.bookmakers.withSiteLock;
  if (deps.prisma) return (siteKey, fn) => withSiteLock(deps, siteKey, fn);
  return memorySiteLock;
}

export function paceOf(deps: BookmakerReadDeps): SitePace {
  if (deps.bookmakers?.paceSite) return deps.bookmakers.paceSite;
  // Attente injectée (tests) : rythme en mémoire sur l'horloge des dépendances, sans vraie attente.
  if (deps.bookmakers?.sleep) return createMemoryPaceFor(deps);
  // Sinon le rythme du chantier A (état en base, partagé entre processus).
  if (deps.prisma) return async (siteKey, kind) => void (await paceSite(deps, siteKey, { kind: kind === "api" ? "request" : "page" }));
  return (processPace ??= createMemoryPace({ now: () => new Date(), sleep: realSleep }));
}

const paceByDeps = new WeakMap<object, SitePace>();
function createMemoryPaceFor(deps: BookmakerReadDeps): SitePace {
  const key = deps.bookmakers ?? deps;
  let p = paceByDeps.get(key);
  if (!p) {
    p = createMemoryPace({ now: () => nowOfDeps(deps), sleep: deps.bookmakers?.sleep ?? realSleep });
    paceByDeps.set(key, p);
  }
  return p;
}

/** IA du lecteur : imposée, sinon celle du contexte si elle est réelle (jamais le faux LLM de simulation). */
export function llmOf(deps: BookmakerReadDeps): LlmProvider | null {
  if (deps.bookmakers?.llm !== undefined) return deps.bookmakers.llm;
  const ctx = deps.providers?.llm as (LlmProvider & { fake?: boolean }) | null | undefined;
  return ctx && !ctx.fake ? ctx : null;
}

export async function emitHook(deps: BookmakerReadDeps, e: BookmakerHookEvent): Promise<void> {
  try {
    await deps.bookmakers?.onBookmakerEvent?.(e);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, type: e.type }, "[bookmakers] crochet en erreur");
  }
}

export async function loadSite(deps: Pick<AgentsDeps, "prisma">, siteKey: string): Promise<ReadSite | null> {
  const r = (await deps.prisma.bookmakerSite.findUnique({ where: { key: siteKey } })) as Record<string, unknown> | null;
  if (!r) return null;
  return {
    key: String(r.key),
    label: String(r.label ?? r.key),
    baseUrl: typeof r.baseUrl === "string" && r.baseUrl ? r.baseUrl : null,
    readTarget: typeof r.readTarget === "string" ? r.readTarget : "auto",
    isActive: r.isActive !== false,
    status: typeof r.status === "string" ? r.status : "NEW",
    providerHint: typeof r.providerHint === "string" ? r.providerHint : null,
  };
}

export async function transportOf(deps: BookmakerReadDeps, site: ReadSite): Promise<BookmakerTransport> {
  const h = deps.bookmakers;
  const t = h?.transport ?? (h?.pickTransport ? await h.pickTransport(deps, site) : null);
  if (!t) throw new BookmakerReadError("no_transport", `aucun moyen de lire ${site.label} ici (ni serveur ni Mac branché)`);
  return t;
}
