/**
 * Phase 31, chantier C — Évaluateur : score (pur), enregistrement du score, dossier (Opus). Exports nommés (pas de
 * `export *`) pour éviter toute collision à la racine du paquet.
 */
export { scoreProspect, audiencePoints, viewRatePoints, interactionPoints, bestOffer, verticalCompatible, AUDIENCE_STEPS, type ScoreInputExtras, type ScoreSettingsInput } from "./score";
export {
  scoreAndStore,
  scoreInputOf,
  activeOffers as activeAffiliateOffers,
  contactsOf as prospectContactsOf,
  isTopB,
  CLIENT_PIPELINE_STATUSES,
  type ProspectRow,
  type OfferRow as AffiliateOfferRow,
  type ContactRow as ProspectContactRow,
} from "./store";
export {
  buildDossier,
  dossierFacts,
  dossierLines,
  dossierProblems,
  dossierAllowance,
  dossierMessage,
  requestDossierDelivery,
  DOSSIER_VARIANTS,
  DOSSIER_LEGAL_LINE,
  DOSSIER_MAX_LINES,
  DOSSIER_REQUEST_PREFIX,
  type DossierDeps,
} from "./dossier";
export {
  loadScoreSettings,
  loadCountriesScope as loadProspectionCountriesScope,
  regionVisible as prospectRegionVisible,
  DEFAULT_SCORE_SETTINGS,
  type ScoreSettings,
} from "./settings";
export {
  formatCount as formatProspectCount,
  flagOf as countryFlag,
  countryName as prospectCountryName,
  handleOf as prospectHandle,
  PROSPECT_STATUS_LABELS,
  VERTICAL_LABELS as PROSPECT_VERTICAL_LABELS,
  CONTACT_CONFIDENCE_LABELS,
  FAKE_FLAG_LABELS,
  RISK_FLAG_LABELS,
  COMPETITION_LABELS as PROSPECT_COMPETITION_LABELS,
  SOURCE_TYPE_LABELS as PROSPECT_SOURCE_LABELS,
} from "./format";
