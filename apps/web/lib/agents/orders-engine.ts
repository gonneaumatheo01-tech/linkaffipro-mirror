/**
 * Fonctions des ordres de Kevin (phase 33, `packages/agents/src/orders/{run,registry}.ts`) appelées par le site,
 * chargées à la demande et tolérantes : la page marche avant comme après leur livraison. Une fonction absente vaut
 * `undefined` ; les boutons répondent alors « pas encore disponible » et le plan affiche la clé de chaque capacité.
 *
 * - `stopOrder(deps, orderId, actor)` : annule les missions non commencées, clôt le réglage temporaire, ordre arrêté.
 * - `extendOrder(deps, orderId, days)` : repousse la fin de l'ordre (et de son réglage temporaire) de N jours.
 * - `listCapabilities()` : capacités du registre (équipe, clé, description en français).
 */
import type { ActorRef, AgentsDeps } from "@linkaffipro/agents";

export type CapabilitySummary = { teamKey: string; key: string; description: string };

export type OrdersEngine = {
  stopOrder?: (deps: AgentsDeps, orderId: string, actor: ActorRef) => Promise<unknown>;
  extendOrder?: (deps: AgentsDeps, orderId: string, days: number) => Promise<unknown>;
  listCapabilities?: () => readonly CapabilitySummary[] | Promise<readonly CapabilitySummary[]>;
};

const NAMES = ["stopOrder", "extendOrder", "listCapabilities"] as const;

export async function loadOrdersEngine(): Promise<OrdersEngine> {
  const mod = (await import("@linkaffipro/agents")) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const n of NAMES) if (typeof mod[n] === "function") out[n] = mod[n];
  return out as OrdersEngine;
}

/** Descriptions des capacités par `équipe:clé` (vide si le registre n'est pas encore livré ou en cas d'erreur). */
export async function loadCapabilityDescriptions(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const engine = await loadOrdersEngine();
    const caps = engine.listCapabilities ? await engine.listCapabilities() : [];
    for (const c of caps)
      if (c && typeof c.key === "string" && typeof c.description === "string") map.set(`${c.teamKey}:${c.key}`, c.description);
  } catch {
    // Le plan reste lisible avec les clés en mots.
  }
  return map;
}
