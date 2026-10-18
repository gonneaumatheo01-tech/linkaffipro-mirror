// Types partagés du moteur de conversation (contrat : docs/ASSISTANT-CONVERSATION.md, §3).

/** Langues des textes du bot (mêmes codes que `packages/telegram/src/i18n.ts`). */
export const CHAT_LANGS = ["fr", "en", "es", "pt", "de", "it"] as const;
export type ChatLang = (typeof CHAT_LANGS)[number];

/** Étapes du parcours (enum Prisma `ConversationStage`). */
export const CONVERSATION_STAGES = [
  "WELCOME",
  "CHAT",
  "PROPOSAL",
  "LINK_SENT",
  "FOLLOW_UP",
  "CONVERTED",
  "CLOSED",
] as const;
export type ConversationStage = (typeof CONVERSATION_STAGES)[number];

/** Statut d'une conversation (enum Prisma `ConversationStatus`). */
export type ConversationStatus = "BOT" | "HUMAN" | "PAUSED" | "CLOSED";

// ------------------------------------------------------------------
// Client du modèle de langue (Venice, compatible OpenAI)
// ------------------------------------------------------------------

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmRequest = {
  model: string;
  messages: LlmMessage[];
  temperature: number;
  maxTokens: number;
  /** Sortie JSON stricte (`response_format: json_schema`). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Le modèle raisonne-t-il (on coupe alors le raisonnement : `reasoning: { enabled: false }`) ? */
  reasoning?: boolean;
};

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmResponse = {
  text: string;
  model: string;
  finishReason: string | null;
  usage: LlmUsage;
  /** Coût réel renvoyé par Venice (`cost.usd`), absent sinon. */
  costUsd: number | null;
  /** En-tête `CF-RAY`. */
  requestId: string | null;
};

export type LlmClient = { complete(req: LlmRequest): Promise<LlmResponse> };

export type VeniceErrorCode =
  | "auth"
  | "balance"
  | "rate_limit"
  | "server"
  | "bad_model"
  | "content_policy"
  | "timeout"
  | "network"
  | "bad_request"
  | "no_key";

export class VeniceError extends Error {
  readonly code: VeniceErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(code: VeniceErrorCode, message: string, opts: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "VeniceError";
    this.code = code;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/** Erreurs qui méritent un nouvel essai puis le modèle de repli. */
export function isTransientVeniceError(code: VeniceErrorCode): boolean {
  return code === "rate_limit" || code === "server" || code === "timeout" || code === "network";
}

/** Modèle texte de Venice tel que gardé en cache dans les réglages. */
export type VeniceModelInfo = {
  id: string;
  name: string;
  /** Prix en dollars par million de jetons (null : inconnu). */
  inputUsdPerM: number | null;
  outputUsdPerM: number | null;
  maxCompletionTokens: number | null;
  contextLength: number | null;
  supportsResponseSchema: boolean;
  supportsReasoning: boolean;
  uncensored: boolean;
  offline: boolean;
  deprecated: boolean;
};

/** Ligne de coût (table `AiConversationUsage`), écrite par l'appelant. */
export type UsagePurpose = "REPLY" | "FOLLOW_UP" | "SUMMARY" | "TEST";
export type UsageRecord = {
  purpose: UsagePurpose;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
  ok: boolean;
  error: string | null;
  attempt: number;
  requestId: string | null;
};
