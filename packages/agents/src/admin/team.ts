/**
 * Réglages d'équipe changés par un humain (CONTRAT, propriétaire : chantier B). Chaque changement = un `AuditLog`.
 * Appelé par le dialogue admin Telegram et par le site.
 */
import { TEAM_KEYS, TEAM_LABELS, type AgentsDeps, type TeamKey } from "../types";
import { agentAudit, agentEvent, readSetting, writeSetting } from "./journal";

export type ActorRef = { userId?: string | null; via: "SITE" | "TELEGRAM" };

export const PAUSED_ALL_KEY = "agents.pausedAll";

export const AUTONOMY_LABELS: Record<0 | 1 | 2, string> = {
  0: "je valide tout",
  1: "je valide les nouveautés",
  2: "autonomie totale",
};

async function upsertTeam(deps: AgentsDeps, team: TeamKey, data: Record<string, unknown>) {
  return deps.prisma.agentTeamConfig.upsert({
    where: { teamKey: team },
    create: { teamKey: team, ...data },
    update: data,
  });
}

/** La pause générale est-elle active ? */
export async function isPausedAll(deps: Pick<AgentsDeps, "prisma">): Promise<boolean> {
  return (await readSetting(deps, PAUSED_ALL_KEY)) === true;
}

/** Pause (ou reprise) d'une équipe, ou de toutes (`"all"` → `Setting` `agents.pausedAll`). */
export async function setTeamPaused(
  deps: AgentsDeps,
  team: TeamKey | "all",
  paused: boolean,
  actor: ActorRef,
  reason?: string,
): Promise<{ ok: boolean; message: string }> {
  const action = paused ? "agents.team.paused" : "agents.team.resumed";
  if (team === "all") {
    await writeSetting(deps, PAUSED_ALL_KEY, paused);
  } else {
    await upsertTeam(deps, team, {
      paused,
      pausedReason: paused ? (reason ?? `pause demandée (${actor.via === "TELEGRAM" ? "Telegram" : "site"})`) : null,
      // Reprendre une équipe efface le compteur d'échecs : sinon elle repartirait en pause au premier échec.
      ...(paused ? {} : { consecutiveFailures: 0 }),
      updatedById: actor.userId ?? null,
    });
  }
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action,
    entityType: "AgentTeamConfig",
    entityId: team,
    metadata: { team, via: actor.via, reason: reason ?? null },
  });
  await agentEvent(deps, action, { team, via: actor.via });
  if (!paused) {
    try {
      await deps.enqueue.orchestrator(team === "all" ? { type: "cycle" } : { type: "cycle", teamKey: team });
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message }, "[agents] cycle non enfilé après reprise");
    }
  }
  if (team === "all")
    return {
      ok: true,
      message: paused
        ? "Pause générale ⏸ : aucune équipe ne travaille."
        : "Pause générale levée ▶️ (une équipe mise en pause seule le reste).",
    };
  return {
    ok: true,
    message: paused ? `Équipe ${TEAM_LABELS[team]} en pause ⏸` : `Équipe ${TEAM_LABELS[team]} reprend ▶️`,
  };
}

export async function setAutonomyLevel(
  deps: AgentsDeps,
  team: TeamKey,
  level: 0 | 1 | 2,
  actor: ActorRef,
): Promise<{ ok: boolean; message: string }> {
  if (![0, 1, 2].includes(level)) return { ok: false, message: "Niveau 0, 1 ou 2 seulement." };
  await upsertTeam(deps, team, { autonomyLevel: level, updatedById: actor.userId ?? null });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.team.autonomy",
    entityType: "AgentTeamConfig",
    entityId: team,
    metadata: { team, level, via: actor.via },
  });
  await agentEvent(deps, "agents.team.autonomy", { team, level, via: actor.via });
  return { ok: true, message: `Équipe ${TEAM_LABELS[team]} : niveau ${level} (${AUTONOMY_LABELS[level]}).` };
}

/** Simulation on/off. Désactiver = ADMIN seulement (vérifié par l'appelant) et confirmé (« OUI » / ConfirmDialog). */
export async function setSimulation(
  deps: AgentsDeps,
  team: TeamKey,
  simulation: boolean,
  actor: ActorRef,
): Promise<{ ok: boolean; message: string }> {
  await upsertTeam(deps, team, { simulation, updatedById: actor.userId ?? null });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: simulation ? "agents.team.simulation_on" : "agents.team.simulation_off",
    entityType: "AgentTeamConfig",
    entityId: team,
    metadata: { team, simulation, via: actor.via },
  });
  await agentEvent(deps, "agents.team.simulation", { team, simulation, via: actor.via });
  return {
    ok: true,
    message: simulation
      ? `Équipe ${TEAM_LABELS[team]} en simulation : tout part sur le canal Test.`
      : `Équipe ${TEAM_LABELS[team]} en vrai ✅ : ses posts partent sur les vrais canaux.`,
  };
}

/** État en 6 lignes au plus (commande « agents »). */
export async function agentsStatusText(deps: AgentsDeps): Promise<string> {
  const [configs, pausedAll, toValidate, openRequests] = await Promise.all([
    deps.prisma.agentTeamConfig.findMany({}),
    isPausedAll(deps),
    deps.prisma.agentValidation.count({ where: { status: "PENDING" } }),
    deps.prisma.humanRequest.count({ where: { status: { in: ["QUEUED", "PENDING"] } } }),
  ]);
  const byTeam = new Map(configs.map((c) => [c.teamKey, c]));
  const lines = [`🤖 Agents${pausedAll ? " — pause générale ⏸" : ""}`];
  for (const team of TEAM_KEYS) {
    const c = byTeam.get(team);
    const running = await deps.prisma.agentMission.count({
      where: { teamKey: team, status: { in: ["PENDING", "RUNNING", "WAITING_VALIDATION", "WAITING_HUMAN"] } },
    });
    // Sans réglage enregistré : valeurs par défaut (active, simulation, niveau 0).
    const state = c?.paused ? "⏸ pause" : c && !c.enabled ? "désactivée" : "▶️ active";
    const sim = !c || c.simulation ? "simulation" : "en vrai";
    lines.push(`${TEAM_LABELS[team]} : ${state} · ${sim} · niveau ${c?.autonomyLevel ?? 0} · ${running} en cours`);
  }
  lines.push(`À valider : ${toValidate} · demandes ouvertes : ${openRequests}`);
  return lines.join("\n");
}
