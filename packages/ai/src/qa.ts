/**
 * Phase 30 — profil `qa-global` : client de l'agent QA Global (dernier verrou avant toute sortie, `packages/agents/src/qa`).
 *
 * Règles (contrat `packages/agents/src/qa/contract.ts`) :
 * - modèle UNIQUE `claude-fable-5-1` : aucun autre modèle ne peut être demandé par ce client, et l'option `fallbacks`
 *   de l'API n'est jamais déclarée (aucun repli) ;
 * - Fable 5.1 refuse `temperature` et `top_p` (400) : jamais envoyés ; la réflexion reste celle du modèle (aucun
 *   `thinking` envoyé), la profondeur passe par `output_config.effort` ; ni `tool_choice` ni pré-remplissage ;
 * - `max_tokens` 2 000 au plus (verdict court) ; délai par `AbortSignal` (l'appelant le fixe : `qa.timeout_ms`) ;
 * - tout échec (réseau, quota 429, 5xx, 400, clé refusée, délai) → `QaModelUnavailableError` (`QA_MODEL_UNAVAILABLE`) :
 *   l'appelant BLOQUE la sortie, jamais d'approbation par défaut ;
 * - `stop_reason` rendu tel quel (« refusal » = sortie bloquée par les classificateurs : traité en erreur par l'appelant).
 * `fetch` injectable : aucun réseau dans les tests.
 */
import Anthropic from "@anthropic-ai/sdk";
import { usageOf } from "./client";
import { estimateCostEur, QA_GLOBAL_MODEL } from "./models";
import type { AiUsage } from "./types";

export const QA_GLOBAL_PROFILE = "qa-global" as const;
export const QA_GLOBAL_MAX_TOKENS = 2000;

export type QaEffort = "low" | "medium" | "high";

/** Même forme que `QaLlm` de `packages/agents/src/qa/contract.ts` (ce paquet ne dépend pas des agents). */
export type QaLlmClient = {
  check(req: { system: string; user: string; effort: QaEffort; maxTokens: number; signal?: AbortSignal }): Promise<{
    text: string;
    stopReason: string | null;
    model: string;
    costCents: number;
    usage?: AiUsage;
  }>;
};

export type QaUnavailableKind = "network" | "quota" | "server" | "bad_request" | "auth" | "aborted" | "unknown";

/** Le modèle du QA n'a pas répondu : la sortie reste bloquée. Message en français, jamais de clé. */
export class QaModelUnavailableError extends Error {
  readonly code = "QA_MODEL_UNAVAILABLE" as const;
  constructor(
    readonly kind: QaUnavailableKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "QaModelUnavailableError";
  }
}

export function isQaModelUnavailable(err: unknown): err is QaModelUnavailableError {
  return err instanceof QaModelUnavailableError || (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "QA_MODEL_UNAVAILABLE");
}

/** Centimes d'euro facturés (arrondi au centime supérieur, prudence pour le plafond), aux prix de Fable 5.1. */
export function qaCostCents(usage: AiUsage): number {
  const eur = estimateCostEur(QA_GLOBAL_MODEL, usage);
  return eur > 0 ? Math.ceil(eur * 100) : 0;
}

/** Erreur du SDK → `QaModelUnavailableError` (message court, sans clé). */
export function toQaUnavailable(err: unknown): QaModelUnavailableError {
  if (err instanceof QaModelUnavailableError) return err;
  const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/sk-[A-Za-z0-9_-]{8,}/g, "[masqué]").slice(0, 160);
  if (err instanceof Anthropic.APIUserAbortError) return new QaModelUnavailableError("aborted", "Vérification interrompue (délai dépassé).");
  if (err instanceof Anthropic.APIConnectionError) return new QaModelUnavailableError("network", "Impossible de joindre l'API Anthropic pour le contrôle qualité.");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new QaModelUnavailableError("auth", `Clé refusée pour ${QA_GLOBAL_MODEL} (droits, crédits ou espace de travail).`, err.status);
  if (err instanceof Anthropic.RateLimitError) return new QaModelUnavailableError("quota", `Quota ou débit atteint chez Anthropic pour ${QA_GLOBAL_MODEL}.`, err.status);
  if (err instanceof Anthropic.BadRequestError) return new QaModelUnavailableError("bad_request", `Demande refusée par Anthropic (${short(err)}).`, err.status);
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    const kind: QaUnavailableKind = status !== undefined && status >= 500 ? "server" : status === 429 ? "quota" : "unknown";
    return new QaModelUnavailableError(kind, `Erreur Anthropic ${status ?? ""} pour ${QA_GLOBAL_MODEL} : ${short(err)}`, status);
  }
  if (err instanceof Error && err.name === "AbortError") return new QaModelUnavailableError("aborted", "Vérification interrompue (délai dépassé).");
  return new QaModelUnavailableError("unknown", `Le contrôle qualité n'a pas répondu : ${short(err)}`);
}

/**
 * Client réel du QA (SDK officiel, un appel non streamé). Une seule relance automatique du SDK (connexion, 429, 5xx),
 * toujours sur le même modèle et dans le délai fixé par `signal`.
 */
export function createQaClient(opts: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number; maxRetries?: number }): QaLlmClient {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 60_000,
    maxRetries: opts.maxRetries ?? 1,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  return {
    async check(req) {
      const maxTokens = Math.max(1, Math.min(QA_GLOBAL_MAX_TOKENS, Math.round(req.maxTokens)));
      let res;
      try {
        res = await client.messages.create(
          {
            model: QA_GLOBAL_MODEL,
            max_tokens: maxTokens,
            output_config: { effort: req.effort },
            system: req.system,
            messages: [{ role: "user", content: req.user }],
          },
          req.signal ? { signal: req.signal } : undefined,
        );
      } catch (err) {
        throw toQaUnavailable(err);
      }
      const text = res.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const usage = usageOf(res.usage);
      return { text, stopReason: res.stop_reason ?? null, model: res.model, costCents: qaCostCents(usage), usage };
    },
  };
}
