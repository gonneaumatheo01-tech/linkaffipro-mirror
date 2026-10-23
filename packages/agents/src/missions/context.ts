/**
 * Construction du contexte d'un agent (`AgentContext`) : réglages de l'équipe, horloge, fournisseurs. IA texte : le
 * fournisseur réel si une clé est réglée dans Réglages → IA, sinon le faux fournisseur déterministe (jamais d'échec
 * faute de clé ; le texte produit passe les mêmes contrôles et, au niveau 0, par la validation humaine).
 */
import { createFakeLlm } from "../providers/fake";
import { loadLlmProvider, type LlmClientFactory } from "../providers/llm";
import type { AgentContext, AgentsDeps, FrameExtractor, Providers, TeamKey } from "../types";
import { loadTeamSettings } from "./settings";

/** Dépendances du moteur : celles des services + fournisseurs imposés (tests) ou fabrique du client Claude. */
export type EngineDeps = AgentsDeps & {
  providers?: Partial<Providers>;
  llmFactory?: LlmClientFactory;
  /** Extraction d'images d'une vidéo (worker : ffmpeg). */
  frames?: FrameExtractor;
  /** `fetch` des fournisseurs de médias (tests : réponses enregistrées). */
  fetch?: typeof fetch;
  /** Cache des cotes (phase 23 : Redis dans le worker). */
  oddsCache?: import("../providers/odds-cache").OddsCache | null;
};

export function clockOf(deps: Pick<AgentsDeps, "now">): () => Date {
  return deps.now ?? (() => new Date());
}

export async function resolveProviders(deps: EngineDeps): Promise<Providers> {
  const llm =
    deps.providers?.llm !== undefined
      ? deps.providers.llm
      : ((await loadLlmProvider(deps.prisma, deps.llmFactory)) ?? createFakeLlm());
  return { ...deps.providers, llm };
}

export async function buildContext(deps: EngineDeps, teamKey: TeamKey): Promise<AgentContext> {
  const [settings, providers] = await Promise.all([loadTeamSettings(deps.prisma, teamKey), resolveProviders(deps)]);
  return { ...deps, now: clockOf(deps), providers, settings };
}
