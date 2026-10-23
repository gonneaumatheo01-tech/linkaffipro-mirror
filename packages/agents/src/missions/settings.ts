/**
 * Réglages des équipes (`AgentTeamConfig`) et des modèles d'IA (`Setting` `agents.models`). Les 4 équipes sont créées
 * avec leurs valeurs par défaut au premier passage (simulation active, niveau 0, aucune pause).
 */
import { DEFAULT_MODEL, QUALITY_MODEL } from "@linkaffipro/ai";
import type { Db as PrismaClient } from "@linkaffipro/db";
import { DEFAULT_MAX_TEXT_LENGTH } from "../rules/content";
import { DEFAULT_SIMILARITY_THRESHOLD } from "../rules/similarity";
import { TEAM_KEYS, type ProviderKey, type TeamKey, type TeamSettings } from "../types";

export const AGENTS_MODELS_KEY = "agents.models";
export const AGENTS_PAUSED_ALL_KEY = "agents.pausedAll";

/** Plafonds mensuels par défaut (centimes) quand l'équipe n'en a pas fixé : 20 € d'IA texte. */
export const DEFAULT_MONTHLY_BUDGET_CENTS: Readonly<Partial<Record<ProviderKey, number>>> = Object.freeze({ llm: 2000 });

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseQuietHours(v: unknown): { start: string; end: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => record(x))
    .filter((x) => typeof x.start === "string" && typeof x.end === "string")
    .map((x) => ({ start: x.start as string, end: x.end as string }));
}

/** Plafonds par défaut de l'équipe Dating (phase 20) : vidéo 100 €, photo 15 € par mois. */
export const DATING_DEFAULT_BUDGET_CENTS: Readonly<Partial<Record<ProviderKey, number>>> = Object.freeze({ video: 10_000, image: 1_500 });

export function defaultBudgetsFor(teamKey: string): Partial<Record<ProviderKey, number>> {
  return teamKey === "dating" ? { ...DEFAULT_MONTHLY_BUDGET_CENTS, ...DATING_DEFAULT_BUDGET_CENTS } : { ...DEFAULT_MONTHLY_BUDGET_CENTS };
}

export function parseBudgets(v: unknown, defaults: Partial<Record<ProviderKey, number>> = DEFAULT_MONTHLY_BUDGET_CENTS): Partial<Record<ProviderKey, number>> {
  const out: Partial<Record<ProviderKey, number>> = { ...defaults };
  for (const [k, n] of Object.entries(record(v)))
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[k as ProviderKey] = Math.round(n);
  return out;
}

export function parseModels(v: unknown): { fast: string; strong: string } {
  const r = record(v);
  return {
    fast: typeof r.fast === "string" && r.fast ? r.fast : DEFAULT_MODEL,
    strong: typeof r.strong === "string" && r.strong ? r.strong : QUALITY_MODEL,
  };
}

type ConfigRow = {
  teamKey: string;
  simulation: boolean;
  paused: boolean;
  autonomyLevel: number;
  monthlyBudgetCents: unknown;
  styleGuidelines: string;
  forbiddenWords: unknown;
  maxTextLength: number;
  quietHours: unknown;
  settings: unknown;
};

/** Ligne `AgentTeamConfig` + modèles → réglages lus par les agents (pur). */
export function toTeamSettings(row: ConfigRow, models: unknown): TeamSettings {
  const settings = record(row.settings);
  const sim = Number(settings.similarityThreshold);
  const level = Math.round(Number(row.autonomyLevel));
  return {
    teamKey: row.teamKey as TeamKey,
    simulation: row.simulation !== false,
    paused: row.paused === true,
    autonomyLevel: (level === 1 || level === 2 ? level : 0) as 0 | 1 | 2,
    monthlyBudgetCents: parseBudgets(row.monthlyBudgetCents, defaultBudgetsFor(row.teamKey)),
    styleGuidelines: row.styleGuidelines ?? "",
    forbiddenWords: strings(row.forbiddenWords),
    maxTextLength: row.maxTextLength > 0 ? row.maxTextLength : DEFAULT_MAX_TEXT_LENGTH,
    quietHours: parseQuietHours(row.quietHours),
    models: parseModels(models),
    similarityThreshold: Number.isFinite(sim) && sim > 0 && sim <= 1 ? sim : DEFAULT_SIMILARITY_THRESHOLD,
    settings,
  };
}

/** Crée les 4 équipes manquantes avec les valeurs par défaut (idempotent). */
export async function ensureTeamConfigs(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.agentTeamConfig.findMany({ select: { teamKey: true } });
  const have = new Set(existing.map((r) => r.teamKey));
  for (const teamKey of TEAM_KEYS) {
    if (have.has(teamKey)) continue;
    await prisma.agentTeamConfig.upsert({ where: { teamKey }, create: { teamKey }, update: {} });
  }
}

/** Réglages d'une équipe (créée si elle manque). */
export async function loadTeamSettings(prisma: PrismaClient, teamKey: TeamKey): Promise<TeamSettings> {
  let row = await prisma.agentTeamConfig.findUnique({ where: { teamKey } });
  if (!row) {
    await ensureTeamConfigs(prisma);
    row = await prisma.agentTeamConfig.findUniqueOrThrow({ where: { teamKey } });
  }
  const models = await prisma.setting.findUnique({ where: { key: AGENTS_MODELS_KEY } });
  return toTeamSettings(row, models?.value);
}

/** Pause générale (`Setting` `agents.pausedAll` = true). */
export async function isAgentsPausedAll(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: AGENTS_PAUSED_ALL_KEY } });
  return row?.value === true || (row?.value as { paused?: unknown } | null)?.paused === true;
}
