/**
 * Moteur des Chefs d'équipe : exécute UNE étape d'une mission (tâche `<missionId>:<index>` de la file de l'équipe),
 * l'enregistre (`AgentRun`, `MissionStep`, coût, `lastActivityAt`, `Event` `agents.*` sans texte de post) et enfile la
 * suivante. Logique programmée, aucun appel d'IA ici.
 * - idempotent : une étape déjà terminée, ou un index qui n'est plus l'étape courante, est ignoré ;
 * - pause d'équipe ou pause générale : l'étape ne s'exécute pas, la mission attend (le balayage `resume` la relance) ;
 * - plafond vérifié avant toute étape payante (`BLOCKED_BUDGET`) ;
 * - une erreur : un nouvel essai immédiat, puis échec de la mission ; 3 missions échouées de suite → pause de l'équipe ;
 * - validation demandée → `requestValidation` (aperçu à l'admin) et arrêt jusqu'à la décision.
 */
import { agentEvent, nowOf } from "../admin/journal";
import { agentFor, PAID_PROVIDERS } from "../agents/registry";
import { buildContext, type EngineDeps } from "../missions/context";
import { json, parsePayload, toMission, type MissionRow } from "../missions/mission";
import { recordUsage } from "../missions/usage";
import { checkBudgets, maybeAlertBudget } from "../orchestrator/budgets";
import { isTeamHalted, recordMissionFailure, recordMissionSuccess } from "../orchestrator/pause";
import { TEAM_QUEUES, type AgentResult, type Mission, type MissionStep } from "../types";
import { requestValidation } from "../validation/requests";
import { appendFrom, nextRunnableIndex } from "./chain";
import { chainOf } from "./index";

export type StepOutcome =
  | "ignored"
  | "halted"
  | "skipped"
  | "done"
  | "next"
  | "redo"
  | "validation"
  | "failed"
  | "blocked_budget";

const TERMINAL = new Set(["DONE", "FAILED", "CANCELLED", "BLOCKED_BUDGET"]);

function short(s: string | null | undefined, n = 300): string | null {
  return s ? s.slice(0, n) : null;
}

/** Enfile l'étape `index` (ou rien si la chaîne est finie). Erreur de file : journalisée, le balayage `resume` reprendra. */
export async function enqueueStep(deps: EngineDeps, mission: Pick<Mission, "id" | "teamKey">, steps: readonly MissionStep[], index: number): Promise<void> {
  const step = steps[index];
  if (!step) return;
  try {
    await deps.enqueue.step(mission.teamKey, step.agent, { type: "step", missionId: mission.id, index });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, missionId: mission.id, index, queue: TEAM_QUEUES[mission.teamKey] }, "[agents] étape non enfilée");
  }
}

async function finishMission(deps: EngineDeps, mission: Mission, steps: MissionStep[], payload: unknown, now: Date): Promise<void> {
  await deps.prisma.agentMission.update({
    where: { id: mission.id },
    data: { status: "DONE", steps: json(steps) as never, payload: json(payload) as never, currentStep: steps.length, lastActivityAt: now, lastError: null },
  });
  await recordMissionSuccess(deps, mission.teamKey);
  await agentEvent(deps, "agents.mission.done", { missionId: mission.id, teamKey: mission.teamKey, postId: mission.postId }, { channelId: mission.channelId });
}

async function failMission(deps: EngineDeps, mission: Mission, steps: MissionStep[], error: string, now: Date, status: "FAILED" | "BLOCKED_BUDGET" = "FAILED"): Promise<void> {
  await deps.prisma.agentMission.update({
    where: { id: mission.id },
    data: { status, steps: json(steps) as never, lastError: error.slice(0, 500), lastActivityAt: now, attempts: { increment: 1 } },
  });
  await agentEvent(
    deps,
    status === "FAILED" ? "agents.mission.failed" : "agents.mission.blocked_budget",
    { missionId: mission.id, teamKey: mission.teamKey, error: short(error, 200) },
    { channelId: mission.channelId },
  );
  if (status === "FAILED") await recordMissionFailure(deps, mission.teamKey, error);
}

