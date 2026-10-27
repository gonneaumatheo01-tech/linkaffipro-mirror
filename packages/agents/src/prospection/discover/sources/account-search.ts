/**
 * Phase 32, chantier C — Source « recherche par compte réel » (lecture seule, désactivée par défaut).
 * SOCLE : signature figée ; le chantier C remplit le corps.
 */
import type { ProspectionAdvancedJob } from "../../contract-advanced";
import type { ProspectionKevinDeps } from "../../kevin-port";

type Lot = Extract<ProspectionAdvancedJob, { type: "prospection.account-search" }>["lot"];

/** Un lot de recherche (20 requêtes au plus) ; refusé si la source n'est pas activée. */
export async function runAccountSearch(_deps: ProspectionKevinDeps, _lot: Lot): Promise<{ ok: boolean; requests: number; found: number; newCount: number; stopped?: string | null }> {
  return { ok: false, requests: 0, found: 0, newCount: 0, stopped: "désactivée" };
}
