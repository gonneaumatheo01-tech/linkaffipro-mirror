/**
 * Lecture des réglages d'une équipe (`AgentTeamConfig`) et des réglages généraux des agents (`Setting`
 * `agents.models`, `agents.libraryChannelId`, `agents.pausedAll`). Fonctions pures de relecture des champs JSON
 * (testées dans config.test.ts) : une valeur abîmée retombe sur la valeur par défaut, jamais une erreur de page.
 */
import { AI_MODEL_IDS, DEFAULT_MODEL, QUALITY_MODEL, type AiModelId } from "@linkaffipro/ai";
import { PROVIDER_KEYS, type ProviderKey, type TeamKey } from "@linkaffipro/agents";
import type { AutonomyLevel } from "./teams";

export const DEFAULT_MAX_TEXT_LENGTH = 900;

export type QuietHours = { start: string; end: string };

export type TeamConfigView = {
  teamKey: TeamKey;
  /** Ligne présente en base (sinon : valeurs par défaut du schéma). */
  exists: boolean;
  enabled: boolean;
  simulation: boolean;
  paused: boolean;
  pausedReason: string | null;
  autonomyLevel: AutonomyLevel;
  /** Centimes par fournisseur ; absent = aucun plafond saisi. */
  budgets: Partial<Record<ProviderKey, number>>;
  styleGuidelines: string;
  forbiddenWords: string[];
  maxTextLength: number;
  quietHours: QuietHours[];
  consecutiveFailures: number;
  updatedAt: Date | null;
};

export type TeamConfigRow = {
  teamKey: string;
  enabled: boolean;
  simulation: boolean;
  paused: boolean;
  pausedReason: string | null;
  autonomyLevel: number;
  monthlyBudgetCents: unknown;
  styleGuidelines: string;
  forbiddenWords: unknown;
  maxTextLength: number;
  quietHours: unknown;
  consecutiveFailures: number;
  updatedAt: Date;
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseBudgets(v: unknown): Partial<Record<ProviderKey, number>> {
  const out: Partial<Record<ProviderKey, number>> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const k of PROVIDER_KEYS) {
    const n = (v as Record<string, unknown>)[k];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[k] = Math.round(n);
  }
  return out;
}

export function parseStringList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : [];
}

export function parseQuietHours(v: unknown): QuietHours[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const { start, end } = x as Record<string, unknown>;
    return typeof start === "string" && typeof end === "string" && HHMM.test(start) && HHMM.test(end)
      ? [{ start, end }]
      : [];
  });
}

function level(n: number): AutonomyLevel {
  return n === 1 || n === 2 ? n : 0;
}

/** Réglages affichés d'une équipe ; sans ligne en base : les valeurs par défaut (simulation active, niveau 0). */
export function teamConfigView(teamKey: TeamKey, row: TeamConfigRow | null): TeamConfigView {
  if (!row)
    return {
      teamKey,
      exists: false,
      enabled: true,
      simulation: true,
      paused: false,
      pausedReason: null,
      autonomyLevel: 0,
      budgets: {},
      styleGuidelines: "",
      forbiddenWords: [],
      maxTextLength: DEFAULT_MAX_TEXT_LENGTH,
      quietHours: [],
      consecutiveFailures: 0,
      updatedAt: null,
    };
  return {
    teamKey,
    exists: true,
    enabled: row.enabled,
    simulation: row.simulation,
    paused: row.paused,
    pausedReason: row.pausedReason,
    autonomyLevel: level(row.autonomyLevel),
    budgets: parseBudgets(row.monthlyBudgetCents),
    styleGuidelines: row.styleGuidelines,
    forbiddenWords: parseStringList(row.forbiddenWords),
    maxTextLength: row.maxTextLength > 0 ? row.maxTextLength : DEFAULT_MAX_TEXT_LENGTH,
    quietHours: parseQuietHours(row.quietHours),
    consecutiveFailures: row.consecutiveFailures,
    updatedAt: row.updatedAt,
  };
}

/** Heures calmes en texte de formulaire : une plage par ligne (« 23:00-08:00 »). */
export function quietHoursText(q: readonly QuietHours[]): string {
  return q.map((h) => `${h.start}-${h.end}`).join("\n");
}

/** Centimes → euros pour un champ de formulaire (« 12,5 ») ; vide si aucun plafond. */
export function centsToEurField(cents: number | undefined): string {
  return cents === undefined ? "" : String(cents / 100).replace(".", ",");
}

export type AgentsModels = { fast: AiModelId; strong: AiModelId };

export const DEFAULT_AGENTS_MODELS: AgentsModels = { fast: DEFAULT_MODEL, strong: QUALITY_MODEL };

function isModel(v: unknown): v is AiModelId {
  return typeof v === "string" && (AI_MODEL_IDS as readonly string[]).includes(v);
}

/** `Setting` `agents.models` : `{ fast, strong }`, chaque valeur inconnue retombe sur le modèle par défaut. */
export function parseAgentsModels(v: unknown): AgentsModels {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    fast: isModel(o.fast) ? o.fast : DEFAULT_AGENTS_MODELS.fast,
    strong: isModel(o.strong) ? o.strong : DEFAULT_AGENTS_MODELS.strong,
  };
}

/** `Setting` `agents.libraryChannelId` : identifiant du canal ou `null` (valeur brute ou `{ channelId }`). */
export function parseLibraryChannelId(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (v && typeof v === "object") {
    const id = (v as Record<string, unknown>).channelId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

/** `Setting` `agents.pausedAll` : booléen, ou `{ paused }`. */
export function parsePausedAll(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v && typeof v === "object") return (v as Record<string, unknown>).paused === true;
  return false;
}
