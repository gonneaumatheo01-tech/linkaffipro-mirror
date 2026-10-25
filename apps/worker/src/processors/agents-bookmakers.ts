import type { Job } from "bullmq";
import {
  bookmakerKevinHook,
  bookmakerTransportHooks,
  claimReadJob,
  createServerTransport,
  executeReadJob,
  HIGH_LEVEL_JOB_KINDS,
  loadSiteAccess,
  macHeartbeatFresh,
  purgeReadJobs,
  readMacHeartbeat,
  readReadJob,
  sweepReadJobs,
  type AgentsDeps,
  type ReadJobRow,
} from "@linkaffipro/agents";
import type { AgentsBookmakersJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { workerAgentsDeps } from "../agents/deps";
import { installBookmakers } from "../bookmakers/install";
import { logger } from "../logger";
import { repeatableBookmakersHealth, runBookmakersHealth } from "./bookmakers-health";

/** Sites lus en même temps au plus par passage (un seul lecteur par site, verrou en base). */
export const BOOKMAKERS_PARALLEL_SITES = 3;

let lastPurge = 0;

/** Dépendances du worker + branchements du lecteur (chantier C) : transport choisi par site, verrou, rythme. */
export function bookmakersDeps(base: AgentsDeps = workerAgentsDeps()): AgentsDeps {
  // Phase 35, chantier D : messages de Kevin sur les événements du lecteur (double lecture impossible, obstacle…).
  return { ...base, bookmakers: { ...bookmakerTransportHooks(base), onBookmakerEvent: bookmakerKevinHook(base) } } as AgentsDeps;
}

async function runJobs(deps: AgentsDeps, jobs: ReadJobRow[]): Promise<Record<string, number>> {
  const server = createServerTransport(deps);
  const out: Record<string, number> = {};
  const results = await Promise.all(
    jobs.map((j) => executeReadJob(deps, j, { server, baseUrlOf: async (k) => (await loadSiteAccess(deps, k))?.baseUrl ?? null })),
  );
  for (const r of results) out[r] = (out[r] ?? 0) + 1;
  return out;
}

/**
 * Passage : ménage (pris depuis 15 min → rendu une fois, puis abandonné), puis prise des travaux en attente :
 * « serveur » (toutes sortes) et travaux complets « mac » que le Mac n'a pas annoncés (le worker les orchestre et lit
 * par le Mac) ; un travail par site au plus.
 */
export async function bookmakersTick(deps: AgentsDeps): Promise<unknown> {
  const swept = await sweepReadJobs(deps);
  if (Date.now() - lastPurge > 6 * 3600_000) {
    lastPurge = Date.now();
    await purgeReadJobs(deps).catch(() => 0);
  }
  const hb = await readMacHeartbeat(deps);
  const macKinds = macHeartbeatFresh(hb, deps.now ? deps.now() : new Date()) ? (hb?.kinds ?? []) : [];
  const orchestrated = HIGH_LEVEL_JOB_KINDS.filter((k) => !macKinds.includes(k));
  const jobs: ReadJobRow[] = [];
  while (jobs.length < BOOKMAKERS_PARALLEL_SITES) {
    const excludeSites = jobs.map((j) => j.siteKey);
    const j = (await claimReadJob(deps, { target: "server", excludeSites })) ?? (orchestrated.length ? await claimReadJob(deps, { target: "mac", kinds: orchestrated, excludeSites }) : null);
    if (!j) break;
    jobs.push(j);
  }
  const ran = jobs.length ? await runJobs(deps, jobs) : {};
  return { swept, ran };
}

/** Un travail précis, tout de suite (déposé par `enqueueReadJob`) ; déjà pris ailleurs → rien. */
export async function bookmakersRun(deps: AgentsDeps, jobId: string): Promise<unknown> {
  const row = await readReadJob(deps, jobId);
  if (!row || row.status !== "PENDING") return { skipped: true };
  const j = await claimReadJob(deps, { target: row.target as "server" | "mac", id: jobId });
  if (!j) return { skipped: true };
  return runJobs(deps, [j]);
}

/**
 * File `agents-bookmakers` (phase 35) : lectures des bookmakers par le serveur (jamais de mise ; un seul lecteur à la
 * fois par site par le verrou en base) ; `tick` toutes les 15 s, `run` à la demande.
 */
export async function processAgentsBookmakers(job: Job<AgentsBookmakersJob>): Promise<unknown> {
  installBookmakers();
  const data = job.data as AgentsBookmakersJob | undefined;
  const deps = bookmakersDeps();
  if (data?.type === "tick") return bookmakersTick(deps);
  if (data?.type === "run") return bookmakersRun(deps, data.jobId);
  // Phase 35, chantier D : santé des bookmakers (30 min).
  if (data?.type === "bookmakers-health") return runBookmakersHealth({ force: data.force === true }, workerAgentsDeps());
  logger.warn({ queue: "agents-bookmakers", id: job.id, name: job.name }, "type de tâche inconnu");
  return { ok: false, reason: "type de tâche inconnu" };
}

export const repeatableAgentsBookmakers: Repeatable[] = [{ data: { type: "tick" }, everyMs: 15_000, jobId: "agents-bookmakers-tick" }, ...repeatableBookmakersHealth];
