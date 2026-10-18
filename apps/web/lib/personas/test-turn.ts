/**
 * Bouton « Tester » d'une persona (phase 17, contrat docs/ASSISTANT-CONVERSATION.md § 6 et § 7) : conversation
 * simulée dans la page, sans Telegram. Ici les règles pures : forme de la demande (l'historique est renvoyé par le
 * navigateur à chaque message, borné), persona telle que la lit le moteur (même règle que le worker), entrée du tour,
 * et réponse affichée (bulles, faux bouton d'offre, étape, style, refus, pannes). L'appel lui-même est dans la route
 * `app/api/assistant/test/route.ts` (vrai client Venice, plafond vérifié, coût enregistré en TEST).
 */
import { z } from "zod";
import {
  CONVERSATION_STAGES,
  clampMaxTokens,
  findModel,
  modelSupportsReasoning,
  parseStyleProfile,
  typingDelayMs,
  type AssistantConfig,
  type ChatLang,
  type ConversationStage,
  type HistoryMessage,
  type PersonaInput,
  type StyleProfile,
  type TurnInput,
  type TurnOutcome,
  type TurnResult,
  type UsageRecord,
} from "@linkaffipro/chat";
import { personaRole } from "./form";
import { aiFailureText, rejectLabels } from "./view";

/** Bornes du test : messages par heure et par personne de l'équipe, historique renvoyé, longueur des textes. */
export const TEST_LIMITS = {
  perHour: 30,
  history: 40,
  text: 1000,
  facts: 20,
  fact: 300,
} as const;

/** Action du journal écrite à chaque message d'essai (sert aussi à compter la limite par heure). */
export const TEST_AUDIT_ACTION = "persona.tested";

/** Adresse des liens d'essai : jamais un vrai lien (domaine réservé), rien n'est créé en base. */
export const TEST_OFFER_BASE_URL = "https://lien-d-essai.invalid/";

const historyItem = z.object({
  from: z.enum(["person", "assistant"]),
  text: z.string().max(TEST_LIMITS.text),
});

const stateSchema = z.object({
  stage: z.enum(CONVERSATION_STAGES).default("WELCOME"),
  style: z.record(z.string(), z.unknown()).default({}),
  facts: z.array(z.string().max(TEST_LIMITS.fact)).max(TEST_LIMITS.facts).default([]),
  assistantTurns: z.number().int().min(0).max(1000).default(0),
  offerSends: z.number().int().min(0).max(100).default(0),
  closed: z.boolean().default(false),
});

/** Corps de POST /api/assistant/test. */
export const testRequestSchema = z.object({
  personaId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  message: z.string().max(TEST_LIMITS.text),
  history: z.array(historyItem).max(TEST_LIMITS.history).default([]),
  state: stateSchema.optional(),
});

export type TestRequest = z.infer<typeof testRequestSchema>;
export type TestHistoryItem = z.infer<typeof historyItem>;

/** État de la conversation d'essai, gardé par le navigateur et renvoyé à chaque message. */
export type TestState = {
  stage: ConversationStage;
  style: StyleProfile;
  facts: string[];
  assistantTurns: number;
  offerSends: number;
  /** Conversation fermée (moins de 18 ans) : « Recommencer » pour un nouvel essai. */
  closed: boolean;
};

export const INITIAL_TEST_STATE: TestState = {
  stage: "WELCOME",
  style: {},
  facts: [],
  assistantTurns: 0,
  offerSends: 0,
  closed: false,
};

/** Un message de l'assistante dans le test. */
export type TestReplyPart = {
  text: string;
  /** Texte du bouton d'offre (faux bouton : lien d'essai, aucun suivi), ou null. */
  button: string | null;
  /** Visuel de l'app envoyé en photo avec ce texte en légende. */
  mediaAssetId: string | null;
  /** Texte fixe de secours (présentation, aveu, arrêt mineur, « je reviens vers toi »). */
  fixed: boolean;
  /** « écrit… » simulé avant ce message (rythme réel raccourci). */
  typingMs: number;
};

export type TestNotice = { tone: "info" | "warning" | "danger"; text: string };

