/**
 * Agent Conversations (CONTRAT phase 21, propriétaire : chantier B). Appelé par le Chef Algorithme (chantier A).
 * Logique dans `agents/conversations/`.
 */
import { computeProfiles } from "../agents/conversations/compute";
import { runConversationReview, type ConversationReview, type ReviewDeps } from "../agents/conversations/review";
import type { AgentsDeps } from "../types";
import type { ConversationProfileStats } from "./contracts";

/** Chiffres par profil sur `days` jours (30 par défaut, se terminant maintenant ou à `end`), sans IA. */
export async function computeConversationProfiles(
  deps: AgentsDeps,
  opts?: { days?: number; end?: Date },
): Promise<ConversationProfileStats[]> {
  return (await computeProfiles(deps, opts)).profiles;
}

/**
 * Relecture hebdomadaire par l'IA d'un échantillon anonymisé (40 conversations × 12 messages au plus par profil,
 * mineurs et /stop exclus) → motifs courts (< 80 caractères) et au plus 3 recommandations PERSONA par profil
 * (créées en PROPOSED dans `Recommendation`), plus les heures de relance par persona (calcul sans IA). Rend ce qui
 * doit aller dans `InsightReport.stats.conversationReview`. `deps` peut porter `providers.llm` (tests) ; sinon la clé
 * de Réglages → IA, et sans clé aucune relecture.
 */
export async function reviewConversations(
  deps: AgentsDeps,
  profiles: ConversationProfileStats[],
  opts: { weekStart: string },
): Promise<{ review: ConversationReview; recommendationIds: string[]; costCents: number }> {
  return runConversationReview(deps as ReviewDeps, profiles, opts);
}
