import type { Job } from "bullmq";
import type { AgentStepJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { processAgentStep } from "../agents/step";

/** File `agents-dating` (phase 19) : une étape de mission de l'équipe ; nom de la tâche = clé de l'agent. */
export async function processAgentsDating(job: Job<AgentStepJob>): Promise<unknown> {
  return processAgentStep("agents-dating", job);
}

export const repeatableAgentsDating: Repeatable[] = [];
