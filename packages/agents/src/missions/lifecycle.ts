/**
 * Cycle de vie des missions (CONTRAT, propriétaire : chantier A « moteur »). Signatures figées : le bot (chantier B)
 * et le site (chantier C) les appellent. Corps à écrire par le chantier A.
 */
import type { AgentsDeps, TeamKey } from "../types";

export type CreateMissionInput = {
  teamKey: TeamKey;
  channelId: string | null;
  createdBy: "GRAND_CHEF" | "HUMAN";
  createdById?: string | null;
  isTest?: boolean;
  planDay?: string | null;
  /** Format imposé (« Créer une mission de test » : texte). */
  format?: "video" | "photo" | "text";
};

export type CreateMissionResult =
  | { ok: true; missionId: string }
  | { ok: false; status?: "BLOCKED_BUDGET"; reason: string };

/** Crée une mission (budgets, pause, collisions vérifiés) et enfile sa première étape. */
export async function createMission(
  _deps: AgentsDeps,
  _input: CreateMissionInput,
): Promise<CreateMissionResult> {
  throw new Error("createMission : à écrire (chantier A)");
}

/**
 * « Créer une mission de test » (site, ADMIN/MANAGER) : mission POST texte sur le canal Test (`Channel.isTest`), en
 * simulation, `isTest = true`.
 */
export async function createTestMission(
  _deps: AgentsDeps,
  _teamKey: TeamKey,
  _byUserId: string | null,
): Promise<CreateMissionResult> {
  throw new Error("createTestMission : à écrire (chantier A)");
}

/**
 * Reprend une mission qui attendait (validation accordée ou corrigée, réponse humaine) : repasse en RUNNING et enfile
 * l'étape voulue (`fromAgent` : par exemple « controle » après une correction, sinon l'étape suivante).
 */
export async function continueMission(
  _deps: AgentsDeps,
  _missionId: string,
  _opts: { fromAgent?: string; reason: string },
): Promise<void> {
  throw new Error("continueMission : à écrire (chantier A)");
}

/** Annule une mission (refus, expiration), journalise, compte comme échec seulement si `asFailure`. */
export async function cancelMission(
  _deps: AgentsDeps,
  _missionId: string,
  _opts: { reason: string; asFailure?: boolean },
): Promise<void> {
  throw new Error("cancelMission : à écrire (chantier A)");
}
