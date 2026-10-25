/**
 * Phase 33, chantier C — outils communs des vues « voir ce que font les équipes » (lecture seule) : jours et moments
 * de la journée à Paris, aperçu de texte, état d'une équipe SANS rien écrire (pas d'`ensureTeamConfigs`),
 * dérogations d'ordre du jour (`activeOverridesFor`, chantier A), forme du résultat d'une vue.
 */
import { addDaysToDay, fromParis, parisDay, parisParts } from "../../rules/time";
import { isAgentsPausedAll, toTeamSettings } from "../../missions/settings";
import { TEAM_LABELS, type AdminButton, type AgentsDeps, type TeamKey, type TeamSettings } from "../../types";
import { activeOverridesFor } from "../run";

/** Résultat d'une vue : faits structurés (seule source des chiffres) et lignes écrites par le code à partir d'eux. */
export type ViewResult = {
  facts: Record<string, unknown>;
  /** Texte brut (non échappé), une idée par ligne. */
  lines: string[];
  buttons?: AdminButton[][];
  /** Dépense chez un fournisseur (centimes) ; 0 = gratuit. */
  costCents?: number;
  /** Médias envoyables par Kevin si demandé (vignettes). */
  mediaAssetIds?: string[];
};

export type DaySlot = "matin" | "midi" | "apres-midi" | "soir" | "nuit";
export const DAY_SLOTS: readonly DaySlot[] = ["matin", "midi", "apres-midi", "soir", "nuit"];

/** Bornes d'un moment de la journée (minutes depuis minuit, heure de Paris). */
export const SLOT_MINUTES: Record<DaySlot, [number, number]> = {
  nuit: [0, 6 * 60],
  matin: [6 * 60, 12 * 60],
  midi: [11 * 60 + 30, 14 * 60],
  "apres-midi": [12 * 60, 18 * 60],
  soir: [18 * 60, 24 * 60],
};

export function isDaySlot(v: unknown): v is DaySlot {
  return typeof v === "string" && (DAY_SLOTS as readonly string[]).includes(v);
}

/** Intervalle UTC d'un jour de Paris, ou d'un moment de ce jour. */
export function slotRange(day: string, slot: DaySlot | null): { from: Date; to: Date } {
  if (!slot) return { from: fromParis(day, 0), to: fromParis(addDaysToDay(day, 1), 0) };
  const [a, b] = SLOT_MINUTES[slot];
  return { from: fromParis(day, a), to: b >= 24 * 60 ? fromParis(addDaysToDay(day, 1), 0) : fromParis(day, b) };
}

/** « aujourd'hui », « demain », « hier », sinon « le 27/10 ». */
export function dayLabel(day: string, now: Date): string {
  const today = parisDay(now);
  if (day === today) return "aujourd'hui";
  if (day === addDaysToDay(today, 1)) return "demain";
  if (day === addDaysToDay(today, -1)) return "hier";
  if (day === addDaysToDay(today, 2)) return "après-demain";
  const [, m, d] = day.split("-");
  return `le ${d}/${m}`;
}

/** « 9 h », « 18 h 30 » (heure de Paris). */
export function hourLabel(at: Date): string {
  const p = parisParts(at);
  return `${p.hour} h${p.minute ? ` ${String(p.minute).padStart(2, "0")}` : ""}`;
}

/** « 09:00 » → « 9 h ». */
export function hhmmLabel(v: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v ?? "").trim());
  if (!m) return v ?? "";
  const h = Number(m[1]);
  return `${h} h${m[2] !== "00" ? ` ${m[2]}` : ""}`;
}

/** Texte HTML Telegram → texte brut court (aperçu). */
export function plainPreview(html: string, max = 200): string {
  const t = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Jour demandé : « aujourdhui » (défaut), « demain », « apres_demain », « hier », ou une date AAAA-MM-JJ. */
export function resolveDay(now: Date, raw?: string | null): string {
  const today = parisDay(now);
  if (!raw) return today;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  switch (raw) {
    case "demain":
      return addDaysToDay(today, 1);
    case "apres_demain":
      return addDaysToDay(today, 2);
    case "hier":
      return addDaysToDay(today, -1);
    default:
      return today;
  }
}

export type TeamState = {
  teamKey: TeamKey;
  label: string;
  enabled: boolean;
  simulation: boolean;
  paused: boolean;
  pausedReason: string | null;
  pausedAll: boolean;
  level: 0 | 1 | 2;
  settings: TeamSettings;
};

/** État d'une équipe SANS rien créer (une équipe absente prend les valeurs par défaut). */
export async function readTeamState(deps: Pick<AgentsDeps, "prisma">, teamKey: TeamKey): Promise<TeamState> {
  const [row, models, pausedAll] = await Promise.all([
    deps.prisma.agentTeamConfig.findUnique({ where: { teamKey } }),
    deps.prisma.setting.findUnique({ where: { key: "agents.models" } }),
    isAgentsPausedAll(deps.prisma),
  ]);
  const r = (row ?? {
    teamKey,
    enabled: true,
    simulation: true,
    paused: false,
    pausedReason: null,
    autonomyLevel: 0,
    monthlyBudgetCents: {},
    styleGuidelines: "",
    forbiddenWords: [],
    maxTextLength: 900,
    quietHours: [],
    settings: {},
  }) as Parameters<typeof toTeamSettings>[0] & { enabled?: boolean; pausedReason?: string | null };
  const settings = toTeamSettings(r, (models as { value?: unknown } | null)?.value);
  return {
    teamKey,
    label: TEAM_LABELS[teamKey],
    enabled: r.enabled !== false,
    simulation: settings.simulation,
    paused: settings.paused,
    pausedReason: r.pausedReason ?? null,
    pausedAll,
    level: settings.autonomyLevel,
    settings,
  };
}

/** Dérogation d'ordre telle que lue (forme de `ChannelPlanOverride`). */
export type OverrideView = {
  id: string;
  orderId: string;
  teamKey: string;
  fromDay: string;
  toDay: string;
  postsPerDay: number | null;
  picksPerDay: number | null;
  betCategoryId: string | null;
  themes: unknown;
  mix: unknown;
  format: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  personaId: string | null;
  isTest: boolean;
  /** Numéro court de l'ordre (« ordre n°12 »), si retrouvé. */
  orderNumber?: number | null;
};

/** Dérogations en cours sur ce canal ce jour-là (règle du chantier A), avec le numéro de l'ordre. */
export async function overridesOf(deps: AgentsDeps, channelId: string, day: string): Promise<OverrideView[]> {
  let raw: unknown;
  try {
    raw = await activeOverridesFor(deps, channelId, day);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, channelId }, "[vues] dérogations illisibles");
    return [];
  }
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as OverrideView[];
  if (!list.length) return [];
  const ids = [...new Set(list.map((o) => o.orderId).filter(Boolean))];
  const orders = ids.length ? ((await deps.prisma.teamOrder.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })) as Array<{ id: string; number: number }>) : [];
  const num = new Map(orders.map((o) => [o.id, o.number]));
  return list.map((o) => ({ ...o, orderNumber: num.get(o.orderId) ?? null }));
}

/** Coupe une réponse à 8 lignes (7 + « Tu veux le détail ? ») sauf si le détail est demandé. */
export const VIEW_MAX_LINES = 8;
export function fitLines(lines: readonly string[], detail: boolean, more: string): { lines: string[]; cut: boolean } {
  const clean = lines.filter((l) => l && l.trim());
  if (detail || clean.length <= VIEW_MAX_LINES) return { lines: clean, cut: false };
  return { lines: [...clean.slice(0, VIEW_MAX_LINES - 1), more], cut: true };
}
