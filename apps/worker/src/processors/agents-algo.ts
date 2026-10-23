import type { Job } from "bullmq";
import { runAlgoReportNow, runAlgoTick } from "@linkaffipro/agents";
import type { AgentsAlgoJob, AgentStepJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { processAgentStep } from "../agents/step";
import { workerAgentsDeps } from "../agents/deps";

/**
 * File `agents-algo` (phase 19, équipe Algorithme en phase 21) :
 * - `algo` `tick` toutes les heures : alertes de décrochage, puis la nuit (Posts → Horaires → Conversations) et le lundi
 *   (tests A/B, relecture des conversations, Synthèse et rapport « Ce qui marche ») quand ils sont dus ;
 * - `algo` `report-now` : tout recalculer et envoyer le rapport tout de suite ;
 * - `step` : une étape de mission (nom de la tâche = clé de l'agent ; aucune mission n'est créée pour cette équipe).
 */
export async function processAgentsAlgo(job: Job<AgentStepJob | AgentsAlgoJob>): Promise<unknown> {
  const data = job.data as AgentStepJob | AgentsAlgoJob | undefined;
  if (data?.type === "algo") {
    if (data.task === "report-now") return runAlgoReportNow(workerAgentsDeps(), { send: data.send !== false });
    return runAlgoTick(workerAgentsDeps());
  }
  return processAgentStep("agents-algo", job as Job<AgentStepJob>);
}

export const repeatableAgentsAlgo: Repeatable[] = [{ data: { type: "algo", task: "tick" }, everyMs: 3_600_000, jobId: "agents-algo-tick" }];
