/**
 * Phase 31, chantier B — Agent Enrichisseur (`docs/prompts/33-phase-31-prospection-affilies.md`, section 3).
 * Exports nommés (pas de `export *`) : les autres chantiers ajoutent leurs propres modules à `prospection/index.ts`.
 */
export { EnrichAiError, callEnrichLlm, enrichLlmOf, type EnrichAiErrorCode, type EnrichDeps } from "./ai";
export { parseAudienceCount, parseChannelPage, fetchChannelPage, type AudienceCount } from "./page";
export { parseProspectPreview, readProspectPosts, tmeUsernameOf, mentionsIn, type ParsedProspectPreview, type ProspectPostExtras, type ProspectPostsResult } from "./posts";
export { computeMetrics, coefficientOfVariation, hasExternalLink } from "./metrics";
export { hardFilters, DEFAULT_HARD_FILTER_SETTINGS, type HardFilterCode, type HardFilterHit, type HardFilterSettings } from "./filters";
export { fakeSignals } from "./fake";
export { detectLanguage, detectTextLanguage, detectLanguageConfirmed, type LanguageGuess, type LanguageResult } from "./language";
export { detectGeo, brandCountry, type GeoEvidence, type GeoInput, type GeoResult } from "./geo";
export {
  analyzeChannel,
  parseChannelAnalysis,
  buildAnalyzePrompt,
  selectPostsForAnalysis,
  analysisAllowedNumbers,
  clipEvidence,
  clipSummary,
  ANALYZE_SYSTEM,
  type AnalyzeInput,
  type ChannelAnalyzeResult,
} from "./analyze";
export {
  extractContacts,
  contactsFromLinkedPage,
  fetchLinkedPage,
  findLinkedGroup,
  findLinkedPageUrl,
  evidenceAround,
  type ContactsInput,
  type ContactsResult,
  type LinkedPage,
} from "./contacts";
export { mergeBrands, detectBrandLinks, isAffiliateLink, promoCodesIn, type BrandWindow, type DetectedBrand, type MergedBrands } from "./brands";
export { regulatoryFlagFor, regulatoryText, marketsOfVertical } from "./regulatory";
export { qcEnrichment, type QcInput, type QcResult } from "./qc";
export { enrichProspect, copiesPostText, guessVerticalFromText, limitPostEvidence, NO_PREVIEW_REASON, type EnrichOutcome } from "./enrich";
