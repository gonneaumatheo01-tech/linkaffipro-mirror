/**
 * Formulaire d'une persona de l'assistant de conversation (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 1 et § 6) :
 * état du formulaire (navigateur), lecture et validation (serveur, la même règle des deux côtés), règles d'activation,
 * textes proposés pour le profil du bot. Fonctions pures, testées dans form.test.ts ; aucun accès à la base ici (les
 * références — offre, campagne, visuel — sont vérifiées par `save.ts`).
 *
 * Deux identités (phase 18), choisies par « Qui est-elle ? » :
 * - l'assistante du canal (ASSISTANT, défaut) : le cadre de la phase 17, sa description de bot doit dire
 *   « assistant(e) » sans le nier ni laisser croire à une vraie personne ;
 * - une fille (GIRL, sur un compte Telegram réel) : elle ne se démasque jamais, ne dit ni « assistante », ni « IA », ni
 *   « canal ». Son âge est obligatoire, et son texte public ne doit contenir aucun mot de machine.
 *
 * Règles du client (non négociables) tenues ici :
 * - aucune option pour cacher qu'il s'agit d'un assistant : la description du bot doit dire « assistant(e) » sans le
 *   nier ni laisser croire à une vraie personne (`botProfileTextProblem`), et une consigne qui demanderait de se faire
 *   passer pour une vraie personne est refusée (`hidesAssistant`) ;
 * - jamais de lien au premier message : au moins 1 message de la personne avant le lien ;
 * - pas de spam : 2 relances au plus, la première après 4 h de silence au moins ;
 * - honnêteté : une offre liée exige sa fiche (« Ce que l'assistante peut dire de l'app ») pour être activée.
 */
import { z } from "zod";
import {
  CHAT_LANGS,
  assistantRole,
  deniesBeingAssistant,
  type ChatLang,
  type PersonaIdentity,
} from "@linkaffipro/chat";
// Honnêteté des textes : règle partagée avec l'équipe Algorithme (réglages de persona appliqués, phase 21).
import {
  PERSONA_UNIVERSES,
  allowedIdentities,
  hidesAssistant,
  isPersonaUniverse,
  saysAssistant,
  type PersonaFaqEntry,
  type PersonaUniverse,
} from "@linkaffipro/core";
import { cleanFaq, validateFaq } from "./faq";

export { hidesAssistant, saysAssistant };
export type { PersonaFaqEntry, PersonaUniverse };

/**
 * Univers de la persona (phase 25) : libellés du client, valeurs ASCII. Sur un bot Casino ou Paris sportifs,
 * l'identité assistante est imposée (`allowedIdentities`) : jamais « une fille », jamais le mode illusion.
 */
export const PERSONA_UNIVERSE_OPTIONS: ReadonlyArray<{ value: PersonaUniverse; label: string }> = [
  { value: "dating", label: "Rencontres" },
  { value: "casino", label: "Casino" },
  { value: "sports", label: "Paris sportifs" },
];

/** Univers lu d'une valeur quelconque (Rencontres par défaut, comme la colonne). */
export function cleanUniverse(v: unknown): PersonaUniverse {
  return isPersonaUniverse(v) ? v : "dating";
}

export function universeLabelFr(v: unknown): string {
  const u = cleanUniverse(v);
  return PERSONA_UNIVERSE_OPTIONS.find((o) => o.value === u)!.label;
}

/** « Une fille » est-elle permise dans cet univers ? (Rencontres seulement.) */
export function girlAllowed(universe: unknown): boolean {
  return allowedIdentities(cleanUniverse(universe)).includes("GIRL");
}

/** Refus serveur d'une fille (ou du mode illusion) hors Rencontres. */
export const GIRL_NOT_ALLOWED =
  "Sur un bot Casino ou Paris sportifs, la persona est toujours l'assistante du canal : « Une fille » n'est pas possible.";

export type { PersonaIdentity };

export type PersonaGender = "F" | "M";

