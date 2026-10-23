/**
 * Filtres du journal des agents (`/agents/journal` et son export) : vue (missions ou passages), équipe, statut,
 * période. Pur (testé dans journal.test.ts).
 */
import { parseMissionFilters, type MissionFilters } from "./missions";
import { parseTeamParam, type TeamKey } from "./teams";

export type JournalView = "missions" | "runs";

export type JournalFilters = MissionFilters & { view: JournalView; team: TeamKey | null };

function first(v: unknown): string {
  return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "";
}

export function parseJournalFilters(sp: Record<string, unknown>): JournalFilters {
  return {
    ...parseMissionFilters(sp, "7d"),
    view: first(sp.view) === "runs" ? "runs" : "missions",
    team: parseTeamParam(first(sp.team)),
  };
}

/** Paramètres d'adresse des filtres (export, onglets) ; valeurs par défaut omises. */
export function journalParams(f: JournalFilters, overrides: Partial<JournalFilters> = {}): string {
  const g = { ...f, ...overrides };
  const p = new URLSearchParams();
  if (g.view === "runs") p.set("view", "runs");
  if (g.team) p.set("team", g.team);
  if (g.status) p.set("status", g.status);
  if (g.range !== "7d") p.set("range", g.range);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Plafond de lignes d'un export (le journal complet reste en base). */
export const JOURNAL_EXPORT_MAX = 5000;
