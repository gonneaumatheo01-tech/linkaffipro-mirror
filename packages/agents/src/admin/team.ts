/**
 * Réglages d'équipe changés par un humain (CONTRAT, propriétaire : chantier B). Chaque changement = un `AuditLog`.
 * Appelé par le dialogue admin Telegram et par le site.
 */
import type { AgentsDeps, TeamKey } from "../types";

export type ActorRef = { userId?: string | null; via: "SITE" | "TELEGRAM" };

/** Pause (ou reprise) d'une équipe, ou de toutes (`"all"` → `Setting` `agents.pausedAll`). */
export async function setTeamPaused(
  _deps: AgentsDeps,
  _team: TeamKey | "all",
  _paused: boolean,
  _actor: ActorRef,
  _reason?: string,
): Promise<{ ok: boolean; message: string }> {
  throw new Error("setTeamPaused : à écrire (chantier B)");
}

export async function setAutonomyLevel(
  _deps: AgentsDeps,
  _team: TeamKey,
  _level: 0 | 1 | 2,
  _actor: ActorRef,
): Promise<{ ok: boolean; message: string }> {
  throw new Error("setAutonomyLevel : à écrire (chantier B)");
}

/** Simulation on/off. Désactiver = ADMIN seulement (vérifié par l'appelant) et confirmé (« OUI » / ConfirmDialog). */
export async function setSimulation(
  _deps: AgentsDeps,
  _team: TeamKey,
  _simulation: boolean,
  _actor: ActorRef,
): Promise<{ ok: boolean; message: string }> {
  throw new Error("setSimulation : à écrire (chantier B)");
}

/** État en 6 lignes au plus (commande « agents »). */
export async function agentsStatusText(_deps: AgentsDeps): Promise<string> {
  throw new Error("agentsStatusText : à écrire (chantier B)");
}
