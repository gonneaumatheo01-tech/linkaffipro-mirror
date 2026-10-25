/**
 * Phase 35, chantier B — APPRENDRE UN SITE (recette) : enregistrement guidé, masquage des secrets, analyse par Opus,
 * validation sans réseau, réutilisation par moteur de paris, apprentissage complet avec contrôle réel.
 * Le parcours guidé est branché sur le transport du chantier A (`setRecordSite`) au chargement de ce module.
 */
import { registeredRecordSite, setRecordSite } from "../transport/hooks";
import { recordSite } from "./record";

export {
  recordSite,
  usefulHeaders,
  responseKind,
  marketTabsOf,
  RECORD_STEPS,
  isListStep,
  isMarketStep,
  type RecordOptions,
} from "./record";
export { maskRecording, leakedSecrets, SECRET_MARK, type MaskOptions } from "./mask";
export { pageOddsFromHtml, parseDisplayedOdds, type PageOdd } from "./page-odds";
export { detectProviderHint, PROVIDER_PATTERNS, UNKNOWN_PROVIDER } from "./provider";
export { rebaseRecording, rebaseRecipe, recipeOrigins, replaceOrigin } from "./rebase";
export { createPlaywrightRecordIo, humanDelayMs, type PlaywrightIoOptions } from "./playwright-io";
export {
  analyzeRecording,
  parseRecipeData,
  reduceRecording,
  compactHtml,
  classifyMarkets,
  marketNamesOf,
  sportsLlmAllowed,
  LEARN_SYSTEM,
  MARKETS_SYSTEM,
  type AnalyzeResult,
  type AnalyzeOptions,
  type AnalyzeDeps,
  type ParsedRecipe,
} from "./analyze";
export {
  validateRecipe,
  validationSummary,
  referenceEvents,
  compareEvents,
  compareOdds,
  apiEventsOf,
  apiOddsOf,
  domEventsOf,
  domOddsOf,
  responseMatchesEndpoint,
  type ReferenceEvent,
  type RecipeOdd,
  type ValidateOptions,
} from "./validate";
export {
  learnSite,
  reuseRecipeByProvider,
  liveCheckRecipe,
  readLearnState,
  learnAllowed,
  obstacleText,
  LEARN_STATE_PREFIX,
  type LearnDeps,
  type LearnReason,
  type LearnResult,
  type LearnState,
  type LiveCheck,
  type ReusedRecipe,
} from "./learn";

if (!registeredRecordSite()) setRecordSite(recordSite);
