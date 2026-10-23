/**
 * Registre des agents : clé → définition. Les clés des phases suivantes sont déclarées sans agent (le Chef saute
 * l'étape). `PAID_PROVIDERS` : fournisseurs payants appelés par un agent (plafond vérifié avant l'étape).
 */
import type { AgentDefinition, AgentKey, ProviderKey } from "../types";
import { agent as controle } from "./controle";
import { agent as mediaIa } from "./media-ia";
import { agent as mediatheque } from "./mediatheque";
import { agent as planification } from "./planification";
import { agent as publication } from "./publication";
import { agent as redaction } from "./redaction";

export const AGENT_REGISTRY: Record<AgentKey, AgentDefinition | null> = {
  mediatheque,
  "media-ia": mediaIa,
  redaction,
  cotes: null, // phase 23
  capture: null, // phase 23
  planification,
  controle,
  publication,
  posts: null, // phase 21
  horaires: null, // phase 21
  conversations: null, // phase 25
  experimentation: null, // phase 21
  synthese: null, // phase 21
  ads: null, // phase 24
};

export const PAID_PROVIDERS: Partial<Record<AgentKey, ProviderKey[]>> = {
  redaction: ["llm"],
  controle: ["llm"],
  "media-ia": ["video", "image"],
  cotes: ["odds"],
  capture: ["screenshot"],
};

/** Agents qui vérifient eux-mêmes leurs plafonds (le poste dépend du format, avec repli) : le moteur ne bloque pas. */
export const SELF_BUDGETED_AGENTS: ReadonlySet<AgentKey> = new Set<AgentKey>(["media-ia"]);

export function agentFor(key: AgentKey): AgentDefinition | null {
  return AGENT_REGISTRY[key] ?? null;
}
