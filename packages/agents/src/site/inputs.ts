/**
 * Phase 34, chantier A — seul point de passage vers les entrées Telegram du chantier F (`boss/inputs/*`, signatures
 * `BossInputsApi` du contrat) : message transféré gardé comme contenu, document reçu. Si F change un nom, seul ce
 * fichier s'adapte ; les tests du déroulé remplacent ce module (`vi.mock("./inputs")`).
 */
import type { BossDeps } from "../boss/contract";
import type { ForwardedContent, ReceivedDocument } from "./contract";
import { peekDocument as fPeekDocument, peekForwarded as fPeekForwarded, takeDocument as fTakeDocument, takeForwarded as fTakeForwarded } from "../boss/inputs";

export function peekForwarded(deps: BossDeps, chatId: string): Promise<ForwardedContent | null> {
  return fPeekForwarded(deps, chatId);
}
export function takeForwarded(deps: BossDeps, chatId: string): Promise<ForwardedContent | null> {
  return fTakeForwarded(deps, chatId);
}
export function peekDocument(deps: BossDeps, chatId: string): Promise<ReceivedDocument | null> {
  return fPeekDocument(deps, chatId);
}
export function takeDocument(deps: BossDeps, chatId: string): Promise<ReceivedDocument | null> {
  return fTakeDocument(deps, chatId);
}
