import type { Job } from "bullmq";
import type { AgentStepJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { processAgentStep } from "../agents/step";

/** File `agents-casino` (phase 19) : une étape de mission de l'équipe ; nom de la tâche = clé de l'agent. */
export async function processAgentsCasino(job: Job<AgentStepJob>): Promise<unknown> {
  return processAgentStep("agents-casino", job);
}

export const repeatableAgentsCasino: Repeatable[] = [];
