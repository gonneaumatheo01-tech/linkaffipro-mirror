/**
 * Formulaire d'une persona de l'assistant de conversation (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 1 et § 6) :
 * état du formulaire (navigateur), lecture et validation (serveur, la même règle des deux côtés), règles d'activation,
 * textes proposés pour le profil du bot. Fonctions pures, testées dans form.test.ts ; aucun accès à la base ici (les
 * références — offre, campagne, visuel — sont vérifiées par `save.ts`).
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
import { CHAT_LANGS, assistantRole, deniesBeingAssistant, type ChatLang } from "@linkaffipro/chat";

export type PersonaGender = "F" | "M";

/** Bornes des champs (longueurs en caractères, nombres inclus). */
export const PERSONA_LIMITS = {
  name: 40,
  personality: 600,
  tone: 200,
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

// ------------------------------------------------------------------
// État du formulaire (navigateur)
// ------------------------------------------------------------------

/** Brouillon tel que saisi : les nombres restent du texte jusqu'à la validation. */
export type PersonaFormState = {
  id: string | null;
  name: string;
  gender: PersonaGender;
  personality: string;
  tone: string;
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
 * qu'aucun prénom n'est saisi (jamais un prénom d'exemple dans un texte que Telegram afficherait).
 */
export function proposedProfileTexts(
  templates: ProfileTemplates,
  state: Pick<PersonaFormState, "name" | "gender" | "languages">,
): ProfileTemplate | null {
  const name = state.name.trim();
  if (!name) return null;
  const lang = state.languages[0] ?? "fr";
  const t = templates[lang]?.[state.gender] ?? templates.fr?.[state.gender];
  if (!t) return null;
  const fill = (s: string) => s.replace("{name}", () => name);
  return { long: fill(t.long), short: fill(t.short) };
}

/**
 * Les textes du profil suivent le prénom, le rôle et la langue tant que l'équipe ne les a pas réécrits : un texte encore
 * égal au texte proposé AVANT la modification (ou vide) est remplacé par le nouveau texte proposé, ou vidé quand il n'y
 * a plus de texte proposé (prénom effacé). Un texte réécrit par l'équipe est toujours gardé.
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
    personality: "",
    tone: "",
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
  personality: string;
  tone: string;
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
  const state: PersonaFormState = {
    id: p.id,
    name: p.name,
    gender: p.gender === "M" ? "M" : "F",
    personality: p.personality,
    tone: p.tone,
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

/**
 * Le texte dit-il que c'est un assistant (« assistant », « assistante », « asistente », « Assistentin »…) ? Même règle
 * que `mentionsAssistant` de packages/telegram (garde-fou de `setAssistantProfile`), vérifiée par un test.
 */
export function saysAssistant(text: string | null | undefined): boolean {
  return /assist[ae]nt|asistent/i.test(text ?? "");
}

/*
 * Consignes qui demanderaient de cacher que c'est un assistant (se faire passer pour une vraie personne, nier être une
 * IA, ne jamais l'avouer) : refusées (`hidesAssistant`). Le texte est d'abord replié (minuscules, sans accents,
 * apostrophes droites, espaces simples) ; le passage rapporté est pris dans le texte d'origine.
 *
 * Trois familles de règles :
 * - affirmations : « tu es une vraie fille », « je ne suis pas un bot », « fais-toi passer pour une vraie personne » ;
 * - silence demandé sur ce qu'elle est : « ne dis jamais / n'avoue jamais / ne jamais dire / ne dis à personne / évite
 *   de dire / il ne faut pas que tu dises … que tu es une IA » (la suite de la proposition doit nommer une IA, un bot ou
 *   une assistante, sans négation avant : « ne dis jamais que tu n'es pas une IA » est une consigne honnête) ;
 * - verbes de dissimulation : « cache / nie / dissimule / tais … que tu es une IA ».
 * Une négation placée avant, dans la même proposition, rend la consigne honnête : « ne cache jamais », « tu ne dois
 * jamais cacher », « ne pas cacher », « sans jamais cacher », « ne jamais te faire passer pour une vraie personne »,
 * « ne dis jamais que tu es une vraie personne », « never pretend to be human ». Une question rapportée aussi : « si on
 * te demande si tu es une vraie personne, réponds que tu es une IA ».
 */

/** Une IA, un bot, une assistante (français, texte replié). */
const AI_FR =
  /(?:^|[^a-z0-9])(?:ia|i\.a\.?|bot|chatbot|robot|assistante?|virtuel(?:le)?|intelligence artificielle)(?![a-z0-9])/;
/** Une IA, un bot, un assistant (anglais, texte replié). */
const AI_EN = /(?:^|[^a-z0-9])(?:ai|a\.i\.?|bot|chatbot|robot|assistant|virtual)(?![a-z0-9])/;
/** Une vraie personne (texte replié) : cible de « fais-toi passer pour… ». « à personne » (nul) n'en est pas une. */
const HUMAN =
  /(?:^|[^a-z0-9])(?:vraie?|veritable|humaine?|reelle?|(?<!(?:^|[^a-z])a )personne|fille|femme|homme|mec|meuf|en chair et en os|real|human|person|woman|girl|man)(?![a-z0-9])/;
/** Négation (français et anglais, texte replié). */
const NEGATION =
  /(?:^|[^a-z0-9])(?:(?:ne|pas|jamais|aucune?|nullement|sans|never|not|without|no|dont)(?![a-z0-9])|n')|n't(?![a-z])/;
/** Elle-même (« que tu es une IA », « être un bot », « ta nature d'IA », « c'est une IA », « you are an AI ») : le silence
 * demandé doit porter sur ce qu'elle est (« ne dis jamais que le bot est payant » n'est pas en cause). */
const SELF_REF =
  /(?:^|[^a-z0-9])(?:(?:tu|te|toi|ta|ton|tes|je|me|moi|ma|mon|elle|il|etre|vous|votre|you|your|yourself|i|being|this is)(?![a-z0-9])|t'|j'|c'|i'm|it's)/;
/** Refus ou interdiction (« interdiction de cacher… », « refuse de nier… », « évite de cacher… »). */
const REFUSAL =
  /(?:^|[^a-z0-9])(?:interdit|interdiction|refuse[sz]?|refuser|evite[sz]?|eviter|avoid|refuse)(?![a-z0-9])/;
/** Une affirmation niée juste avant : « ne dis jamais que… », « never say… », « don't pretend… ». */
const CLAIM_NEGATED_END =
  /(?:^|[^a-z0-9])(?:que|qu'|that|say|claim|pretend|tell (?:them|anyone|people|the user|him|her)) ?$/;
/** Une question rapportée juste avant : « si on te demande si… », « if they ask whether… ». */
const QUESTION_END = /(?:^|[^a-z0-9])(?:si|s'il|if|whether) ?$/;

type HidingRule = {
  /** Déclencheur, sur le texte replié (drapeau g ajouté par `hidesAssistant`). */
  re: RegExp;
  /**
   * Cible exigée dans la suite de la proposition (80 caractères au plus), sans négation avant elle ; une cible IA doit
   * en plus parler d'elle-même (`SELF_REF`).
   */
  target?: RegExp;
  /** Une vraie personne nommée avant la cible rend la consigne honnête (« ne dis jamais que tu es humaine : tu es une IA »). */
  humanBeforeTargetOk?: boolean;
  /**
   * Ce qui précède, dans la même proposition, peut rendre la consigne honnête :
   * - "claim" (affirmation) : affirmation niée ou question rapportée juste avant (« ne dis jamais que tu es une vraie
   *   personne », « si on te demande si tu es une vraie personne »), ou suivie d'un « ? » ;
   * - "act" (verbe) : une négation ou un refus (« ne cache jamais », « tu ne dois jamais cacher », « sans jamais cacher »).
   */
  honestIf?: "claim" | "act";
};

const SAY_CONJ =
  "dis|dit|dites|avoue|avouez|admets|admet|admettez|revele|revelez|reconnais|reconnait|reconnaissez|confirme|confirmez|mentionne|mentionnez|precise|precisez|indique|indiquez|signale|signalez|devoile|devoilez|laisse (?:entendre|croire|penser|paraitre)|laissez (?:entendre|croire|penser|paraitre)";
const SAY_INF =
  "dire|avouer|admettre|reveler|reconnaitre|confirmer|mentionner|preciser|indiquer|signaler|devoiler|laisser (?:entendre|croire|penser|paraitre)";
const SAY_SUBJ =
  "dises|disiez|avoues|avouiez|admettes|admettiez|reveles|reconnaisses|confirmes|mentionnes|precises";
const NEVER = "jamais|pas|surtout pas|plus|en aucun cas|sous aucun pretexte|surtout jamais";
const PRONOUN = "(?:(?:le|la|lui|leur|les) |l')?";
const MODAL = "(?:(?:dois|doit|devez|doivent|faut|peux|peut|pouvez|vas|va|allez|veux|voulez) )?";
const PERSON_FR = "personne|fille|femme|humaine?|homme|mec|meuf|nana";
const AI_NOUN_FR =
  "ia|i\\.a\\.?|bot|chatbot|robot|assistante?|intelligence artificielle|programme|machine";

const HIDING_RULES: readonly HidingRule[] = [
  // Affirmations : « tu es une vraie fille », « c'est une vraie personne », « je suis humaine », « je ne suis pas un bot ».
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])(?:tu es|t'es|vous etes|je suis|est) (?:une?|un) (?:vraie?|veritable) (?:${PERSON_FR})(?![a-z0-9])`,
    ),
    honestIf: "claim",
  },
  {
    re: /(?:^|[^a-z0-9])(?:tu es|t'es|vous etes|je suis|elle est|il est|c'est) (?:humaine?|reelle?|en chair et en os)(?![a-z0-9])/,
    honestIf: "claim",
  },
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])(?:tu n'es|t'es|tu es|vous n'etes|je ne suis|je suis|n'est|est) pas (?:une?|un) (?:${AI_NOUN_FR})(?![a-z0-9])`,
    ),
    honestIf: "claim",
  },
  // « fais-toi passer pour une vraie personne », « fais semblant d'être une femme », « prétends être humaine ».
  {
    re: /(?:^|[^a-z0-9])(?:fais[- ]toi passer|faites[- ]vous passer|se faire passer|te faire passer|fais semblant|faites semblant|faire semblant|pretends?|pretendez|pretendre)(?![a-z0-9])/,
    target: HUMAN,
    honestIf: "act",
  },
  // Silence demandé : « ne dis jamais… », « n'avoue jamais… », « ne dis à personne… », « ne dis rien… ».
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])n(?:e |')${PRONOUN}(?:${SAY_CONJ}) (?:(?:${NEVER})(?: a personne)?|a personne|rien)(?![a-z0-9])`,
    ),
    target: AI_FR,
    humanBeforeTargetOk: true,
  },
  // « ne jamais dire… », « tu ne dois jamais dire… », « ne pas avouer… », « il ne faut jamais le dire… ».
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])n(?:e |')${MODAL}(?:${NEVER}) ${PRONOUN}(?:${SAY_INF})(?![a-z0-9])`,
    ),
    target: AI_FR,
    humanBeforeTargetOk: true,
  },
  // « il ne faut pas que tu dises… ».
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])ne faut (?:${NEVER}) que (?:tu|vous) ${PRONOUN}(?:${SAY_SUBJ})(?![a-z0-9])`,
    ),
    target: AI_FR,
    humanBeforeTargetOk: true,
  },
  // Sans « ne » : « dis jamais que t'es une IA », « surtout pas dire… », « évite de dire… », « refuse d'admettre… ».
  {
    re: new RegExp(
      `(?:^|[^a-z0-9])(?:(?:${SAY_CONJ}) (?:jamais|a personne|surtout pas)|(?:jamais|surtout pas) (?:${SAY_INF})|(?:evite|evitez|eviter|refuse|refusez|refuser|interdiction|sans|sans jamais|garde-toi|gardez-vous) (?:de |d')?${PRONOUN}(?:${SAY_INF}))(?![a-z0-9])`,
    ),
    target: AI_FR,
    humanBeforeTargetOk: true,
    honestIf: "act",
  },
  // Dissimulation : « cache que tu es une IA », « nie être un bot », « garde le secret… ».
  {
    re: /(?:^|[^a-z0-9])(?:cache|caches|cachez|cacher|dissimule|dissimules|dissimulez|dissimuler|masque|masquez|masquer|nie|nies|niez|nier|tais|taisez|taire|garde le secret|gardez le secret|garder le secret)(?![a-z0-9])/,
    target: AI_FR,
    honestIf: "act",
  },
  // Anglais.
  {
    re: /(?:^|[^a-z0-9])(?:you are|you're|youre|i am|i'm|im) (?:a |an )?(?:real|human|actual person)(?![a-z0-9])/,
    honestIf: "claim",
  },
  {
    re: /(?:^|[^a-z0-9])(?:(?:you are|you're|youre|i am|i'm|im) not|you aren't|you arent|i'm no) (?:a |an )?(?:ai|a\.i\.?|bot|chatbot|robot|assistant)(?![a-z0-9])/,
    honestIf: "claim",
  },
  {
    re: /(?:^|[^a-z0-9])(?:pretend|pretending|act as if|act like|pose as|posing as)(?![a-z0-9])/,
    target: HUMAN,
    honestIf: "act",
  },
  {
    re: /(?:^|[^a-z0-9])(?:never|don't|dont|do not)(?: ever)? (?:say|admit|reveal|tell|mention|disclose|confirm|let (?:anyone|them|people|the user) know)(?![a-z0-9])/,
    target: AI_EN,
    humanBeforeTargetOk: true,
  },
  {
    re: /(?:^|[^a-z0-9])(?:hide|hiding|conceal|concealing|deny|denying|keep (?:it )?secret)(?![a-z0-9])/,
    target: AI_EN,
    honestIf: "act",
  },
];

