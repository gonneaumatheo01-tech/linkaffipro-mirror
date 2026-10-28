// Sortie JSON stricte d'un tour de l'assistant (contrat §3.2) : schéma envoyé au modèle (`response_format: json_schema`,
// strict) et contrôle de forme fait par le code (sans dépendance : erreurs lisibles en français).
import {
  isAssistantOnlyUniverse,
  isNeedsHumanReason,
  NEEDS_HUMAN_REASONS,
  type NeedsHumanReason,
} from "@linkaffipro/core";
import { CHAT_LANGS, CONVERSATION_STAGES, type ChatLang, type ConversationStage } from "./types";

export const STYLE_LENGTHS = ["short", "medium", "long"] as const;
export const STYLE_EMOJIS = ["none", "few", "many"] as const;
export const STYLE_REGISTERS = ["casual", "neutral", "formal"] as const;
export const STYLE_TONES = ["shy", "direct", "flirty", "dry", "chatty"] as const;

export type StyleLength = (typeof STYLE_LENGTHS)[number];
export type StyleEmojis = (typeof STYLE_EMOJIS)[number];
export type StyleRegister = (typeof STYLE_REGISTERS)[number];
export type StyleTone = (typeof STYLE_TONES)[number];

/** Style observé chez la personne, estimé par le modèle à chaque tour. */
export type StyleUpdate = {
  length: StyleLength;
  emojis: StyleEmojis;
  register: StyleRegister;
  language: ChatLang;
  tone: StyleTone;
  /** Intérêt de la personne pour la discussion et l'app, de 0 à 10. */
  interest: number;
};

/** Réponse du modèle pour un tour. */
export type TurnOutput = {
  messages: { text: string }[];
  style_update: StyleUpdate;
  stage: ConversationStage;
  send_offer: boolean;
  memory_facts: string[];
  minor_suspected: boolean;
  app_refused: boolean;
  note_interne: string;
  /**
   * Passage à un humain demandé par le modèle (Casino / Paris sportifs, phase 25 ; absent ailleurs). Le motif est
   * vérifié par le code : un motif inconnu avec `needed` vrai devient « question hors fiche ».
   */
  handoff?: TurnHandoff;
  /** Phase 25 bis : clé du bookmaker choisi (paris sportifs VIP) ; chaîne vide si aucun. */
  selected_book?: string;
  /** Phase 25 bis : le modèle demande l'envoi du lien du canal VIP (après dépôt confirmé). */
  send_vip_link?: boolean;
};

export type TurnHandoff = { needed: boolean; reason: NeedsHumanReason | "none" };

export const TURN_OUTPUT_SCHEMA_NAME = "assistant_turn";
export const MIN_TURN_MESSAGES = 1;
export const MAX_TURN_MESSAGES = 3;
export const MIN_INTEREST = 0;
export const MAX_INTEREST = 10;

const TURN_OUTPUT_FIELDS = [
  "messages",
  "style_update",
  "stage",
  "send_offer",
  "memory_facts",
  "minor_suspected",
  "app_refused",
  "note_interne",
] as const;
const STYLE_FIELDS = ["length", "emojis", "register", "language", "tone", "interest"] as const;

const stringEnum = (values: readonly string[]) => ({ type: "string", enum: [...values] });

/**
 * Schéma strict (tous les champs requis, aucun champ en plus, valeurs fixes). Sans `minItems` / `maxItems` / `minimum`
 * / `maximum` : la documentation de Venice ne garantit pas ces mots-clés en mode strict, et un refus (400) rendrait
 * l'assistant muet ; les bornes (1 à 3 messages, intérêt de 0 à 10) sont dites dans le prompt et vérifiées par
 * `checkTurnOutput`.
 */
