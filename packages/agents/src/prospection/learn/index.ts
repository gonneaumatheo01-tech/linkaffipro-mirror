/**
 * Phase 32, chantier B — Boucle Link Affi : rattachement, résultats réels, calibrage proposé, rapport mensuel.
 * SOCLE : signatures figées ; le chantier B remplit les corps.
 */
import type { ProspectionKevinDeps } from "../kevin-port";

/** « @x = affilié 1234 » : rattache un prospect signé à son identifiant Link Affi. */
export async function linkAffiliate(_deps: ProspectionKevinDeps, _prospectId: string, _affiliateId: string, _by: "client" | "system"): Promise<{ ok: boolean; message?: string | null }> {
  return { ok: false, message: "pas encore disponible" };
}

/** Lit les résultats du mois (défaut : mois précédent et mois en cours) pour chaque affilié rattaché. */
export async function pullAffiliateResults(_deps: ProspectionKevinDeps, _month?: string | null): Promise<{ affiliates: number; rows: number; activated: number }> {
  return { affiliates: 0, rows: 0, activated: 0 };
}

/** Calibrage mensuel : propositions `Recommendation` en choix numérotés, dans les bornes. */
export async function proposeCalibration(_deps: ProspectionKevinDeps, _now: Date): Promise<{ proposed: number; reason?: string | null }> {
  return { proposed: 0, reason: "pas encore disponible" };
}

/** Rapport mensuel « ce que rapporte la prospection » (QA `REPORT`). Une fois par mois (repère posé par `jobs.ts`). */
export async function sendMonthlyReport(_deps: ProspectionKevinDeps, _month?: string | null): Promise<{ sent: boolean; qaBlocked: boolean }> {
  return { sent: false, qaBlocked: false };
}

/** Rappel hebdomadaire du rattachement des signés sans identifiant Link Affi (3 fois au plus). */
export async function runLinkReminders(_deps: ProspectionKevinDeps, _now: Date): Promise<{ sent: number }> {
  return { sent: 0 };
}
