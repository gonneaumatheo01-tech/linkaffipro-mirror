/**
 * Phase 29, chantier B — fausses dépendances des tests (aucun réseau) : IA scriptée et accès web en mémoire.
 */
import type { LlmProvider, LlmRequest } from "../types";
import type { AnalystsWeb } from "./contract";

export type FakeAnalystsLlm = LlmProvider & { calls: LlmRequest[] };

/** IA scriptée : `script(req)` rend le texte (ou une erreur levée). */
export function createFakeAnalystsLlm(script: (req: LlmRequest) => string | Error, costCents = 0): FakeAnalystsLlm {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      const out = script(req);
      if (out instanceof Error) throw out;
      return { text: out, costCents };
    },
  };
}

/** Accès web en mémoire : pages par adresse (absente = 404), résultats de recherche par mot. */
export function createFakeAnalystsWeb(
  pages: Record<string, string>,
  search: Array<{ match: RegExp; results: Array<{ url: string; title: string; snippet: string; date: string | null }> }> = [],
): AnalystsWeb & { fetched: string[]; searched: string[] } {
  const fetched: string[] = [];
  const searched: string[] = [];
  return {
    fetched,
    searched,
    async fetchText(url) {
      fetched.push(url);
      const body = pages[url];
      return body === undefined ? { status: 404, body: "", finalUrl: url } : { status: 200, body, finalUrl: url };
    },
    async search(req) {
      searched.push(req.query);
      return search.find((s) => s.match.test(req.query))?.results ?? [];
    },
  };
}
