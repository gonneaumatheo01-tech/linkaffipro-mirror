/**
 * Écritures propres au site dans la rubrique Agents : réglages d'une équipe, plan d'un canal, modèles, canal
 * Médiathèque. Chaque écriture a son `AuditLog` (jamais de texte de post ni de clé). Aucun appel d'IA, aucune mise en
 * file : le Grand Chef relit ces réglages à son prochain passage (toutes les 30 minutes).
 * Pause, niveau, simulation, validations, demandes et clés passent par `@linkaffipro/agents` (qui journalise).
 */
import { audit, prisma, type Prisma } from "@linkaffipro/db";
import type { ProviderKey, TeamKey } from "@linkaffipro/agents";
import type { AgentsSettingsInput, ChannelPlanInput, TeamSettingsInput } from "./forms";
import { TEAM_VERTICAL } from "./teams";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function saveTeamSettings(team: TeamKey, input: TeamSettingsInput, userId: string): Promise<void> {
  const data = {
    styleGuidelines: input.styleGuidelines,
    forbiddenWords: json(input.forbiddenWords),
    maxTextLength: input.maxTextLength,
    quietHours: json(input.quietHours),
    monthlyBudgetCents: json(input.budgets),
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
      budgetsCents: input.budgets,
    },
  });
}

/** Plafonds d'une équipe seuls (Réglages des agents) ; les autres réglages de l'équipe ne bougent pas. */
export async function saveTeamBudgets(
  team: TeamKey,
  budgets: Partial<Record<ProviderKey, number>>,
  userId: string,
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
    metadata: { budgetsCents: budgets },
  });
}

export type PlanSaveResult = { ok: true } | { ok: false; error: string };

/**
 * Plan d'un canal : le canal doit être de l'univers de l'équipe (ou le canal Test) ; persona et campagne doivent
 * exister. Un canal n'a qu'un plan (`ChannelAgentPlan.channelId` unique).
 */
export async function saveChannelPlan(team: TeamKey, input: ChannelPlanInput, userId: string): Promise<PlanSaveResult> {
  const vertical = TEAM_VERTICAL[team];
  if (!vertical) return { ok: false, error: "L'équipe Algorithme ne publie sur aucun canal." };
  const channel = await prisma.channel.findUnique({
    where: { id: input.channelId },
    select: { id: true, vertical: true, isTest: true },
  });
  if (!channel || (channel.vertical !== vertical && !channel.isTest))
    return { ok: false, error: "Ce canal n'est pas un canal de cette équipe." };
  if (input.personaId && !(await prisma.persona.findUnique({ where: { id: input.personaId }, select: { id: true } })))
    return { ok: false, error: "Persona introuvable : rechargez la page." };
  if (input.campaignId && !(await prisma.campaign.findUnique({ where: { id: input.campaignId }, select: { id: true } })))
    return { ok: false, error: "Campagne introuvable : rechargez la page." };
  const data = {
    teamKey: team,
    enabled: input.enabled,
    postsPerDay: input.postsPerDay,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    minSpacingMinutes: input.minSpacingMinutes,
    mix: json(input.mix),
    personaId: input.personaId,
    campaignId: input.campaignId,
    themes: json(input.themes),
    updatedById: userId,
  };
  await prisma.channelAgentPlan.upsert({
    where: { channelId: input.channelId },
    create: { channelId: input.channelId, ...data },
    update: data,
  });
  await audit({
    userId,
    action: "agents.channel_plan_saved",
    entityType: "ChannelAgentPlan",
    entityId: input.channelId,
    metadata: { teamKey: team, ...input, channelId: undefined },
  });
  return { ok: true };
}

async function putSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({ where: { key }, create: { key, value: json(value) }, update: { value: json(value) } });
}

export async function saveAgentsGeneralSettings(
  input: AgentsSettingsInput,
  before: { models: { fast: string; strong: string }; libraryChannelId: string | null },
  userId: string,
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
      metadata: { from: before.models, to: { fast: input.fast, strong: input.strong } },
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
      metadata: { from: before.libraryChannelId, to: input.libraryChannelId },
    });
  }
  return { ok: true };
}
