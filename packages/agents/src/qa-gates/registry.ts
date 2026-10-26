/**
 * Phase 30, chantier B — suites des décisions du client par type de contenu (module feuille, sans import : chaque
 * branchement s'y enregistre au chargement sans risque de cycle).
 */
import type { QaContentType } from "../qa/contract";
import type { AgentsDeps } from "../types";

export type QaDecisionRef = { contentType: QaContentType; contentId: string; hash: string; teamKey: string; extra: Record<string, unknown> };

/** Suite propre à un type de contenu quand le client tranche (« Publier quand même » / « Non »). */
export type QaDecisionHandler = {
  /** Accord rangé pour l'empreinte : relancer la sortie (reprise de la mission, nouvel envoi…). */
  onApprove?(deps: AgentsDeps, d: QaDecisionRef): Promise<void>;
  /** « Non » : le contenu ne sort jamais (annulé, retiré). */
  onDrop?(deps: AgentsDeps, d: QaDecisionRef): Promise<void>;
};

export const QA_DECISION_ACTION = "qa-decision";
export const qaDecisionKey = (contentType: QaContentType, contentId: string) => `qa.decision.${contentType}.${contentId}`;

const handlers = new Map<QaContentType, QaDecisionHandler>();

export function registerQaDecisionHandler(contentType: QaContentType, h: QaDecisionHandler): void {
  handlers.set(contentType, h);
}

export function qaDecisionHandler(contentType: QaContentType): QaDecisionHandler | undefined {
  return handlers.get(contentType);
}
