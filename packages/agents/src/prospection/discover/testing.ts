/**
 * Phase 31, chantier A : outils des tests du Sourceur (aucun réseau). Faux `deps.web` servi depuis
 * `packages/agents/fixtures/prospection`, horloge et attente simulées, faux prisma. Jamais importé par la production.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { memoryHostThrottle } from "../../analysts/watch/polite";
import { createFakePrisma, type FakePrisma } from "../../testing/fake-prisma";
import type { AgentsEnqueue } from "../../types";
import type { ProspectionEnqueue, ProspectionQueueJob, ProspectionWeb } from "../contract";
import type { PoliteProspectDeps } from "./polite";

export const PROSPECTION_FIXTURES_DIR = join(import.meta.dirname, "..", "..", "..", "fixtures", "prospection");
/** 27 octobre 2026, 3 h à Paris (nuit de découverte). */
export const DISCOVER_NOW = new Date("2026-10-27T02:00:00Z");

export function readProspectionFixture(path: string): string {
  return readFileSync(join(PROSPECTION_FIXTURES_DIR, path), "utf8");
}

export type FakeRoute = { status?: number; body: string } | ((url: string) => { status?: number; body: string });

/** Faux web : adresse exacte → réponse, sinon 404 ; garde chaque lecture avec l'heure simulée. */
export function fakeProspectWeb(
  routes: Record<string, FakeRoute>,
  clock: () => number,
  search: (query: string) => Array<{ url: string; title: string; snippet: string }> = () => [],
): ProspectionWeb & { fetches: Array<{ url: string; at: number }>; searches: string[] } {
  const fetches: Array<{ url: string; at: number }> = [];
  const searches: string[] = [];
  return {
    fetches,
    searches,
    async fetchText(url) {
      fetches.push({ url, at: clock() });
      const r = routes[url];
      const v = typeof r === "function" ? r(url) : r;
      if (!v) return { status: 404, body: "not found", finalUrl: url };
      return { status: v.status ?? 200, body: v.body, finalUrl: url };
    },
    async search(req) {
      searches.push(req.query);
      return search(req.query);
    },
  };
}

export function fakeClock(start: Date = DISCOVER_NOW) {
  let t = start.getTime();
  return {
    clock: () => t,
    now: () => new Date(t),
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const agentsEnqueue: AgentsEnqueue = { async orchestrator() {}, async step() {} };

/** Dépendances complètes d'un test du Sourceur. */
export function discoverKit(opts: { routes?: Record<string, FakeRoute>; search?: (q: string) => Array<{ url: string; title: string; snippet: string }>; seed?: Record<string, Array<Record<string, unknown>>>; start?: Date } = {}) {
  const c = fakeClock(opts.start);
  const web = fakeProspectWeb(opts.routes ?? {}, c.clock, opts.search);
  const prisma: FakePrisma = createFakePrisma(opts.seed ?? {});
  const jobs: Array<{ job: ProspectionQueueJob; opts?: { jobId?: string; priority?: number } }> = [];
  const enqueue: ProspectionEnqueue = async (job, o) => {
    jobs.push({ job, ...(o ? { opts: o } : {}) });
  };
  const deps: PoliteProspectDeps = {
    prisma,
    enqueue: agentsEnqueue,
    now: c.now,
    clock: c.clock,
    sleep: c.sleep,
    web,
    prospection: { enqueue },
    throttle: memoryHostThrottle(),
    robotsCache: new Map(),
  };
  return {
    c,
    web,
    prisma,
    jobs,
    deps,
    prospects: () => prisma._tables.prospect ?? [],
    events: () => prisma._tables.prospectEvent ?? [],
    runs: () => prisma._tables.prospectSourceRun ?? [],
    setting: (key: string) => (prisma._tables.setting ?? []).find((s) => s.key === key)?.value,
  };
}
