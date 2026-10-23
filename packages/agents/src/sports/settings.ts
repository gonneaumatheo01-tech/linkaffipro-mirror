/**
 * Réglages de l'équipe Paris sportifs (phase 23), rangés dans `AgentTeamConfig(teamKey = "sports").settings.sports`
 * (sans migration). Lecture tolérante : une valeur absente ou abîmée prend le défaut. Les réglages de capture
 * (`captureMode`, `bookmakerSites`, `captureWaitMinutes`) vivent au même endroit mais sont lus par la capture.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";

export type SportsSettings = {
  /** Heures de passage (heure de Paris). */
  runHours: number[];
  /** Passage supplémentaire N heures avant chaque match retenu. */
  kickoffTriggerHours: number;
  maxApiCallsPerMonth: number;
  /** Matchs cherchés jusqu'à N heures. */
  lookaheadHours: number;
  /** Mots interdits ajoutés à ceux de l'équipe. */
  forbiddenWords: string[];
  /** Score d'intérêt minimal pour retenir un pari. */
  minInterestScore: number;
  /** Bookmakers minimum pour juger une cote. */
  minBookmakers: number;
  /** Après une validation plus longue que ce délai, la cote est relue avant l'envoi. */
  recheckAfterMinutes: number;
  /** Ligne de prudence en bas du post. */
  disclaimer: string;
  offerButtonText: string;
  /** Réglages de la fiche d'équipe (site) : appliqués avec ceux de la catégorie, le plus strict gagne. */
  maxOddsDriftPct: number;
  minMinutesBeforeKickoff: number;
};

export const DEFAULT_SPORTS_FORBIDDEN_WORDS = ["sûr", "garanti", "100 %", "ne peut pas perdre"] as const;

export const DEFAULT_SPORTS_SETTINGS: Readonly<SportsSettings> = Object.freeze({
  runHours: [10, 15, 18],
  kickoffTriggerHours: 2,
  maxApiCallsPerMonth: 2000,
  lookaheadHours: 48,
  forbiddenWords: [...DEFAULT_SPORTS_FORBIDDEN_WORDS],
  minInterestScore: -0.05,
  minBookmakers: 2,
  recheckAfterMinutes: 10,
  disclaimer: "Aucun pari n'est gagné d'avance : joue avec modération. 18+",
  offerButtonText: "🎯 Parier chez le bookmaker",
  maxOddsDriftPct: 5,
  minMinutesBeforeKickoff: 30,
});

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

/** `settings` de l'équipe (JSON) → réglages Paris (pur). */
export function parseSportsSettings(teamSettings: unknown): SportsSettings {
  const s = record(record(teamSettings).sports);
  const hours = Array.isArray(s.runHours)
    ? [...new Set(s.runHours.map((h) => Number(h)).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b)
    : [];
  const words = Array.isArray(s.forbiddenWords) ? s.forbiddenWords.filter((w): w is string => typeof w === "string" && w.trim() !== "") : null;
  const text = (v: unknown, def: string) => (typeof v === "string" && v.trim() ? v.trim() : def);
  return {
    runHours: hours.length ? hours : [...DEFAULT_SPORTS_SETTINGS.runHours],
    kickoffTriggerHours: num(s.kickoffTriggerHours, DEFAULT_SPORTS_SETTINGS.kickoffTriggerHours, 0, 24),
    maxApiCallsPerMonth: Math.round(num(s.maxApiCallsPerMonth, DEFAULT_SPORTS_SETTINGS.maxApiCallsPerMonth, 0, 10_000_000)),
    lookaheadHours: num(s.lookaheadHours, DEFAULT_SPORTS_SETTINGS.lookaheadHours, 1, 168),
    forbiddenWords: words ?? [...DEFAULT_SPORTS_SETTINGS.forbiddenWords],
    minInterestScore: num(s.minInterestScore, DEFAULT_SPORTS_SETTINGS.minInterestScore, -1, 1),
    minBookmakers: Math.round(num(s.minBookmakers, DEFAULT_SPORTS_SETTINGS.minBookmakers, 1, 50)),
    recheckAfterMinutes: num(s.recheckAfterMinutes, DEFAULT_SPORTS_SETTINGS.recheckAfterMinutes, 0, 1440),
    disclaimer: text(s.disclaimer, DEFAULT_SPORTS_SETTINGS.disclaimer),
    offerButtonText: text(s.offerButtonText, DEFAULT_SPORTS_SETTINGS.offerButtonText),
    maxOddsDriftPct: num(s.maxOddsDriftPct, DEFAULT_SPORTS_SETTINGS.maxOddsDriftPct, 0, 100),
    minMinutesBeforeKickoff: Math.round(num(s.minMinutesBeforeKickoff, DEFAULT_SPORTS_SETTINGS.minMinutesBeforeKickoff, 0, 1440)),
  };
}

/** Catégorie avec les bornes de l'équipe : écart toléré le plus petit, délai avant le match le plus long (pur). */
export function withTeamBounds<T extends { maxOddsDriftPct: number; minMinutesBeforeKickoff: number }>(category: T, s: Pick<SportsSettings, "maxOddsDriftPct" | "minMinutesBeforeKickoff">): T {
  return {
    ...category,
    maxOddsDriftPct: Math.min(category.maxOddsDriftPct, s.maxOddsDriftPct),
    minMinutesBeforeKickoff: Math.max(category.minMinutesBeforeKickoff, s.minMinutesBeforeKickoff),
  };
}

export async function loadSportsSettings(prisma: PrismaClient): Promise<SportsSettings> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "sports" }, select: { settings: true } });
  return parseSportsSettings(row?.settings);
}
