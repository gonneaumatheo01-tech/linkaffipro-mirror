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
export { resolveOddsProvider, resolveSgoProvider, hasOddsKey, ODDS_SECRET_KEY, migrateCategoryMarketTypes, type CategoryMarketsMigration, type OddsResolveDeps } from "./providers/odds-registry";
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
// Chantier B (phase 27) : analyse d'un canal d'inspiration, comparaison « eux / nous », profil de style.
export { UNIVERSE_OF_VERTICAL as INSPIRATION_UNIVERSE_OF_VERTICAL, UNIVERSE_LABELS as INSPIRATION_UNIVERSE_LABELS, type AnalysisPost } from "./inspiration/analysis/types";
export { textSignals, hasGainClaim, type TextSignals } from "./inspiration/analysis/patterns";
export { fromReferencePost, fromClientPost, type ReferencePostRow } from "./inspiration/analysis/normalize";
export { rhythmMeasures, peakSlotsOf, slotOf as inspirationSlotOf, PEAK_SLOT_COUNT, WEEKDAY_LABELS as INSPIRATION_WEEKDAY_LABELS } from "./inspiration/analysis/rhythm";
export { formMeasures, MEDIA_LABELS as INSPIRATION_MEDIA_LABELS } from "./inspiration/analysis/form";
export { contentMeasures, flaggedOf, betSeriesOf, BET_SERIES_MAX_HOURS, type BetSeries } from "./inspiration/analysis/content";
export { resultsMeasures, describePost, MIN_CORRELATION_POSTS, MIN_GROUP_POSTS, DAY_PERIODS } from "./inspiration/analysis/results";
export { analyzeReference, computeAnalysis, isInspirationUniverse, loadReference, loadReferencePosts, quotesOf, type ComputeOptions } from "./inspiration/analysis/analyze";
export {
  compareWithChannel,
  compareAnalyses,
  gapMatters,
  parseGapThresholds,
  loadGapThresholds,
  loadClientPosts,
  COMPARE_WINDOW_DAYS,
  DEFAULT_GAP_THRESHOLDS,
  INSPIRATION_THRESHOLDS_KEY,
  type GapThresholds,
} from "./inspiration/analysis/compare";
export * from "./inspiration/style";
// Chantier A (phase 27) : lecture d'un canal d'inspiration (aperçu web, compte réel membre, posts transférés).
export * from "./inspiration/sources/web-preview";
export * from "./inspiration/sources/account";
export * from "./inspiration/sources/forwarded";
export * from "./inspiration/features";
export * from "./inspiration/store";
export * from "./inspiration/read";
// Chantier C (phase 27) : Kevin et le canal d'inspiration (résumé, propositions, application, posts transférés).
export {
  afterReferenceRead,
  afterReferenceReread,
  inspirationSummaryLines,
  summaryFacts,
  methodChanges,
  snapshotOf,
  askForForwards,
  notifyReadPostponed,
  notifyReadFailed,
  shouldRebuildProfile,
  REREAD_THRESHOLDS,
  SUMMARY_MAX_LINES,
  SUMMARY_QUESTION,
} from "./inspiration/kevin";
export {
  inspirationProposals,
  proposalsText,
  mixSteps,
  proposedWindow,
  theirMixShares,
  mergeTaggedLine,
  INSPIRATION_SOURCE,
  SPORTS_RESULT_POSTS_SUPPORTED,
  type InspirationProposal,
  type ProposalsResult,
} from "./inspiration/proposals";
export {
  applyInspiration,
  undoInspiration,
  removeReference,
  inspirationReviews,
  enoughTrafficForAb,
  changePct,
  reviewSentence,
  INSPIRATION_UNDO_DAYS,
  INSPIRATION_TEST_DAYS,
  INSPIRATION_REPORT_TEAM,
  type ApplyInspirationResult,
  type UndoInspirationResult,
} from "./inspiration/apply";
export {
  kevinForwardedPost,
  inspirationForwardAck,
  isChannelForward,
  forwardAckLine,
  FORWARD_ACK_JOB,
  FORWARD_BATCH_MS,
  type ForwardInput,
  type ForwardOutcome,
} from "./inspiration/kevin-forward";
export { referenceLabel, linkTarget, universeRefusal, type ReferenceRow } from "./inspiration/kevin-refs";
export {
  INSPIRATION_ACTIONS,
  inspirationFastPath,
  parseProposalNumbers,
  choiceIsOpen,
  choiceIsForAdmin,
  INSPIRATION_CHOICE_SETTING,
} from "./boss/catalog-inspiration";
import "./inspiration/keep-action";
export * from "./inspiration/sources/userbot-mailbox";
export * from "./orders/contract";
export * from "./boss/voice";
// Chantier C (phase 33) : annuaire des agents, vues en lecture seule de Kevin (plan, programmé, paris, matchs, fait, pourquoi).
export { AGENT_DIRECTORY, agentDirectory, agentEntry, findAgent, agentCard, agentAbilities, orderTeamLabel, type AgentEntry, type AgentKind, type FindAgentResult, type AgentCardOptions } from "./orders/agents-dict";
export { viewPlan, planLines, mixLabel, nextPassageOf, type ViewPlanInput, type PlanEntry } from "./orders/view/plan";
export { viewScheduled, scheduledLines, type ViewScheduledInput, type ScheduledItem } from "./orders/view/scheduled";
export { viewSportsChannel, previewSportsPicks, categoriesForChannel, type PreviewCandidate } from "./orders/view/sports";
export { viewMatches, matchLines, registerBookmakerMatchLister, sportIdOf, bookKey, type ViewMatchesInput, type MatchesResult, type BookmakerMatch, type BookmakerMatchLister, type MatchesDeps } from "./orders/view/matches";
export { viewDone, pendingValidations, validationLines, failureText, type ViewDoneInput } from "./orders/view/done";
export { whyNothing, WHY_CAUSES, type WhyCause, type WhyFinding } from "./orders/view/why";
export { slotRange, resolveDay, fitLines, VIEW_MAX_LINES, DAY_SLOTS, type DaySlot, type ViewResult } from "./orders/view/common";
export { VIEW_ACTIONS, VIEW_ACTION_KEYS, viewReply } from "./boss/catalog-view";
// Phase 33, chantier B : Kevin comprend, planifie, récapitule, fait confirmer, suit les ordres.
export {
  openOrders,
  orderById,
  findOrderRef,
  ordersMemoryLines,
  orderShortLine,
  periodLabel,
  ORDER_STATUS_LABELS,
  FUTURE_TEAMS,
  type TeamOrderRow,
  type StoredInterpretation,
} from "./orders/current";
export { planOrder, plannerContext, plannerUser, normalizePlannerOutput, defaultStartDay as defaultOrderStartDay, planCacheKeyOf, PLANNER_SYSTEM, type PlanResult, type PlannedOrder, type PlannerInput } from "./orders/planner";
export { validatePlan, findOverlap, clampParams, type ValidatedPlan, type ValidatedStep, type ImpossibleOut, type ValidationStatus } from "./orders/validate";
export {
  orderRecap,
  submitOrder,
  classifyOrder,
  recapWhatLine,
  recapAdjustLine,
  startOrder,
  confirmOrderLaunch,
  replayAlternative,
  resolveOverlapChoice,
  orderQuickCancel,
  ORDER_CONFIRM_ACTION,
  ORDER_ALTERNATIVE_ACTION,
  ORDER_OVERLAP_ACTION,
  ORDER_QUICK_CANCEL_SETTING,
  type OrderClass,
  type OrderReply,
  type OrderSubmitContext,
} from "./orders/recap";
export { handleOrderRequest, sweepStaleOrderConfirmations } from "./orders/request";
export { sendOrderReport, orderReportText, installOrderReports } from "./orders/reports";
export { recordOrderUnmet, weeklyUnmetLines, groupUnmet, unmetGroupLine, isUnmetDigestDay, type UnmetGroup } from "./orders/unmet";
export { ORDER_ACTIONS, ORDER_INTERNAL_KEYS, orderStatusLines, applyModification, orderTeamOf } from "./boss/catalog-orders";
export type { BossLlmExt, FakePlanner } from "./boss/llm";
// Phase 33, chantier A : registre des capacités, thèmes de paris, Grand Chef (exécution, dérogations, suivi des ordres).
export { listCapabilities, capability, capabilitiesForAgent, capabilitiesOf, registerCapabilities, orderableTeams, isOrderableTeam, BUILTIN_CAPABILITIES, type AnyCapability } from "./orders/registry";
export { runOrder, stopOrder, extendOrder, modifyOrder, planSteps, type RunOrderResult } from "./orders/run";
export { tickOrders, type TickResult } from "./orders/tick";
export { setOrderEventHook, emitOrderEvent, type OrderEvent, type OrderEventHook, type OrderEventType } from "./orders/events";
export { activeOverridesFor, activeOverridesOn, overrideConflicts, overrideActiveOn, type OverrideRow, type OverrideConflict } from "./orders/overrides";
export { planOrderMissions } from "./orders/day-missions";
export { orderFacts } from "./orders/facts";
export { parseOrderPlan, type OrderProgress } from "./orders/store";
export { orderMissionFacts, resolvePeriod, frRange, type OrderMissionFacts } from "./orders/capabilities/kit";
export { SPORTS_THEMES, resolveTheme, themeByKey, themeOfMarkets, marketsAvailable, themeOddsCounts, themesWithOdds, listBetThemes, DEFAULT_THEME_LEAGUES, type SportsTheme, type ThemeAvailability } from "./sports/themes";
export * from "./bookmakers/contract";
// Phase 35, chantier A : transport des bookmakers (serveur, Mac, choix de la cible, verrou par site, rythme, nuit),
// file des travaux de lecture et garde « jamais de mise » étendue à la lecture.
export * from "./bookmakers/jobs";
export * from "./bookmakers/guard";
export * from "./bookmakers/transport/index";
// Phase 35, chantier D : sites, identifiants communs, santé, gestes (tester, apprendre, navigateur du Mac), vues de Kevin.
export * from "./bookmakers/sites";
export { readBookmakerCredentialsFor, hasDefaultCredentials, credentialsSummary, askBookmakerCredentials, combineDefaultCredentials, DEFAULT_LOGIN_REQUEST_KEY, DEFAULT_PASSWORD_REQUEST_KEY, TEST_ALL_REQUEST_KEY, CREDENTIALS_ASKED_SETTING, type SiteCredentials } from "./bookmakers/credentials";
export * from "./bookmakers/health";
export * from "./bookmakers/actions";
export { siteMatchesView, bookmakersStatusView, oddsOfView, resolveSiteView, agoLabel, frOdds, pickSelection, type MatchesQuery, type OddsQuery } from "./bookmakers/views";
export { BOOKMAKERS_VARIANTS } from "./boss/bookmakers-texts";
// Phase 35, chantier B : apprendre un site (enregistrement guidé, masquage, analyse par Opus, validation, recette).
export * from "./bookmakers/learn/index";
// Phase 35, chantier C : lecteur à trois niveaux (cache, double lecture, diagnostic), fournisseur `bookmaker-direct`,
// vérification des paris lus sur un site du client, capture par la recette apprise.
export {
  readEvents,
  readEventsStored,
  readMarkets,
  readMarketsStored,
  readOddsTwice,
  storedEvent,
  storedEvents,
  allowedHostsOf,
  diagnosePage,
  diagnoseByRules,
  parseAiDiagnosis,
  maskForAi,
  actionFor,
  gestureOf,
  PAGE_DIAGNOSES,
  BookmakerReadError,
  createMemoryPace,
  memorySiteLock,
  isNightInParis,
  toDecimalOdds,
  sameOddsExact,
  expandMarketKeys,
  translateRow,
  loadActiveRecipe,
  parseRecipeRow,
  readOddsOnImage,
  parseImageOdds,
  type ReadEventsQuery,
  type ReadMarketsOptions,
  type OddsTwiceQuery,
  type OddsTwiceResult,
  type StoredEvent,
  type StoredOdds,
  type DiagnosedPage,
  type DiagnosisAction,
  type PageInput,
  type BookmakerReadDeps,
  type BookmakerHooks,
  type BookmakerHookEvent,
  type ReadSite,
  type SiteLock,
  type SitePace,
  type ActiveRecipe,
} from "./bookmakers/read/index";
export { recipeCaptureConfig, stepSelector, marketBlockSelector } from "./bookmakers/read/capture-config";
export {
  createBookmakerDirectProvider,
  cachedDirectEvents,
  directEventId,
  parseDirectEventId,
  readySites,
  matchOddsEvent,
  leagueKeyOf,
  BOOKMAKER_DIRECT,
  DIRECT_EVENT_PREFIX,
  type BookmakerDirectDeps,
  type BookmakerDirectProvider,
} from "./providers/bookmaker-direct";
export { verifyDirectOdds, isDirectPick, MAX_RESELECTIONS, MAX_RECAPTURES, type DirectOddsOk } from "./sports/direct-odds";
export { expandCategoryMarkets } from "./sports/data";
export { unusualOddsOf, UNUSUAL_ODDS_GAP_PCT } from "./agents/cotes/select";
export * from "./site/contract";
export { SITE_OPS } from "./site/ops";
export { SITE_PARITY } from "./site/parity";
// Phase 34, chantier A (socle) : registre, signature de l'entrée interne, outils de l'IA, déroulé, erreurs en phrases
// de collègue, capacités du planificateur, client en processus du site.
export { siteOp, listSiteOps, siteOpsByDomain, siteDomainOf, indexSiteOps, SITE_DOMAIN_LABELS, SITE_DOMAINS } from "./site/registry";
export { siteOpsKeyFrom, signSiteOpsBody, verifySiteOpsSignature, type SiteOpsSignatureCheck } from "./site/signing";
export { siteTools, siteToolDecision, siteToolName, publicParamsOf, SITE_TOOL_PREFIX } from "./site/tools";
export {
  runSiteFlow,
  proceedSiteFlow,
  executeSiteFlow,
  siteRightsOf,
  siteOpAllowed,
  siteConfirmOf,
  registerSiteOpClassifier,
  siteDeleteWordReply,
  handleSiteChoiceCallback,
  isSiteChoiceData,
  readSiteFlowState,
  SITE_FLOW_VARIANTS,
  type SiteFlowState,
  type SiteFlowReply,
  type SiteRights,
  type SiteRightsLevel,
} from "./site/flow";
export { choicesFor } from "./site/choices";
export { colleagueError, colleagueMessage, colleagueRules, missingFieldOf, SITE_ERRORS_VARIANTS } from "./site/errors";
export { siteCapabilities, siteCapability, isOrderableSiteOp, SITE_CAPABILITY_TEAM } from "./site/capabilities";
export { SITE_OP_ACTION, SITE_OP_DELETE_ACTION, SITE_CHOICE_PREFIX, SITE_SELF_AUDITED_ACTIONS } from "./site/keys";
export { setInProcessSiteOps, inProcessSiteOpsPort, portSiteOps } from "./site/port";
export { scanServerActions, checkParity, parityMarkdown, parityTable, parityOk, isUseServerFile, type ServerActionEntry, type ServerActionFile, type ParityReport } from "./site/parity-scan";

