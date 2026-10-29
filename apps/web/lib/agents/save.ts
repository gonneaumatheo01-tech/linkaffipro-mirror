/**
 * Écritures propres au site dans la rubrique Agents : réglages d'une équipe, plan d'un canal, modèles, canal
 * Médiathèque. Chaque écriture a son `AuditLog` (jamais de texte de post ni de clé). Aucun appel d'IA, aucune mise en
 * file : le Grand Chef relit ces réglages à son prochain passage (toutes les 30 minutes).
 * Pause, niveau, simulation, validations, demandes et clés passent par `@linkaffipro/agents` (qui journalise).
 */
import { audit, prisma, type Prisma } from "@linkaffipro/db";
import { saveChannelPlanFor, type AgentsDeps, type ProviderKey, type TeamKey } from "@linkaffipro/agents";
import type { AgentsSettingsInput, ChannelPlanInput, TeamSettingsInput } from "./forms";

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Origine de l'écriture (phase 34) : site ou Kevin, notée dans l'`AuditLog` quand elle est donnée. */
export type Via = "WEB" | "TELEGRAM";
export const viaMeta = (via?: Via): { via?: Via } => (via ? { via } : {});

/**
 * Réglages d'une équipe. `budgets: null` : plafonds inchangés (un responsable ne les modifie pas, phase 20 : les
 * plafonds sont réservés aux administrateurs).
 */
export async function saveTeamSettings(
  team: TeamKey,
  input: Omit<TeamSettingsInput, "budgets"> & { budgets: TeamSettingsInput["budgets"] | null },
  userId: string,
  via?: Via,
): Promise<void> {
  const data = {
    styleGuidelines: input.styleGuidelines,
    forbiddenWords: json(input.forbiddenWords),
    maxTextLength: input.maxTextLength,
    quietHours: json(input.quietHours),
    ...(input.budgets ? { monthlyBudgetCents: json(input.budgets) } : {}),
    updatedById: userId,
  };
  await prisma.agentTeamConfig.upsert({
    where: { teamKey: team },
    create: { teamKey: team, ...data },
    update: data,
  });
  await audit({
    userId,
    action: "agents.team_settings_saved",
    entityType: "AgentTeamConfig",
    entityId: team,
    metadata: {
      styleGuidelinesLength: input.styleGuidelines.length,
      forbiddenWords: input.forbiddenWords.length,
      maxTextLength: input.maxTextLength,
      quietHours: input.quietHours,
      budgetsCents: input.budgets ?? "inchangés",
      ...viaMeta(via),
    },
  });
}

/** Plafonds d'une équipe seuls (Réglages des agents) ; les autres réglages de l'équipe ne bougent pas. */
export async function saveTeamBudgets(
  team: TeamKey,
  budgets: Partial<Record<ProviderKey, number>>,
  userId: string,
  via?: Via,
): Promise<void> {
  await prisma.agentTeamConfig.upsert({
    where: { teamKey: team },
    create: { teamKey: team, monthlyBudgetCents: json(budgets), updatedById: userId },
    update: { monthlyBudgetCents: json(budgets), updatedById: userId },
  });
  await audit({
    userId,
    action: "agents.budgets_saved",
    entityType: "AgentTeamConfig",
    entityId: team,
    metadata: { budgetsCents: budgets, ...viaMeta(via) },
  });
}

export type PlanSaveResult = { ok: true } | { ok: false; error: string };

/**
 * Plan d'un canal : le canal doit être de l'univers de l'équipe (ou le canal Test) ; persona et campagne doivent
 * exister. Un canal n'a qu'un plan (`ChannelAgentPlan.channelId` unique). Une seule logique avec le Boss (phase 26) :
 * `saveChannelPlanFor` de `@linkaffipro/agents` (contrôles, enregistrement et `AuditLog`).
 */
export async function saveChannelPlan(team: TeamKey, input: ChannelPlanInput, userId: string, via?: Via): Promise<PlanSaveResult> {
  const deps = { prisma: prisma as unknown as AgentsDeps["prisma"], enqueue: NO_ENQUEUE };
  return saveChannelPlanFor(deps, team, input, { userId, via: via === "TELEGRAM" ? "TELEGRAM" : "SITE" });
}

/** L'enregistrement d'un plan ne met rien en file (le Grand Chef relit les plans à son passage). */
const NO_ENQUEUE: AgentsDeps["enqueue"] = {
  async orchestrator() {},
  async step() {},
};

async function putSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({ where: { key }, create: { key, value: json(value) }, update: { value: json(value) } });
}

export async function saveAgentsGeneralSettings(
  input: AgentsSettingsInput,
  before: { models: { fast: string; strong: string }; libraryChannelId: string | null },
  userId: string,
  via?: Via,
): Promise<PlanSaveResult> {
  if (input.libraryChannelId) {
    const ch = await prisma.channel.findUnique({ where: { id: input.libraryChannelId }, select: { id: true } });
    if (!ch) return { ok: false, error: "Canal Médiathèque introuvable : rechargez la page." };
  }
  if (before.models.fast !== input.fast || before.models.strong !== input.strong) {
    await putSetting("agents.models", { fast: input.fast, strong: input.strong });
    await audit({
      userId,
      action: "agents.models_saved",
      entityType: "Setting",
      entityId: "agents.models",
      metadata: { from: before.models, to: { fast: input.fast, strong: input.strong }, ...viaMeta(via) },
    });
  }
  if (before.libraryChannelId !== input.libraryChannelId) {
    // Aucun canal : le réglage est retiré (une valeur JSON nulle serait ambiguë pour les lecteurs).
    if (input.libraryChannelId) await putSetting("agents.libraryChannelId", input.libraryChannelId);
    else await prisma.setting.deleteMany({ where: { key: "agents.libraryChannelId" } });
    await audit({
      userId,
      action: "agents.library_channel_set",
      entityType: "Setting",
      entityId: "agents.libraryChannelId",
      metadata: { from: before.libraryChannelId, to: input.libraryChannelId, ...viaMeta(via) },
    });
  }
  return { ok: true };
}