/** Réponse de POST /api/assistant/test. */
export type TestResponse = {
  outcome: TurnOutcome;
  parts: TestReplyPart[];
  state: TestState;
  language: ChatLang;
  model: string | null;
  /** Note interne de l'IA (jamais envoyée à la personne). */
  note: string | null;
  /** Raisons de refus des réponses de l'IA pendant ce tour, en français. */
  rejected: string[];
  notice: TestNotice | null;
  /** Coût de ce message d'essai (euros, estimé). */
  costEur: number;
};

/** Persona enregistrée telle que la lit le moteur (colonnes utiles). */
export type PersonaTurnRow = {
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
  offerPitch: string;
  offerButtonText: string;
  offerMediaAssetId: string | null;
};

/**
 * Persona du moteur, même règle que le worker (`toPersonaInput`) : sans offre utilisable (offre liée inactive ou sans
 * adresse de suivi), le moteur ne parle jamais du lien et aucun visuel ne part.
 */
export function personaTurnInput(
  p: PersonaTurnRow,
  extras: { offerUsable: boolean; channelTitle: string | null; botName: string | null },
): PersonaInput {
  return {
    name: p.name,
    gender: p.gender,
    personality: p.personality,
    tone: p.tone,
    languages: p.languages,
    interests: p.interests,
    extraPrompt: p.extraPrompt,
    model: p.model,
    temperature: p.temperature,
    minExchangesBeforeOffer: p.minExchangesBeforeOffer,
    requireInterest: p.requireInterest,
    maxOfferSends: p.maxOfferSends,
    followUpAfterHours: p.followUpAfterHours,
    followUpsMax: p.followUpsMax,
    offerPitch: p.offerPitch,
    offerButtonText: p.offerButtonText,
    hasOffer: Boolean(p.affiliateCampaignId) && extras.offerUsable,
    offerMediaAssetId: extras.offerUsable ? p.offerMediaAssetId : null,
    channelTitle: extras.channelTitle,
    botName: extras.botName,
  };
}

/** État reçu du navigateur, relu avec les bornes (style relu comme un profil enregistré). */
export function testStateFrom(raw: TestRequest["state"]): TestState {
  if (!raw) return { ...INITIAL_TEST_STATE };
  return {
    stage: raw.stage,
    style: parseStyleProfile(raw.style),
    facts: raw.facts.map((f) => f.trim()).filter(Boolean),
    assistantTurns: raw.assistantTurns,
    offerSends: raw.offerSends,
    closed: raw.closed,
  };
}

/** Le test est-il terminé (moins de 18 ans, conversation fermée) ? */
export function testClosed(state: TestState): boolean {
  return state.closed || state.stage === "CLOSED";
}

/** Entrée du tour : le message écrit par l'équipe comme une personne, l'historique renvoyé, coût en TEST. */
export function buildTestTurnInput(input: {
  persona: PersonaInput;
  config: AssistantConfig;
  history: readonly TestHistoryItem[];
  message: string;
  state: TestState;
}): TurnInput {
  const { persona, config: cfg, state } = input;
  const history: HistoryMessage[] = input.history
    .filter((h) => h.text.trim())
    .slice(-TEST_LIMITS.history)
    .map((h) =>
      h.from === "person"
        ? { direction: "IN", author: "MEMBER", text: h.text }
        : { direction: "OUT", author: "ASSISTANT", text: h.text },
    );
  const modelId = persona.model?.trim() || cfg.defaultModel;
  return {
    kind: "reply",
    persona,
    settings: {
      defaultModel: cfg.defaultModel,
      fallbackModel: cfg.fallbackModel,
      temperature: cfg.temperature,
      maxTokens: clampMaxTokens(cfg.maxTokens, findModel(modelId, cfg.models)),
      modelSupportsReasoning: (id) => modelSupportsReasoning(id, cfg.models),
    },
    conversation: {
      stage: state.stage,
      style: state.style,
      summary: null,
      facts: state.facts,
      // Messages de la personne, ceux de ce tour compris (contrat § 7).
      memberMessages: history.filter((h) => h.direction === "IN").length + 1,
      assistantTurns: state.assistantTurns,
      offerSends: state.offerSends,
      followUpCount: 0,
      isMinor: state.closed,
      isFirstAssistantTurn: state.assistantTurns === 0,
      memberLanguageCode: null,
      lastInboundAt: null,
      lastAssistantAt: null,
      lastNeutralAt: null,
    },
    history,
    inbound: [{ text: input.message }],
    usagePurpose: "TEST",
    retryCount: 0,
  };
}

