/**
 * Réglages de l'équipe Algorithme (phase 21), rangés dans `AgentTeamConfig(teamKey = "algo").settings.algo` : seuils de
 * données, bornes des réglages, seuil des alertes. Lecture tolérante (une valeur absente ou abîmée prend le défaut).
 * Le niveau d'autonomie est celui de l'équipe Algorithme (`AgentTeamConfig.autonomyLevel`).
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { hhmmToMinutes } from "../rules/time";

export type HourRange = { start: string; end: string };

export type AlgoSettings = {
  /** Posts minimum par cas comparé (ou `minViews` vues cumulées). */
  minPosts: number;
  minViews: number;
  /** Conversations minimum par profil (agent Conversations). */
  minConversations: number;
  /** Déplacement maximal du mélange, en points de pourcentage par semaine. */
  maxMixShiftPoints: number;
  /** Quota que les réglages ne peuvent jamais dépasser (question posée au client). */
  maxPostsPerDay: number;
  /** Heures autorisées des fenêtres : par défaut, et par canal. */
  allowedHours: { default: HourRange; byChannel: Record<string, HourRange> };
  /** Fenêtres : heures dont le score atteint ce ratio du meilleur. */
  windowRatio: number;
  /** Posts minimum dans une case jour × heure pour qu'elle compte dans une fenêtre. */
  minPostsPerCell: number;
  /** Baisse (en %) qui déclenche une alerte de décrochage. */
  dropPct: number;
  /** Durée d'un test A/B (jours) et effectif minimal par variante. */
  experimentDays: number;
  experimentMinSamples: number;
  /** Seuil de signification des tests (5 %). */
  alpha: number;
};

export const DEFAULT_ALGO_SETTINGS: Readonly<AlgoSettings> = Object.freeze({
  minPosts: 20,
  minViews: 1000,
  minConversations: 30,
  maxMixShiftPoints: 20,
  maxPostsPerDay: 6,
  allowedHours: { default: { start: "08:00", end: "24:00" }, byChannel: {} },
  windowRatio: 0.8,
  minPostsPerCell: 3,
  dropPct: 30,
  experimentDays: 14,
  experimentMinSamples: 20,
  alpha: 0.05,
});

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

function range(v: unknown): HourRange | null {
  const r = record(v);
  const s = typeof r.start === "string" ? hhmmToMinutes(r.start) : null;
  const e = typeof r.end === "string" ? hhmmToMinutes(r.end) : null;
  if (s === null || e === null || e <= s) return null;
  return { start: r.start as string, end: r.end as string };
}

/** `settings.algo` (JSON) → réglages complets. */
export function parseAlgoSettings(v: unknown): AlgoSettings {
  const r = record(v);
  const d = DEFAULT_ALGO_SETTINGS;
  const hours = record(r.allowedHours);
  const byChannel: Record<string, HourRange> = {};
  for (const [id, x] of Object.entries(record(hours.byChannel))) {
    const h = range(x);
    if (h) byChannel[id] = h;
  }
  return {
    minPosts: Math.round(num(r.minPosts, d.minPosts, 1, 10_000)),
    minViews: Math.round(num(r.minViews, d.minViews, 0, 100_000_000)),
    minConversations: Math.round(num(r.minConversations, d.minConversations, 1, 100_000)),
    maxMixShiftPoints: num(r.maxMixShiftPoints, d.maxMixShiftPoints, 0, 100),
    maxPostsPerDay: Math.round(num(r.maxPostsPerDay, d.maxPostsPerDay, 1, 48)),
    allowedHours: { default: range(hours.default) ?? { ...d.allowedHours.default }, byChannel },
    windowRatio: num(r.windowRatio, d.windowRatio, 0.1, 1),
    minPostsPerCell: Math.round(num(r.minPostsPerCell, d.minPostsPerCell, 1, 1000)),
    dropPct: num(r.dropPct, d.dropPct, 1, 100),
    experimentDays: Math.round(num(r.experimentDays, d.experimentDays, 1, 90)),
    experimentMinSamples: Math.round(num(r.experimentMinSamples, d.experimentMinSamples, 2, 100_000)),
    alpha: num(r.alpha, d.alpha, 0.001, 0.2),
  };
}

/** Heures autorisées d'un canal. */
export function allowedHoursFor(s: AlgoSettings, channelId: string): HourRange {
  return s.allowedHours.byChannel[channelId] ?? s.allowedHours.default;
}

export type AlgoTeamState = { settings: AlgoSettings; level: 0 | 1 | 2; paused: boolean; raw: Record<string, unknown> };

/** Réglages et niveau de l'équipe Algorithme (équipe créée si elle manque). */
export async function loadAlgoTeam(prisma: PrismaClient): Promise<AlgoTeamState> {
  const row =
    (await prisma.agentTeamConfig.findUnique({ where: { teamKey: "algo" } })) ??
    (await prisma.agentTeamConfig.upsert({ where: { teamKey: "algo" }, create: { teamKey: "algo" }, update: {} }));
  const raw = record(row.settings);
  const level = Math.round(Number(row.autonomyLevel));
  return {
    settings: parseAlgoSettings(raw.algo),
    level: (level === 1 || level === 2 ? level : 0) as 0 | 1 | 2,
    paused: row.paused === true || row.enabled === false,
    raw,
  };
}

/** Écrit une partie de `settings.algo` (les autres clés de `settings` sont gardées). */
export async function patchAlgoSettings(prisma: PrismaClient, patch: Partial<Record<keyof AlgoSettings, unknown>>): Promise<AlgoSettings> {
  const team = await loadAlgoTeam(prisma);
  const algo = { ...record(team.raw.algo), ...patch };
  const settings = JSON.parse(JSON.stringify({ ...team.raw, algo }));
  await prisma.agentTeamConfig.update({ where: { teamKey: "algo" }, data: { settings } });
  return parseAlgoSettings(algo);
}
