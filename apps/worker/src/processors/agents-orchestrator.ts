import type { Job } from "bullmq";
import { bossDailyNudge, resumeMissions, runBench, runCycle, sendDailyReport, sweepHumanRequests, sweepValidations } from "@linkaffipro/agents";
import type { AgentsOrchestratorJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { processAdminVoice } from "../agents/admin-voice";
import { processBossText } from "../agents/boss-text";
import { workerAgentsDeps } from "../agents/deps";
import { logger } from "../logger";

/**
 * File `agents-orchestrator` (phase 19, Grand Chef, logique programmée sans IA) :
 * - `cycle` : toutes les 30 min et à la demande (plan du jour, reprise, validations sans réponse, demandes, rapport de 9 h) ;
 * - `resume` : toutes les 10 min, missions sans activité depuis 15 min ré-enfilées ;
 * - `human-requests` : toutes les 5 min, demandes au client (envoi de la suivante, rappel 24 h, expiration 7 jours),
 *   puis la relance quotidienne du Boss (phase 26, une par jour au plus, seulement si quelque chose bloque) ;
 * - `validations` : validations sans réponse (24 h : reportée + rappel ; 72 h : annulée) ;
 * - `report` : rapport du jour (forcé depuis le site) ;
 * - `bench` (phase 20) : banc d'essai vidéo, un passage court qui se ré-enfile toutes les 30 s (jamais d'attente ici) ;
 * - `admin-voice` (phase 20) : vocal de l'admin transcrit puis traité comme un message écrit ;
 * - `boss-text` (phase 26) : message de l'admin au Boss qui demande l'interprète IA (`../agents/boss-text.ts`).
 */
export async function processAgentsOrchestrator(job: Job<AgentsOrchestratorJob>): Promise<unknown> {
  const data = job.data as AgentsOrchestratorJob | undefined;
  const deps = workerAgentsDeps();
  switch (data?.type) {
    case "cycle":
      return runCycle(deps, data.teamKey ? { teamKey: data.teamKey } : {});
    case "resume":
      return resumeMissions(deps);
    case "human-requests": {
      const swept = await sweepHumanRequests(deps);
      // Phase 26 : relance quotidienne du Boss (une par jour au plus, seulement si quelque chose bloque ; ne lève jamais).
      return { ...swept, nudge: await bossDailyNudge(deps) };
    }
    case "validations":
      return sweepValidations(deps);
    case "report":
      return sendDailyReport(deps, { force: data.force === true });
    case "bench":
      return runBench(deps, data);
    case "admin-voice":
      return processAdminVoice(data);
    case "boss-text":
      return processBossText(data);
    default:
      logger.warn({ queue: "agents-orchestrator", id: job.id, type: (data as { type?: unknown } | undefined)?.type }, "type de tâche inconnu");
      return { ok: false, reason: "type de tâche inconnu" };
  }
}

export const repeatableAgentsOrchestrator: Repeatable[] = [
  { data: { type: "cycle" }, everyMs: 30 * 60_000, jobId: "agents-cycle" },
  { data: { type: "resume" }, everyMs: 10 * 60_000, jobId: "agents-resume" },
  { data: { type: "human-requests" }, everyMs: 5 * 60_000, jobId: "agents-human-requests" },
  { data: { type: "validations" }, everyMs: 15 * 60_000, jobId: "agents-validations" },
];
