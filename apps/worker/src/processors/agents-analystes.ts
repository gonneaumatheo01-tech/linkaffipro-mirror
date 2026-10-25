import type { Job } from "bullmq";
import { loadWatchDeps, runAnalystsJob, type AnalystsKevinDeps, type AnalystsQueueJob } from "@linkaffipro/agents";
import { createAnalystsEnqueue, type AgentsAnalystesJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { logger } from "../logger";
import { workerAgentsDeps } from "../agents/deps";

const KNOWN = new Set([
  "analysts.schedule",
  "analysts.scrape",
  "analysts.compliance_check",
  "analysts.strategy",
  "analysts.report",
  "analysts.discover",
  "analysts.reverify",
  "analysts.purge",
]);

/** Tâches de la veille (lecture des sources, découverte) : IA Haiku / Sonnet de la veille. */
const WATCH_JOBS = new Set(["analysts.scrape", "analysts.discover"]);

let enqueue: ReturnType<typeof createAnalystsEnqueue> | null = null;

/**
 * Dépendances d'une tâche : celles des agents du worker (base, messager de Kevin, journal), la mise en file
 * `agents-analystes`, l'accès web poli (débit par source, robots.txt) et, pour la veille, son IA. Les tâches de la
 * Compliance, du Stratège et du Rapporteur laissent le chantier B construire son IA (Opus, délai de 180 s).
 */
export async function workerAnalystsDeps(job: AnalystsQueueJob): Promise<AnalystsKevinDeps> {
  const base = workerAgentsDeps() as unknown as AnalystsKevinDeps;
  const watch = await loadWatchDeps(base);
  enqueue ??= createAnalystsEnqueue();
  const deps = { ...watch, analysts: { enqueue } } as AnalystsKevinDeps;
  if (!WATCH_JOBS.has(job.type)) delete (deps as { analystsLlm?: unknown }).analystsLlm;
  return deps;
}

/**
 * File `agents-analystes` (phase 29) : veille du marché, règles des plateformes pub, stratégie et rapports. Deux tâches
 * à la fois (lecture réseau, peu de calcul). `analysts.schedule` toutes les heures : sources dues, rapport de la semaine
 * (lundi 8 h Paris par défaut), découverte, revérification, purge, premier lancement. `analysts.enabled = false` :
 * rien ne tourne. L'équipe recommande seulement : rien n'est changé chez Meta / TikTok ni sur les canaux.
 */
export async function processAgentsAnalystes(
  job: Job<AgentsAnalystesJob>,
  depsFor: (job: AnalystsQueueJob) => Promise<AnalystsKevinDeps> = workerAnalystsDeps,
): Promise<unknown> {
  const data = job.data as AnalystsQueueJob | undefined;
  if (!data || !KNOWN.has(data.type)) {
    logger.warn({ queue: "agents-analystes", id: job.id, name: job.name }, "type de tâche inconnu");
    return { ok: false, reason: "type de tâche inconnu" };
  }
  return runAnalystsJob(await depsFor(data), data);
}

export const repeatableAgentsAnalystes: Repeatable[] = [{ data: { type: "analysts.schedule" }, everyMs: 3600_000, jobId: "agents-analystes-schedule" }];
