/**
 * Contrats de l'équipe Algorithme (phase 21). Signatures FIGÉES, partagées entre les chantiers :
 * A (posts, horaires, tests A/B, synthèse et réglages, worker), B (conversations), C (site).
 */
import type { AgentsDeps } from "../types";
import type { ActorRef } from "../admin/team";
import { applyRecommendationImpl, rejectRecommendationImpl, undoRecommendationImpl } from "../agents/synthese/apply";
import { runAlgoReportNowImpl } from "../chiefs/algo";

/** Chiffres d'un profil de conversation sur 30 jours (agent Conversations, chantier B), rangés dans
 * `InsightReport.stats.conversations` (tableau) et lus par le site. */
export type ConversationProfileStats = {
  /** Clé stable : `<botId>:<personaId|->:<source|->`. */
  key: string;
  botId: string;
  botLabel: string;
  /** BOT (assistant) | ACCOUNT (compte réel). */
  kind: "BOT" | "ACCOUNT";
  personaId: string | null;
  personaName: string | null;
  source: string | null;
  conversations: number;
  /** Personnes qui répondent au premier message ÷ conversations. */
  replyRate: number | null;
  medianMessagesBeforeLink: number | null;
  /** Étape où les gens décrochent le plus (`ConversationStage`). */
  dropStage: string | null;
  medianReplyDelaySec: number | null;
  /** Heures de Paris (0-23) où les gens répondent le plus. */
  replyHours: number[];
  linksSent: number;
  clicks: number;
  registrations: number;
  ftds: number;
  aiCostEur: number;
  costPerRegistrationEur: number | null;
  /** Assez de données pour conclure (seuil réglable, 30 conversations par défaut). */
  enoughData: boolean;
};

export type RecommendationActionResult = { ok: boolean; message: string };

/** Applique une recommandation (bornes revérifiées au moment d'appliquer ; persona par la logique du formulaire). Chantier A. */
export async function applyRecommendation(
  deps: AgentsDeps,
  id: string,
  actor: ActorRef | { by: "GRAND_CHEF" },
): Promise<RecommendationActionResult> {
  return applyRecommendationImpl(deps, id, actor);
}

/** Annulation en un clic : remet la valeur « avant », journalisée. Chantier A. */
export async function undoRecommendation(
  deps: AgentsDeps,
  id: string,
  actor: ActorRef,
): Promise<RecommendationActionResult> {
  return undoRecommendationImpl(deps, id, actor);
}

export async function rejectRecommendation(
  deps: AgentsDeps,
  id: string,
  actor: ActorRef,
): Promise<RecommendationActionResult> {
  return rejectRecommendationImpl(deps, id, actor);
}

/** « Rapport maintenant » : recalcule fiches, horaires, conversations, synthèse et envoie le rapport. Chantier A. */
export async function runAlgoReportNow(
  deps: AgentsDeps,
  opts?: { send?: boolean },
): Promise<{ ok: boolean; message: string; reportIds: string[] }> {
  return runAlgoReportNowImpl(deps, opts);
}
