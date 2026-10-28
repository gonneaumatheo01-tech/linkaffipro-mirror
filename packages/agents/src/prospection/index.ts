// Phase 31 : équipe Prospection (chantiers A à D ajoutent leurs lignes ici).
export * from "./contract";
export * from "./score";
export * from "./pipeline";
export * from "./discover";
export * from "./dict";
// Chantier D : Kevin et la file `agents-prospection` (tâches, boutons, chemin rapide, offres, accès réseau du worker).
export * from "./jobs";
export { isProspectCallbackData, mayChangePipeline, prospectButton, prospectionFastPath } from "./kevin-buttons";
export { prospectionPort, type ProspectionKevinDeps, type ProspectionKevinPort, type ProspectCallbackOutcome } from "./kevin-port";
export { ensureProspectionOfferQuestions, PROSPECTION_OFFER_KEYS } from "./kevin-offers";
export { answerProspectionQuestion } from "./kevin-answer";
export { createProspectionWeb, loadProspectionWeb, PROSPECTION_USER_AGENT } from "./web-runtime";
export * from "./enrich";
// Phase 32, chantier C : Kevin (boutons d'alerte `pra:`, chemin rapide, recherche par compte réel).
export { isProspectAlertCallbackData, prospectAlertButton, prospectionAdvancedFastPath, offerAccountSearchOnce } from "./kevin-advanced";
export { prospectionAdvancedKevinPort, type ProspectionAdvancedKevinPort, type ProspectionAdvancedKevinDeps } from "./kevin-advanced-port";
export { accountSearchEnabled, createUserbotSearchTransport, runAccountSearch, type AccountSearchTransport } from "./discover/sources/account-search";
