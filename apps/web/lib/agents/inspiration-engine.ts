/**
 * Fonctions du moteur d'inspiration (phase 27) appelées par le site, chargées à la demande et tolérantes : la page
 * marche avant comme après la livraison de l'analyse et de Kevin. Une fonction absente vaut `undefined` ; la page
 * affiche alors les mesures brutes, et les boutons répondent « pas encore disponible ».
 *
 * - `undoInspiration(deps, referenceChannelId | recommendationIds, actor)` : remet les réglages d'avant.
 * - `removeReference(deps, id, actor)` : retire la référence (efface ses posts et son profil).
 * - `analyzeReference(deps, id)` + `compareWithChannel(deps, analyse, canal)` : chiffres « eux / nous ».
 */
import type { ActorRef, AgentsDeps, InspirationApi } from "@linkaffipro/agents";

export type InspirationEngine = {
  undoInspiration?: (deps: AgentsDeps, target: string | string[], actor: ActorRef) => Promise<unknown>;
  removeReference?: (deps: AgentsDeps, id: string, actor: ActorRef) => Promise<unknown>;
  analyzeReference?: InspirationApi["analyzeReference"];
  compareWithChannel?: InspirationApi["compareWithChannel"];
};

const NAMES = ["undoInspiration", "removeReference", "analyzeReference", "compareWithChannel"] as const;

export async function loadInspirationEngine(): Promise<InspirationEngine> {
  const mod = (await import("@linkaffipro/agents")) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const n of NAMES) if (typeof mod[n] === "function") out[n] = mod[n];
  return out as InspirationEngine;
}