/** Bornes des champs (longueurs en caractères, nombres inclus). */
export const PERSONA_LIMITS = {
  name: 40,
  personality: 2000,
  tone: 800,
  styleExamples: 1500,
  age: { min: 18, max: 99 },
  interests: 12,
  interest: 40,
  extraPrompt: 1000,
  offerPitch: 1500,
  offerButtonText: 40,
  /** Bornes de Telegram (setMyDescription / setMyShortDescription). */
  botDescription: 512,
  botShortDescription: 120,
  minExchangesBeforeOffer: { min: 1, max: 20, def: 4 },
  maxOfferSends: { min: 1, max: 3, def: 2 },
  followUpAfterHours: { min: 4, max: 168, def: 24 },
  followUpsMax: { min: 0, max: 2, def: 2 },
  temperature: { min: 0, max: 2 },
} as const;

export const DEFAULT_OFFER_BUTTON_TEXT = "Découvrir l'app";

/** Types de visuels acceptés pour l'offre : envoyés en photo par Telegram. */
export const OFFER_VISUAL_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Langues proposées (celles des textes du bot), avec leur nom en français. */
export const PERSONA_LANGUAGES: ReadonlyArray<{ code: ChatLang; label: string }> = [
  { code: "fr", label: "Français" },
  { code: "en", label: "Anglais" },
  { code: "es", label: "Espagnol" },
  { code: "pt", label: "Portugais" },
  { code: "de", label: "Allemand" },
  { code: "it", label: "Italien" },
];

