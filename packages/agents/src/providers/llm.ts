/**
 * Fournisseur d'IA texte des agents, au-dessus du client Claude de `@linkaffipro/ai`. Clé lue comme Réglages → IA
 * (`Setting` `ai.config`, champ `apiKeyEncrypted`, chiffré par `@linkaffipro/core`) ; jamais journalisée.
 * Coût : `estimateCostEur` converti en centimes, arrondi au centime supérieur (prudence pour les plafonds).
 */
import { createAnthropicClient, estimateCostEur, type AiClient } from "@linkaffipro/ai";
import { decrypt } from "@linkaffipro/core";
import type { Db as PrismaClient } from "@linkaffipro/db";
import type { LlmProvider } from "../types";

export const AI_CONFIG_KEY = "ai.config";

/** Fournisseur marqué « faux » : aucun coût, plafonds non vérifiés. */
export type AgentLlmProvider = LlmProvider & { fake?: boolean; name: string };

export type LlmClientFactory = (apiKey: string) => AiClient;

export function costCentsOf(model: string, usage: Parameters<typeof estimateCostEur>[1]): number {
  const eur = estimateCostEur(model, usage);
  return eur > 0 ? Math.ceil(eur * 100) : 0;
}

export function llmFromClient(client: AiClient): AgentLlmProvider {
  return {
    name: "anthropic",
    async complete(req) {
      const res = await client.createMessage({
        model: req.model,
        maxTokens: req.maxTokens,
        system: [{ text: req.system, cache: true }],
        user: req.user,
        ...(req.images?.length ? { images: req.images } : {}),
      });
      return { text: res.text, costCents: costCentsOf(req.model, res.usage) };
    },
  };
}

/** Clé Anthropic en clair (null si absente ou illisible). */
export async function readAiApiKey(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: AI_CONFIG_KEY } });
  const enc = (row?.value as { apiKeyEncrypted?: unknown } | null)?.apiKeyEncrypted;
  if (typeof enc !== "string" || !enc) return null;
  try {
    return decrypt(enc);
  } catch {
    return null;
  }
}

/** Fournisseur réel si une clé est réglée, sinon null (l'appelant prend alors le faux fournisseur). */
export async function loadLlmProvider(
  prisma: PrismaClient,
  factory: LlmClientFactory = (key) => createAnthropicClient(key),
): Promise<AgentLlmProvider | null> {
  const key = await readAiApiKey(prisma);
  return key ? llmFromClient(factory(key)) : null;
}
