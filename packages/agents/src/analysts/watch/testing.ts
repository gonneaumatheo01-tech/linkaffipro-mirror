/**
 * Phase 29, chantier A : outils des tests de la veille (aucun réseau). Faux web servi depuis
 * `packages/agents/fixtures/analysts` (contenus inventés), horloge et attente simulées, fausse IA scriptée, faux outils
 * serveur de l'API Claude (blocs au format de l'API). Jamais importé par le code de production.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerContentBlock, ServerToolsClient, ServerToolsRequest, ServerToolsResponse } from "@linkaffipro/ai";
import type { LlmProvider, LlmRequest } from "../../types";

export const ANALYSTS_FIXTURES_DIR = join(import.meta.dirname, "..", "..", "..", "fixtures", "analysts");
export const ANALYSTS_FIXTURE_NOW = new Date("2026-10-24T12:00:00Z");

export function readAnalystsFixture(name: string): string {
  return readFileSync(join(ANALYSTS_FIXTURES_DIR, name), "utf8");
}

/** Horloge simulée : `sleep` avance le temps (aucune attente réelle). */
export function fakeClock(start: Date = ANALYSTS_FIXTURE_NOW) {
  let t = start.getTime();
  const sleeps: number[] = [];
  return {
    clock: () => t,
    now: () => new Date(t),
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}

export type FakeRoute = { status?: number; body: string; contentType?: string } | ((url: string) => { status?: number; body: string; contentType?: string });

/**
 * Faux `fetch` : adresse exacte (sans fragment) → réponse ; sinon 404. Garde chaque appel avec l'heure de l'horloge
 * donnée et les en-têtes envoyés.
 */
export function fakeFetch(routes: Record<string, FakeRoute>, clock: () => number = () => ANALYSTS_FIXTURE_NOW.getTime()) {
  const calls: Array<{ url: string; at: number; headers: Record<string, string> }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url, at: clock(), headers });
    const route = routes[url];
    const r = typeof route === "function" ? route(url) : route;
    if (!r) return new Response("not found", { status: 404 });
    const res = new Response(r.body, { status: r.status ?? 200, headers: { "content-type": r.contentType ?? "text/html; charset=utf-8" } });
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as typeof fetch;
  return { impl, calls };
}

/** Fausse IA scriptée : `handler` reçoit la demande et rend le texte ; 1 centime par appel. */
export function scriptedLlm(handler: (req: LlmRequest) => string, costCents = 1): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      return { text: handler(req), costCents };
    },
  };
}

export type FakeSearchResult = { url: string; title: string; page_age?: string | null; snippet?: string; date?: string | null };

/**
 * Faux outils serveur : `search(query, request)` rend des résultats (ou `{ error_code }`) ; `fetch(url)` rend le texte
 * d'une page (ou `{ error_code }`). `pauseFirst` : la première réponse s'arrête sur `pause_turn` (reprise testée).
 */
export function fakeServerTools(opts: {
  search?: (query: string, req: ServerToolsRequest) => FakeSearchResult[] | { error_code: string };
  fetch?: (url: string) => string | { error_code: string };
  pauseFirst?: boolean;
}): ServerToolsClient & { requests: ServerToolsRequest[] } {
  const requests: ServerToolsRequest[] = [];
  let paused = false;
  return {
    requests,
    async create(req): Promise<ServerToolsResponse> {
      requests.push(structuredClone(req));
      const user = String(req.messages[0]?.content ?? "");
      const usage = { inputTokens: 1000, outputTokens: 200, cachedTokens: 0, cacheWriteTokens: 0 };
      if (opts.pauseFirst && !paused) {
        paused = true;
        return { content: [{ type: "server_tool_use", id: "srv_1", name: "web_search", input: {} }], stopReason: "pause_turn", usage, webSearchRequests: 0, webFetchRequests: 0 };
      }
      const tool = req.tools[0]!;
      const content: ServerContentBlock[] = [];
      if (tool.type === "web_search_20260209") {
        const query = user.replace(/^Recherche : /, "");
        const res = opts.search?.(query, req) ?? [];
        content.push({ type: "server_tool_use", id: "srv_s", name: "web_search", input: { query } });
        if (Array.isArray(res)) {
          content.push({
            type: "web_search_tool_result",
            tool_use_id: "srv_s",
            content: res.map((r) => ({ type: "web_search_result", url: r.url, title: r.title, page_age: r.page_age ?? null, encrypted_content: "x" })),
          });
          content.push({
            type: "text",
            text: JSON.stringify({ results: res.filter((r) => r.snippet !== undefined).map((r) => ({ url: r.url, title: r.title, snippet: r.snippet, date: r.date ?? null })) }),
          });
        } else content.push({ type: "web_search_tool_result", tool_use_id: "srv_s", content: { type: "web_search_tool_result_error", error_code: res.error_code } });
        return { content, stopReason: "end_turn", usage, webSearchRequests: Array.isArray(res) ? 1 : 0, webFetchRequests: 0 };
      }
      const url = user.replace(/^Lis cette page : /, "");
      const page = opts.fetch?.(url) ?? { error_code: "url_not_accessible" };
      content.push({ type: "server_tool_use", id: "srv_f", name: "web_fetch", input: { url } });
      content.push({
        type: "web_fetch_tool_result",
        tool_use_id: "srv_f",
        content:
          typeof page === "string"
            ? { type: "web_fetch_result", url, retrieved_at: null, content: { type: "document", source: { type: "text", media_type: "text/plain", data: page }, title: null } }
            : { type: "web_fetch_tool_result_error", error_code: page.error_code },
      });
      content.push({ type: "text", text: "lu" });
      return { content, stopReason: "end_turn", usage, webSearchRequests: 0, webFetchRequests: 1 };
    },
  };
}
