/**
 * Phase 32, chantier A — Réseaux de canaux (preuves notées, ≥ 4 points ; fusion / séparation par le client).
 * Signatures figées (`rebuildNetworks`, `mergeProspects`, `splitProspect`) appelées par `advanced-port.ts` ; lectures et
 * propagation pour Kevin, le site et le Pipeline (`networkOf`, `networkById`, `listNetworks`, `propagateNetworkStatus`).
 */
import type { ProspectionKevinDeps } from "../kevin-port";
import { mergeProspects as merge, rebuildNetworks as rebuild, splitProspect as split } from "./store";

/** Recalcule les réseaux automatiques (jamais une paire séparée par le client). */
export async function rebuildNetworks(deps: ProspectionKevinDeps): Promise<{ networks: number; members: number }> {
  return rebuild(deps);
}

/** « @a et @b c'est la même personne » : réseau MANUAL. */
export async function mergeProspects(deps: ProspectionKevinDeps, prospectIds: string[], by: "client" | "system"): Promise<{ ok: boolean; networkId: string | null; message?: string | null }> {
  return merge(deps, prospectIds, by);
}

/** « sépare @a » : sort le canal de son réseau (la paire n'est plus jamais refusionnée automatiquement). */
export async function splitProspect(deps: ProspectionKevinDeps, prospectId: string, by: "client" | "system"): Promise<{ ok: boolean; message?: string | null }> {
  return split(deps, prospectId, by);
}

export { networkOf, networkById, listNetworks, propagateNetworkStatus, networkFields, SPLIT_PAIRS_KEY, type NetworkView, type NetworkMember, type NetworkRow } from "./store";
export { buildClusters, linkedPairs, pairEvidence, pointsOf, keysOf, siteKey, descriptionSimilarity, descriptionWords, GENERIC_SHARE_MAX, type Cluster, type ClusterProspect } from "./cluster";
export { renderNetworkCard, networkLine, NETWORK_CARD_VARIANTS, type NetworkCardInput } from "./card";
