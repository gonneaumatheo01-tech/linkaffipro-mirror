/**
 * Validations humaines (CONTRAT, propriétaire : chantier B « dialogue admin »). Signatures figées : le moteur
 * (chantier A) appelle `requestValidation`, le site (chantier C) `decideValidation`.
 */
import type { AgentsDeps, TeamKey } from "../types";

export type RequestValidationInput = {
  missionId: string;
  teamKey: TeamKey;
  previewText: string;
  mediaAssetId?: string | null;
  reason: string;
  /** Nom du canal réellement visé (affiché dans l'aperçu). */
  channelTitle?: string | null;
};

/** Crée l'`AgentValidation`, passe la mission en WAITING_VALIDATION et envoie l'aperçu (✅ / ✏️ / ❌) à l'admin. */
export async function requestValidation(
  _deps: AgentsDeps,
  _input: RequestValidationInput,
): Promise<{ validationId: string; number: number }> {
  throw new Error("requestValidation : à écrire (chantier B)");
}

export type DecideValidationInput = {
  /** Identifiant ou numéro court. */
  validationId?: string;
  number?: number;
  decision: "approve" | "edit" | "reject";
  /** Texte corrigé (décision « edit » depuis le site, ou message suivant de l'admin sur Telegram). */
  editedText?: string;
  rejectReason?: string | null;
  via: "SITE" | "TELEGRAM";
  byUserId?: string | null;
};

export type DecideValidationResult = { ok: true; message: string } | { ok: false; message: string };

/** Décision (Publier / Corriger / Refuser) : met à jour la validation, l'`AuditLog`, puis reprend ou annule la mission. */
export async function decideValidation(
  _deps: AgentsDeps,
  _input: DecideValidationInput,
): Promise<DecideValidationResult> {
  throw new Error("decideValidation : à écrire (chantier B)");
}
