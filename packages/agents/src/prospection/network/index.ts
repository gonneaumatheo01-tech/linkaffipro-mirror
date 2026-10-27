/**
 * Phase 32, chantier A — Réseaux de canaux (preuves notées, ≥ 4 points ; fusion / séparation par le client).
 * SOCLE : signatures figées ; le chantier A remplit les corps.
 */
import type { ProspectionKevinDeps } from "../kevin-port";

/** Recalcule les réseaux automatiques (jamais une paire séparée par le client). */
export async function rebuildNetworks(_deps: ProspectionKevinDeps): Promise<{ networks: number; members: number }> {
  return { networks: 0, members: 0 };
}

/** « @a et @b c'est la même personne » : réseau MANUAL. */
export async function mergeProspects(_deps: ProspectionKevinDeps, _prospectIds: string[], _by: "client" | "system"): Promise<{ ok: boolean; networkId: string | null; message?: string | null }> {
  return { ok: false, networkId: null, message: "pas encore disponible" };
}

/** « sépare @a » : sort le canal de son réseau (la paire n'est plus jamais refusionnée automatiquement). */
export async function splitProspect(_deps: ProspectionKevinDeps, _prospectId: string, _by: "client" | "system"): Promise<{ ok: boolean; message?: string | null }> {
  return { ok: false, message: "pas encore disponible" };
}
