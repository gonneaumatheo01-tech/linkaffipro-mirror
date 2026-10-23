/**
 * Agent Conversations (CONTRAT phase 21, propriétaire : chantier B). Appelé par le Chef Algorithme (chantier A).
 */
import type { AgentsDeps } from "../types";
import type { ConversationProfileStats } from "./contracts";

/** Chiffres par profil sur `days` jours (30 par défaut), sans IA. */
export async function computeConversationProfiles(
  _deps: AgentsDeps,
  _opts?: { days?: number },
): Promise<ConversationProfileStats[]> {
  throw new Error("computeConversationProfiles : à écrire (chantier B)");
}

/**
 * Relecture hebdomadaire par l'IA d'un échantillon anonymisé (40 conversations × 12 messages au plus par profil,
 * mineurs et /stop exclus) → motifs courts (< 80 caractères) et au plus 3 recommandations PERSONA par profil
 * (créées en PROPOSED dans `Recommendation`). Rend ce qui doit aller dans `InsightReport.stats.conversationReview`.
 */
export async function reviewConversations(
  _deps: AgentsDeps,
  _profiles: ConversationProfileStats[],
  _opts: { weekStart: string },
): Promise<{ review: unknown; recommendationIds: string[]; costCents: number }> {
  throw new Error("reviewConversations : à écrire (chantier B)");
}