export const TURN_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [...TURN_OUTPUT_FIELDS],
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string" } },
      },
    },
    style_update: {
      type: "object",
      additionalProperties: false,
      required: [...STYLE_FIELDS],
      properties: {
        length: stringEnum(STYLE_LENGTHS),
        emojis: stringEnum(STYLE_EMOJIS),
        register: stringEnum(STYLE_REGISTERS),
        language: stringEnum(CHAT_LANGS),
        tone: stringEnum(STYLE_TONES),
        interest: { type: "integer" },
      },
    },
    stage: stringEnum(CONVERSATION_STAGES),
    send_offer: { type: "boolean" },
    memory_facts: { type: "array", items: { type: "string" } },
    minor_suspected: { type: "boolean" },
    app_refused: { type: "boolean" },
    note_interne: { type: "string" },
  },
};

/** Valeurs permises de `handoff.reason` (« none » quand aucun passage n'est demandé). */
export const HANDOFF_REASON_VALUES = ["none", ...NEEDS_HUMAN_REASONS] as const;

/**
 * Schéma des univers Casino et Paris sportifs : celui de Rencontres + `handoff` (requis en mode strict). Rencontres garde
 * exactement son schéma d'avant.
 */
export const UNIVERSE_TURN_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  ...TURN_OUTPUT_JSON_SCHEMA,
  required: [...TURN_OUTPUT_FIELDS, "handoff", "selected_book", "send_vip_link"],
  properties: {
    ...(TURN_OUTPUT_JSON_SCHEMA.properties as Record<string, unknown>),
    handoff: {
      type: "object",
      additionalProperties: false,
      required: ["needed", "reason"],
      properties: { needed: { type: "boolean" }, reason: stringEnum(HANDOFF_REASON_VALUES) },
    },
    /** Phase 25 bis : clé du bookmaker partenaire choisi (vide si aucun). */
    selected_book: { type: "string" },
    /** Phase 25 bis : true quand la personne a confirmé son dépôt et qu'on envoie le lien VIP. */
    send_vip_link: { type: "boolean" },
  },
};

/** Paramètre `jsonSchema` d'une requête au modèle (selon l'univers de la persona ; absent = Rencontres). */
export function turnOutputJsonSchema(universe?: string | null): {
  name: string;
  schema: Record<string, unknown>;
} {
  return {
    name: TURN_OUTPUT_SCHEMA_NAME,
    schema: isAssistantOnlyUniverse(universe)
      ? UNIVERSE_TURN_OUTPUT_JSON_SCHEMA
      : TURN_OUTPUT_JSON_SCHEMA,
  };
}

/**
 * `handoff` de la sortie : absent → aucun champ ; `needed` non booléen → erreur ; motif inconnu avec `needed` vrai →
 * « off_faq » (prudence : la conversation passe à l'équipe) ; `needed` faux → motif « none ».
 */
function handoffValue(raw: unknown, errors: string[]): TurnHandoff | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw) || typeof raw.needed !== "boolean") {
    errors.push("handoff : objet { needed, reason } attendu.");
    return undefined;
  }
  if (!raw.needed) return { needed: false, reason: "none" };
  const reason = typeof raw.reason === "string" ? raw.reason.trim().toLowerCase() : "";
  return { needed: true, reason: isNeedsHumanReason(reason) ? reason : "off_faq" };
}

export type TurnOutputCheck = { ok: true; value: TurnOutput } | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Valeur d'une liste fixe, sans tenir compte de la casse (« FR » → « fr », « chat » → « CHAT »). */
function enumValue<T extends string>(values: readonly T[], raw: unknown): T | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return values.find((x) => x.toLowerCase() === v.toLowerCase()) ?? null;
}

/** Nombre entier entre 0 et 10 (« 7 » ou 7.4 acceptés, arrondis ; hors bornes ramenés aux bornes). */
function interestValue(raw: unknown): number | null {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_INTEREST, Math.max(MIN_INTEREST, Math.round(n)));
}

/**
 * Contrôle de forme de la sortie du modèle. Tolérances (sans effet sur la sécurité) : casse des valeurs fixes, intérêt
 * arrondi et borné, `memory_facts` / `note_interne` absents → vides, `minor_suspected` absent → faux (la détection par
 * le code reste faite), champs en plus ignorés. Le contenu des messages est vérifié ensuite par `validateTurnOutput`.
 */
