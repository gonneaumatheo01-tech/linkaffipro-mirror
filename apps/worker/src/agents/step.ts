/** Une étape de mission dans une file d'équipe (nom de la tâche = clé de l'agent). */
import type { Job } from "bullmq";
import { runNextStep } from "@linkaffipro/agents";
import type { AgentStepJob } from "@linkaffipro/queue";
import { logger } from "../logger";
import { workerAgentsDeps } from "./deps";

export async function processAgentStep(queue: string, job: Job<AgentStepJob>): Promise<unknown> {
  const data = job.data as AgentStepJob | undefined;
  if (data?.type !== "step" || typeof data.missionId !== "string" || !Number.isInteger(data.index)) {
    logger.warn({ queue, id: job.id, name: job.name }, "type de tâche inconnu");
    return { ok: false, reason: "type de tâche inconnu" };
  }
  const outcome = await runNextStep(workerAgentsDeps(), data.missionId, data.index);
  return { ok: true, outcome };
}