export function languageLabel(code: string): string {
  return PERSONA_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/** « l'assistante » / « l'assistant » (en français, pour l'interface). */
export function personaRole(gender: string | null | undefined): string {
  return assistantRole("fr", gender);
}

/** Identité effective d'une persona enregistrée (toute valeur autre que « GIRL » est l'assistante). */
export function cleanIdentity(identity: string | null | undefined): PersonaIdentity {
  return identity === "GIRL" ? "GIRL" : "ASSISTANT";
}

/** Libellé court de l'identité (« Une fille », « l'assistante »), accordé au genre. */
export function identityLabel(identity: string | null | undefined, gender?: string | null): string {
  return cleanIdentity(identity) === "GIRL" ? "Une fille" : personaRole(gender);
}

// ------------------------------------------------------------------
// État du formulaire (navigateur)
// ------------------------------------------------------------------

/** Brouillon tel que saisi : les nombres restent du texte jusqu'à la validation. */
export type PersonaFormState = {
  id: string | null;
  name: string;
  gender: PersonaGender;
  /** « Qui est-elle ? » : l'assistante du canal, ou une fille sur un compte Telegram réel. */
  identityKind: PersonaIdentity;
  /** Univers du bot (Rencontres, Casino, Paris sportifs) : hors Rencontres, toujours l'assistante. */
  universe: PersonaUniverse;
  /** "" : aucun âge (obligatoire pour une fille). */
  age: string;
  personality: string;
  tone: string;
  /** Exemples d'écriture à imiter (facultatifs), recopiés dans les consignes du modèle. */
  styleExamples: string;
  /** Langues cochées, la première est la langue par défaut. */
  languages: ChatLang[];
  /** Centres d'intérêt séparés par des virgules. */
  interests: string;
  minExchangesBeforeOffer: string;
  requireInterest: boolean;
  maxOfferSends: string;
  followUpAfterHours: string;
  followUpsMax: string;
  /** "" : aucune offre (jamais de lien). */
  affiliateCampaignId: string;
  /** "" : aucune campagne. */
  campaignId: string;
  offerPitch: string;
  offerButtonText: string;
  /** "" : aucun visuel. */
  offerMediaAssetId: string;
  botDescription: string;
  botShortDescription: string;
  /** "" : modèle par défaut des réglages. */
  model: string;
  /** "" : créativité des réglages. */
  temperature: string;
  extraPrompt: string;
  /** Fiche d'informations (questions / réponses, 40 au plus) : modifiable par un administrateur seulement. */
  faq: PersonaFaqEntry[];
  isActive: boolean;
};

export type PersonaFormField = Exclude<keyof PersonaFormState, "id">;
export type PersonaFormErrors = Partial<Record<PersonaFormField, string>>;

/**
 * Textes proposés pour le profil du bot, par langue et par rôle, avec le repère `{name}` (calculés côté serveur depuis
 * `assistantProfilePlan` de packages/telegram : mêmes textes que ceux posés par défaut dans Telegram).
 */
export type ProfileTemplate = { long: string; short: string };
export type ProfileTemplates = Partial<Record<ChatLang, Record<PersonaGender, ProfileTemplate>>>;

/**
 * Textes proposés du profil (description et description courte) pour ce prénom, ce rôle et cette langue ; null tant
 * qu'aucun prénom n'est saisi (jamais un prénom d'exemple dans un texte que Telegram afficherait), et null pour une
 * fille : un compte réel n'a pas de description de bot (celle de l'assistante dit « assistante », ce qu'une fille ne
 * doit pas dire).
 */
export function proposedProfileTexts(
  templates: ProfileTemplates,
  state: Pick<PersonaFormState, "name" | "gender" | "languages" | "identityKind">,
): ProfileTemplate | null {
  const name = state.name.trim();
  if (!name) return null;
  if (state.identityKind === "GIRL") return null;
  const lang = state.languages[0] ?? "fr";
  const t = templates[lang]?.[state.gender] ?? templates.fr?.[state.gender];
  if (!t) return null;
  const fill = (s: string) => s.replace("{name}", () => name);
  return { long: fill(t.long), short: fill(t.short) };
}

/**
 * Les textes du profil suivent le prénom, le rôle et la langue tant que l'équipe ne les a pas réécrits : un texte encore
 * égal au texte proposé AVANT la modification (ou vide) est remplacé par le nouveau texte proposé, ou vidé quand il n'y
 * a plus de texte proposé (prénom effacé, ou persona passée en fille). Un texte réécrit par l'équipe est toujours gardé.
 */
export function withProfileTexts(
  before: PersonaFormState,
  after: PersonaFormState,
  templates: ProfileTemplates,
): PersonaFormState {
  const prev = proposedProfileTexts(templates, before);
  const next = proposedProfileTexts(templates, after);
  const follows = (current: string, proposed: string | undefined) =>
    current.trim() === "" || (proposed !== undefined && current === proposed);
  return {
    ...after,
    botDescription: follows(after.botDescription, prev?.long)
      ? (next?.long ?? "")
      : after.botDescription,
    botShortDescription: follows(after.botShortDescription, prev?.short)
      ? (next?.short ?? "")
      : after.botShortDescription,
  };
}

/**
 * Nouvelle persona : désactivée, valeurs par défaut du contrat ; descriptions du bot vides tant qu'aucun prénom n'est
 * saisi (proposées dès qu'un prénom est tapé ; laissées vides, le texte par défaut est posé à l'enregistrement).
 */
export function emptyPersonaForm(templates: ProfileTemplates = {}): PersonaFormState {
  const base: PersonaFormState = {
    id: null,
    name: "",
    gender: "F",
    identityKind: "ASSISTANT",
    universe: "dating",
    age: "",
    personality: "",
    tone: "",
    styleExamples: "",
    languages: ["fr"],
    interests: "",
    minExchangesBeforeOffer: String(PERSONA_LIMITS.minExchangesBeforeOffer.def),
    requireInterest: true,
    maxOfferSends: String(PERSONA_LIMITS.maxOfferSends.def),
    followUpAfterHours: String(PERSONA_LIMITS.followUpAfterHours.def),
    followUpsMax: String(PERSONA_LIMITS.followUpsMax.def),
    affiliateCampaignId: "",
    campaignId: "",
    offerPitch: "",
    offerButtonText: DEFAULT_OFFER_BUTTON_TEXT,
    offerMediaAssetId: "",
    botDescription: "",
    botShortDescription: "",
    model: "",
    temperature: "",
    extraPrompt: "",
    faq: [],
    isActive: false,
  };
  const texts = proposedProfileTexts(templates, base);
  return texts ? { ...base, botDescription: texts.long, botShortDescription: texts.short } : base;
}

/** Persona enregistrée (colonnes Prisma) telle que la lit le formulaire. */
export type PersonaRecord = {
  id: string;
  name: string;
  gender: string;
  identityKind: string;
  /** Phase 25 (colonnes facultatives pour les lectures plus anciennes : Rencontres, fiche vide). */
  universe?: string | null;
  faq?: unknown;
  age: number | null;
  personality: string;
  tone: string;
  styleExamples: string | null;
  languages: string[];
  interests: string[];
  extraPrompt: string | null;
  model: string | null;
  temperature: number | null;
  minExchangesBeforeOffer: number;
  requireInterest: boolean;
  maxOfferSends: number;
  followUpAfterHours: number;
  followUpsMax: number;
  affiliateCampaignId: string | null;
  campaignId: string | null;
  offerPitch: string;
  offerButtonText: string;
  offerMediaAssetId: string | null;
  botDescription: string | null;
  botShortDescription: string | null;
  isActive: boolean;
};

/** Langues d'une persona parmi les 6, dans l'ordre, sans doublon (français si aucune). */
export function cleanLanguages(languages: readonly string[]): ChatLang[] {
  const out: ChatLang[] = [];
  for (const l of languages) {
    const code = l.trim().toLowerCase();
    if ((CHAT_LANGS as readonly string[]).includes(code) && !out.includes(code as ChatLang))
      out.push(code as ChatLang);
  }
  return out.length > 0 ? out : ["fr"];
}

/** Formulaire pré-rempli depuis une persona enregistrée (description vide : texte proposé). */
export function personaToForm(
  p: PersonaRecord,
  templates: ProfileTemplates = {},
): PersonaFormState {
  const universe = cleanUniverse(p.universe);
  const state: PersonaFormState = {
    id: p.id,
    name: p.name,
    gender: p.gender === "M" ? "M" : "F",
    // Une ancienne fille hors Rencontres (impossible depuis la phase 25) repasse en assistante dans le formulaire.
    identityKind: girlAllowed(universe) ? cleanIdentity(p.identityKind) : "ASSISTANT",
    universe,
    age: p.age === null ? "" : String(p.age),
    personality: p.personality,
    tone: p.tone,
    styleExamples: p.styleExamples ?? "",
    languages: cleanLanguages(p.languages),
    interests: p.interests.join(", "),
    minExchangesBeforeOffer: String(p.minExchangesBeforeOffer),
    requireInterest: p.requireInterest,
    maxOfferSends: String(p.maxOfferSends),
    followUpAfterHours: String(p.followUpAfterHours),
    followUpsMax: String(p.followUpsMax),
    affiliateCampaignId: p.affiliateCampaignId ?? "",
    campaignId: p.campaignId ?? "",
    offerPitch: p.offerPitch,
    offerButtonText: p.offerButtonText,
    offerMediaAssetId: p.offerMediaAssetId ?? "",
    botDescription: p.botDescription ?? "",
    botShortDescription: p.botShortDescription ?? "",
    model: p.model ?? "",
    temperature: p.temperature === null ? "" : String(p.temperature),
    extraPrompt: p.extraPrompt ?? "",
    faq: cleanFaq(p.faq),
    isActive: p.isActive,
  };
  const texts = proposedProfileTexts(templates, state);
  if (!texts) return state;
  return {
    ...state,
    botDescription: state.botDescription || texts.long,
    botShortDescription: state.botShortDescription || texts.short,
  };
}

/** Réglages « Avancé » qui s'écartent des valeurs par défaut (compteur du bloc replié). */
export function advancedModifiedCount(state: PersonaFormState): number {
  return [state.model.trim(), state.temperature.trim(), state.extraPrompt.trim()].filter(Boolean)
    .length;
}

// ------------------------------------------------------------------
// Règles du client
// ------------------------------------------------------------------

/** Un mot de machine (« assistante », « IA », « bot »…) : interdit dans le texte public d'une fille. */
const MACHINE_WORD =
  /assist[ae]nt|asistent|intelligence artificielle|\bia\b|\bbot\b|chatbot|robot|virtuel/i;

/** Refus commun d'un texte qui cacherait l'assistante (passage en cause cité quand il est connu). */
function hidingRefusal(hit: string | null): string {
  return hit
    ? `Refusé : l'assistante dit toujours qu'elle est une assistante (une IA). Retirez « ${hit} ».`
    : "Refusé : l'assistante dit toujours qu'elle est une assistante (une IA). Ce texte le nie ou laisse croire à une vraie personne : réécrivez-le.";
}

/**
 * Texte public de la persona (description ou description courte, posé tel quel dans Telegram) :
 * - assistante (ASSISTANT) : refusé s'il nie être une assistante ou laisse croire à une vraie personne
 *   (`deniesBeingAssistant` du moteur, `hidesAssistant`), ou s'il ne dit pas « assistante » / « assistant » ;
 * - fille (GIRL) : refusé s'il contient un mot de machine (« assistante », « IA », « bot »…), elle qui n'en parle jamais.
 * Null : texte accepté.
 */
export function botProfileTextProblem(
  text: string,
  kind: "long" | "short",
  identityKind: PersonaIdentity = "ASSISTANT",
): string | null {
  const t = text.trim();
  if (!t) return null;
  const label = kind === "long" ? "description" : "description courte";
  if (identityKind === "GIRL") {
    const hit = MACHINE_WORD.exec(t);
    return hit
      ? `Pour une fille, la ${label} ne doit pas parler de machine : retirez « ${hit[0]} ».`
      : null;
  }
  const hit = hidesAssistant(t);
  if (hit || deniesBeingAssistant(t)) return hidingRefusal(hit);
  if (!saysAssistant(t))
    return kind === "long"
      ? "La description doit dire que c'est l'assistante ou l'assistant du canal (le mot « assistante » ou « assistant »)."
      : "La description courte doit dire « assistante » ou « assistant ».";
  return null;
}

/**
 * Ce qui empêche d'activer la persona (liste vide : activation permise). Le nom du champ cité est celui affiché par le
 * formulaire, accordé au genre de la persona (« Ce que l'assistant peut dire de l'app » pour une persona masculine).
 */
export function activationProblems(p: {
  name: string;
  affiliateCampaignId: string | null;
  offerPitch: string;
  gender?: string | null;
}): string[] {
  const out: string[] = [];
  if (!p.name.trim()) out.push("Donnez-lui d'abord un prénom.");
  if (p.affiliateCampaignId && !p.offerPitch.trim())
    out.push(
      `Une offre est liée : remplissez d'abord « Ce que ${personaRole(p.gender)} peut dire de l'app » (sans ce texte, ${p.gender === "M" ? "il" : "elle"} ne pourrait rien en dire d'honnête).`,
    );
  return out;
}

// ------------------------------------------------------------------
// Lecture et validation (serveur)
// ------------------------------------------------------------------

/** Persona validée, prête à enregistrer. */
export type PersonaData = {
  name: string;
  gender: PersonaGender;
  identityKind: PersonaIdentity;
  universe: PersonaUniverse;
  age: number | null;
  personality: string;
  tone: string;
  styleExamples: string | null;
  languages: ChatLang[];
  interests: string[];
  minExchangesBeforeOffer: number;
  requireInterest: boolean;
  maxOfferSends: number;
  followUpAfterHours: number;
  followUpsMax: number;
  affiliateCampaignId: string | null;
  campaignId: string | null;
  offerPitch: string;
  offerButtonText: string;
  offerMediaAssetId: string | null;
  botDescription: string | null;
  botShortDescription: string | null;
  model: string | null;
  temperature: number | null;
  extraPrompt: string | null;
  /**
   * Fiche d'informations lue et vérifiée (`validateFaq` de ./faq) ; null si le brouillon n'en porte pas (la fiche
   * enregistrée reste alors inchangée). Le droit de la modifier (ADMIN) est vérifié par l'enregistrement.
   */
  faq: PersonaFaqEntry[] | null;
  isActive: boolean;
};

export type PersonaValidation =
  | { ok: true; id: string | null; data: PersonaData }
  | { ok: false; error: string; errors: PersonaFormErrors };

const text = (max: number) => z.string().max(max).catch("");
const id = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9_-]*$/)
  .catch("");

