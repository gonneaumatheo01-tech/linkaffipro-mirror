/**
 * Phase 29, chantier A : veille web de l'équipe Analystes. Exports choisis (noms propres à l'équipe) pour ne pas
 * entrer en collision avec les autres modules exportés par `src/index.ts`.
 */
export {
  AnalystsAiError,
  type AnalystsAiErrorCode,
  type WatchDeps,
  CLASSIFY_MODEL,
  SUMMARY_MODEL,
  WEB_TOOLS_MODEL,
  llmOfAnalysts,
  analystsBudgetCap,
  analystsMonthSpent,
  assertAnalystsBudget,
  recordAnalystsUsage,
  callAnalystsLlm,
} from "./ai";
export { serverWebSearch, serverWebFetch, serverToolsCostCents, WEB_SEARCH_USD, type WebSearchHit } from "./server-tools";
export {
  createAnalystsWeb,
  politeFetch,
  parseRobots,
  robotsAllows,
  looksLikeBotWall,
  memoryHostThrottle,
  processHostThrottle,
  PoliteFetchError,
  ANALYSTS_USER_AGENT,
  type PoliteWeb,
  type PoliteWebDeps,
  type HostThrottle,
  type RobotsPolicy,
} from "./polite";
export { LOCAL_TERMS, WATCH_LANGUAGES, localQuery, languageOfCountry, type LocalTerms } from "./terms";
export {
  fetchForum,
  fetchReddit,
  fetchTelegramPublic,
  searchNews,
  searchX,
  searchTelegram,
  parseForumPage,
  parseRedditListing,
  extractArticle,
  scrubPersonalData,
  pseudonymOf,
  WatchReadError,
  type WatchScrapeConfig,
  type NewsSearchRequest,
} from "./readers";
export { classifyEntry, summarizeEntry, validateClassification, TREND_CATEGORIES, TREND_SENTIMENTS, COMPLIANCE_PLATFORMS, RISK_LEVELS, type EntrySummary } from "./classify";
export {
  ingestEntries,
  scrapeSource,
  readSource,
  purgeRawTexts,
  normalizeEntryUrl,
  urlHashOf,
  platformRiskOfTags,
  alertKindOf,
  type WatchSource,
  type WatchAlert,
  type IngestResult,
  type ScrapeResult,
  type SourceDisabledEvent,
} from "./ingest";
export { seedSources, SEED_SOURCES, type SeedSource } from "./seed";
export { discoverSources, DISCOVERY_SETTING_KEY, type DiscoveryProposal, type DiscoveryResult } from "./discover";
export { loadWatchDeps } from "./runtime";
