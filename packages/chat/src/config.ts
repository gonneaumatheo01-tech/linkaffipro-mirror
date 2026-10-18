// Réglages de l'assistant de conversation (`Setting` `assistant.venice`), contrat docs/ASSISTANT-CONVERSATION.md § 2.
// Pur : ni Prisma ni réseau. Lecture tolérante (un champ invalide prend sa valeur par défaut), état affichable sans la
// clé, bornes de Paris (plafond mensuel et limite du jour) et règle d'activation.
import type { VeniceModelInfo } from "./types";

export const ASSISTANT_SETTING_KEY = "assistant.venice";

/** « off » : l'assistant ne répond à personne ; « team » : seulement aux comptes Telegram de l'équipe ; « all ». */
export const ASSISTANT_ACTIVATIONS = ["off", "team", "all"] as const;
export type AssistantActivation = (typeof ASSISTANT_ACTIVATIONS)[number];

export const DEFAULT_ASSISTANT_MODEL = "venice-uncensored-role-play";
export const DEFAULT_ASSISTANT_FALLBACK_MODEL = "venice-uncensored-1-2";

/** Bornes des réglages numériques (une valeur hors bornes est invalide : valeur par défaut). */
export const ASSISTANT_LIMITS = {
  temperature: { min: 0, max: 2 },
  maxTokens: { min: 64, max: 2000 },
  monthlyCapEur: { min: 0, max: 100_000 },
  perConversationDailyLimit: { min: 1, max: 1000 },
} as const;

export type AssistantConfig = {
  /** `encrypt()` de core ; jamais renvoyée au navigateur. */
  apiKeyEncrypted: string | null;
  activation: AssistantActivation;
  defaultModel: string;
  fallbackModel: string;
  temperature: number;
  /** Longueur maximale d'une réponse (jetons), bornée à `maxCompletionTokens` du modèle à l'appel. */
  maxTokens: number;
  /** Plafond mensuel en euros (0 = aucun appel). */
  monthlyCapEur: number;
  /** Réponses de l'assistant par jour (Paris) et par conversation. */
  perConversationDailyLimit: number;
  /** Cache de `GET /models` (texte, sortie JSON stricte, en ligne, non retiré). */
  models: VeniceModelInfo[];
  modelsFetchedAt: string | null;
  verifiedAt: string | null;
  lastError: string | null;
};

export const DEFAULT_ASSISTANT_CONFIG: Readonly<AssistantConfig> = Object.freeze({
  apiKeyEncrypted: null,
  activation: "off",
  defaultModel: DEFAULT_ASSISTANT_MODEL,
  fallbackModel: DEFAULT_ASSISTANT_FALLBACK_MODEL,
  temperature: 0.85,
  maxTokens: 400,
  monthlyCapEur: 30,
  perConversationDailyLimit: 60,
  models: [],
  modelsFetchedAt: null,
  verifiedAt: null,
  lastError: null,
}) as Readonly<AssistantConfig>;

/** État affichable (sans la clé). */
export type AssistantConfigState = Omit<AssistantConfig, "apiKeyEncrypted"> & {
  hasKey: boolean;
  keyHint: string | null;
};

// ------------------------------------------------------------------
// Lecture tolérante
// ------------------------------------------------------------------

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function inRange(
  v: unknown,
  { min, max }: { min: number; max: number },
  def: number,
  integer = false,
): number {
  const n = toNumber(v);
  if (n === null) return def;
  const x = integer ? Math.round(n) : n;
  return x >= min && x <= max ? x : def;
}

function text(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Identifiant de modèle Venice plausible (lettres, chiffres, points, tirets, soulignés, deux-points, barres). */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

function modelId(v: unknown, def: string): string {
  const t = text(v, 200);
  return t && MODEL_ID.test(t) ? t : def;
}

function isoDate(v: unknown): string | null {
  const t = text(v, 64);
  if (!t) return null;
  return Number.isNaN(Date.parse(t)) ? null : t;
}

function nullableNumber(v: unknown): number | null {
  const n = toNumber(v);
  return n !== null && n >= 0 ? n : null;
}

/** Une entrée du cache des modèles (forme `VeniceModelInfo`), ou null si elle est inexploitable. */
export function parseCachedModel(value: unknown): VeniceModelInfo | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const id = text(v.id, 200);
  if (!id || !MODEL_ID.test(id)) return null;
  const int = (x: unknown) => {
    const n = nullableNumber(x);
    return n === null ? null : Math.round(n);
  };
  return {
    id,
    name: text(v.name, 200) ?? id,
    inputUsdPerM: nullableNumber(v.inputUsdPerM),
    outputUsdPerM: nullableNumber(v.outputUsdPerM),
    maxCompletionTokens: int(v.maxCompletionTokens),
    contextLength: int(v.contextLength),
    supportsResponseSchema: v.supportsResponseSchema === true,
    supportsReasoning: v.supportsReasoning === true,
    uncensored: v.uncensored === true,
    offline: v.offline === true,
    deprecated: v.deprecated === true,
  };
}

