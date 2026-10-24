/**
 * @linkaffipro/agents (phase 19) : Grand Chef, Chefs d'équipe, agents, règles pures, demandes au client.
 * Sans Next.js ni grammY ; tout fournisseur externe est injecté.
 */
export * from "./types";
export * from "./missions/lifecycle";
export * from "./validation/requests";
export * from "./human/requests";
export * from "./admin/team";
export * from "./human/secrets";
export * from "./human/site";
// Chantier B : validation humaine, demandes au client, dialogue admin Telegram, dépôt dans la médiathèque.
export * from "./validation/sweep";
export * from "./human/answer";
export * from "./human/respond";
export * from "./admin/commands";
export * from "./admin/handle";
export * from "./admin/callbacks";
export { adminTelegramId, telegramActorUserId } from "./admin/journal";
export * from "./library/tags";
export * from "./library/store";
// Chantier A : moteur (règles, fournisseurs, agents, Chefs, Grand Chef).
export * from "./rules/content";
export * from "./rules/similarity";
export * from "./rules/slots";
export * from "./rules/time";
export * from "./providers/llm";
export * from "./providers/fake";
export type * from "./providers/video";
export type * from "./providers/image";
export * from "./providers/costs";
export { ProviderError } from "./providers/http";
export { createFalClient, createFalImageProvider, createFalVideoProvider, FAL_IMAGE_MODEL, FAL_VIDEO_MODEL } from "./providers/fal";
export { createMagicHourVideoProvider } from "./providers/magichour";
export {
  MAGICHOUR_SECRET_KEY,
  VIDEO_RESOLUTIONS,
  DEFAULT_VIDEO_RESOLUTION,
  DEFAULT_MAX_VIDEO_SECONDS,
  mediaSettings,
  resolveMediaProviders,
  pickVideoProviderName,
  type MediaSettings,
  type MediaProviders,
} from "./providers/registry";
export * from "./providers/verifiers";
export { DATING_DEFAULT_MIX } from "./chiefs/dating-format";
export { DATING_DEFAULT_BUDGET_CENTS } from "./missions/settings";
export { LOW_SOURCE_STOCK, unusedSourceCount } from "./agents/mediatheque/stock";
export type * from "./providers/odds";
export type * from "./providers/screenshot";
export * from "./missions/settings";
export * from "./missions/usage";
export * from "./missions/mission";
export { buildContext, resolveProviders, type EngineDeps } from "./missions/context";
export { AGENT_REGISTRY, PAID_PROVIDERS, agentFor } from "./agents/registry";
export { CHAINS, chainOf } from "./chiefs/index";
export type { Chain } from "./chiefs/chain";
export { runNextStep, type StepOutcome } from "./chiefs/engine";
export * from "./orchestrator/autonomy";
export * from "./orchestrator/budgets";
export * from "./orchestrator/collisions";
export * from "./orchestrator/pause";
export * from "./orchestrator/plan-day";
export * from "./orchestrator/reports";
export * from "./orchestrator/resume";
export * from "./orchestrator/cycle";
export { simulationHeader, withSimulationHeader } from "./agents/publication/header";
export * from "./missions/test-post";
export * from "./orchestrator/bench";
export * from "./human/dating-setup";
// Chantier B (phase 20) : vocaux de l'admin, plafond par poste.
export * from "./admin/voice";
export * from "./admin/budget";

