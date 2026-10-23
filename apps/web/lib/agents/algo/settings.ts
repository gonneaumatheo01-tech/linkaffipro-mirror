/**
 * Réglages de l'équipe Algorithme (phase 21), rangés dans `AgentTeamConfig.settings.algo` (les autres clés de
 * `settings` sont gardées telles quelles). Lus par le moteur (chantier A) : seuils de données, bornes des réglages,
 * fréquence de la synthèse. Fonctions pures, testées (settings.test.ts).
 */
import type { FormResult } from "../forms";

export type AlgoFrequency = "weekly" | "biweekly";

export type AlgoSettings = {
  /** Seuils « assez de données » : par cas comparé, 20 posts OU 1 000 vues cumulées ; 30 conversations par profil. */
  minPosts: number;
  minViews: number;
  minConversations: number;
  /** Bornes : un mélange ne bouge pas de plus de N points par semaine ; quota maximum de posts par jour et par canal. */
  maxMixPointsPerWeek: number;
  maxPostsPerDay: number;
  /** Heures autorisées (Europe/Paris, « HH:MM ») : une fenêtre recommandée reste dedans. */
  allowedStart: string;
  allowedEnd: string;
  /** Synthèse et réglages : chaque semaine (le lundi) ou toutes les deux semaines. */
  frequency: AlgoFrequency;
};

export const ALGO_DEFAULTS: AlgoSettings = {
  minPosts: 20,
  minViews: 1000,
  minConversations: 30,
  maxMixPointsPerWeek: 20,
  maxPostsPerDay: 6,
  allowedStart: "08:00",
  allowedEnd: "23:00",
  frequency: "weekly",
};

export const ALGO_FREQUENCIES: ReadonlyArray<{ value: AlgoFrequency; label: string }> = [
  { value: "weekly", label: "Chaque semaine, le lundi (conseillé)" },
  { value: "biweekly", label: "Toutes les deux semaines" },
];

/** Bornes de saisie de chaque chiffre (incluses). */
export const ALGO_LIMITS = {
  minPosts: [5, 500],
  minViews: [100, 1_000_000],
  minConversations: [5, 1000],
  maxMixPointsPerWeek: [5, 50],
  maxPostsPerDay: [1, 30],
} as const satisfies Record<string, readonly [number, number]>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function intIn(v: unknown, [min, max]: readonly [number, number]): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Lecture tolérante de `settings.algo` : toute valeur absente ou hors bornes reprend sa valeur par défaut. */
export function parseAlgoSettings(settings: unknown): AlgoSettings {
  const a = obj(obj(settings).algo);
  const out = { ...ALGO_DEFAULTS };
  for (const k of Object.keys(ALGO_LIMITS) as Array<keyof typeof ALGO_LIMITS>) {
    const n = intIn(a[k], ALGO_LIMITS[k]);
    if (n !== null) out[k] = n;
  }
  if (typeof a.allowedStart === "string" && HHMM.test(a.allowedStart)) out.allowedStart = a.allowedStart;
  if (typeof a.allowedEnd === "string" && HHMM.test(a.allowedEnd)) out.allowedEnd = a.allowedEnd;
  if (a.frequency === "weekly" || a.frequency === "biweekly") out.frequency = a.frequency;
  return out;
}

/** `settings` complet avec `algo` remplacé (les autres clés du moteur sont gardées). */
export function mergeAlgoSettings(settings: unknown, algo: AlgoSettings): Record<string, unknown> {
  return { ...obj(settings), algo: { ...obj(obj(settings).algo), ...algo } };
}

const FIELD_NAMES: Record<keyof typeof ALGO_LIMITS, string> = {
  minPosts: "Posts minimum par cas",
  minViews: "Vues minimum par cas",
  minConversations: "Conversations minimum par profil",
  maxMixPointsPerWeek: "Points de mélange par semaine",
  maxPostsPerDay: "Posts par jour au maximum",
};

/** Formulaire « Réglages de l'équipe Algorithme ». */
export function parseAlgoSettingsForm(fd: FormData): FormResult<AlgoSettings> {
  const out = { ...ALGO_DEFAULTS };
  for (const k of Object.keys(ALGO_LIMITS) as Array<keyof typeof ALGO_LIMITS>) {
    const n = intIn(fd.get(k), ALGO_LIMITS[k]);
    if (n === null) {
      const [min, max] = ALGO_LIMITS[k];
      return { ok: false, error: `${FIELD_NAMES[k]} : un nombre entier entre ${min} et ${max}.` };
    }
    out[k] = n;
  }
  const start = String(fd.get("allowedStart") ?? "").trim();
  const end = String(fd.get("allowedEnd") ?? "").trim();
  if (!HHMM.test(start) || !HHMM.test(end))
    return { ok: false, error: "Heures autorisées : écrivez le début et la fin sous la forme 08:00." };
  if (start >= end)
    return { ok: false, error: "Heures autorisées : le début doit venir avant la fin (même journée, heure de Paris)." };
  out.allowedStart = start;
  out.allowedEnd = end;
  const f = fd.get("frequency");
  if (f !== "weekly" && f !== "biweekly") return { ok: false, error: "Choisissez la fréquence des réglages." };
  out.frequency = f;
  return { ok: true, data: out };
}

export type AlgoLevel = 0 | 1 | 2;

/** Niveaux propres à l'équipe Algorithme (elle ne publie rien : ses niveaux disent quels réglages partent seuls). */
export const ALGO_LEVELS: ReadonlyArray<{ value: AlgoLevel; label: string; sentence: string }> = [
  {
    value: 0,
    label: "Niveau 0 : tout me proposer",
    sentence: "Aucun réglage n'est appliqué seul : chaque proposition attend que vous cliquiez sur « Appliquer ».",
  },
  {
    value: 1,
    label: "Niveau 1 : appliquer les petits réglages seuls (conseillé)",
    sentence:
      "Horaires et mélange s'appliquent seuls, dans les bornes ; les réglages de persona et les quotas vous sont proposés.",
  },
  {
    value: 2,
    label: "Niveau 2 : tout appliquer dans les bornes",
    sentence:
      "Tous les réglages s'appliquent seuls, toujours dans les bornes ci-dessous et annulables en un clic. Le rapport de la semaine part dans tous les cas.",
  },
];
