/**
 * Réglages de l'équipe Casino (phase 22), rangés dans `AgentTeamConfig(teamKey = "casino").settings.casino` : thèmes de
 * l'équipe, seuil de manque, durée de rotation. Lecture tolérante : une valeur absente ou abîmée prend le défaut.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { CASINO_DEFAULT_THEMES } from "./contracts";

export type CasinoSettings = {
  /** Clés ASCII des thèmes de l'équipe (dans l'ordre de la fiche). */
  themes: string[];
  /** Sous ce nombre de vidéos non utilisées, un thème d'un canal est « en manque ». */
  lowStock: number;
  /** Une vidéo n'est jamais republiée sur le même canal avant ce nombre de jours. */
  rotationDays: number;
};

export const DEFAULT_CASINO_SETTINGS: Readonly<CasinoSettings> = Object.freeze({
  themes: [...CASINO_DEFAULT_THEMES],
  lowStock: 3,
  rotationDays: 30,
});

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function int(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : def;
}

/** Clé de thème : minuscules ASCII, chiffres et tirets (« Machines à sous » → `machines-a-sous`). */
export function themeKey(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** `settings` de l'équipe (JSON) → réglages Casino (pur). */
export function parseCasinoSettings(teamSettings: unknown): CasinoSettings {
  const c = record(record(teamSettings).casino);
  const raw = Array.isArray(c.themes) ? c.themes : null;
  const themes = raw
    ? [...new Set(raw.map((t) => (typeof t === "string" ? themeKey(t) : typeof (t as { key?: unknown })?.key === "string" ? themeKey((t as { key: string }).key) : "")).filter(Boolean))]
    : [];
  return {
    themes: themes.length ? themes : [...DEFAULT_CASINO_SETTINGS.themes],
    lowStock: int(c.lowStock, DEFAULT_CASINO_SETTINGS.lowStock, 1, 50),
    rotationDays: int(c.rotationDays, DEFAULT_CASINO_SETTINGS.rotationDays, 1, 365),
  };
}

export async function loadCasinoSettings(prisma: PrismaClient): Promise<CasinoSettings> {
  const row = await prisma.agentTeamConfig.findUnique({ where: { teamKey: "casino" }, select: { settings: true } });
  return parseCasinoSettings(row?.settings);
}
