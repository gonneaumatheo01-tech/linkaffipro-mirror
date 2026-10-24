/**
 * Cycle de vie des missions (CONTRAT, propriétaire : chantier A « moteur »). Signatures figées : le bot (chantier B)
 * et le site (chantier C) les appellent.
 */
import { agentAudit, agentEvent, nowOf } from "../admin/journal";
import { appendFrom, buildSteps, nextRunnableIndex } from "../chiefs/chain";
import { chainOf } from "../chiefs/index";
import { PAID_PROVIDERS } from "../agents/registry";
import { checkBudgets } from "../orchestrator/budgets";
import { collisionReason } from "../orchestrator/collisions";
import { isTeamHalted, recordMissionFailure } from "../orchestrator/pause";
import { parisDay } from "../rules/time";
import { isAgentKey, TEAM_LABELS, type AgentsDeps, type ProviderKey, type TeamKey } from "../types";
import { json, parsePayload, parseSteps, ACTIVE_STATUSES } from "./mission";
import { loadTeamSettings } from "./settings";
import { assignExperiment } from "../agents/experimentation/variants";
import { resolveProviders, type EngineDeps } from "./context";

export type CreateMissionInput = {
  teamKey: TeamKey;
  channelId: string | null;
  createdBy: "GRAND_CHEF" | "HUMAN";
  createdById?: string | null;
  isTest?: boolean;
  planDay?: string | null;
  /** Format imposé (« Créer une mission de test » : texte). */
  format?: "video" | "photo" | "text";
  /** Persona imposée (post de test de l'équipe Dating, phase 20). */
  personaId?: string | null;
  /** Phase 23 : mission BET (équipe Paris sportifs), charge utile de départ, étapes déjà faites (pari choisi par une
   * mission sœur), quota du canal (somme des paris par jour des catégories qui le visent). */
  kind?: "POST" | "BET";
  payload?: Record<string, unknown>;
  skipAgents?: readonly string[];
  postsPerDay?: number;
};

export type CreateMissionResult =
  | { ok: true; missionId: string }
  | { ok: false; status?: "BLOCKED_BUDGET"; reason: string };

/** Crée une mission (budgets, pause, collisions vérifiés) et enfile sa première étape. */
export async function createMission(deps: AgentsDeps, input: CreateMissionInput): Promise<CreateMissionResult> {
  const now = nowOf(deps);
  const chain = chainOf(input.teamKey);
  if (!chain.active) return { ok: false, reason: `L'équipe ${TEAM_LABELS[input.teamKey]} n'a pas encore d'agents (phases suivantes).` };
  const halt = await isTeamHalted(deps, input.teamKey);
  if (halt.halted) return { ok: false, reason: `Mission non créée : ${halt.reason}.` };

  const channel = input.channelId
    ? await deps.prisma.channel.findUnique({ where: { id: input.channelId }, select: { id: true, isActive: true } })
    : null;
  const [plan, active] = await Promise.all([
    input.channelId && !input.isTest ? deps.prisma.channelAgentPlan.findUnique({ where: { channelId: input.channelId } }) : null,
    input.channelId
      ? deps.prisma.agentMission.findMany({
          where: { channelId: input.channelId, status: { in: [...ACTIVE_STATUSES] }, isTest: false },
          select: { teamKey: true },
        })
      : [],
  ]);
  const collision = collisionReason({
    channel,
    teamKey: input.teamKey,
    activeOnChannel: active,
    postsPerDay: input.postsPerDay ?? plan?.postsPerDay ?? 3,
    isTest: input.isTest,
  });
  if (collision) return { ok: false, reason: collision };

  const steps = buildSteps(chain.post).map((s) =>
    input.skipAgents?.includes(s.agent) ? { ...s, status: "SKIPPED" as const, summary: "déjà fait par une mission sœur" } : s,
  );
  const payload = {
    ...(input.payload ?? {}),
    ...(input.format ? { format: input.format } : {}),
    ...(input.personaId ? { personaId: input.personaId } : {}),
  };
  const settings = await loadTeamSettings(deps.prisma, input.teamKey);
  const paid = [...new Set(chain.post.flatMap((a) => PAID_PROVIDERS[a] ?? []))] as ProviderKey[];
  // IA de repli (aucune clé) : aucune dépense, donc aucun plafond à vérifier.
  const llm = (await resolveProviders(deps as EngineDeps)).llm as { fake?: boolean } | null;
  // L'équipe Paris sportifs n'appelle pas l'IA texte (posts écrits par le code) : aucun plafond d'IA ne la bloque.
  const budget = await checkBudgets(deps, settings, paid.filter((p) => p === "llm" && !llm?.fake && input.teamKey !== "sports"), now);
  const base = {
    teamKey: input.teamKey,
    kind: input.kind ?? ("POST" as const),
    channelId: input.channelId,
    steps: json(steps) as never,
    payload: payload as never,
    planDay: input.planDay ?? parisDay(now),
    isTest: input.isTest === true,
    createdBy: input.createdBy,
    createdById: input.createdById ?? null,
    lastActivityAt: now,
  };
  if (budget) {
    // Gardée en BLOCKED_BUDGET : visible dans le journal, comptée dans le plan du jour (pas de nouvel essai toutes les 30 min).
    const blocked = await deps.prisma.agentMission.create({ data: { ...base, status: "BLOCKED_BUDGET", lastError: budget.reason } });
    await agentEvent(deps, "agents.mission.blocked_budget", { missionId: blocked.id, teamKey: input.teamKey, reason: budget.reason }, { channelId: input.channelId });
    return { ok: false, status: "BLOCKED_BUDGET", reason: budget.reason! };
  }
  const first = nextRunnableIndex(steps, 0) ?? 0;
  const mission = await deps.prisma.agentMission.create({ data: { ...base, status: "PENDING", currentStep: first } });
  // Test A/B actif sur le canal (phase 21) : variante tirée une fois, gardée dans la charge utile pour toutes les étapes.
  if (input.channelId && !input.isTest && input.kind !== "BET") {
    const running = await deps.prisma.experiment.findMany({
      where: { channelId: input.channelId, status: "RUNNING" },
      select: { id: true, kind: true, variants: true },
    });
    const experiment = assignExperiment(mission.id, running);
    if (experiment) await deps.prisma.agentMission.update({ where: { id: mission.id }, data: { payload: json({ ...payload, experiment }) as never } });
  }
  await agentEvent(
    deps,
    "agents.mission.created",
    { missionId: mission.id, teamKey: input.teamKey, by: input.createdBy, isTest: input.isTest === true },
    { channelId: input.channelId },
  );
  if (input.createdBy === "HUMAN")
    await agentAudit(deps, {
      userId: input.createdById ?? null,
      action: input.isTest ? "agents.mission.test_created" : "agents.mission.created",
      entityType: "AgentMission",
      entityId: mission.id,
      metadata: { teamKey: input.teamKey, channelId: input.channelId },
    });
  try {
    await deps.enqueue.step(input.teamKey, steps[first]!.agent, { type: "step", missionId: mission.id, index: first });
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, missionId: mission.id }, "[agents] première étape non enfilée (reprise par le balayage)");
  }
  return { ok: true, missionId: mission.id };
}

