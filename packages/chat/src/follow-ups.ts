// Relances après un silence (contrat §3.7, règle 5 du client) : au plus 2, la 2e au moins 24 h après la 1re, jamais
// après /stop, un mineur, un blocage ou une reprise par l'équipe ; une relance due entre 22 h et 9 h (Paris) part à 10 h.
import { parisWallClock, parisWallTimeToDate } from "./paris-time";
import type { ConversationStage, ConversationStatus } from "./types";

export const MAX_FOLLOW_UPS = 2;
export const MIN_FOLLOW_UP_AFTER_HOURS = 4;
export const MIN_HOURS_BETWEEN_FOLLOW_UPS = 24;
/** Heures calmes de Paris : de 22 h à 9 h ; la relance est alors décalée à 10 h. */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 9;
export const QUIET_SHIFT_HOUR = 10;

const HOUR_MS = 3_600_000;
/** Étapes après lesquelles une relance peut être prévue (pas après la seule présentation). */
const FOLLOW_UP_STAGES: readonly ConversationStage[] = [
  "CHAT",
  "PROPOSAL",
  "LINK_SENT",
  "FOLLOW_UP",
];

export type FollowUpState = {
  status: ConversationStatus;
  stage: ConversationStage;
  isMinor: boolean;
  stoppedAt: Date | null;
  /** Relances déjà envoyées depuis le dernier message de la personne. */
  followUpCount: number;
  /** Dernier message de l'assistant (une relance comprise). */
  lastAssistantAt: Date | null;
};

export type FollowUpRules = {
  followUpAfterHours: number;
  followUpsMax: number;
  /**
   * Heures de Paris conseillées par l'équipe Algorithme (phase 21, `Persona.suggestedFollowUpHours`) : non vide
   * seulement si une recommandation les a appliquées ; la relance est alors repoussée à la prochaine de ces heures.
   */
  suggestedFollowUpHours?: readonly number[] | null;
};

/** Vrai si cette heure tombe dans les heures calmes de Paris (22 h – 9 h). */
export function isQuietHour(d: Date): boolean {
  const { hour } = parisWallClock(d);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/** Décale un instant des heures calmes à 10 h (Paris) : le jour même avant 9 h, le lendemain à partir de 22 h. */
export function shiftOutOfQuietHours(d: Date): Date {
  const p = parisWallClock(d);
  if (p.hour >= QUIET_START_HOUR)
    return parisWallTimeToDate(p.year, p.month, p.day + 1, QUIET_SHIFT_HOUR);
  if (p.hour < QUIET_END_HOUR) return parisWallTimeToDate(p.year, p.month, p.day, QUIET_SHIFT_HOUR);
  return d;
}

/** Nombre de relances permis par la persona (0 à 2, jamais plus de 2). */
export function followUpsAllowed(rules: Pick<FollowUpRules, "followUpsMax">): number {
  const n = Math.round(rules.followUpsMax);
  return Math.min(MAX_FOLLOW_UPS, Math.max(0, Number.isFinite(n) ? n : 0));
}

/**
 * Prochaine relance, ou null : statut BOT seulement, ni /stop ni mineur, étape CHAT / PROPOSAL / LINK_SENT /
 * FOLLOW_UP, moins de min(2, followUpsMax) relances. 1re relance : `followUpAfterHours` (au moins 4 h) après le dernier
 * message de l'assistant ; 2e : au moins 24 h après la 1re. Heures calmes → 10 h.
 */
export function nextFollowUpAt(state: FollowUpState, rules: FollowUpRules): Date | null {
  if (state.status !== "BOT" || state.isMinor || state.stoppedAt) return null;
  if (!FOLLOW_UP_STAGES.includes(state.stage)) return null;
  if (!state.lastAssistantAt) return null;
  if (state.followUpCount >= followUpsAllowed(rules)) return null;
  const after = Number.isFinite(rules.followUpAfterHours)
    ? rules.followUpAfterHours
    : MIN_FOLLOW_UP_AFTER_HOURS;
  let hours = Math.max(MIN_FOLLOW_UP_AFTER_HOURS, after);
  if (state.followUpCount >= 1) hours = Math.max(hours, MIN_HOURS_BETWEEN_FOLLOW_UPS);
  const due = new Date(state.lastAssistantAt.getTime() + hours * HOUR_MS);
  return shiftOutOfQuietHours(shiftToSuggestedHour(due, rules.suggestedFollowUpHours));
}

/**
 * Lit `Persona.suggestedFollowUpHours` (JSON) : heures entières 0-23 hors heures calmes, sans doublon, triées ; null
 * si rien d'utilisable (champ vide = jamais appliqué : le calcul habituel reste en vigueur).
 */
export function parseSuggestedFollowUpHours(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const hours = [
    ...new Set(
      v.filter(
        (h): h is number =>
          typeof h === "number" && Number.isInteger(h) && h >= QUIET_END_HOUR && h < QUIET_START_HOUR,
      ),
    ),
  ].sort((a, b) => a - b);
  return hours.length > 0 ? hours : null;
}

/**
 * Repousse un instant à la prochaine heure conseillée (début de l'heure de Paris), jamais plus tôt : les délais
 * minimaux (4 h, 24 h entre deux relances) restent tenus. Sans heure conseillée utilisable : inchangé.
 */
export function shiftToSuggestedHour(d: Date, suggested: readonly number[] | null | undefined): Date {
  const hours = parseSuggestedFollowUpHours(suggested);
  if (!hours) return d;
  const p = parisWallClock(d);
  if (hours.includes(p.hour)) return d;
  for (let k = 1; k <= 24; k++) {
    const t = parisWallTimeToDate(p.year, p.month, p.day, p.hour + k);
    if (hours.includes(parisWallClock(t).hour)) return t;
  }
  return d;
}
