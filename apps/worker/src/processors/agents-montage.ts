import type { Job } from "bullmq";
import { MONTAGE_LIMITS, pollReplace, resumeStalledMontage, runMontageStep, submitReplace, sweepMontageWorkDir, type MontagePipelineDeps, type MontageQueueJob } from "@linkaffipro/agents";
import { JOB_RETRY_OPTIONS, type AgentsMontageJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { logger } from "../logger";
import { workerMontageDeps } from "../montage/deps";

const STEP_TYPES = new Set(["montage.analyze", "montage.cut", "montage.dress", "montage.qc", "montage.preview"]);

/**
 * File `agents-montage` (phase 28) : une tâche à la fois (ffmpeg est lourd en calcul). Étapes de la chaîne
 * (`runMontageStep` : la base fait foi, un short rangé n'est jamais refait) avec 3 essais BullMQ (attente croissante) :
 * l'essai en cours est transmis à la chaîne, qui marque l'échec au dernier et laisse Kevin prévenir. `video-ia.*` :
 * remplacement d'une personne par une persona dans une vidéo reçue par Kevin (`boss/video-ia-run.ts`). `sweep` (15 min) :
 * tâches perdues remises en file ; `cleanup` (chaque jour) : dossiers de travail orphelins de plus de 24 h.
 */
export async function processAgentsMontage(job: Job<AgentsMontageJob>, deps: MontagePipelineDeps = workerMontageDeps()): Promise<unknown> {
  const data = job.data as AgentsMontageJob | undefined;
  if (data && STEP_TYPES.has(data.type)) {
    const maxAttempts = job.opts?.attempts ?? JOB_RETRY_OPTIONS["agents-montage"].attempts;
    const attempt = (job.attemptsMade ?? 0) + 1;
    // Dernier essai permis par BullMQ = dernier essai pour la chaîne (échec marqué, Kevin prévient).
    return runMontageStep(deps, data as MontageQueueJob, { attempt: attempt >= maxAttempts ? MONTAGE_LIMITS.maxAttempts : attempt });
  }
  // Personne remplacée par une persona dans une vidéo envoyée à Kevin : soumission, puis relectures (même file).
  if (data?.type === "video-ia.submit") return submitReplace(deps, data.chatId);
  if (data?.type === "video-ia.poll") return pollReplace(deps, data.chatId);
  if (data?.type === "montage.sweep") return resumeStalledMontage(deps);
  if (data?.type === "montage.cleanup") {
    const r = await sweepMontageWorkDir(deps);
    return { removed: r.removed.length };
  }
  logger.warn({ queue: "agents-montage", id: job.id, name: job.name }, "type de tâche inconnu");
  return { ok: false, reason: "type de tâche inconnu" };
}

export const repeatableAgentsMontage: Repeatable[] = [
  { data: { type: "montage.sweep" }, everyMs: 15 * 60_000, jobId: "agents-montage-sweep" },
  { data: { type: "montage.cleanup" }, everyMs: 24 * 3600_000, jobId: "agents-montage-cleanup" },
];
