/**
 * Phase 35 (chantier B) — fausse IA de l'apprentissage (tests seulement) : réponses « Opus » préparées pour la tâche
 * `bookmaker-recette` (une par passe, dans l'ordre), classement « Sonnet » pour `bookmaker-marches`. Garde chaque
 * demande (pour vérifier qu'aucun secret n'y figure). Jamais importé en production.
 */
import type { LlmProvider, LlmRequest } from "../../types";

export type FakeLearnLlm = LlmProvider & { calls: LlmRequest[]; fake?: false };

export function createFakeLearnLlm(
  o: {
    recipes?: Array<unknown>;
    markets?: Record<string, string | null> | string;
    costCents?: number;
    fail?: boolean;
  } = {},
): FakeLearnLlm {
  const queue = [...(o.recipes ?? [])];
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      if (o.fail) throw new Error("IA indisponible (test)");
      const cost = o.costCents ?? 12;
      if (req.user.includes("Tâche : bookmaker-marches"))
        return {
          text: typeof o.markets === "string" ? o.markets : JSON.stringify(o.markets ?? {}),
          costCents: 1,
        };
      if (req.user.includes("Tâche : bookmaker-recette")) {
        const next = queue.length > 1 ? queue.shift() : queue[0];
        return {
          text:
            typeof next === "string" ? next : "```json\n" + JSON.stringify(next ?? {}) + "\n```",
          costCents: cost,
        };
      }
      return { text: "", costCents: 0 };
    },
  };
}
