/**
 * Phase 29, chantier C — ce que Kevin et la file `agents-analystes` appellent chez les autres chantiers, derrière un
 * seul port (faux en test, `deps.analystsKevin`) :
 * - chantier A (veille) : `scrapeSource`, `seedSources`, `discoverSources`, `purgeRawTexts` ;
 * - chantier B (compliance, stratège, rapporteur) : `buildInitialRules`, `checkEntryCompliance`, `reverifyRules`,
 *   `answerMarketQuestion`, `weeklySynthesis`, `buildWeeklyReport`, `buildBriefing`, `alertFor`.
 * La production prend les vraies fonctions ; les tests remplacent celles qu'ils veulent.
 */
import type { BossDeps } from "../boss/contract";
import { alertFor, type AlertEntry, type AlertRule, type AnalystsAlert } from "./alert-texts";
import { buildInitialRules, checkEntryCompliance, reverifyRules, type EntryComplianceResult, type InitialRulesResult, type ReverifyResult } from "./compliance";
import type { AnalystsDeps, AnalystsQueueJob } from "./contract";
import type { AnalystsBrainDeps } from "./reasoning";
import { buildBriefing, buildWeeklyReport, type BriefingRequest, type BriefingResult, type WeeklyReportResult } from "./reporter";
import { answerMarketQuestion, weeklySynthesis, type MarketAnswer, type MarketQuestion, type WeeklySynthesis } from "./strategist";
import { discoverSources, type DiscoveryResult } from "./watch/discover";
import { purgeRawTexts, scrapeSource, type ScrapeResult } from "./watch/ingest";
import { seedSources } from "./watch/seed";

export type AnalystsKevinPort = {
  scrapeSource(deps: AnalystsKevinDeps, sourceId: string): Promise<ScrapeResult>;
  seedSources(deps: AnalystsKevinDeps): Promise<{ created: number; existing: number }>;
  discoverSources(deps: AnalystsKevinDeps): Promise<DiscoveryResult>;
  purgeRawTexts(deps: AnalystsKevinDeps): Promise<{ purged: number }>;
  buildInitialRules(deps: AnalystsKevinDeps): Promise<InitialRulesResult>;
  checkEntryCompliance(deps: AnalystsKevinDeps, entryId: string): Promise<EntryComplianceResult>;
  reverifyRules(deps: AnalystsKevinDeps): Promise<ReverifyResult>;
  answerMarketQuestion(deps: AnalystsKevinDeps, q: MarketQuestion): Promise<MarketAnswer>;
  weeklySynthesis(deps: AnalystsKevinDeps): Promise<WeeklySynthesis>;
  buildWeeklyReport(deps: AnalystsKevinDeps, synthesis: WeeklySynthesis | null): Promise<WeeklyReportResult>;
  buildBriefing(deps: AnalystsKevinDeps, input: BriefingRequest): Promise<BriefingResult>;
  alertFor(item: AlertRule | AlertEntry, opts?: { chatId?: string | number | null }): AnalystsAlert;
};

/** Mise en file `agents-analystes` (worker, site, bot) ; absente : Kevin répond sans attendre (tests, outils). */
export type AnalystsEnqueue = (job: AnalystsQueueJob, opts?: { jobId?: string; delayMs?: number }) => Promise<void>;

/** Dépendances de Kevin et de la file pour l'équipe Analystes (au-dessus de celles du Boss et des chantiers A / B). */
export type AnalystsKevinDeps = BossDeps &
  AnalystsDeps &
  AnalystsBrainDeps & {
    analysts?: { enqueue?: AnalystsEnqueue };
    /** Fonctions des autres chantiers remplacées (tests). */
    analystsKevin?: Partial<AnalystsKevinPort>;
  };

const REAL: AnalystsKevinPort = {
  scrapeSource: (deps, id) => scrapeSource(deps, id),
  seedSources: (deps) => seedSources(deps),
  discoverSources: (deps) => discoverSources(deps),
  purgeRawTexts: (deps) => purgeRawTexts(deps),
  buildInitialRules: (deps) => buildInitialRules(deps),
  checkEntryCompliance: (deps, id) => checkEntryCompliance(deps, id),
  reverifyRules: (deps) => reverifyRules(deps),
  answerMarketQuestion: (deps, q) => answerMarketQuestion(deps, q),
  weeklySynthesis: (deps) => weeklySynthesis(deps),
  buildWeeklyReport: (deps, synthesis) => buildWeeklyReport(deps, deps.now ? deps.now() : new Date(), { synthesis }),
  buildBriefing: (deps, input) => buildBriefing(deps, input),
  alertFor: (item, opts) => alertFor(item, opts),
};

export function analystsPort(deps: Pick<AnalystsKevinDeps, "analystsKevin">): AnalystsKevinPort {
  return { ...REAL, ...(deps.analystsKevin ?? {}) };
}
