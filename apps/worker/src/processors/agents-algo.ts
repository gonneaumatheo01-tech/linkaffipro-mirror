import type { Job } from "bullmq";
import type { AgentStepJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { processAgentStep } from "../agents/step";

/** File `agents-algo` (phase 19) : une étape de mission de l'équipe ; nom de la tâche = clé de l'agent. */
export async function processAgentsAlgo(job: Job<AgentStepJob>): Promise<unknown> {
  return processAgentStep("agents-algo", job);
}

export const repeatableAgentsAlgo: Repeatable[] = [];
