/**
 * Phase 29, chantier A : dépendances réelles de la veille pour le worker (chantier C). Clé Anthropic lue comme
 * Réglages → IA (`readAiApiKey`) ; sans clé, l'IA et la recherche sont absentes et chaque appel le dit en clair.
 * Jamais appelé dans les tests.
 */
import { createAnthropicClient, createServerToolsClient } from "@linkaffipro/ai";
import { llmFromClient, readAiApiKey } from "../../providers/llm";
import type { AgentsDeps } from "../../types";
import type { WatchDeps } from "./ai";
import { createAnalystsWeb, type PoliteWeb, type PoliteWebDeps } from "./polite";

export async function loadWatchDeps(
  deps: AgentsDeps & Pick<PoliteWebDeps, "fetchImpl" | "throttle" | "sleep">,
): Promise<WatchDeps & { web: PoliteWeb }> {
  const key = await readAiApiKey(deps.prisma);
  const d: PoliteWebDeps = {
    ...deps,
    analystsLlm: key ? llmFromClient(createAnthropicClient(key)) : null,
    serverTools: key ? createServerToolsClient(key) : null,
  };
  return { ...d, web: createAnalystsWeb(d) };
}
