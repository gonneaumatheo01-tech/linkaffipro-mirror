import type { Job } from "bullmq";
import type { AgentStepJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { processAgentStep } from "../agents/step";

/** File `agents-sports` (phase 19) : une étape de mission de l'équipe ; nom de la tâche = clé de l'agent. */
export async function processAgentsSports(job: Job<AgentStepJob>): Promise<unknown> {
  return processAgentStep("agents-sports", job);
}

export const repeatableAgentsSports: Repeatable[] = [];
