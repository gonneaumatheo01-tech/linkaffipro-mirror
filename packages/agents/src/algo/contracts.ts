/**
 * Contrats de l'équipe Algorithme (phase 21). Signatures FIGÉES, partagées entre les chantiers :
 * A (posts, horaires, tests A/B, synthèse et réglages, worker), B (conversations), C (site).
 */
import type { AgentsDeps } from "../types";
import type { ActorRef } from "../admin/team";

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
  _deps: AgentsDeps,
  _id: string,
  _actor: ActorRef | { by: "GRAND_CHEF" },
): Promise<RecommendationActionResult> {
  throw new Error("applyRecommendation : à écrire (chantier A)");
}

/** Annulation en un clic : remet la valeur « avant », journalisée. Chantier A. */
export async function undoRecommendation(
  _deps: AgentsDeps,
  _id: string,
  _actor: ActorRef,
): Promise<RecommendationActionResult> {
  throw new Error("undoRecommendation : à écrire (chantier A)");
}

export async function rejectRecommendation(
  _deps: AgentsDeps,
  _id: string,
  _actor: ActorRef,
): Promise<RecommendationActionResult> {
  throw new Error("rejectRecommendation : à écrire (chantier A)");
}

/** « Rapport maintenant » : recalcule fiches, horaires, conversations, synthèse et envoie le rapport. Chantier A. */
export async function runAlgoReportNow(
  _deps: AgentsDeps,
  _opts?: { send?: boolean },
): Promise<{ ok: boolean; message: string; reportIds: string[] }> {
  throw new Error("runAlgoReportNow : à écrire (chantier A)");
}