/** Vrai si ce qui précède le déclencheur (même proposition) rend la consigne honnête (voir `HidingRule.honestIf`). */
function honestBefore(kind: "claim" | "act", prior: string, after: string): boolean {
  if (kind === "claim")
    return (
      QUESTION_END.test(prior) ||
      /^ ?\?/.test(after) ||
      (NEGATION.test(prior) && CLAIM_NEGATED_END.test(prior))
    );
  return NEGATION.test(prior) || REFUSAL.test(prior);
}

/** Fin de proposition : ponctuation forte, deux-points, retour à la ligne. */
const CLAUSE_END = /[.!?;:\n]/;

/** Texte replié (minuscules, sans accents, apostrophes droites, espaces simples) et position d'origine de chaque caractère. */
function foldForRules(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    let f: string;
    if (/['’‘`´ʼ]/.test(ch)) f = "'";
    else if (ch === "\n") f = "\n";
    else if (/\s/.test(ch)) f = " ";
    else
      f = ch
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    if (f === " " && (folded.endsWith(" ") || folded.endsWith("\n") || folded === "")) continue;
    for (const c of f) {
      folded += c;
      origin.push(i);
    }
  }
  return { folded, origin };
}

/** Début de la proposition qui contient la position `at` (après la dernière ponctuation forte). */
function clauseStart(folded: string, at: number): number {
  for (let i = at - 1; i >= 0; i--) if (CLAUSE_END.test(folded[i]!)) return i + 1;
  return 0;
}

export function hidesAssistant(text: string | null | undefined): string | null {
  const original = text ?? "";
  if (!original.trim()) return null;
  const { folded, origin } = foldForRules(original);
  for (const rule of HIDING_RULES) {
    const re = new RegExp(rule.re.source, "g");
    for (let m = re.exec(folded); m; m = re.exec(folded)) {
      // Tous les déclencheurs commencent par une lettre : un premier caractère autre est le séparateur capturé devant.
      const start = m.index + (/^[^a-z0-9]/.test(m[0]) ? 1 : 0);
      let end = m.index + m[0].length;
      if (rule.honestIf) {
        const prior = folded.slice(Math.max(clauseStart(folded, start), start - 60), start);
        if (honestBefore(rule.honestIf, prior, folded.slice(end, end + 3))) continue;
      }
      if (rule.target) {
        let stop = end;
        while (stop < folded.length && stop - end < 80 && !CLAUSE_END.test(folded[stop]!)) stop++;
        const tail = folded.slice(end, stop);
        const t = rule.target.exec(tail);
        if (!t) continue;
        const ahead = tail.slice(0, t.index);
        if (NEGATION.test(ahead)) continue;
        if (rule.target !== HUMAN && !SELF_REF.test(ahead)) continue;
        if (rule.humanBeforeTargetOk && HUMAN.test(ahead)) continue;
        end += t.index + t[0].length;
      }
      return original.slice(origin[start]!, origin[end - 1]! + 1).trim();
    }
  }
  return null;
}

/** Refus commun d'un texte qui cacherait l'assistante (passage en cause cité quand il est connu). */
function hidingRefusal(hit: string | null): string {
  return hit
    ? `Refusé : l'assistante dit toujours qu'elle est une assistante (une IA). Retirez « ${hit} ».`
    : "Refusé : l'assistante dit toujours qu'elle est une assistante (une IA). Ce texte le nie ou laisse croire à une vraie personne : réécrivez-le.";
}

/**
 * Texte public du bot (description ou description courte, posé tel quel dans Telegram) : refusé s'il nie être une
 * assistante ou laisse croire à une vraie personne (`deniesBeingAssistant` du moteur, `hidesAssistant`), ou s'il ne dit
 * pas « assistante » / « assistant ». Null : texte accepté.
 */
export function botProfileTextProblem(text: string, kind: "long" | "short"): string | null {
  const t = text.trim();
  if (!t) return null;
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
  personality: string;
  tone: string;
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
  personality: text(6000),
  tone: text(2000),
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
  const personality = f.personality.trim();
  if (personality.length > L.personality) errors.personality = tooLong(L.personality);
  const tone = f.tone.trim();
  if (tone.length > L.tone) errors.tone = tooLong(L.tone);

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

  // Texte public du bot : il dit « assistant(e) », sans le nier ni laisser croire à une vraie personne (règle 2).
  const botDescription = f.botDescription.trim();
  if (botDescription.length > L.botDescription) errors.botDescription = tooLong(L.botDescription);
  else {
    const problem = botProfileTextProblem(botDescription, "long");
    if (problem) errors.botDescription = problem;
  }
  const botShortDescription = f.botShortDescription.replace(/\s+/g, " ").trim();
  if (botShortDescription.length > L.botShortDescription)
    errors.botShortDescription = tooLong(L.botShortDescription);
  else {
    const problem = botProfileTextProblem(botShortDescription, "short");
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

  // Aucune option pour cacher qu'il s'agit d'un assistant (règle 2 du client).
  for (const [field, value] of [
    ["personality", personality],
    ["tone", tone],
    ["extraPrompt", extraPrompt],
    ["interests", f.interests],
  ] as const) {
    if (errors[field]) continue;
    const hit = hidesAssistant(value);
    if (hit) errors[field] = hidingRefusal(hit);
  }

  const affiliateCampaignId = f.affiliateCampaignId || null;
  const data: PersonaData = {
    name,
    gender: f.gender,
    personality,
    tone,
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
