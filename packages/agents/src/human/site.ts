/**
 * Demandes au client depuis le site (onglet « Demandes » de `/agents/validations`) et balayage périodique
 * (CONTRAT, propriétaire : chantier B). Mêmes règles que par Telegram.
 */
import type { AgentsDeps } from "../types";
import type { ActorRef } from "../admin/team";

export type AnswerResult = { ok: boolean; message: string };

/** Réponse donnée depuis le site (texte, numéro d'option, oui / non, clé). */
export async function answerHumanRequestFromSite(
  _deps: AgentsDeps,
  _requestId: string,
  _answer: string,
  _actor: ActorRef,
): Promise<AnswerResult> {
  throw new Error("answerHumanRequestFromSite : à écrire (chantier B)");
}

/** « Plus tard » : la demande est passée, la suivante part. */
export async function skipHumanRequest(
  _deps: AgentsDeps,
  _requestId: string,
  _actor: ActorRef,
): Promise<AnswerResult> {
  throw new Error("skipHumanRequest : à écrire (chantier B)");
}

/** Relance en un clic d'une demande expirée ou passée (remise dans la file). */
export async function relaunchHumanRequest(
  _deps: AgentsDeps,
  _requestId: string,
  _actor: ActorRef,
): Promise<AnswerResult> {
  throw new Error("relaunchHumanRequest : à écrire (chantier B)");
}

/** Balayage (file `agents-orchestrator`, tâche `human-requests`) : envoi de la suivante, rappel 24 h, expiration 7 jours. */
export async function sweepHumanRequests(_deps: AgentsDeps): Promise<{ sent: number; reminded: number; expired: number }> {
  throw new Error("sweepHumanRequests : à écrire (chantier B)");
}

/** Crée une seule fois la demande CONFIRM « Veux-tu recevoir chaque matin le rapport des agents ? » (`Setting` `agents.dailyReport`). */
export async function ensureDailyReportQuestion(_deps: AgentsDeps): Promise<void> {
  throw new Error("ensureDailyReportQuestion : à écrire (chantier B)");
}