/** « écrit… » simulé : le rythme réel (1 à 4 s selon la longueur) raccourci à 0,4 à 1,4 s. */
export function testTypingMs(text: string): number {
  return Math.min(1400, Math.max(400, Math.round(typingDelayMs(text) * 0.35)));
}

function failureCode(result: TurnResult): string | null {
  const failed = result.events.find((e) => e.type === "ai_failed");
  const code = failed?.payload.code;
  return typeof code === "string" ? code : null;
}

/**
 * Bandeau sous la conversation : mineur, plafond, panne, repli ou réponse refaite (rien si tout va bien). Textes
 * accordés au genre de la persona (« l'assistante » par défaut, « l'assistant » pour une persona masculine).
 */
export function testNotice(result: TurnResult, gender?: string | null): TestNotice | null {
  const rejected = rejectLabels(result.rejected, gender);
  const role = personaRole(gender);
  const code = failureCode(result);
  switch (result.outcome) {
    case "minor":
      return {
        tone: "warning",
        text: "La personne a dit avoir moins de 18 ans : message d'arrêt envoyé, aucun lien, conversation fermée. Cliquez sur « Recommencer » pour un nouvel essai.",
      };
    case "skipped_cap":
      return {
        tone: "danger",
        text: `Plafond mensuel atteint : ${role} ne répond plus jusqu'au mois prochain (un administrateur peut le relever dans Réglages → IA de conversation).`,
      };
    case "aborted":
      return { tone: "info", text: "Conversation fermée : cliquez sur « Recommencer »." };
    case "failed": {
      const parts = [aiFailureText(code)];
      if (rejected.length > 0) parts.push(`Réponses refusées : ${rejected.join(", ")}.`);
      if (result.neutralSent)
        parts.push(
          "Comme dans la vraie vie, la personne a reçu « je reviens vers toi dans un instant ».",
        );
      if (result.retryAt) parts.push(`Dans la vraie vie, ${role} réessaie 5 minutes plus tard.`);
      return { tone: "danger", text: parts.join(" ") };
    }
    default: {
      if (result.sent.some((p) => p.fixedKey))
        return {
          tone: "warning",
          text:
            rejected.length > 0
              ? `Texte de secours envoyé : les réponses de l'IA ont été refusées deux fois (${rejected.join(", ")}).`
              : `Texte de secours envoyé. ${aiFailureText(code)}`,
        };
      if (rejected.length > 0)
        return {
          tone: "info",
          text: `Une première réponse a été refusée par les contrôles (${rejected.join(", ")}), puis refaite.`,
        };
      return null;
    }
  }
}

/**
 * Réponse affichée par le panneau « Tester » à partir du résultat du tour. `gender` : genre de la persona testée
 * (`persona.input.gender`), pour accorder les refus et le bandeau ; absent : « l'assistante ».
 */
export function testResponseFrom(input: {
  result: TurnResult;
  state: TestState;
  offerButtonText: string;
  usages: readonly UsageRecord[];
  gender?: string | null;
}): TestResponse {
  const { result, state } = input;
  const costEur =
    Math.round(
      input.usages.reduce((s, u) => s + (Number.isFinite(u.costEur) ? u.costEur : 0), 0) * 10_000,
    ) / 10_000;
  return {
    outcome: result.outcome,
    parts: result.sent.map((p) => ({
      text: p.text,
      button: p.offerSubId ? input.offerButtonText || "Découvrir l'app" : null,
      mediaAssetId: p.mediaAssetId,
      fixed: Boolean(p.fixedKey),
      typingMs: testTypingMs(p.text),
    })),
    state: {
      stage: result.newStage,
      style: result.style,
      facts: result.facts,
      assistantTurns: state.assistantTurns + (result.outcome === "replied" ? 1 : 0),
      offerSends: state.offerSends + (result.offerSent ? 1 : 0),
      closed: state.closed || result.outcome === "minor" || result.closeReason === "MINOR",
    },
    language: result.language,
    model: result.model,
    note: result.note,
    rejected: rejectLabels(result.rejected, input.gender),
    notice: testNotice(result, input.gender),
    costEur,
  };
}
