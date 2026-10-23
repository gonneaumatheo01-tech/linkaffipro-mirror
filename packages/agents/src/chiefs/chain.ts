/** Chaîne d'étapes d'un Chef d'équipe (logique programmée, sans IA) et outils de construction des étapes. */
import { agentFor } from "../agents/registry";
import type { AgentKey, MissionStep, TeamKey } from "../types";

export type Chain = {
  teamKey: TeamKey;
  /** Étapes d'une mission POST, dans l'ordre. */
  post: readonly AgentKey[];
  /** L'équipe a-t-elle des agents réels dans cette phase (le plan du jour ne crée rien sinon) ? */
  active: boolean;
};

/** Étapes initiales : un agent sans implémentation (phase suivante) est marqué « sauté » dès la création. */
export function buildSteps(chain: readonly AgentKey[]): MissionStep[] {
  return chain.map((agent) => ({ agent, status: agentFor(agent) ? "PENDING" : "SKIPPED" }));
}

/** Prochain index à exécuter à partir de `from` (étapes sautées ignorées) ; null si la chaîne est finie. */
export function nextRunnableIndex(steps: readonly MissionStep[], from: number): number | null {
  for (let i = from; i < steps.length; i++) if (steps[i]!.status !== "SKIPPED" && steps[i]!.status !== "DONE") return i;
  return null;
}

/**
 * Renvoi à une étape antérieure (Contrôle → Rédaction, ou reprise après correction) : les étapes restantes sont
 * marquées « sautées » et la fin de la chaîne, depuis `agent`, est ajoutée (historique gardé, index uniques).
 */
export function appendFrom(steps: readonly MissionStep[], chain: readonly AgentKey[], agent: AgentKey, after: number): MissionStep[] {
  const out = steps.map((s, i) => (i > after && s.status === "PENDING" ? { ...s, status: "SKIPPED" as const } : s));
  const at = chain.indexOf(agent);
  const tail = at >= 0 ? chain.slice(at) : [agent];
  return [...out, ...buildSteps(tail)];
}
