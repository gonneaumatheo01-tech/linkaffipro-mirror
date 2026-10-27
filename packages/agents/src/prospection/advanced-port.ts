/**
 * Phase 32 — socle : port des fonctions des chantiers A (Veilleur, Réseaux), B (Valorisateur, Boucle Link Affi) et C
 * (compte réel), appelé par `jobs.ts` et Kevin. La production prend les vraies fonctions ; les tests remplacent celles
 * qu'ils veulent par `deps.prospectionAdvanced`.
 */
import type { ProspectionAdvancedJob, ValueEstimate } from "./contract-advanced";
import type { ProspectCallbackOutcome, ProspectionKevinDeps } from "./kevin-port";
import { dueForRequalify, handleAlertCallback, requalifyProspect, sendAlertsDigest } from "./watch/index";
import { mergeProspects, rebuildNetworks, splitProspect } from "./network/index";
import { estimateProspectValue, refreshValues } from "./value/index";
import { linkAffiliate, proposeCalibration, pullAffiliateResults, runLinkReminders, sendMonthlyReport } from "./learn/index";
import { runAccountSearch } from "./discover/sources/account-search";

type AccountLot = Extract<ProspectionAdvancedJob, { type: "prospection.account-search" }>["lot"];

export type ProspectionAdvancedPort = {
  dueForRequalify(deps: ProspectionKevinDeps, now: Date, limit: number): Promise<string[]>;
  requalifyProspect(deps: ProspectionKevinDeps, prospectId: string): Promise<{ alerts: number; status: string }>;
  sendAlertsDigest(deps: ProspectionKevinDeps, now: Date): Promise<{ sent: number; qaBlocked: boolean }>;
  handleAlertCallback(deps: ProspectionKevinDeps, input: { data: string; chatId: string; actorTelegramId: string }): Promise<ProspectCallbackOutcome | null>;
  rebuildNetworks(deps: ProspectionKevinDeps): Promise<{ networks: number; members: number }>;
  mergeProspects(deps: ProspectionKevinDeps, prospectIds: string[], by: "client" | "system"): Promise<{ ok: boolean; networkId: string | null; message?: string | null }>;
  splitProspect(deps: ProspectionKevinDeps, prospectId: string, by: "client" | "system"): Promise<{ ok: boolean; message?: string | null }>;
  estimateProspectValue(deps: ProspectionKevinDeps, prospectId: string): Promise<ValueEstimate | null>;
  refreshValues(deps: ProspectionKevinDeps, now: Date): Promise<{ updated: number }>;
  linkAffiliate(deps: ProspectionKevinDeps, prospectId: string, affiliateId: string, by: "client" | "system"): Promise<{ ok: boolean; message?: string | null }>;
  pullAffiliateResults(deps: ProspectionKevinDeps, month?: string | null): Promise<{ affiliates: number; rows: number; activated: number }>;
  proposeCalibration(deps: ProspectionKevinDeps, now: Date): Promise<{ proposed: number; reason?: string | null }>;
  sendMonthlyReport(deps: ProspectionKevinDeps, month?: string | null): Promise<{ sent: boolean; qaBlocked: boolean }>;
  runLinkReminders(deps: ProspectionKevinDeps, now: Date): Promise<{ sent: number }>;
  runAccountSearch(deps: ProspectionKevinDeps, lot: AccountLot): Promise<{ ok: boolean; requests: number; found: number; newCount: number; stopped?: string | null }>;
};

const REAL: ProspectionAdvancedPort = {
  dueForRequalify,
  requalifyProspect,
  sendAlertsDigest,
  handleAlertCallback,
  rebuildNetworks,
  mergeProspects,
  splitProspect,
  estimateProspectValue,
  refreshValues,
  linkAffiliate,
  pullAffiliateResults,
  proposeCalibration,
  sendMonthlyReport,
  runLinkReminders,
  runAccountSearch,
};

export function prospectionAdvancedPort(deps: { prospectionAdvanced?: Partial<ProspectionAdvancedPort> }): ProspectionAdvancedPort {
  return { ...REAL, ...(deps.prospectionAdvanced ?? {}) };
}
