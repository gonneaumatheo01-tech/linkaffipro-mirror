/**
 * Phase 32, chantier B — Valorisateur : valeur estimée mensuelle en fourchette (code, sans IA).
 * SOCLE : signatures figées ; le chantier B remplit les corps.
 */
import type { ValueEstimate } from "../contract-advanced";
import type { ProspectionKevinDeps } from "../kevin-port";

/** Calcule et enregistre `Prospect.valueEstimate` ; null si rien d'estimable (pas de mesure, pas d'offre). */
export async function estimateProspectValue(_deps: ProspectionKevinDeps, _prospectId: string): Promise<ValueEstimate | null> {
  return null;
}

/** Recalcule les valeurs des prospects qualifiés et en pipeline (passage quotidien). */
export async function refreshValues(_deps: ProspectionKevinDeps, _now: Date): Promise<{ updated: number }> {
  return { updated: 0 };
}