export function checkTurnOutput(value: unknown): TurnOutputCheck {
  if (!isRecord(value)) return { ok: false, errors: ["La réponse n'est pas un objet JSON."] };
  const errors: string[] = [];

  const messages: { text: string }[] = [];
  if (!Array.isArray(value.messages)) errors.push("messages : liste attendue.");
  else {
    if (value.messages.length < MIN_TURN_MESSAGES || value.messages.length > MAX_TURN_MESSAGES)
      errors.push(
        `messages : ${MIN_TURN_MESSAGES} à ${MAX_TURN_MESSAGES} éléments attendus (${value.messages.length} reçus).`,
      );
    value.messages.forEach((m, i) => {
      if (isRecord(m) && typeof m.text === "string") messages.push({ text: m.text });
      else if (typeof m === "string") messages.push({ text: m });
      else errors.push(`messages[${i}] : objet { text } attendu.`);
    });
  }

  let style: StyleUpdate | null = null;
  if (!isRecord(value.style_update)) errors.push("style_update : objet attendu.");
  else {
    const s = value.style_update;
    const length = enumValue(STYLE_LENGTHS, s.length);
    const emojis = enumValue(STYLE_EMOJIS, s.emojis);
    const register = enumValue(STYLE_REGISTERS, s.register);
    const language = enumValue(CHAT_LANGS, s.language);
    const tone = enumValue(STYLE_TONES, s.tone);
    const interest = interestValue(s.interest);
    if (!length) errors.push(`style_update.length : ${STYLE_LENGTHS.join(" | ")} attendu.`);
    if (!emojis) errors.push(`style_update.emojis : ${STYLE_EMOJIS.join(" | ")} attendu.`);
    if (!register) errors.push(`style_update.register : ${STYLE_REGISTERS.join(" | ")} attendu.`);
    if (!language) errors.push(`style_update.language : ${CHAT_LANGS.join(" | ")} attendu.`);
    if (!tone) errors.push(`style_update.tone : ${STYLE_TONES.join(" | ")} attendu.`);
    if (interest === null) errors.push("style_update.interest : nombre de 0 à 10 attendu.");
    if (length && emojis && register && language && tone && interest !== null)
      style = { length, emojis, register, language, tone, interest };
  }

  const stage = enumValue(CONVERSATION_STAGES, value.stage);
  if (!stage) errors.push(`stage : ${CONVERSATION_STAGES.join(" | ")} attendu.`);

  if (typeof value.send_offer !== "boolean") errors.push("send_offer : vrai ou faux attendu.");

  let facts: string[] = [];
  if (value.memory_facts !== undefined) {
    if (!Array.isArray(value.memory_facts)) errors.push("memory_facts : liste de textes attendue.");
    else facts = value.memory_facts.filter((f): f is string => typeof f === "string");
  }

  if (value.minor_suspected !== undefined && typeof value.minor_suspected !== "boolean")
    errors.push("minor_suspected : vrai ou faux attendu.");
  if (value.app_refused !== undefined && typeof value.app_refused !== "boolean")
    errors.push("app_refused : vrai ou faux attendu.");

  const note = typeof value.note_interne === "string" ? value.note_interne : "";
  const handoff = handoffValue(value.handoff, errors);

  // Phase 25 bis : selected_book (chaîne, vide si aucun) et send_vip_link (booléen).
  const selectedBook =
    typeof value.selected_book === "string" ? (value.selected_book as string).trim() : undefined;
  const sendVipLink =
    value.send_vip_link === true ? true : value.send_vip_link === false ? false : undefined;

  if (errors.length > 0 || !style || !stage) return { ok: false, errors };
  return {
    ok: true,
    value: {
      messages,
      style_update: style,
      stage,
      send_offer: value.send_offer === true,
      memory_facts: facts,
      minor_suspected: value.minor_suspected === true,
      app_refused: value.app_refused === true,
      note_interne: note,
      ...(handoff ? { handoff } : {}),
      ...(selectedBook !== undefined ? { selected_book: selectedBook } : {}),
      ...(sendVipLink !== undefined ? { send_vip_link: sendVipLink } : {}),
    },
  };
}
