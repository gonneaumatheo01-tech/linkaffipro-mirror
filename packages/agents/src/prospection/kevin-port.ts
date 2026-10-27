/**
 * Phase 31, chantier D — ce que Kevin et la file `agents-prospection` appellent chez les autres chantiers, derrière un
 * seul port (faux en test, `deps.prospectionKevin`) :
 * - chantier A (Sourceur) : `planDiscoveryLots`, `runDiscovery`, `requestDiscovery`, `addManualProspect` ;
 * - chantier B (Enrichisseur) : `enrichProspect` ;
 * - chantier C (Évaluateur, Pipeline) : `scoreAndStore`, `buildDossier`, `transitionProspect`, `addProspectNote`,
 *   `sendDailyTop`, `handleProspectCallback`, `answerPendingDeal`, `runReminders`, `sendWeeklyReport`.
 * La production prend les vraies fonctions ; les tests remplacent celles qu'ils veulent.
 */
import type { BossDeps } from "../boss/contract";
import type { AdminButton, LlmProvider } from "../types";
import type { DiscoveryLot, ProspectionDeps, ProspectStatus } from "./contract";
import { addManualProspect, planDiscoveryLots, requestDiscovery, runDiscovery } from "./discover/index";
import { enrichProspect } from "./enrich/enrich";
import { buildDossier, scoreAndStore } from "./score/index";
import { addProspectNote, answerPendingDeal, handleProspectCallback, returnSkippedProspects, runReminders, sendDailyTop, sendWeeklyReport, snoozeProspect, transitionProspect } from "./pipeline/index";

/** Réponse à un bouton `prospect:<id>:<action>` : petit message au doigt, réponse de Kevin, nouveaux boutons. */
export type ProspectCallbackOutcome = {
  handled?: boolean;
  toast?: string | null;
  reply?: string | null;
  buttons?: AdminButton[][];
  removeButtons?: boolean;
};

export type ProspectTransitionOptions = {
  by: "client" | "system";
  dealType?: "CPA" | "REVSHARE" | "HYBRID" | null;
  dealTerms?: Record<string, unknown> | null;
  snoozeDays?: number | null;
};

export type ProspectionKevinPort = {
  planDiscoveryLots(deps: ProspectionKevinDeps, now: Date): Promise<DiscoveryLot[]>;
  runDiscovery(deps: ProspectionKevinDeps, lot: DiscoveryLot): Promise<unknown>;
  requestDiscovery(deps: ProspectionKevinDeps, req: { countries: string[]; vertical: "SPORTS" | "CASINO"; requestId: string }): Promise<unknown>;
  /** Canal ajouté par le client (MANUAL, enrichi en priorité) ; `prospectId` null si le lien est refusé. */
  addManualProspect(deps: ProspectionKevinDeps, input: { url: string }, by: "client" | "system"): Promise<{ prospectId: string | null; created: boolean; reason?: string | null }>;
  enrichProspect(deps: ProspectionKevinDeps, prospectId: string): Promise<{ status: ProspectStatus; reason: string | null; scoreQueued: boolean }>;
  scoreAndStore(deps: ProspectionKevinDeps, prospectId: string): Promise<unknown>;
  buildDossier(deps: ProspectionKevinDeps, prospectId: string): Promise<unknown>;
  transitionProspect(deps: ProspectionKevinDeps, prospectId: string, to: ProspectStatus, opts: ProspectTransitionOptions): Promise<{ ok: boolean; message?: string | null }>;
  snoozeProspect(deps: ProspectionKevinDeps, prospectId: string, days: number): Promise<{ ok: boolean; message?: string | null }>;
  returnSkippedProspects(deps: ProspectionKevinDeps): Promise<number>;
  addProspectNote(deps: ProspectionKevinDeps, prospectId: string, note: string, by: string): Promise<unknown>;
  /** Top du jour (`morning`) ou à la demande (`on_demand`) : rend le nombre de canaux envoyés. */
  sendDailyTop(deps: ProspectionKevinDeps, opts: { count?: number; now?: Date; scope?: "morning" | "on_demand" }): Promise<{ sent: number; qaBlocked: boolean }>;
  handleProspectCallback(deps: ProspectionKevinDeps, input: { data: string; chatId: string; actorTelegramId: string }): Promise<ProspectCallbackOutcome>;
  /** Montant après « CPA » (« 100 ») : réponse de Kevin, ou null si aucune question de montant n'est ouverte. */
  answerPendingDeal(deps: ProspectionKevinDeps, chatId: string, text: string): Promise<string | null>;
  runReminders(deps: ProspectionKevinDeps, now: Date): Promise<unknown>;
  sendWeeklyReport(deps: ProspectionKevinDeps, now: Date): Promise<unknown>;
};

/** Dépendances de Kevin et de la file pour l'équipe Prospection. */
export type ProspectionKevinDeps = BossDeps &
  ProspectionDeps & {
    /** IA des questions complexes (Opus) ; absente : fournisseur Anthropic réel (clé de Réglages → IA). */
    prospectionLlm?: LlmProvider | null;
    /** Fonctions des autres chantiers remplacées (tests). */
    prospectionKevin?: Partial<ProspectionKevinPort>;
  };

/* eslint-disable @typescript-eslint/no-explicit-any */
const REAL: ProspectionKevinPort = {
  planDiscoveryLots: async (deps, now) => (await planDiscoveryLots(deps as any, now)) as DiscoveryLot[],
  runDiscovery: (deps, lot) => runDiscovery(deps as any, lot),
  requestDiscovery: (deps, req) => requestDiscovery(deps as any, req as any),
  addManualProspect: async (deps, input, by) => {
    const r = await addManualProspect(deps as any, input, by);
    return r.ok ? { prospectId: r.prospectId, created: r.created } : { prospectId: null, created: false, reason: r.reason };
  },
  enrichProspect: (deps, id) => enrichProspect(deps as any, id),
  snoozeProspect: async (deps, id, days) => {
    const r = (await snoozeProspect(deps as any, id, days, "client")) as any;
    return { ok: r?.ok !== false, message: (r?.reason ?? null) as string | null };
  },
  returnSkippedProspects: (deps) => returnSkippedProspects(deps as any),
  scoreAndStore: (deps, id) => scoreAndStore(deps as any, id),
  buildDossier: (deps, id) => buildDossier(deps as any, id),
  transitionProspect: async (deps, id, to, opts) => {
    const r = (await transitionProspect(deps as any, id, to as any, opts as any)) as any;
    return { ok: r?.ok !== false, message: (r?.reason ?? null) as string | null };
  },
  addProspectNote: (deps, id, note, by) => addProspectNote(deps as any, id, note, by as any),
  sendDailyTop: (deps, opts) => sendDailyTop(deps as any, { count: opts.count, now: opts.now, chatScope: opts.scope ?? "morning" }),
  handleProspectCallback: async (deps, input) => {
    const r = await handleProspectCallback(deps as any, input);
    if (!r) return { handled: false };
    return { handled: true, toast: r.toast, reply: r.reply?.html ?? null, ...(r.reply?.buttons ? { buttons: r.reply.buttons } : {}) };
  },
  answerPendingDeal: (deps, chatId, text) => answerPendingDeal(deps as any, chatId, text),
  runReminders: (deps, now) => runReminders(deps as any, now),
  sendWeeklyReport: (deps, now) => sendWeeklyReport(deps as any, now),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export function prospectionPort(deps: Pick<ProspectionKevinDeps, "prospectionKevin">): ProspectionKevinPort {
  return { ...REAL, ...(deps.prospectionKevin ?? {}) };
}
