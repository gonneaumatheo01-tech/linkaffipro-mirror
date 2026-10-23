/**
 * Agent Conversations (équipe Algorithme, phase 21) : chiffres par profil, relecture d'un échantillon anonymisé,
 * propositions de réglages de persona, heures de relance et alerte de chute. Appelé par le Chef Algorithme (pas
 * d'étape de mission : l'équipe ne publie rien). Exports nommés explicitement (aucun nom générique à l'index).
 */
export {
  DEFAULT_MIN_CONVERSATIONS,
  SAMPLE_MAX_CONVERSATIONS,
  SAMPLE_MAX_MESSAGES,
  parseConversationsSettings,
  loadConversationsSettings,
  type ConversationsAgentSettings,
} from "./settings";
export {
  aggregateProfiles as aggregateConversationProfiles,
  profileKey as conversationProfileKey,
  profileLabel as conversationProfileLabel,
  type ProfileInput as ConversationProfileInput,
} from "./profiles";
export { computeProfiles as computeConversationProfilesWindow } from "./compute";
export { anonymizeText, containsPersonalData, COMMON_FIRST_NAMES, MASKS as ANONYMIZE_MASKS } from "./anonymize";
export { buildSample as buildConversationSample, isExcludedFromSample, type SampleConversation } from "./sample";
export { parseReviewOutput as parseConversationReviewOutput, AI_PROPOSAL_FIELDS } from "./review-output";
export {
  PERSONA_RECOMMENDATION_FIELDS,
  isPersonaRecommendationField,
  type PersonaRecommendationField,
} from "./recommendations";
export { suggestFollowUpHours, followUpRatesByHour } from "./follow-up-hours";
export {
  PERSONA_DROP_ALERT_KIND,
  PERSONA_DROP_THRESHOLD,
  personaDropAlerts,
  personaDropMessage,
  computePersonaDropAlerts,
  type PersonaDropCandidate,
} from "./drop-alert";
export { type ConversationReview, type ProfileReview, type FollowUpHoursReview } from "./review";