// Phase 34, chantier F : entrées Telegram (message transféré, fichier, liens d'autorisation, reprise après OAuth).
export * from "./boss/inputs";
export * from "./montage/contract";

// Phase 28, chantier B : moteur ffmpeg du montage (exécuteurs, rendu en un passage, contrôle qualité, fixtures de test).
export * from "./montage/ffmpeg";

// Phase 28, chantier C : IA du montage (instructions, plan de coupe, sous-titres, lisibilité) ; les autres chantiers ajoutent leurs lignes dans `montage/index.ts`.
export * from "./montage/index";
export * from "./analysts/contract";

// Phase 29 : équipe Analystes (chantier A : veille ; B et C ajoutent leurs lignes dans `analysts/index.ts`).
export * from "./analysts/index";
export * from "./qa/contract";

// Phase 30 : QA Global (chantier A : moteur ; B et C ajoutent leurs lignes dans `qa/index.ts`).
export * from "./qa/index";

// Phase 30, chantier B : branchements du QA Global dans les sorties des équipes (posts, shorts, rapports, alertes,
// recommandations, réponses de Kevin, rattrapage).
export * from "./qa-gates/index";

// Phase 31 : équipe Prospection (contrat ; les chantiers ajoutent leurs lignes dans `prospection/index.ts`).
export * from "./prospection/index";
// Phase 32, chantier D (site) : contrat avancé de la Prospection et fonctions appelées par les cœurs du site
// (fusion / séparation d'un réseau, rattachement Link Affi). Les autres chantiers peuvent aussi les exporter depuis
// `prospection/index.ts` : même liaison, aucun conflit.
export * from "./prospection/contract-advanced";
export { mergeProspects, splitProspect } from "./prospection/network/index";
export { linkAffiliate } from "./prospection/learn/index";
