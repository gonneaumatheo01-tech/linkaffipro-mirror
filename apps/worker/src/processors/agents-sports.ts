import type { Job } from "bullmq";
import { runSportsSettle } from "@linkaffipro/agents";
import type { AgentsSportsJob, AgentStepJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { processAgentStep } from "../agents/step";
import { workerAgentsDeps } from "../agents/deps";

/**
 * File `agents-sports` (phase 19, équipe Paris sportifs en phase 23) :
 * - `step` : une étape de mission (nom de la tâche = clé de l'agent : cotes, capture, redaction, controle, publication) ;
 * - `sports` `settle` toutes les 2 h : résultats des paris publiés (gagné / perdu / remboursé), validations trop
 *   tardives annulées. Les passages du Chef Paris (10 h, 15 h, 18 h, 2 h avant les matchs) partent du Grand Chef.
 */
export async function processAgentsSports(job: Job<AgentStepJob | AgentsSportsJob>): Promise<unknown> {
  const data = job.data as AgentStepJob | AgentsSportsJob | undefined;
  if (data?.type === "sports") return runSportsSettle(workerAgentsDeps());
  return processAgentStep("agents-sports", job as Job<AgentStepJob>);
}

export const repeatableAgentsSports: Repeatable[] = [{ data: { type: "sports", task: "settle" }, everyMs: 2 * 3_600_000, jobId: "agents-sports-settle" }];