// Vérificateurs des clés fal.ai et Magic Hour (bouton « Vérifier », réponse au bot) : enregistrés au chargement.
import { registerMediaKeyVerifiers } from "./providers/verifiers";
registerMediaKeyVerifiers();
export * from "./algo/contracts";
export * from "./algo/conversations-contract";
// Chantier B (phase 21) : agent Conversations de l'équipe Algorithme.
export * from "./agents/conversations/index";
// Chantier A (phase 21) : équipe Algorithme.
export * from "./algo/settings";
export * from "./algo/week";
export * from "./algo/alerts";
export * from "./algo/setup";
export { algoChain, algoDue, runAlgoNightly, runAlgoTick, runAlgoWeekly, ALGO_NIGHTLY_KEY, ALGO_WEEKLY_KEY } from "./chiefs/algo";
export * from "./agents/posts/features";
export * from "./agents/posts/rank";
export { computePostInsights, loadInsightRows, INSIGHT_HISTORY_DAYS } from "./agents/posts/insights";
export { runPostsAgent, personaNames, type PostsAgentResult } from "./agents/posts/index";
export * from "./agents/horaires/besthours";
export * from "./agents/horaires/windows";
export { runHorairesAgent, BEST_HOURS_SOURCE, BEST_HOURS_SOURCE_KEY, type HorairesResult } from "./agents/horaires/index";
export * from "./agents/experimentation/stats";
export * from "./agents/experimentation/verdict";
export * from "./agents/experimentation/variants";
export {
  createExperiment,
  startExperiment,
  cancelExperiment,
  closeExperiments,
  proposeExperiments,
  experimentProposals,
  experimentsState,
  OPEN_EXPERIMENT_STATUSES,
  type NewExperiment,
} from "./agents/experimentation/index";
export * from "./agents/synthese/bounds";
export { currentValue, sameValue } from "./agents/synthese/apply";
export * from "./agents/synthese/proposals";
export * from "./agents/synthese/report";
export { runSynthese, autoApplyPending, type SyntheseResult } from "./agents/synthese/index";
export * from "./casino/contracts";
// Chantier B (phase 22) : dépôt casino par le bot, thèmes des médias, classement.
export { addCasinoTheme, casinoTagsFor, casinoThemesOfAsset, readCasinoThemes } from "./casino/themes";
export { applyCasinoThemes } from "./casino/classify";
export { CREATE_THEME_ACTION, casinoDepositLine, stockPhrase, type CasinoDepositInfo } from "./casino/deposit";
// Chantier A (phase 22) : moteur de l'équipe Casino.
export * from "./casino/settings";
export * from "./casino/rotation";
export * from "./casino/pick";
export { stockRows, computeCasinoStock } from "./casino/stock";
export * from "./casino/format";
export * from "./casino/requests";
export * from "./casino/offer";
export * from "./casino/control";
export * from "./casino/setup";
export { casinoThemesOf, channelThemes } from "./casino/data";
export { inventedFigures, offerFiguresIn } from "./rules/figures";
export { runCasinoMediatheque, casinoFallbacksOf } from "./agents/mediatheque/casino";
export * from "./sports/contracts";
// Chantier B (phase 23) : captures chez les bookmakers, garde « jamais de mise », parade anti-blocage.
export * from "./providers/screenshot/index";
export { connectionMessage, registerBookmakerVerifiers, CONNECTION_TEST_WAIT_MS, type ConnectionTestOutcome } from "./sports/connection";
export { agent as captureAgent, captureRequestOf, type CapturePayload } from "./agents/capture";
import { registerBookmakerVerifiers } from "./sports/connection";
registerBookmakerVerifiers();
// Chantier A (phase 23) : cotes, sélection, chaîne du Chef Paris, résultats.
export { createSportsGameOddsProvider, verifySportsGameOddsKey, SGO_BASE, type SportsGameOddsProvider } from "./providers/sportsgameodds";
export { americanToDecimal, mapEvent, mapSelections, mapResult } from "./providers/sportsgameodds-map";
export { createFakeOddsProvider, FAKE_ODDS_ANCHOR, type FakeOddsProvider } from "./providers/fake-odds";
export { createMemoryOddsCache, withOddsCache, ODDS_TTL, type OddsCache } from "./providers/odds-cache";
export { createOddsQuota, oddsCallsThisMonth, OddsQuotaError } from "./providers/odds-quota";
export { resolveOddsProvider, hasOddsKey, ODDS_SECRET_KEY } from "./providers/odds-registry";
export * from "./rules/bets";
export * from "./rules/bet-settle";
export * from "./rules/bet-summary";
export * from "./sports/labels";
export { parseSportsSettings, loadSportsSettings, DEFAULT_SPORTS_SETTINGS, DEFAULT_SPORTS_FORBIDDEN_WORDS, type SportsSettings } from "./sports/settings";
export { toCategory, loadCategory, activeCategories, type BetCategoryInfo, type PickRow } from "./sports/data";
export { betPostText, reasoningSentences, kickoffLabel } from "./sports/format";
export { createBetMission } from "./sports/missions";
export { runSportsPassage, type SportsPassageResult } from "./sports/passage";
export { duePassage, parsePassageState, SPORTS_PASSAGES_SETTING } from "./sports/passage-state";
export { runSportsSettle, type SettleRunResult } from "./sports/settle";
export { computeBetSummary, sportsReportNotes, weekStart } from "./sports/summary";
export { ensureSportsSetupQuestions, askCaptureWorkaround, parseNumberList, SPORTS_SETUP_SETTING, WORKAROUND_OPTIONS } from "./sports/setup";
export { rankCandidates, type Candidate, type PickReasoning } from "./agents/cotes/select";
export { fallbackPng } from "./sports/pick-image";
export * from "./ads/contracts";
// Chantier A (phase 24) : Agent Ads (analyse, règles, recommandations jamais appliquées, rapports, alertes).
export * from "./rules/report-numbers";
export * from "./rules/ads";
export { FUNNEL_STEPS, FUNNEL_LABELS, funnelRates, bottleneckOf, type FunnelRate, type FunnelStepKey } from "./agents/ads/funnel";
export { COHORT_DAYS, COHORT_WINDOW_DAYS, adCohorts } from "./agents/ads/cohorts";
export { adsRange, type AdsRange } from "./agents/ads/periods";
export type { AdsRowDetail, AdsAnalysisDetail } from "./agents/ads/build";
export { toMetrics as adsMetricsOf, EMPTY_METRICS as EMPTY_ADS_METRICS } from "./agents/ads/metrics";
export * from "./agents/ads/thresholds";
export { computeAdsAnalysisImpl, loadAdsContext, loadAdsThresholdsView, analysisOf as adsAnalysisOf, type AdsContext } from "./agents/ads/analysis";
export { ADS_TEAM_KEY, ADS_NEVER_APPLIED, ADS_OUTDATED_COMMENT, saveAdsRecommendations } from "./agents/ads/recommendations";
export * from "./agents/ads/report";
export * from "./agents/ads/alerts";
export * from "./agents/ads/setup";
export {
  ADS_LAST_DAILY_KEY,
  ADS_LAST_WEEKLY_KEY,
  ADS_PAGE_PATH,
  adsPageUrl,
  adsReportKey,
  adsReportsDue,
  adsProposalsOf,
  dailyFacts as adsDailyFacts,
  weeklyFacts as adsWeeklyFacts,
  isAdsPaused,
  runAdsDaily,
  runAdsWeekly,
  runAdsTick,
  runAdsReportNowImpl as runAdsReportNow,
} from "./agents/ads/run";
export * from "./orchestrator/overview-contract";
export * from "./boss/contract";
export * from "./boss/register-port";
// Chantier C (phase 26) : démarrage guidé, aide, carnet des besoins non couverts, relance quotidienne du Boss.
export * from "./boss/guide";
export * from "./boss/help";
export * from "./boss/unmet";
export * from "./boss/nudge";
// Chantier B (phase 26) : cerveau du Boss (catalogue fermé, interprète, réponses chiffrées, mémoire, confirmations).
export * from "./boss/params";
export * from "./boss/catalog-kit";
export * from "./boss/catalog";
export * from "./boss/catalog-read";
export * from "./boss/catalog-teams";
export * from "./boss/catalog-univers";
export * from "./boss/facts";
export * from "./boss/answer";
export * from "./boss/memory";
export * from "./boss/llm";
export * from "./boss/resolve";
export * from "./boss/confirm";
export * from "./boss/interpret";
export * from "./boss/execute";
export * from "./boss/fast";
export * from "./control/channel-plan";
export * from "./control/bet-category";
// Phase 26, section 4 : Kevin en équipe (groupe Telegram, membres présentés, droits, demandes adressées).
export * from "./boss/catalog-team";
export * from "./boss/team/addressed";
export * from "./boss/team/members";
export * from "./boss/team/rights";
export * from "./boss/team/parse";
export * from "./boss/team/group";
export * from "./boss/team/incoming";
export * from "./boss/team/morning";
export * from "./boss/team/callbacks";
export * from "./human/delivery";
export * from "./inspiration/contract";
export * from "./inspiration/copy-check";
