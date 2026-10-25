/**
 * Phase 29 — équipe Analystes. Le contrat (`./contract`) est exporté à part par `src/index.ts`.
 * Chaque chantier ajoute ses lignes ici.
 */
// Chantier A : veille (sources, lecture polie, classement, résumé, rangement, découverte, purge).
export * from "./watch/index";

// Chantier B : Compliance (règles des plateformes), Stratège (réponses, synthèse, recommandations), Rapporteur
// (rapport de la semaine, briefings, alertes). Exports nommés (pas de `export *`) pour éviter les collisions.
export {
  ANALYSTS_TASK_MODELS,
  ANALYSTS_TASK_MAX_TOKENS,
  ANALYSTS_DATA_RULES,
  callAnalystsTask,
  brainLlmOf,
  parseAnalystsJson,
  type AnalystsTask,
  type AnalystsBrainDeps,
  type InternalFigure,
} from "./reasoning";
export {
  LEGAL_REWRITE_SENTENCE,
  sanitizeLegal as sanitizeAnalystsLegal,
  hasLegalAdvice as hasAnalystsLegalAdvice,
  honestWorkaround,
  stripUnknownUrls as stripUnknownAnalystsUrls,
  RISK_LABELS as ANALYSTS_RISK_LABELS,
} from "./citations";
export {
  MARKETS as ANALYSTS_MARKETS,
  MARKET_LABELS as ANALYSTS_MARKET_LABELS,
  PLATFORM_LABELS as ANALYSTS_PLATFORM_LABELS,
  COUNTRY_LABELS as ANALYSTS_COUNTRY_LABELS,
  countryLabel as analystsCountryLabel,
} from "./analysis-labels";
export { loadInternalFigures } from "./internal";
export {
  buildInitialRules,
  checkEntryCompliance,
  reverifyRules,
  OFFICIAL_POLICY_PAGES,
  COMPLIANCE_CATEGORIES,
  COMPLIANCE_LIMITS,
  isRuleVerified,
  mergeEvidence as mergeRuleEvidence,
  evidenceOf as ruleEvidenceOf,
  validateProposedRule,
  saveProposedRule,
  alertRiskThreshold,
  type PolicyPage,
  type RuleEvidence,
  type ProposedRule,
  type SavedRule,
  type InitialRulesResult,
  type EntryComplianceResult,
  type ReverifyResult,
} from "./compliance";
export {
  answerMarketQuestion,
  weeklySynthesis,
  finalizeAnswer as finalizeMarketAnswer,
  validateRecommendation as validateMarketRecommendation,
  saveMarketRecommendation,
  recommendationLine as marketRecommendationLine,
  noDataAnswer as noMarketDataAnswer,
  MARKET_RECOMMENDATION_TARGET,
  MARKET_RECOMMENDATION_FIELD,
  AD_TYPES as ANALYSTS_AD_TYPES,
  AD_ANGLES as ANALYSTS_AD_ANGLES,
  AD_TYPE_LABELS as ANALYSTS_AD_TYPE_LABELS,
  AD_ANGLE_LABELS as ANALYSTS_AD_ANGLE_LABELS,
  type MarketQuestion,
  type MarketAnswer,
  type WeeklySynthesis,
  type SynthesisGroup,
  type SynthesisTrend,
  type SynthesisRecommendation,
  type AdType as AnalystsAdType,
  type AdAngle as AnalystsAdAngle,
} from "./strategist";
export {
  buildWeeklyReport,
  buildBriefing,
  alertFor,
  ALERT_VARIANTS as ANALYSTS_ALERT_VARIANTS,
  complianceAlertText,
  trendAlertText,
  analystsPageUrl,
  ANALYSTS_PAGE_PATH,
  WEEKLY_REPORT_MAX_CHARS,
  codeWeeklyReport,
  weeklyReportProblems,
  weeklyReportFacts,
  briefingTitle,
  isoWeekOf,
  type AnalystsAlert,
  type AlertRule,
  type AlertEntry,
  type WeeklyReportFacts,
  type WeeklyReportResult,
  type BriefingRequest,
  type BriefingResult,
} from "./reporter";

// Chantier C : Kevin et la file `agents-analystes` (tâches du worker, réponses différées, lectures instantanées,
// fiches des agents). Exports nommés pour éviter les collisions.
export {
  runAnalystsJob,
  composeAnalystsAnswer,
  ANALYSTS_COMPLIANCE_CATEGORIES,
  ANALYSTS_BOOTSTRAP_SETTING,
  ANALYSTS_RUNS_SETTING,
  ANALYSTS_ACTIVATE_ANSWER,
} from "./kevin-jobs";
export { analystsPort, type AnalystsKevinPort, type AnalystsKevinDeps, type AnalystsEnqueue } from "./kevin-port";
export { analystsEnabled, analystsScheduleSettings, sendKevin as sendAnalystsKevin, type AnalystsRequest } from "./kevin-state";
export { analystsAgentCard, ANALYSTS_AGENT_KEYS } from "./kevin-view";
