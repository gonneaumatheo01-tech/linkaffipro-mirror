/**
 * Plafond mensuel d'un poste de dépense d'une équipe (`AgentTeamConfig.monthlyBudgetCents`), réglé depuis Telegram
 * (commande « budget vidéo … », question de mise en route Dating). Les autres postes ne bougent pas.
 */
import type { AgentsDeps, ProviderKey, TeamKey } from "../types";
import type { ActorRef } from "./team";
import { agentAudit } from "./journal";

export async function setTeamBudget(
  deps: AgentsDeps,
  teamKey: TeamKey,
  provider: ProviderKey,
  cents: number,
  actor: ActorRef,
): Promise<void> {
  const value = Math.max(0, Math.round(cents));
  const cfg = await deps.prisma.agentTeamConfig.findUnique({ where: { teamKey } });
  const budgets = { ...((cfg?.monthlyBudgetCents as Record<string, number> | null) ?? {}), [provider]: value };
  await deps.prisma.agentTeamConfig.upsert({
    where: { teamKey },
    create: { teamKey, monthlyBudgetCents: budgets, updatedById: actor.userId ?? null },
    update: { monthlyBudgetCents: budgets, updatedById: actor.userId ?? null },
  });
  await agentAudit(deps, {
    userId: actor.userId ?? null,
    action: "agents.team.budget",
    entityType: "AgentTeamConfig",
    entityId: teamKey,
    metadata: { provider, cents: value, via: actor.via },
  });
}
