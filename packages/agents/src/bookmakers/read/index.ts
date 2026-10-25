/** Phase 35, chantier C : lecteur des bookmakers (trois niveaux, cache, double lecture, diagnostic). */
export {
  readEvents,
  readEventsStored,
  readMarkets,
  readMarketsStored,
  readOddsTwice,
  storedEvent,
  storedEvents,
  allowedHostsOf,
  daysOf,
  type ReadEventsQuery,
  type ReadMarketsOptions,
  type OddsTwiceQuery,
  type OddsTwiceResult,
  type StoredEvent,
  type StoredOdds,
} from "./core";
export { diagnosePage, diagnoseByRules, parseAiDiagnosis, maskForAi, actionFor, gestureOf, PAGE_DIAGNOSES, DIAGNOSE_SYSTEM, type DiagnosedPage, type DiagnosisAction, type PageInput } from "./diagnose";
export {
  BookmakerReadError,
  createMemoryPace,
  memorySiteLock,
  isNightInParis,
  type BookmakerReadDeps,
  type BookmakerHooks,
  type BookmakerHookEvent,
  type ReadSite,
  type SiteLock,
  type SitePace,
} from "./deps";
export { toDecimalOdds, sameOddsExact, sameLine, type OddsFormat } from "./odds-format";
export { expandMarketKeys, translateRow, marketRefOf, sideOf, selectionKeyOf, lineOf, wantedSelection } from "./mapping";
export { parseSiteDate, zonedToUtc } from "./dates";
export { parseHtml, querySelectorAll, textOf, isSupportedSelector } from "./html";
export { readEventsFromHtml, readMarketsFromHtml, candidateNodes, pickCandidate } from "./dom-read";
export { extractRows, parsePath } from "./json-shape";
export { loadActiveRecipe, parseRecipeRow, type ActiveRecipe } from "./recipe";
export { readOddsOnImage, parseImageOdds, IMAGE_READ_SYSTEM } from "./image";
