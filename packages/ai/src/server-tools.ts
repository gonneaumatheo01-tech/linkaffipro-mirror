/**
 * Phase 29 (équipe Analystes) : appel des outils SERVEUR de l'API Claude (`web_search_20260209`, `web_fetch_20260209`,
 * Sonnet 5.5 / Opus 5.5 seulement). Ce module ne fait que transporter la demande et rendre les blocs bruts : la lecture
 * des résultats, la reprise sur `pause_turn` et le comptage des dépenses sont faits par l'appelant
 * (`packages/agents/src/analysts/watch/server-tools.ts`). Jamais `code_execution` à côté, jamais de `tool_choice`
 * forcé ni de température (modèles 5.5). `fetch` injectable : aucun réseau dans les tests.
 */
import Anthropic from "@anthropic-ai/sdk";
import { toAiError, usageOf } from "./client";
import type { AiUsage } from "./types";

export type ServerWebSearchTool = {
  type: "web_search_20260209";
  name: "web_search";
  max_uses?: number;
  /** Jamais avec `blocked_domains`. */
  allowed_domains?: string[];
  blocked_domains?: string[];
  user_location?: { type: "approximate"; country?: string };
};

export type ServerWebFetchTool = {
  type: "web_fetch_20260209";
  name: "web_fetch";
  max_uses?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
  citations?: { enabled: boolean };
  max_content_tokens?: number;
};

export type ServerTool = ServerWebSearchTool | ServerWebFetchTool;

/** Bloc de contenu brut (texte, `server_tool_use`, `web_search_tool_result`, `web_fetch_tool_result`…). */
export type ServerContentBlock = { type: string; [k: string]: unknown };

export type ServerToolsMessage = { role: "user" | "assistant"; content: string | ServerContentBlock[] };

export type ServerToolsRequest = {
  model: string;
  maxTokens: number;
  system: string;
  messages: ServerToolsMessage[];
  tools: ServerTool[];
};

export type ServerToolsResponse = {
  content: ServerContentBlock[];
  stopReason: string | null;
  usage: AiUsage;
  webSearchRequests: number;
  webFetchRequests: number;
};

export type ServerToolsClient = { create(req: ServerToolsRequest): Promise<ServerToolsResponse> };

function cleanTool(t: ServerTool): Anthropic.Messages.WebSearchTool20260209 | Anthropic.Messages.WebFetchTool20260209 {
  // Jamais les deux listes de domaines à la fois (refusé par l'API) : la liste permise l'emporte.
  const domains = t.allowed_domains?.length
    ? { allowed_domains: t.allowed_domains }
    : t.blocked_domains?.length
      ? { blocked_domains: t.blocked_domains }
      : {};
  if (t.type === "web_search_20260209")
    return {
      type: t.type,
      name: t.name,
      ...(t.max_uses ? { max_uses: t.max_uses } : {}),
      ...domains,
      ...(t.user_location ? { user_location: t.user_location } : {}),
    };
  return {
    type: t.type,
    name: t.name,
    ...(t.max_uses ? { max_uses: t.max_uses } : {}),
    ...domains,
    ...(t.citations ? { citations: t.citations } : {}),
    ...(t.max_content_tokens ? { max_content_tokens: t.max_content_tokens } : {}),
  };
}

/** Client réel (SDK officiel), un appel non streamé par demande. */
export function createServerToolsClient(
  apiKey: string,
  opts: { timeoutMs?: number; fetch?: typeof fetch; maxRetries?: number } = {},
): ServerToolsClient {
  const client = new Anthropic({
    apiKey,
    timeout: opts.timeoutMs ?? 120_000,
    maxRetries: opts.maxRetries ?? 1,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  return {
    async create(req) {
      try {
        const res = await client.messages.create({
          model: req.model,
          max_tokens: req.maxTokens,
          output_config: { effort: "low" },
          system: req.system,
          messages: req.messages as Anthropic.Messages.MessageParam[],
          tools: req.tools.map(cleanTool),
          tool_choice: { type: "auto" },
        });
        if (res.stop_reason === "refusal") throw new Error("L'IA a refusé cette recherche.");
        return {
          content: res.content as unknown as ServerContentBlock[],
          stopReason: res.stop_reason,
          usage: usageOf(res.usage),
          webSearchRequests: res.usage.server_tool_use?.web_search_requests ?? 0,
          webFetchRequests: res.usage.server_tool_use?.web_fetch_requests ?? 0,
        };
      } catch (err) {
        throw toAiError(err);
      }
    },
  };
}