/**
 * « Créer une mission de test » (site, ADMIN/MANAGER) : mission POST texte sur le canal Test (`Channel.isTest`), en
 * simulation, `isTest = true`.
 */
export async function createTestMission(deps: AgentsDeps, teamKey: TeamKey, byUserId: string | null): Promise<CreateMissionResult> {
  // Équipe Paris sportifs : un pari de test (faux fournisseur de cotes), jamais un post sans pari.
  if (teamKey === "sports") return (await import("../sports/test-bet")).createTestBet(deps, { byUserId });
  const test = await deps.prisma.channel.findFirst({
    where: { isTest: true, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!test) return { ok: false, reason: "Aucun canal Test : cochez « canal de test » sur un canal (page Canaux)." };
  return createMission(deps, { teamKey, channelId: test.id, createdBy: "HUMAN", createdById: byUserId, isTest: true, format: "text" });
}

/**
 * Reprend une mission qui attendait (validation accordée ou corrigée, réponse humaine) : repasse en RUNNING et enfile
 * l'étape voulue (`fromAgent` : par exemple « controle » après une correction, sinon l'étape suivante).
 */
export async function continueMission(deps: AgentsDeps, missionId: string, opts: { fromAgent?: string; reason: string }): Promise<void> {
  const row = await deps.prisma.agentMission.findUnique({ where: { id: missionId } });
  if (!row) throw new Error("Mission introuvable.");
  if (["DONE", "FAILED", "CANCELLED", "BLOCKED_BUDGET"].includes(row.status)) return;
  const teamKey = row.teamKey as TeamKey;
  const now = nowOf(deps);
  let steps = parseSteps(row.steps);
  let index: number | null;
  if (opts.fromAgent && isAgentKey(opts.fromAgent)) {
    const after = Math.max(0, Math.min(row.currentStep, steps.length) - 1);
    steps = appendFrom(steps, chainOf(teamKey).post, opts.fromAgent, after);
    index = nextRunnableIndex(steps, after + 1);
  } else {
    index = nextRunnableIndex(steps, row.currentStep);
  }
  if (index === null) {
    await deps.prisma.agentMission.update({ where: { id: missionId }, data: { status: "DONE", lastActivityAt: now, steps: json(steps) as never } });
    return;
  }
  await deps.prisma.agentMission.update({
    where: { id: missionId },
    data: { status: "RUNNING", currentStep: index, steps: json(steps) as never, lastActivityAt: now },
  });
  await agentEvent(deps, "agents.mission.resumed", { missionId, index, agent: steps[index]!.agent, reason: opts.reason.slice(0, 200) }, { channelId: row.channelId });
  await deps.enqueue.step(teamKey, steps[index]!.agent, { type: "step", missionId, index });
}

/** Annule une mission (refus, expiration), journalise, compte comme échec seulement si `asFailure`. */
export async function cancelMission(deps: AgentsDeps, missionId: string, opts: { reason: string; asFailure?: boolean }): Promise<void> {
  const row = await deps.prisma.agentMission.findUnique({ where: { id: missionId } });
  if (!row || ["DONE", "CANCELLED"].includes(row.status)) return;
  const now = nowOf(deps);
  await deps.prisma.agentMission.update({
    where: { id: missionId },
    data: { status: "CANCELLED", lastError: opts.reason.slice(0, 500), lastActivityAt: now, payload: json({ ...parsePayload(row.payload), cancelReason: opts.reason }) as never },
  });
  // Les messages déjà programmés par la mission (cas rare : annulation après Publication) ne sont pas envoyés : tous,
  // un par canal de destination (`Post.agentMissionId`), pas seulement le premier (`AgentMission.postId`).
  await deps.prisma.post.updateMany({
    where: { status: "SCHEDULED", OR: [...(row.postId ? [{ id: row.postId }] : []), { agentMissionId: missionId }] },
    data: { status: "CANCELLED" },
  });
  await agentEvent(deps, "agents.mission.cancelled", { missionId, teamKey: row.teamKey, reason: opts.reason.slice(0, 200) }, { channelId: row.channelId });
  if (opts.asFailure) await recordMissionFailure(deps, row.teamKey as TeamKey, opts.reason);
}