/** Forme attendue du brouillon (tolérante : un champ absent ou de mauvais type devient vide). */
const payloadSchema = z.object({
  id: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable()
    .catch(null),
  name: text(400),
  gender: z.enum(["F", "M"]).catch("F"),
  identityKind: z.enum(["ASSISTANT", "GIRL"]).catch("ASSISTANT"),
  universe: z.enum(PERSONA_UNIVERSES).catch("dating"),
  /** Le formulaire ne l'envoie pas (déduit de l'identité) ; refusé hors Rencontres s'il arrive à true. */
  illusion: z.boolean().optional().catch(undefined),
  age: z.union([z.string().max(20), z.number()]).catch(""),
  personality: text(6000),
  tone: text(2000),
  styleExamples: text(6000),
  languages: z.array(z.string().max(10)).max(20).catch([]),
  interests: text(4000),
  minExchangesBeforeOffer: z.union([z.string().max(20), z.number()]).catch(""),
  requireInterest: z.boolean().catch(true),
  maxOfferSends: z.union([z.string().max(20), z.number()]).catch(""),
  followUpAfterHours: z.union([z.string().max(20), z.number()]).catch(""),
  followUpsMax: z.union([z.string().max(20), z.number()]).catch(""),
  affiliateCampaignId: id,
  campaignId: id,
  offerPitch: text(15000),
  offerButtonText: text(400),
  offerMediaAssetId: id,
  botDescription: text(5000),
  botShortDescription: text(2000),
  model: text(400),
  temperature: z.union([z.string().max(20), z.number()]).catch(""),
  extraPrompt: text(10000),
  // Fiche d'informations : absente ou illisible → null (inchangée). Les bornes fines sont vérifiées par validateFaq.
  faq: z
    .array(z.object({ q: z.string().max(5000), a: z.string().max(10000) }))
    .max(200)
    .nullable()
    .optional()
    .catch(undefined),
  isActive: z.boolean().catch(false),
});

