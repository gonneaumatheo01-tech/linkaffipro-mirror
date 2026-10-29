import type { Job } from "bullmq";
import { runAlgoReportNow, runAlgoTick, runQaAlerts, runQaSweep } from "@linkaffipro/agents";
import type { AgentsAlgoJob, AgentsQaJob, AgentStepJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { processAgentStep } from "../agents/step";
import { workerAgentsDeps } from "../agents/deps";

/**
 * File `agents-algo` (phase 19, équipe Algorithme en phase 21) :
 * - `algo` `tick` toutes les heures : alertes de décrochage, puis la nuit (Posts → Horaires → Conversations) et le lundi
 *   (tests A/B, relecture des conversations, Synthèse et rapport « Ce qui marche ») quand ils sont dus ;
 * - `algo` `report-now` : tout recalculer et envoyer le rapport tout de suite ;
 * - `step` : une étape de mission (nom de la tâche = clé de l'agent ; aucune mission n'est créée pour cette équipe) ;
 * - `qa-sweep` (phase 30, 5 min) : recommandations sans approbation du QA Global vérifiées, alertes retenues ;
 * - `qa-alerts` (phase 30, 5 min) : alertes internes du QA Global envoyées par Kevin.
 */
export async function processAgentsAlgo(job: Job<AgentStepJob | AgentsAlgoJob | AgentsQaJob>): Promise<unknown> {
  const data = job.data as AgentStepJob | AgentsAlgoJob | AgentsQaJob | undefined;
  // Phase 30 : rattrapage et alertes internes du QA Global.
  if (data?.type === "qa-sweep") return runQaSweep(workerAgentsDeps());
  if (data?.type === "qa-alerts") return runQaAlerts(workerAgentsDeps());
  if (data?.type === "algo") {
    if (data.task === "report-now") return runAlgoReportNow(workerAgentsDeps(), { send: data.send !== false });
    return runAlgoTick(workerAgentsDeps());
  }
  // Anciennes tâches du canal d'inspiration (retiré le 28 octobre 2026) restées en file : ignorées.
  if ((data as { type?: string } | undefined)?.type?.startsWith("inspiration-")) return { skipped: "inspiration retirée" };
  return processAgentStep("agents-algo", job as Job<AgentStepJob>);
}

export const repeatableAgentsAlgo: Repeatable[] = [
  { data: { type: "algo", task: "tick" }, everyMs: 3_600_000, jobId: "agents-algo-tick" },
  { data: { type: "qa-sweep" }, everyMs: 5 * 60_000, jobId: "agents-algo-qa-sweep" },
  { data: { type: "qa-alerts" }, everyMs: 5 * 60_000, jobId: "agents-algo-qa-alerts" },
];
