/**
 * Phase 32, chantier B — Boucle Link Affi : rattachement, résultats réels, calibrage proposé, rapport mensuel.
 * Link Affi en lecture seule (`deps.linkAffiReader`, GET seulement) ; calibrage jamais appliqué sans le client.
 * - `link.ts` : « @x = affilié 1234 », question à la signature, rappels du lundi ;
 * - `pull.ts` : `AffiliateResult` par mois, ACTIVE au premier dépôt, arrêt proposé après 60 jours sans clic ;
 * - `calibrate.ts` : coefficients par segment, attribution des sources, poids du score → `Recommendation` ;
 * - `apply.ts` : choix numérotés, application bornée + `Experiment`, annulation ;
 * - `report.ts` : rapport mensuel (QA `REPORT`) ; `performance.ts` : résultats par affilié, estimé contre réel.
 */
import type { QaDeps } from "../../qa/contract";
import type { ProspectionKevinDeps } from "../kevin-port";
import { proposeCalibration as proposeCalibrationImpl, type ProposeResult } from "./calibrate";
import { sendMonthlyReport as sendMonthlyReportImpl } from "./report";

export { linkAffiliate, askLinkAffiId, answerLinkChoice, runLinkReminders, parseAffiliateId, readLinkAsk, signedWithoutLink, LINK_ASK_KEY, LINKABLE_STATUSES, type LinkCandidate, type LinkResult } from "./link";
export { pullAffiliateResults, churnProposals, monthRange, monthsToPull, previousMonthOf, type PullResult } from "./pull";
export {
  loadSamples,
  coefficientProposals,
  clippedMedian,
  boundedFactor,
  attribution,
  proposeShares,
  proposeWeights,
  sharesOf,
  withinCoefficientBounds,
  withinShareBounds,
  withinWeightBounds,
  noCalibrationText,
  CALIBRATION_TARGETS,
  DISCOVERY_SHARES_KEY,
  DISCOVERY_SHARE_SOURCES,
  DISCOVERY_LABELS,
  DEFAULT_DISCOVERY_SHARES,
  WEIGHT_LABELS,
  type AttributionRow,
  type CalibrationSample,
  type CoefficientProposal,
  type DiscoveryShares,
  type ProposeResult,
} from "./calibrate";
export {
  listCalibrationChoices,
  calibrationChoicesMessage,
  applyCalibration,
  undoCalibration,
  closeCalibrationExperiments,
  calibrationHistory,
  calibrationSegments,
  CALIBRATION_LAST_APPLY_KEY,
  CALIBRATION_EXPERIMENT_METRIC,
  type CalibrationActor,
  type CalibrationChoice,
  type ApplyCalibrationResult,
  type UndoCalibrationResult,
} from "./apply";
export { buildMonthlyReport, monthlyReportData, monthLabel, type MonthlyReportData } from "./report";
export { affiliatePerformance, estimatedVsReal, signedAffiliates, monthLine, type AffiliatePerformance, type EstimatedVsReal, type EstimatedVsRealRow, type EstimatedVsRealSegment } from "./performance";
export { aggregateAffiliateStats, recentAffiliatesFrom, profileNameOf, LINKAFFI_STATS_COLUMNS, PROFILE_NAME_COLUMNS, type AffiliateStatsAggregate, type RecentAffiliate } from "./linkaffi-rows";
export { LINK_VARIANTS, CALIBRATION_VARIANTS, REPORT_VARIANTS, PERFORMANCE_VARIANTS } from "./texts";

/** Calibrage mensuel : propositions `Recommendation` en choix numérotés, dans les bornes. */
export async function proposeCalibration(deps: ProspectionKevinDeps, now: Date): Promise<ProposeResult> {
  return proposeCalibrationImpl(deps as ProspectionKevinDeps & QaDeps, now);
}

/** Rapport mensuel « ce que rapporte la prospection » (QA `REPORT`). Une fois par mois (repère posé par `jobs.ts`). */
export async function sendMonthlyReport(deps: ProspectionKevinDeps, month?: string | null): Promise<{ sent: boolean; qaBlocked: boolean }> {
  return sendMonthlyReportImpl(deps as ProspectionKevinDeps & QaDeps, month);
}