function intIn(raw: string | number, range: { min: number; max: number }): number | null {
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= range.min && n <= range.max ? n : null;
}

/** Centres d'intérêt : séparés par des virgules, points-virgules ou retours à la ligne ; sans doublon. */
export function parseInterests(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const t = part.replace(/\s+/g, " ").trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Identifiant de modèle Venice plausible (même règle que les réglages). */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

const tooLong = (max: number) => `${max} caractères au plus.`;

/**
 * Lit et valide le brouillon envoyé par le formulaire. Les règles du client sont vérifiées ici (description qui dit
 * « assistant(e) », consigne qui ne cache rien, bornes du parcours, conditions d'activation) ; l'existence de l'offre,
 * de la campagne et du visuel est vérifiée par l'enregistrement.
 */
export function validatePersonaForm(raw: unknown): PersonaValidation {
  const parsed = payloadSchema.safeParse(raw ?? {});
  if (!parsed.success)
    return {
      ok: false,
      error: "Le formulaire n'a pas pu être lu : rechargez la page, puis recommencez.",
      errors: {},
    };
  const f = parsed.data;
  const errors: PersonaFormErrors = {};
  const L = PERSONA_LIMITS;

  const name = f.name.replace(/\s+/g, " ").trim();
  if (name.length > L.name) errors.name = tooLong(L.name);
  const identityKind = cleanIdentity(f.identityKind);
  const universe = cleanUniverse(f.universe);
  // Casino et Paris sportifs : identité assistante imposée (ni « une fille », ni mode illusion).
  if (!girlAllowed(universe) && (identityKind === "GIRL" || f.illusion === true))
    errors.identityKind = GIRL_NOT_ALLOWED;
  let faq: PersonaFaqEntry[] | null = null;
  if (Array.isArray(f.faq)) {
    const fv = validateFaq(f.faq);
    if (fv.ok) faq = fv.faq;
    else errors.faq = fv.error;
  } else if (
    raw &&
    typeof raw === "object" &&
    "faq" in raw &&
    (raw as { faq: unknown }).faq != null
  )
    errors.faq =
      "La fiche d'informations n'a pas pu être lue : rechargez la page, puis recommencez.";
  const personality = f.personality.trim();
  if (personality.length > L.personality) errors.personality = tooLong(L.personality);
  const tone = f.tone.trim();
  if (tone.length > L.tone) errors.tone = tooLong(L.tone);
  const styleExamples = f.styleExamples.trim();
  if (styleExamples.length > L.styleExamples) errors.styleExamples = tooLong(L.styleExamples);

  // Âge : obligatoire pour une fille (sans âge, elle n'est pas crédible), facultatif pour une assistante.
  const ageRaw = String(f.age).trim();
  let age: number | null = null;
  if (ageRaw) {
    const n = Number(ageRaw);
    if (!Number.isInteger(n) || n < L.age.min || n > L.age.max)
      errors.age = `Un âge entier de ${L.age.min} à ${L.age.max}.`;
    else age = n;
  } else if (identityKind === "GIRL") {
    errors.age = "Indiquez son âge : une fille qui ne connaît pas son âge n'est pas crédible.";
  }

  const languages = cleanLanguages(f.languages);
  if (f.languages.filter((l) => (CHAT_LANGS as readonly string[]).includes(l)).length === 0)
    errors.languages = "Cochez au moins une langue.";

  const interests = parseInterests(f.interests);
  if (interests.length > L.interests)
    errors.interests = `${L.interests} centres d'intérêt au plus.`;
  else if (interests.some((i) => i.length > L.interest))
    errors.interests = `Chaque centre d'intérêt : ${L.interest} caractères au plus.`;

  const minExchanges = intIn(f.minExchangesBeforeOffer, L.minExchangesBeforeOffer);
  if (minExchanges === null)
    errors.minExchangesBeforeOffer = `Un nombre entier de ${L.minExchangesBeforeOffer.min} à ${L.minExchangesBeforeOffer.max} (jamais de lien au premier message).`;
  const maxOfferSends = intIn(f.maxOfferSends, L.maxOfferSends);
  if (maxOfferSends === null)
    errors.maxOfferSends = `De ${L.maxOfferSends.min} à ${L.maxOfferSends.max} envois.`;
  const followUpAfterHours = intIn(f.followUpAfterHours, L.followUpAfterHours);
  if (followUpAfterHours === null)
    errors.followUpAfterHours = `Un nombre d'heures de ${L.followUpAfterHours.min} à ${L.followUpAfterHours.max}.`;
  const followUpsMax = intIn(f.followUpsMax, L.followUpsMax);
  if (followUpsMax === null)
    errors.followUpsMax = `De ${L.followUpsMax.min} à ${L.followUpsMax.max} relances (jamais plus de 2).`;

  const offerPitch = f.offerPitch.trim();
  if (offerPitch.length > L.offerPitch) errors.offerPitch = tooLong(L.offerPitch);
  const offerButtonText = f.offerButtonText.replace(/\s+/g, " ").trim();
  if (!offerButtonText) errors.offerButtonText = "Écrivez le texte du bouton.";
  else if (offerButtonText.length > L.offerButtonText)
    errors.offerButtonText = tooLong(L.offerButtonText);

  // Texte public de la persona : l'assistante dit « assistant(e) » sans le nier (règle 2) ; une fille ne parle pas de
  // machine du tout.
  const botDescription = f.botDescription.trim();
  if (botDescription.length > L.botDescription) errors.botDescription = tooLong(L.botDescription);
  else {
    const problem = botProfileTextProblem(botDescription, "long", identityKind);
    if (problem) errors.botDescription = problem;
  }
  const botShortDescription = f.botShortDescription.replace(/\s+/g, " ").trim();
  if (botShortDescription.length > L.botShortDescription)
    errors.botShortDescription = tooLong(L.botShortDescription);
  else {
    const problem = botProfileTextProblem(botShortDescription, "short", identityKind);
    if (problem) errors.botShortDescription = problem;
  }

  const model = f.model.trim();
  if (model && !MODEL_ID.test(model))
    errors.model = "Modèle inconnu : choisissez-en un dans la liste.";
  const tempRaw = String(f.temperature).trim().replace(",", ".");
  let temperature: number | null = null;
  if (tempRaw) {
    const n = Number(tempRaw);
    if (!Number.isFinite(n) || n < L.temperature.min || n > L.temperature.max)
      errors.temperature = `Un nombre de ${L.temperature.min} à ${L.temperature.max} (ou vide pour le réglage général).`;
    else temperature = Math.round(n * 100) / 100;
  }
  const extraPrompt = f.extraPrompt.trim();
  if (extraPrompt.length > L.extraPrompt) errors.extraPrompt = tooLong(L.extraPrompt);

  // Aucune option pour cacher qu'il s'agit d'un assistant (règle 2 du client). Sans objet pour une fille : elle est
  // censée nier être une machine, donc « ne dis jamais que tu es une IA » est une consigne juste.
  if (identityKind === "ASSISTANT") {
    for (const [field, value] of [
      ["personality", personality],
      ["tone", tone],
      ["extraPrompt", extraPrompt],
      ["styleExamples", styleExamples],
      ["interests", f.interests],
    ] as const) {
      if (errors[field]) continue;
      const hit = hidesAssistant(value);
      if (hit) errors[field] = hidingRefusal(hit);
    }
  }

  const affiliateCampaignId = f.affiliateCampaignId || null;
  const data: PersonaData = {
    name,
    gender: f.gender,
    identityKind,
    universe,
    age,
    personality,
    tone,
    styleExamples: styleExamples || null,
    languages,
    interests,
    minExchangesBeforeOffer: minExchanges ?? L.minExchangesBeforeOffer.def,
    requireInterest: f.requireInterest,
    maxOfferSends: maxOfferSends ?? L.maxOfferSends.def,
    followUpAfterHours: followUpAfterHours ?? L.followUpAfterHours.def,
    followUpsMax: followUpsMax ?? L.followUpsMax.def,
    affiliateCampaignId,
    campaignId: f.campaignId || null,
    offerPitch,
    offerButtonText,
    offerMediaAssetId: f.offerMediaAssetId || null,
    botDescription: botDescription || null,
    botShortDescription: botShortDescription || null,
    model: model || null,
    temperature,
    extraPrompt: extraPrompt || null,
    faq,
    isActive: f.isActive,
  };

  if (f.isActive) {
    const problems = activationProblems(data);
    if (problems.length > 0) {
      if (!name) errors.name ??= "Un prénom est nécessaire pour activer la persona.";
      if (affiliateCampaignId && !offerPitch)
        errors.offerPitch ??= "Nécessaire pour activer la persona (une offre est liée).";
      errors.isActive = `Activation impossible : ${problems.join(" ")}`;
    }
  }

  const count = Object.keys(errors).length;
  if (count > 0)
    return {
      ok: false,
      error:
        count === 1
          ? "Un champ est à corriger (indiqué en rouge)."
          : `${count} champs sont à corriger (indiqués en rouge).`,
      errors,
    };
  return { ok: true, id: f.id, data };
}
