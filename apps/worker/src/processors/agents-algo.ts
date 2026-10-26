import type { Job } from "bullmq";
import {
  rehashReferenceShingles,
  reportReadFailed,
  reportReadPostponed,
  runAlgoReportNow,
  runAlgoTick,
  runQaAlerts,
  runQaSweep,
  runReferenceRead,
  runWeeklyRereads,
  type ReferenceReadIo,
} from "@linkaffipro/agents";
import { addIdempotent, getQueue, safeJobId, type AgentsAlgoJob, type AgentsInspirationJob, type AgentsQaJob, type AgentsQueueLike, type AgentStepJob } from "@linkaffipro/queue";
import type { Repeatable } from "./index";
import { processAgentStep } from "../agents/step";
import { workerAgentsDeps } from "../agents/deps";
import { createRedisTmeThrottle } from "../agents/tme-throttle";
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

/** Entrées de lecture du worker : rythme vers t.me partagé dans Redis. */
function inspirationIo(): ReferenceReadIo {
  return { tmeThrottle: createRedisTmeThrottle() };
}

/**
 * Lecture d'un canal de référence ; nouvel essai différé si la lecture le demande (`retryInMs`) et Kevin prévient du
 * report (une fois par référence et par jour) ; après 8 essais, abandon et Kevin prévient de l'échec.
 */
export async function processInspirationRead(data: Extract<AgentsInspirationJob, { type: "inspiration-read" }>): Promise<unknown> {
  const deps = workerAgentsDeps();
  const out = await runReferenceRead(deps, data.referenceChannelId, inspirationIo());
  if (out.retryInMs) {
    const attempt = (data.attempt ?? 0) + 1;
    if (attempt <= INSPIRATION_MAX_ATTEMPTS) {
      await enqueueInspirationRead(data.referenceChannelId, { attempt, delayMs: out.retryInMs });
      await reportReadPostponed(deps, data.referenceChannelId, out.message);
    } else {
      logger.warn({ referenceChannelId: data.referenceChannelId, message: out.message }, "[inspiration] lecture abandonnée après plusieurs essais");
      await reportReadFailed(deps, data.referenceChannelId, out.message);
    }
  }
  return out;
}

/** Recalcul unique des empreintes de copie (normalisation 2), au premier passage du processus ; ne bloque jamais. */
let shinglesChecked = false;
async function ensureShinglesV2(): Promise<void> {
  if (shinglesChecked) return;
  shinglesChecked = true;
  try {
    const r = await rehashReferenceShingles(workerAgentsDeps());
    if (r.done) logger.info({ rehashed: r.rehashed }, "[inspiration] empreintes de copie recalculées");
  } catch (err) {
    shinglesChecked = false;
    logger.error({ err: String((err as Error)?.message ?? err) }, "[inspiration] recalcul des empreintes en échec");
  }
}

/**
 * File `agents-algo` (phase 19, équipe Algorithme en phase 21) :
 * - `algo` `tick` toutes les heures : alertes de décrochage, puis la nuit (Posts → Horaires → Conversations) et le lundi
 *   (tests A/B, relecture des conversations, Synthèse et rapport « Ce qui marche ») quand ils sont dus ;
 * - `algo` `report-now` : tout recalculer et envoyer le rapport tout de suite ;
 * - `inspiration-read` (phase 27) : lecture d'un canal de référence (aperçu web, compte réel membre), une à la fois ;
 * - `inspiration-reread` (phase 27, chaque jour) : relecture hebdomadaire des références vivantes ;
 * - `step` : une étape de mission (nom de la tâche = clé de l'agent ; aucune mission n'est créée pour cette équipe) ;
 * - `qa-sweep` (phase 30, 5 min) : recommandations sans approbation du QA Global vérifiées, alertes retenues ;
 * - `qa-alerts` (phase 30, 5 min) : alertes internes du QA Global envoyées par Kevin.
 */
export async function processAgentsAlgo(job: Job<AgentStepJob | AgentsAlgoJob | AgentsInspirationJob | AgentsQaJob>): Promise<unknown> {
  const data = job.data as AgentStepJob | AgentsAlgoJob | AgentsInspirationJob | AgentsQaJob | undefined;
  // Phase 30 : rattrapage et alertes internes du QA Global (avant le recalcul des empreintes : sans lien).
  if (data?.type === "qa-sweep") return runQaSweep(workerAgentsDeps());
  if (data?.type === "qa-alerts") return runQaAlerts(workerAgentsDeps());
  await ensureShinglesV2();
  if (data?.type === "algo") {
    if (data.task === "report-now") return runAlgoReportNow(workerAgentsDeps(), { send: data.send !== false });
    return runAlgoTick(workerAgentsDeps());
  }
  if (data?.type === "inspiration-read") return processInspirationRead(data);
  if (data?.type === "inspiration-reread") return runWeeklyRereads(workerAgentsDeps(), inspirationIo());
  return processAgentStep("agents-algo", job as Job<AgentStepJob>);
}

export const repeatableAgentsAlgo: Repeatable[] = [
  { data: { type: "algo", task: "tick" }, everyMs: 3_600_000, jobId: "agents-algo-tick" },
  { data: { type: "inspiration-reread" }, everyMs: 24 * 3_600_000, jobId: "agents-algo-inspiration-reread" },
  { data: { type: "qa-sweep" }, everyMs: 5 * 60_000, jobId: "agents-algo-qa-sweep" },
  { data: { type: "qa-alerts" }, everyMs: 5 * 60_000, jobId: "agents-algo-qa-alerts" },
];
