/**
 * Phase 32, chantier A — Veilleur : relecture allégée, changements, suivi des affiliés signés, message du matin.
 * SOCLE : signatures figées (appelées par `advanced-port.ts`) ; le chantier A remplit les corps.
 */
import type { ProspectCallbackOutcome, ProspectionKevinDeps } from "../kevin-port";

/** Prospects dont la relecture est due (cadences `WATCH_LIMITS.cadenceDays`), les plus en retard d'abord. */
export async function dueForRequalify(_deps: ProspectionKevinDeps, _now: Date, _limit: number): Promise<string[]> {
  return [];
}

/** Relit un prospect (page + 20 posts), enregistre un `ProspectSnapshot`, détecte et écrit les alertes. */
export async function requalifyProspect(_deps: ProspectionKevinDeps, _prospectId: string): Promise<{ alerts: number; status: string }> {
  return { alerts: 0, status: "skipped" };
}

/** Message du matin (09:10) : 8 alertes au plus, QA `ALERT`, boutons `pra:`. Une fois par jour (repère posé par `jobs.ts`). */
export async function sendAlertsDigest(_deps: ProspectionKevinDeps, _now: Date): Promise<{ sent: number; qaBlocked: boolean }> {
  return { sent: 0, qaBlocked: false };
}

/** Bouton `pra:<alertId>:<action>` ; null si ce n'est pas un bouton d'alerte. */
export async function handleAlertCallback(_deps: ProspectionKevinDeps, _input: { data: string; chatId: string; actorTelegramId: string }): Promise<ProspectCallbackOutcome | null> {
  return null;
}