export async function runNextStep(deps: EngineDeps, missionId: string, index: number): Promise<StepOutcome> {
  const row = (await deps.prisma.agentMission.findUnique({ where: { id: missionId } })) as MissionRow | null;
  if (!row || TERMINAL.has(row.status) || row.status === "WAITING_VALIDATION" || row.status === "WAITING_HUMAN") return "ignored";
  const mission = toMission(row);
  const steps = mission.steps;
  const step = steps[index];
  if (!step || index !== mission.currentStep || step.status === "DONE") return "ignored";

  const halt = await isTeamHalted(deps, mission.teamKey);
  if (halt.halted) return "halted";

  const chain = chainOf(mission.teamKey).post;
  const def = step.status === "SKIPPED" ? null : agentFor(step.agent);
  const now0 = nowOf(deps);
  if (!def) {
    // Agent d'une phase suivante : étape sautée, on passe à la suivante.
    steps[index] = { ...step, status: "SKIPPED", summary: step.summary ?? "agent pas encore disponible" };
    const next = nextRunnableIndex(steps, index + 1);
    if (next === null) {
      await finishMission(deps, mission, steps, mission.payload, now0);
      return "done";
    }
    await deps.prisma.agentMission.update({ where: { id: mission.id }, data: { steps: json(steps) as never, currentStep: next, lastActivityAt: now0 } });
    await enqueueStep(deps, mission, steps, next);
    return "skipped";
  }

  const ctx = await buildContext(deps, mission.teamKey);
  const fakeLlm = (ctx.providers.llm as { fake?: boolean } | null)?.fake === true;
  const paid = (PAID_PROVIDERS[step.agent] ?? []).filter((p) => !(p === "llm" && fakeLlm));
  const blocked = await checkBudgets(deps, ctx.settings, paid, now0);
  if (blocked) {
    steps[index] = { ...step, status: "FAILED", error: blocked.reason, endedAt: now0.toISOString() };
    await failMission(deps, mission, steps, blocked.reason!, now0, "BLOCKED_BUDGET");
    return "blocked_budget";
  }

  steps[index] = { ...step, status: "RUNNING", startedAt: now0.toISOString(), error: null };
  await deps.prisma.agentMission.update({
    where: { id: mission.id },
    data: { status: "RUNNING", steps: json(steps) as never, lastActivityAt: now0 },
  });
  const run = await deps.prisma.agentRun.create({
    data: {
      missionId: mission.id,
      agentKey: step.agent,
      stepIndex: index,
      status: "RUNNING",
      startedAt: now0,
      inputSummary: short(`mission ${mission.kind} ${mission.teamKey}${mission.channelId ? ` canal ${mission.channelId}` : ""}`),
    },
  });

  // Un essai, puis un second si l'agent lève une erreur ou demande de réessayer.
  let result: AgentResult;
  let spent = 0;
  const attempt = async (): Promise<AgentResult> => {
    try {
      const r = await def.run({ ...mission, steps, status: "RUNNING" }, ctx);
      spent += r.costCents ?? 0;
      return r;
    } catch (err) {
      return { ok: false, error: (err as Error).message || "erreur inconnue", retryable: true };
    }
  };
  result = await attempt();
  if (!result.ok && result.retryable) result = await attempt();

  const now = nowOf(deps);
  if (spent > 0) {
    const provider = paid[0] ?? "llm";
    await recordUsage(deps.prisma, mission.teamKey, provider, spent, now);
    await maybeAlertBudget(deps, ctx.settings, provider, now);
  }
  const durationMs = now.getTime() - now0.getTime();
  await deps.prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: result.ok ? "OK" : "ERROR",
      endedAt: now,
      durationMs,
      costCents: spent,
      outputSummary: short(result.summary),
      error: short(result.error),
    },
  });
  await deps.prisma.agentMission.update({ where: { id: mission.id }, data: { costCents: { increment: spent } } });

  if (!result.ok) {
    const error = result.error ?? "échec de l'étape";
    steps[index] = { ...steps[index]!, status: "FAILED", endedAt: now.toISOString(), error, costCents: spent };
    await agentEvent(deps, "agents.step.failed", { missionId: mission.id, agent: step.agent, index, error: short(error, 200) }, { channelId: mission.channelId });
    await failMission(deps, mission, steps, error, now);
    return "failed";
  }

  // Relire la charge utile : une décision humaine a pu l'écrire pendant l'étape.
  const fresh = await deps.prisma.agentMission.findUnique({ where: { id: mission.id }, select: { payload: true, postId: true } });
  const payload = { ...parsePayload(fresh?.payload ?? mission.payload), ...(result.output ?? {}) };
  steps[index] = { ...steps[index]!, status: "DONE", endedAt: now.toISOString(), summary: short(result.summary, 200), costCents: spent };
  const scheduledFor = typeof result.output?.slot === "string" ? new Date(result.output.slot) : undefined;
  await agentEvent(
    deps,
    "agents.step.done",
    { missionId: mission.id, agent: step.agent, index, summary: short(result.summary, 200), costCents: spent },
    { channelId: mission.channelId },
  );

  if (result.goTo) {
    const appended = appendFrom(steps, chain, result.goTo, index);
    const next = nextRunnableIndex(appended, index + 1) ?? appended.length - 1;
    await deps.prisma.agentMission.update({
      where: { id: mission.id },
      data: { steps: json(appended) as never, payload: json(payload) as never, currentStep: next, lastActivityAt: now },
    });
    await agentEvent(deps, "agents.mission.redo", { missionId: mission.id, to: result.goTo, reasons: (payload.reasons ?? []).slice(0, 5) }, { channelId: mission.channelId });
    await enqueueStep(deps, mission, appended, next);
    return "redo";
  }

  const next = nextRunnableIndex(steps, index + 1);
  if (result.needsValidation) {
    await deps.prisma.agentMission.update({
      where: { id: mission.id },
      data: {
        status: "WAITING_VALIDATION",
        steps: json(steps) as never,
        payload: json(payload) as never,
        currentStep: next ?? steps.length,
        lastActivityAt: now,
        ...(scheduledFor ? { scheduledFor } : {}),
      },
    });
    const target = mission.channelId
      ? await deps.prisma.channel.findUnique({ where: { id: mission.channelId }, select: { title: true } })
      : null;
    try {
      await requestValidation(deps, {
        missionId: mission.id,
        teamKey: mission.teamKey,
        previewText: payload.text ?? "",
        mediaAssetId: payload.mediaAssetId ?? null,
        reason: result.needsValidation.reason,
        channelTitle: target?.title ?? null,
      });
    } catch (err) {
      // Validation non créée : le cycle du Grand Chef la redemandera (mission en attente sans validation).
      deps.logger?.error({ err: (err as Error).message, missionId: mission.id }, "[agents] validation non demandée");
      await deps.prisma.agentMission.update({ where: { id: mission.id }, data: { lastError: short((err as Error).message) } });
    }
    return "validation";
  }

  const postId = typeof payload.postId === "string" ? payload.postId : (fresh?.postId ?? mission.postId);
  if (next === null) {
    await finishMission(deps, { ...mission, postId }, steps, payload, now);
    return "done";
  }
  await deps.prisma.agentMission.update({
    where: { id: mission.id },
    data: { steps: json(steps) as never, payload: json(payload) as never, currentStep: next, lastActivityAt: now, ...(scheduledFor ? { scheduledFor } : {}) },
  });
  await enqueueStep(deps, mission, steps, next);
  return "next";
}
