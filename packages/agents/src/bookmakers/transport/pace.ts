/**
 * Phase 35 (règle 2) : rythme humain vers un site et nuit.
 * - `paceSite(deps, siteKey, { kind })` : une page toutes les 2 à 5 s (tirage au hasard), jamais plus de 60 requêtes
 *   (pages + appels d'API) sur 60 s glissantes ; état gardé en base (`Setting bookmakers.pace.<site>`) pour que deux
 *   processus (site, worker) partagent le même compteur ; en mémoire quand il n'y a pas de base (runner du Mac).
 * - `isParisNight(at)` : aucune lecture de 1 h à 7 h (Paris), sauf `force` (ordre de l'admin).
 * Horloge, attente et hasard injectables (tests sur horodatages, sans attendre).
 */
import type { AgentsPrisma } from "../../types";
import { parisParts } from "../../rules/time";
import { BOOKMAKER_LIMITS } from "../contract";

export const PACE_KEY_PREFIX = "bookmakers.pace.";
const WINDOW_MS = 60_000;

export type PaceKind = "page" | "request";
export type PaceClock = { now(): number; sleep(ms: number): Promise<void>; random(): number };
export const REAL_CLOCK: PaceClock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: () => Math.random() };

export type PaceState = { lastPageAt: number | null; stamps: number[] };

export type PaceStore = {
  load(siteKey: string): Promise<PaceState>;
  save(siteKey: string, s: PaceState): Promise<void>;
};

export function createMemoryPaceStore(): PaceStore {
  const m = new Map<string, PaceState>();
  return {
    load: async (k) => m.get(k) ?? { lastPageAt: null, stamps: [] },
    save: async (k, s) => {
      m.set(k, { lastPageAt: s.lastPageAt, stamps: [...s.stamps] });
    },
  };
}

function parseState(v: unknown): PaceState {
  const o = (v ?? {}) as { lastPageAt?: unknown; stamps?: unknown };
  return {
    lastPageAt: typeof o.lastPageAt === "number" && Number.isFinite(o.lastPageAt) ? o.lastPageAt : null,
    stamps: Array.isArray(o.stamps) ? o.stamps.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : [],
  };
}

export function createDbPaceStore(prisma: AgentsPrisma): PaceStore {
  return {
    async load(siteKey) {
      const row = await prisma.setting.findUnique({ where: { key: `${PACE_KEY_PREFIX}${siteKey}` } });
      return parseState(row?.value);
    },
    async save(siteKey, s) {
      const key = `${PACE_KEY_PREFIX}${siteKey}`;
      const value = { lastPageAt: s.lastPageAt, stamps: s.stamps } as never;
      await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    },
  };
}

/** Pur : attente nécessaire avant la prochaine requête (et délai tiré pour une page). */
export function paceWaitMs(state: PaceState, kind: PaceKind, now: number, random: number): number {
  let wait = 0;
  if (kind === "page" && state.lastPageAt !== null) {
    const span = BOOKMAKER_LIMITS.maxPageDelayMs - BOOKMAKER_LIMITS.minPageDelayMs;
    const delay = BOOKMAKER_LIMITS.minPageDelayMs + Math.floor(Math.min(Math.max(random, 0), 0.999999) * span);
    wait = Math.max(wait, state.lastPageAt + delay - now);
  }
  const recent = state.stamps.filter((t) => t > now - WINDOW_MS).sort((a, b) => a - b);
  const max = BOOKMAKER_LIMITS.maxRequestsPerMinute;
  if (recent.length >= max) {
    // La (n-59)-ième requête doit sortir de la fenêtre avant la suivante.
    wait = Math.max(wait, recent[recent.length - max]! + WINDOW_MS - now + 1);
  }
  return Math.max(0, Math.ceil(wait));
}

// Un seul passage à la fois par site dans ce processus (le verrou par site couvre les processus).
const chains = new Map<string, Promise<unknown>>();

export type PaceDeps = { prisma?: AgentsPrisma | null };
export type PaceOptions = { kind?: PaceKind; clock?: PaceClock; store?: PaceStore };

const memoryStore = createMemoryPaceStore();

/**
 * Attend le bon moment pour la prochaine page (ou requête) vers ce site, puis la compte. À appeler juste avant chaque
 * navigation, clic de lecture ou appel d'API. Renvoie l'attente faite (ms).
 */
export async function paceSite(deps: PaceDeps, siteKey: string, opts: PaceOptions = {}): Promise<number> {
  const clock = opts.clock ?? REAL_CLOCK;
  const store = opts.store ?? (deps.prisma ? createDbPaceStore(deps.prisma) : memoryStore);
  const kind = opts.kind ?? "page";
  const prev = chains.get(siteKey) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const state = await store.load(siteKey);
    const wait = paceWaitMs(state, kind, clock.now(), clock.random());
    if (wait > 0) await clock.sleep(wait);
    const at = clock.now();
    const stamps = [...state.stamps.filter((t) => t > at - WINDOW_MS), at].slice(-BOOKMAKER_LIMITS.maxRequestsPerMinute * 2);
    await store.save(siteKey, { lastPageAt: kind === "page" ? at : state.lastPageAt, stamps });
    return wait;
  });
  chains.set(siteKey, run);
  try {
    return await run;
  } finally {
    if (chains.get(siteKey) === run) chains.delete(siteKey);
  }
}

/** Pur : est-ce la nuit à Paris (1 h - 7 h) ? */
export function isParisNight(at: Date): boolean {
  const h = parisParts(at).hour;
  return h >= BOOKMAKER_LIMITS.nightStartHour && h < BOOKMAKER_LIMITS.nightEndHour;
}

/** Pur : une lecture est-elle permise maintenant ? (`force` : ordre de l'admin.) */
export function readAllowedAt(at: Date, force = false): boolean {
  return force || !isParisNight(at);
}
