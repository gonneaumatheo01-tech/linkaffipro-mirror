/**
 * Réglages de l'agent Conversations, lus dans `AgentTeamConfig.settings.algo` de l'équipe Algorithme (le site les
 * modifie ; valeur abîmée = valeur par défaut).
 */
import type { AgentsPrisma } from "../../types";

/** Règle 1 du plan : au moins 30 conversations par profil pour conclure. */
export const DEFAULT_MIN_CONVERSATIONS = 30;
/** Fenêtre des chiffres par profil. */
export const PROFILE_DAYS = 30;
/** Plafonds de l'échantillon relu par l'IA (règle 5). */
export const SAMPLE_MAX_CONVERSATIONS = 40;
export const SAMPLE_MAX_MESSAGES = 12;
/** Longueur maximale d'un motif ou d'une tournure (règle 5 : moins de 80 caractères). */
export const MAX_PATTERN_LENGTH = 79;
/** Propositions de réglages au plus par profil. */
export const MAX_PROPOSALS_PER_PROFILE = 3;

export type ConversationsAgentSettings = { minConversations: number };

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Pur : `settings` de l'équipe Algorithme → réglages de l'agent. */
export function parseConversationsSettings(teamSettings: unknown): ConversationsAgentSettings {
  const algo = record(record(teamSettings).algo);
  const n = Math.round(Number(algo.minConversations));
  return { minConversations: Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : DEFAULT_MIN_CONVERSATIONS };
}

export async function loadConversationsSettings(prisma: AgentsPrisma): Promise<ConversationsAgentSettings> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "algo" } });
  return parseConversationsSettings(row?.settings);
}
