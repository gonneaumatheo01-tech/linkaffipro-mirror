import Anthropic from "@anthropic-ai/sdk";
import { AiError } from "./errors";
import type { AiClient, AiMessageRequest, AiMessageResponse, AiUsage } from "./types";

/** Convertit une erreur du SDK en erreur lisible, sans jamais exposer la clé. */
export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError)
    return new AiError("auth", "Clé API refusée par Anthropic : vérifiez-la dans Réglages → IA.");
  if (err instanceof Anthropic.PermissionDeniedError)
    return new AiError(
      "auth",
      "Cette clé n'a pas le droit d'utiliser ce modèle (vérifiez les crédits et l'espace de travail dans la console Anthropic).",
    );
  if (err instanceof Anthropic.RateLimitError)
    return new AiError(
      "rate_limit",
      "Anthropic limite le débit pour le moment : réessayez dans une minute.",
    );
  if (err instanceof Anthropic.BadRequestError)
    return new AiError("api", `Demande refusée par Anthropic (${err.message.slice(0, 160)}).`);
  if (err instanceof Anthropic.APIConnectionError)
    return new AiError(
      "network",
      "Impossible de joindre l'API Anthropic : vérifiez la connexion et réessayez.",
    );
  if (err instanceof Anthropic.APIError)
    return new AiError(
      "api",
      `Erreur Anthropic ${err.status ?? ""} : ${err.message.slice(0, 160)}`,
    );
  return new AiError("api", err instanceof Error ? err.message.slice(0, 200) : "Erreur inconnue.");
}

export function usageOf(u: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): AiUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cachedTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Contenu du message : le texte seul, ou les images puis le texte (rétrocompatible : sans image, une chaîne). */
export function userContent(req: AiMessageRequest) {
  if (!req.images?.length) return req.user;
  return [
    ...req.images.map((img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
    })),
    { type: "text" as const, text: req.user },
  ];
}

/**
 * Client réel : SDK officiel, un seul appel non streamé par demande (sorties courtes).
 * Effort « low » par défaut (Haiku 5.5 et Sonnet 5.5 réfléchissent d'office ; la réflexion compte dans max_tokens).
 * `fetch` : injectable pour les tests (aucun appel réseau).
 */
export function createAnthropicClient(
  apiKey: string,
  opts: { timeoutMs?: number; fetch?: typeof fetch; maxRetries?: number } = {},
): AiClient {
  const client = new Anthropic({
    apiKey,
    timeout: opts.timeoutMs ?? 90_000,
    // Une relance par défaut ; 0 pour un appel long et cher (planificateur des ordres de Kevin).
    maxRetries: opts.maxRetries ?? 1,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  return {
    async createMessage(req: AiMessageRequest): Promise<AiMessageResponse> {
      try {
        const res = await client.messages.create({
          model: req.model,
          max_tokens: req.maxTokens,
          output_config: { effort: req.effort ?? "low" },
          system: req.system.map((b) =>
            b.cache
              ? {
                  type: "text" as const,
                  text: b.text,
                  cache_control: { type: "ephemeral" as const },
                }
              : { type: "text" as const, text: b.text },
          ),
          messages: [{ role: "user", content: userContent(req) }],
          ...(req.tools?.length
            ? {
                tools: req.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
                  ...(t.strict ? { strict: true } : {}),
                })),
                tool_choice: { type: "auto" as const, disable_parallel_tool_use: true },
              }
            : {}),
        });
        if (res.stop_reason === "refusal")
          throw new AiError(
            "api",
            "L'IA a refusé cette demande (contenu non autorisé). Reformulez le brouillon.",
          );
        const text = res.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        const toolUses = res.content
          .filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use")
          .map((b) => ({ name: b.name, input: b.input }));
        return {
          text,
          usage: usageOf(res.usage),
          stopReason: res.stop_reason,
          ...(toolUses.length ? { toolUses } : {}),
        };
      } catch (err) {
        throw toAiError(err);
      }
    },
  };
}

/**
 * Vérification minimale d'une clé (bouton « Vérifier ») : un appel de 16 jetons au modèle demandé.
 * Une réponse coupée (stop_reason max_tokens) suffit : seule compte l'acceptation de la clé.
 */
export async function verifyApiKey(
  apiKey: string,
  model: string,
  client: AiClient = createAnthropicClient(apiKey, { timeoutMs: 20_000 }),
): Promise<{ ok: true; usage: AiUsage } | { ok: false; error: string }> {
  try {
    const res = await client.createMessage({
      model,
      maxTokens: 16,
      system: [],
      user: "Réponds simplement : ok",
    });
    return { ok: true, usage: res.usage };
  } catch (err) {
    return { ok: false, error: toAiError(err).message };
  }
}