/** Lit le réglage `assistant.venice` : chaque champ absent ou invalide prend sa valeur par défaut. */
export function parseAssistantConfig(value: unknown): AssistantConfig {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_ASSISTANT_CONFIG;
  const activation = ASSISTANT_ACTIVATIONS.includes(v.activation as AssistantActivation)
    ? (v.activation as AssistantActivation)
    : d.activation;
  const seen = new Set<string>();
  const models: VeniceModelInfo[] = [];
  if (Array.isArray(v.models))
    for (const raw of v.models) {
      const m = parseCachedModel(raw);
      if (m && !seen.has(m.id)) {
        seen.add(m.id);
        models.push(m);
      }
    }
  return {
    apiKeyEncrypted: text(v.apiKeyEncrypted, 4096),
    activation,
    defaultModel: modelId(v.defaultModel, d.defaultModel),
    fallbackModel: modelId(v.fallbackModel, d.fallbackModel),
    temperature: inRange(v.temperature, ASSISTANT_LIMITS.temperature, d.temperature),
    maxTokens: inRange(v.maxTokens, ASSISTANT_LIMITS.maxTokens, d.maxTokens, true),
    monthlyCapEur: inRange(v.monthlyCapEur, ASSISTANT_LIMITS.monthlyCapEur, d.monthlyCapEur),
    perConversationDailyLimit: inRange(
      v.perConversationDailyLimit,
      ASSISTANT_LIMITS.perConversationDailyLimit,
      d.perConversationDailyLimit,
      true,
    ),
    models,
    modelsFetchedAt: isoDate(v.modelsFetchedAt),
    verifiedAt: isoDate(v.verifiedAt),
    lastError: text(v.lastError, 500),
  };
}

/** Indice de la clé pour la reconnaître (« abcd…wxyz »), jamais la clé entière. */
export function keyHint(key: string): string {
  const k = key.trim();
  if (k.length < 12) return "••••";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

/** Réglages affichables : la clé chiffrée est retirée, remplacée par `hasKey` et un indice. */
export function assistantConfigState(
  cfg: AssistantConfig,
  decryptFn: (encrypted: string) => string,
): AssistantConfigState {
  const { apiKeyEncrypted, ...rest } = cfg;
  let hint: string | null = null;
  if (apiKeyEncrypted) {
    try {
      hint = keyHint(decryptFn(apiKeyEncrypted));
    } catch {
      hint = "(illisible : recollez la clé)";
    }
  }
  return { ...rest, hasKey: Boolean(apiKeyEncrypted), keyHint: hint };
}

/**
 * L'assistant peut-il répondre à cette personne ? « off » : jamais ; « team » : seulement aux comptes Telegram liés à
 * un utilisateur de la plateforme (ou à l'admin) ; « all » : à tous ceux qui ont écrit au bot.
 */
export function canAssistantReply(
  activation: AssistantActivation,
  { isTeamMember }: { isTeamMember: boolean },
): boolean {
  if (activation === "all") return true;
  if (activation === "team") return isTeamMember;
  return false;
}

// ------------------------------------------------------------------
// Heure de Paris (plafond mensuel, limite du jour) : stockage UTC, calcul fiable aux changements d'heure
// ------------------------------------------------------------------

const PARIS_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type ParisParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parisParts(d: Date): ParisParts {
  const out: Record<string, number> = {};
  for (const p of PARIS_PARTS.formatToParts(d))
    if (p.type !== "literal") out[p.type] = Number(p.value);
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Décalage de Paris sur UTC à cet instant, en millisecondes (+1 h l'hiver, +2 h l'été). */
function parisOffsetMs(d: Date): number {
  const p = parisParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Instant UTC de minuit à Paris pour cette date de calendrier (minuit n'est jamais sauté à Paris). */
function parisMidnight(year: number, month: number, day: number): Date {
  const wall = Date.UTC(year, month - 1, day);
  let t = wall - parisOffsetMs(new Date(wall));
  // Second passage : le décalage de minuit peut différer de celui de l'estimation (jour de changement d'heure).
  t = wall - parisOffsetMs(new Date(t));
  return new Date(t);
}

/** Début du mois en cours à Paris (instant UTC). */
export function parisMonthStart(now: Date = new Date()): Date {
  const p = parisParts(now);
  return parisMidnight(p.year, p.month, 1);
}

/** Début du jour en cours à Paris (instant UTC). */
export function parisDayStart(now: Date = new Date()): Date {
  const p = parisParts(now);
  return parisMidnight(p.year, p.month, p.day);
}

/** Jour de Paris « AAAA-MM-JJ » (clé de la limite du jour). */
export function parisDayKey(now: Date = new Date()): string {
  const p = parisParts(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
