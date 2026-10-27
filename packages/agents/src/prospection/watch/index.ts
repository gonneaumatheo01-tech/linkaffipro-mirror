/**
 * Phase 32, chantier A — Veilleur : relecture allégée, changements, suivi des affiliés signés, message du matin.
 * Signatures figées appelées par `advanced-port.ts` (`dueForRequalify`, `requalifyProspect`, `sendAlertsDigest`,
 * `handleAlertCallback`) ; lectures et actions pour Kevin et le site (`listAlerts`, `muteAlertKind`,
 * `unmuteAlertKind`, `markAlertSeen`, `muteProspectAlerts`, `unmuteProspectAlerts`, `answerPendingAlertNote`).
 */
import type { ProspectCallbackOutcome, ProspectionKevinDeps } from "../kevin-port";
import { dueForRequalify as due, requalifyProspect as requalify } from "./requalify";
import { handleAlertCallback as alertCallbackImpl, sendAlertsDigest as digest } from "./digest";

/** Prospects dont la relecture est due (cadences `WATCH_LIMITS.cadenceDays`), les plus en retard d'abord. */
export async function dueForRequalify(deps: ProspectionKevinDeps, now: Date, limit: number): Promise<string[]> {
  return due(deps, now, limit);
}

/** Relit un prospect (page + 20 posts), enregistre un `ProspectSnapshot`, détecte et écrit les alertes. */
export async function requalifyProspect(deps: ProspectionKevinDeps, prospectId: string): Promise<{ alerts: number; status: string }> {
  return requalify(deps, prospectId);
}

/** Message du matin (09:10) : 8 alertes au plus, QA `ALERT`, boutons `pra:`. Une fois par jour (repère posé par `jobs.ts`). */
export async function sendAlertsDigest(deps: ProspectionKevinDeps, now: Date): Promise<{ sent: number; qaBlocked: boolean }> {
  return digest(deps, now);
}

/** Bouton `pra:<alertId>:<action>` ; null si ce n'est pas un bouton d'alerte. */
export async function handleAlertCallback(deps: ProspectionKevinDeps, input: { data: string; chatId: string; actorTelegramId: string }): Promise<ProspectCallbackOutcome | null> {
  return alertCallbackImpl(deps, input);
}

export {
  listAlerts,
  markAlertSeen,
  muteAlertKind,
  unmuteAlertKind,
  muteProspectAlerts,
  unmuteProspectAlerts,
  mutedAlertKinds,
  recordAlerts,
  clipEvidence,
  isAlertKind,
  ALERT_KINDS,
  MUTED_KINDS_KEY,
  MUTE_OFFERED_KEY,
  type AlertListItem,
  type ProspectAlertRow,
} from "./alerts";
export {
  answerPendingAlertNote,
  alertButtons,
  alertCallback,
  parseAlertCallback,
  selectDigestAlerts,
  sortAlertsForDigest,
  kindsToOfferMute,
  PENDING_ALERT_NOTE_PREFIX,
  PENDING_ALERT_NOTE_TTL_MS,
  type AlertCallbackAction,
} from "./digest";
export { diffSnapshots, growthCheck, referencePoint, familyOf, brandKeyOf, ONCE_PER_KEY_KINDS, WATCH_PIPELINE_STATUSES, WATCH_SIGNED_STATUSES, type DiffInput, type DiffResult, type GrowthCheck } from "./diff";
export { cadenceDaysFor, nextDueAt, lightPostsPerDay, networkHints, mergeStoredBrands, WATCHED_STATUSES } from "./requalify";
export { compactionPlan, mergeSnapshotRows, snapshotPointOf, baselinePointOf, brandsOf, type SnapshotRow, type CompactionPlan } from "./snapshots";
export {
  watchAffiliate,
  ourLinksStats,
  isOurLink,
  codeAffiliateFindings,
  parseAffiliateWatch,
  buildAffiliateWatchPrompt,
  OUR_LINK_HOSTS,
  RISKY_CLAIM_LABELS,
  AFFILIATE_WATCH_SYSTEM,
  type RiskyClaimType,
  type AffiliateFinding,
} from "./affiliates-watch";
export { ALERT_KIND_LABELS, ALERT_BUTTONS, WATCH_ALERT_VARIANTS, WATCH_DIGEST_VARIANTS, alertVariants, evidenceLine, changeText } from "./texts";
