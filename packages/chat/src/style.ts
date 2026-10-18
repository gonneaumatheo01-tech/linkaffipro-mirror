// Style de la personne (contrat §3.5) : profil gardé sur la conversation, fusionné à chaque tour, réinjecté dans le
// prompt ; langue de réponse.
import {
  MAX_INTEREST,
  MIN_INTEREST,
  STYLE_EMOJIS,
  STYLE_LENGTHS,
  STYLE_REGISTERS,
  STYLE_TONES,
  type StyleUpdate,
} from "./schema";
import { chatLangOf } from "./texts";
import { CHAT_LANGS, type ChatLang } from "./types";

/** `Conversation.styleProfile` : champs de `style_update` (tous facultatifs) + date de la dernière mise à jour. */
export type StyleProfile = Partial<StyleUpdate> & { updatedAt?: string };

function pick<T extends string>(values: readonly T[], raw: unknown): T | undefined {
  return typeof raw === "string" && (values as readonly string[]).includes(raw)
    ? (raw as T)
    : undefined;
}

/** Lecture tolérante d'un profil enregistré (JSON) : champ invalide → absent. */
export function parseStyleProfile(value: unknown): StyleProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const out: StyleProfile = {};
  const length = pick(STYLE_LENGTHS, v.length);
  const emojis = pick(STYLE_EMOJIS, v.emojis);
  const register = pick(STYLE_REGISTERS, v.register);
  const language = pick(CHAT_LANGS, v.language);
  const tone = pick(STYLE_TONES, v.tone);
  if (length) out.length = length;
  if (emojis) out.emojis = emojis;
  if (register) out.register = register;
  if (language) out.language = language;
  if (tone) out.tone = tone;
  if (typeof v.interest === "number" && Number.isFinite(v.interest))
    out.interest = Math.min(MAX_INTEREST, Math.max(MIN_INTEREST, Math.round(v.interest)));
  if (typeof v.updatedAt === "string") out.updatedAt = v.updatedAt;
  return out;
}

/** Fusion du profil avec l'estimation du tour : la dernière estimation du modèle (qui voit tout l'échange) l'emporte. */
export function mergeStyle(previous: StyleProfile, update: StyleUpdate, now: Date): StyleProfile {
  return { ...previous, ...update, updatedAt: now.toISOString() };
}

/** Langues de la persona reconnues (6 langues), dans l'ordre ; français si aucune. */
export function personaLanguages(languages: readonly string[]): ChatLang[] {
  const out: ChatLang[] = [];
  for (const l of languages) {
    const lang = chatLangOf(l);
    if (lang && !out.includes(lang)) out.push(lang);
  }
  return out.length > 0 ? out : ["fr"];
}

/**
 * Langue de réponse (contrat §3.5) : celle de la personne (`style.language`, sinon `Member.languageCode`), si la
 * persona la parle ; sinon la première langue de la persona.
 */
export function replyLanguage(input: {
  style: StyleProfile;
  memberLanguageCode: string | null | undefined;
  personaLanguages: readonly string[];
}): ChatLang {
  const langs = personaLanguages(input.personaLanguages);
  const personLang = input.style.language ?? chatLangOf(input.memberLanguageCode);
  if (personLang && langs.includes(personLang)) return personLang;
  return langs[0] ?? "fr";
}

const LENGTH_FR: Record<string, string> = { short: "courts", medium: "moyens", long: "longs" };
const EMOJIS_FR: Record<string, string> = {
  none: "aucun emoji",
  few: "quelques emojis",
  many: "beaucoup d'emojis",
};
const REGISTER_FR: Record<string, string> = {
  casual: "familier",
  neutral: "neutre",
  formal: "soutenu",
};
const TONE_FR: Record<string, string> = {
  shy: "timide",
  direct: "direct",
  flirty: "joueur, dragueur",
  dry: "sec, peu bavard",
  chatty: "bavard",
};

/** Description du style en français (pour le prompt), ou null si rien n'est encore connu. */
export function describeStyle(style: StyleProfile): string | null {
  const parts: string[] = [];
  if (style.length) parts.push(`messages ${LENGTH_FR[style.length]}`);
  if (style.emojis) parts.push(EMOJIS_FR[style.emojis] ?? style.emojis);
  if (style.register) parts.push(`registre ${REGISTER_FR[style.register]}`);
  if (style.tone) parts.push(`ton ${TONE_FR[style.tone]}`);
  if (typeof style.interest === "number") parts.push(`intérêt estimé ${style.interest}/10`);
  return parts.length > 0 ? parts.join(", ") : null;
}
