/**
 * Assistant IA d'écriture des messages (phase 8) : types partagés entre le paquet, le site et les tests.
 * Ce paquet ne touche ni à la base ni aux secrets : il reçoit une clé en clair (déjà déchiffrée par le site),
 * construit les prompts, appelle le client injectable et valide la sortie.
 */

/** Ce que l'utilisateur demande. */
export type AiKind =
  "improve" | "idea" | "shorter" | "punchier" | "angle" | "translate" | "ab_variant";
export const AI_KINDS: readonly AiKind[] = [
  "improve",
  "idea",
  "shorter",
  "punchier",
  "angle",
  "translate",
  "ab_variant",
];

export type AiVertical = "CASINO" | "SPORTS" | "DATING";
export type AiSurface = "post" | "bot_text" | "broadcast" | "template" | "automation";
export const AI_SURFACES: readonly AiSurface[] = [
  "post",
  "bot_text",
  "broadcast",
  "template",
  "automation",
];
export type AiObjective = "offer_click" | "signup" | "engagement" | "reactivation";
export const AI_OBJECTIVES: readonly AiObjective[] = [
  "offer_click",
  "signup",
  "engagement",
  "reactivation",
];
export type AiTone = "friendly" | "professional" | "energetic" | "sober" | "playful";
export const AI_TONES: readonly AiTone[] = [
  "friendly",
  "professional",
  "energetic",
  "sober",
  "playful",
];
export type AiLength = "short" | "medium" | "long";
export const AI_LENGTHS: readonly AiLength[] = ["short", "medium", "long"];
/**
 * Langues dans lesquelles l'assistant écrit : toutes celles des textes du bot
 * (apps/web/app/(admin)/channels/[id]/sequences/langs.ts), pour que l'IA réponde dans la langue du champ.
 */
export type AiLanguage =
  "fr" | "en" | "es" | "pt" | "de" | "it" | "ar" | "tr" | "nl" | "pl" | "ro" | "ru";
export const AI_LANGUAGES: readonly AiLanguage[] = [
  "fr",
  "en",
  "es",
  "pt",
  "de",
  "it",
  "ar",
  "tr",
  "nl",
  "pl",
  "ro",
  "ru",
];
/**
 * Langues cibles de « Traduire dans les langues du bot » : les 6 langues de l'interface du bot
 * (packages/telegram/src/i18n.ts). Les 6 autres restent possibles en écriture et comme langue de départ ;
 * les traduire toutes à la fois dépasserait le plafond de sortie pour un texte long.
 */
export const AI_TRANSLATION_LANGUAGES: readonly AiLanguage[] = ["fr", "en", "es", "pt", "de", "it"];

export const AI_LABELS = {
  vertical: { CASINO: "Casino", SPORTS: "Paris sportifs", DATING: "Dating" } satisfies Record<
    AiVertical,
    string
  >,
  objective: {
    offer_click: "Clic sur l'offre",
    signup: "Inscription",
    engagement: "Engagement (réactions, réponses)",
    reactivation: "Relance des inactifs",
  } satisfies Record<AiObjective, string>,
  tone: {
    friendly: "Amical",
    professional: "Professionnel",
    energetic: "Énergique",
    sober: "Sobre",
    playful: "Léger, avec humour",
  } satisfies Record<AiTone, string>,
  length: {
    short: "Court (2-3 lignes)",
    medium: "Moyen (4-6 lignes)",
    long: "Long (8-12 lignes)",
  } satisfies Record<AiLength, string>,
  language: {
    fr: "Français",
    en: "Anglais",
    es: "Espagnol",
    pt: "Portugais",
    de: "Allemand",
    it: "Italien",
    ar: "Arabe",
    tr: "Turc",
    nl: "Néerlandais",
    pl: "Polonais",
    ro: "Roumain",
    ru: "Russe",
  } satisfies Record<AiLanguage, string>,
  surface: {
    post: "Message de canal",
    bot_text: "Texte du bot",
    broadcast: "Envoi groupé",
    template: "Modèle",
    automation: "Automatisation",
  } satisfies Record<AiSurface, string>,
  kind: {
    improve: "Améliorer",
    idea: "Écrire à partir d'une idée",
    shorter: "Plus court",
    punchier: "Plus percutant",
    angle: "Autre angle",
    translate: "Traduire",
    ab_variant: "Version B (test A/B)",
  } satisfies Record<AiKind, string>,
} as const;

/** Contexte de la demande (tout est facultatif : le prompt s'adapte à ce qui est connu). */
export type AiContext = {
  vertical?: AiVertical | null;
  categoryName?: string | null;
  language?: AiLanguage | null;
  objective?: AiObjective | null;
  tone?: AiTone | null;
  length?: AiLength | null;
  hasMedia?: boolean | null;
  surface?: AiSurface | null;
};

/** Exemple « ce qui marche chez vous » : texte d'un message envoyé qui a bien fonctionné (jamais de donnée personnelle). */
export type AiExample = { text: string; note?: string };

/** Textes de la mention des risques, réglables dans Réglages → IA. */
export type AiRiskNotice = { casino: string; sports: string };
export const DEFAULT_RISK_NOTICE: AiRiskNotice = {
  casino: "Jouer comporte des risques : endettement, isolement, dépendance.",
  sports: "Jouer comporte des risques : endettement, isolement, dépendance.",
};

/** Une version proposée : le texte (HTML Telegram) et la phrase « ce qui change ». `lang` pour les traductions. */
export type AiVersion = { text: string; why: string; lang?: AiLanguage };

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
};

export type AiRequest = {
  kind: AiKind;
  /** Brouillon (ou idée pour `idea`). */
  text: string;
  context: AiContext;
  examples?: AiExample[];
  riskNotice?: Partial<AiRiskNotice> | null;
  model: string;
};

export type AiResult = {
  versions: AiVersion[];
  usage: AiUsage;
  costEur: number;
  model: string;
  /** Versions écartées par la validation (pour le journal), avec la raison. */
  rejected: Array<{ text: string; reason: string }>;
};

/** Requête minimale envoyée au client (forme proche de `messages.create`, sans dépendre du SDK dans les tests). */
export type AiMessageRequest = {
  model: string;
  /** Plafond de jetons de sortie, réflexion du modèle comprise. */
  maxTokens: number;
  system: Array<{ text: string; cache: boolean }>;
  user: string;
  /** Effort de réflexion (`output_config.effort`) ; « low » par défaut : textes courts, réponse rapide. */
  effort?: "low" | "medium" | "high";
  /** Images jointes au message (contrôle des médias des agents, phase 20), placées avant le texte. */
  images?: AiImageInput[];
};
/** Image en base64 (JPEG, PNG, WebP ou GIF). */
export type AiImageInput = { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };
export type AiMessageResponse = { text: string; usage: AiUsage; stopReason: string | null };
/** Client injectable : le vrai appelle l'API Anthropic, le simulé renvoie des réponses préparées. */
export type AiClient = { createMessage(req: AiMessageRequest): Promise<AiMessageResponse> };
