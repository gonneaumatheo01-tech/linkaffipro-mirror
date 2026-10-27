import type { Job } from "bullmq";
import { loadProspectionWeb, PROSPECTION_LIMITS, runProspectionJob, type ProspectionKevinDeps, type ProspectionQueueJob } from "@linkaffipro/agents";
import { createProspectionEnqueue, type AgentsProspectionJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { logger } from "../logger";
import { workerAgentsDeps } from "../agents/deps";

const KNOWN = new Set([
  "prospection.schedule",
  "prospection.discover",
  "prospection.enrich",
  "prospection.score",
  "prospection.dossier",
  "prospection.daily-top",
  "prospection.reminders",
  "prospection.weekly-report",
  "prospection.requalify",
  // Phase 32.
  "prospection.requalify-one",
  "prospection.alerts-digest",
  "prospection.networks",
  "prospection.values",
  "prospection.learn-pull",
  "prospection.calibrate",
  "prospection.monthly-report",
  "prospection.link-reminders",
  "prospection.account-search",
]);

/** Tâches qui lisent le réseau (pages publiques t.me, annuaires, recherche web). */
const NETWORK_JOBS = new Set(["prospection.discover", "prospection.enrich", "prospection.requalify-one"]);

let enqueue: ReturnType<typeof createProspectionEnqueue> | null = null;

/**
 * Dépendances d'une tâche : celles des agents du worker (base, messager de Kevin = seul envoi possible, journal), la
 * mise en file `agents-prospection` et, pour la lecture, l'accès réseau réel (User-Agent honnête, corps plafonné,
 * recherche par les outils serveur de l'API Claude). Aucune méthode d'envoi vers un tiers.
 */
export async function workerProspectionDeps(job: ProspectionQueueJob): Promise<ProspectionKevinDeps> {
  const base = workerAgentsDeps() as unknown as ProspectionKevinDeps;
  enqueue ??= createProspectionEnqueue();
  const deps = { ...base, prospection: { enqueue } } as ProspectionKevinDeps;
  if (NETWORK_JOBS.has(job.type)) deps.web = await loadProspectionWeb(base);
  return deps;
}

/** Une tâche ne dépasse jamais 5 minutes : au-delà, elle échoue (BullMQ la reprend une fois, la base fait foi). */
export async function withProspectionTimeout<T>(run: Promise<T>, ms: number = PROSPECTION_LIMITS.jobTimeoutMs): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tâche de prospection trop longue (plus de ${Math.round(ms / 60_000)} min)`)), ms);
  });
  try {
    return await Promise.race([run, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * File `agents-prospection` (phase 31) : découverte, lecture, note, dossier des canaux Telegram publics d'affiliés,
 * Top du jour, rappels, rapport du lundi. Deux tâches à la fois, 5 minutes au plus chacune. `prospection.schedule`
 * toutes les 10 minutes (heure de Paris). `prospection.enabled = false` : rien ne tourne. L'équipe ne contacte jamais
 * personne : seul Kevin écrit, à l'admin ou au groupe de l'équipe.
 */
export async function processAgentsProspection(
  job: Job<AgentsProspectionJob>,
  depsFor: (job: ProspectionQueueJob) => Promise<ProspectionKevinDeps> = workerProspectionDeps,
  timeoutMs: number = PROSPECTION_LIMITS.jobTimeoutMs,
): Promise<unknown> {
  const data = job.data as ProspectionQueueJob | undefined;
  if (!data || !KNOWN.has(data.type)) {
    logger.warn({ queue: "agents-prospection", id: job.id, name: job.name }, "type de tâche inconnu");
    return { ok: false, reason: "type de tâche inconnu" };
  }
  return withProspectionTimeout(runProspectionJob(await depsFor(data), data), timeoutMs);
}

export const repeatableAgentsProspection: Repeatable[] = [{ data: { type: "prospection.schedule" }, everyMs: 10 * 60_000, jobId: "agents-prospection-schedule" }];
