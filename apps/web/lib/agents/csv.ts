/**
 * Exports CSV du journal des agents (`/agents/journal/export`) : missions ou passages des agents, avec les filtres de
 * la page. Jamais le texte d'un post : seulement qui, quoi, quand, le résultat en résumé et le coût. Règles pures.
 */
import { csvDate, csvNumber, toCsv } from "@/lib/members/csv";
import { statusLabel } from "@/lib/status-badges";
import { MISSION_KIND_LABELS, CREATED_BY_LABELS } from "./missions";
import { agentLabel, teamName } from "./teams";

export type MissionCsvRow = {
  id: string;
  createdAt: Date;
  teamKey: string;
  kind: string;
  channelTitle: string | null;
  status: string;
  currentAgent: string | null;
  createdBy: string;
  isTest: boolean;
  costCents: number;
  scheduledFor: Date | null;
  lastError: string | null;
};

export const MISSIONS_CSV_HEADERS = [
  "Créée le (Paris)",
  "Équipe",
  "Type",
  "Canal",
  "Statut",
  "Étape en cours",
  "Créée par",
  "Mission de test",
  "Coût (€)",
  "Prévue le (Paris)",
  "Dernière erreur",
  "Identifiant",
];

export function missionsCsv(rows: readonly MissionCsvRow[]): string {
  return toCsv(
    MISSIONS_CSV_HEADERS,
    rows.map((m) => [
      csvDate(m.createdAt),
      teamName(m.teamKey),
      MISSION_KIND_LABELS[m.kind] ?? m.kind,
      m.channelTitle ?? "",
      statusLabel("agentMission", m.status),
      m.currentAgent ? agentLabel(m.currentAgent) : "",
      CREATED_BY_LABELS[m.createdBy] ?? m.createdBy,
      m.isTest ? "oui" : "non",
      csvNumber(m.costCents / 100),
      csvDate(m.scheduledFor),
      m.lastError ?? "",
      m.id,
    ]),
  );
}

export type RunCsvRow = {
  id: string;
  missionId: string;
  teamKey: string;
  agentKey: string;
  status: string;
  startedAt: Date;
  durationMs: number | null;
  costCents: number;
  inputSummary: string | null;
  outputSummary: string | null;
  error: string | null;
};

export const RUNS_CSV_HEADERS = [
  "Début (Paris)",
  "Équipe",
  "Agent",
  "Statut",
  "Durée (s)",
  "Coût (€)",
  "Ce qu'il a reçu",
  "Ce qu'il a produit",
  "Erreur",
  "Mission",
];

export function runsCsv(rows: readonly RunCsvRow[]): string {
  return toCsv(
    RUNS_CSV_HEADERS,
    rows.map((r) => [
      csvDate(r.startedAt),
      teamName(r.teamKey),
      agentLabel(r.agentKey),
      statusLabel("agentRun", r.status),
      r.durationMs === null ? "" : csvNumber(r.durationMs / 1000, 1),
      csvNumber(r.costCents / 100),
      r.inputSummary ?? "",
      r.outputSummary ?? "",
      r.error ?? "",
      r.missionId,
    ]),
  );
}
