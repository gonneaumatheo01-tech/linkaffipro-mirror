import type { Job } from "bullmq";
import { runAlgoReportNow, runAlgoTick, runReferenceRead, runWeeklyRereads } from "@linkaffipro/agents";
import { addIdempotent, getQueue, safeJobId, type AgentsAlgoJob, type AgentsInspirationJob, type AgentsQueueLike, type AgentStepJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { processAgentStep } from "../agents/step";
import { workerAgentsDeps } from "../agents/deps";
import { logger } from "../logger";

/** Nouveaux essais différés d'une lecture (verrou pris, quota du jour, Telegram indisponible) au plus. */
export const INSPIRATION_MAX_ATTEMPTS = 8;

/** Met une lecture de canal de référence dans `agents-algo` (identifiant `inspiration-read:<id>`, `:r<n>` pour un nouvel essai). */
export async function enqueueInspirationRead(referenceChannelId: string, opts: { attempt?: number; delayMs?: number } = {}): Promise<boolean> {
  const attempt = opts.attempt ?? 0;
  const id = safeJobId(`inspiration-read:${referenceChannelId}${attempt ? `:r${attempt}` : ""}`)!;
  const q = getQueue("agents-algo") as unknown as AgentsQueueLike;
  const job: AgentsInspirationJob = { type: "inspiration-read", referenceChannelId, ...(attempt ? { attempt } : {}) };
  return addIdempotent(q, "inspiration-read", job, id, opts.delayMs);
}

/** Lecture d'un canal de référence ; nouvel essai différé si la lecture le demande (`retryInMs`). */
export async function processInspirationRead(data: Extract<AgentsInspirationJob, { type: "inspiration-read" }>): Promise<unknown> {
  const out = await runReferenceRead(workerAgentsDeps(), data.referenceChannelId);
  if (out.retryInMs) {
    const attempt = (data.attempt ?? 0) + 1;
    if (attempt <= INSPIRATION_MAX_ATTEMPTS) await enqueueInspirationRead(data.referenceChannelId, { attempt, delayMs: out.retryInMs });
    else logger.warn({ referenceChannelId: data.referenceChannelId, message: out.message }, "[inspiration] lecture abandonnée après plusieurs essais");
  }
  return out;
}

/**
 * File `agents-algo` (phase 19, équipe Algorithme en phase 21) :
 * - `algo` `tick` toutes les heures : alertes de décrochage, puis la nuit (Posts → Horaires → Conversations) et le lundi
 *   (tests A/B, relecture des conversations, Synthèse et rapport « Ce qui marche ») quand ils sont dus ;
 * - `algo` `report-now` : tout recalculer et envoyer le rapport tout de suite ;
 * - `inspiration-read` (phase 27) : lecture d'un canal de référence (aperçu web, compte réel membre), une à la fois ;
 * - `inspiration-reread` (phase 27, chaque jour) : relecture hebdomadaire des références vivantes ;
 * - `step` : une étape de mission (nom de la tâche = clé de l'agent ; aucune mission n'est créée pour cette équipe).
 */
export async function processAgentsAlgo(job: Job<AgentStepJob | AgentsAlgoJob | AgentsInspirationJob>): Promise<unknown> {
  const data = job.data as AgentStepJob | AgentsAlgoJob | AgentsInspirationJob | undefined;
  if (data?.type === "algo") {
    if (data.task === "report-now") return runAlgoReportNow(workerAgentsDeps(), { send: data.send !== false });
    return runAlgoTick(workerAgentsDeps());
  }
  if (data?.type === "inspiration-read") return processInspirationRead(data);
  if (data?.type === "inspiration-reread") return runWeeklyRereads(workerAgentsDeps());
  return processAgentStep("agents-algo", job as Job<AgentStepJob>);
}

export const repeatableAgentsAlgo: Repeatable[] = [
  { data: { type: "algo", task: "tick" }, everyMs: 3_600_000, jobId: "agents-algo-tick" },
  { data: { type: "inspiration-reread" }, everyMs: 24 * 3_600_000, jobId: "agents-algo-inspiration-reread" },
];
