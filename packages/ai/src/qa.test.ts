import { describe, expect, it } from "vitest";
import { estimateCostEur, QA_GLOBAL_MODEL, USD_TO_EUR } from "./models";
import { createQaClient, isQaModelUnavailable, qaCostCents, QaModelUnavailableError } from "./qa";

/** `fetch` simulé : aucun appel réseau, requêtes mémorisées. */
function fakeFetch(status: number, body: Record<string, unknown>) {
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl = async (_url: unknown, init?: { body?: unknown; signal?: AbortSignal }) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
  };
  return { requests, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const message = (stop: string, text = '{"verdict":"APPROVED","reasons":[],"corrections":[]}') => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: QA_GLOBAL_MODEL,
  content: [{ type: "text", text }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

describe("profil qa-global (fetch simulé)", () => {
  it("n'envoie que Fable 5.1, 2 000 jetons au plus, l'effort, sans température, top_p, thinking, tool_choice ni fallbacks", async () => {
    const { requests, fetchImpl } = fakeFetch(200, message("end_turn"));
    const client = createQaClient({ apiKey: "sk-ant-test", fetch: fetchImpl, maxRetries: 0 });
    const res = await client.check({ system: "Consigne", user: "Contenu", effort: "medium", maxTokens: 9000 });
    const req = requests[0]!;
    expect(req.model).toBe(QA_GLOBAL_MODEL);
    expect(req.max_tokens).toBe(2000);
    expect(req.output_config).toEqual({ effort: "medium" });
    for (const k of ["temperature", "top_p", "top_k", "thinking", "tool_choice", "tools", "fallbacks"]) expect(req).not.toHaveProperty(k);
    expect(req.messages).toEqual([{ role: "user", content: "Contenu" }]);
    expect(res.model).toBe(QA_GLOBAL_MODEL);
    expect(res.stopReason).toBe("end_turn");
    expect(res.text).toContain("APPROVED");
    expect(res.costCents).toBe(qaCostCents({ inputTokens: 1000, outputTokens: 200, cachedTokens: 0, cacheWriteTokens: 0 }));
  });

  it("rend le stop_reason « refusal » tel quel (l'appelant bloque)", async () => {
    const { fetchImpl } = fakeFetch(200, message("refusal", ""));
    const res = await createQaClient({ apiKey: "sk-ant-test", fetch: fetchImpl, maxRetries: 0 }).check({ system: "s", user: "u", effort: "low", maxTokens: 2000 });
    expect(res.stopReason).toBe("refusal");
  });

  it.each([
    [400, "bad_request"],
    [401, "auth"],
    [429, "quota"],
    [500, "server"],
    [529, "server"],
  ])("erreur %i → QA_MODEL_UNAVAILABLE (%s), clé jamais dans le message", async (status, kind) => {
    const { fetchImpl } = fakeFetch(status, { type: "error", error: { type: "x", message: "boom sk-ant-secret-1234567890" } });
    const err = await createQaClient({ apiKey: "sk-ant-secret-1234567890", fetch: fetchImpl, maxRetries: 0 })
      .check({ system: "s", user: "u", effort: "low", maxTokens: 10 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QaModelUnavailableError);
    expect(isQaModelUnavailable(err)).toBe(true);
    expect((err as QaModelUnavailableError).code).toBe("QA_MODEL_UNAVAILABLE");
    expect((err as QaModelUnavailableError).kind).toBe(kind);
    expect((err as Error).message).not.toContain("sk-ant-secret");
  });

  it("réseau coupé → QA_MODEL_UNAVAILABLE", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const err = await createQaClient({ apiKey: "k", fetch: fetchImpl, maxRetries: 0 })
      .check({ system: "s", user: "u", effort: "low", maxTokens: 10 })
      .catch((e: unknown) => e);
    expect(isQaModelUnavailable(err)).toBe(true);
  });

  it("délai par AbortSignal → QA_MODEL_UNAVAILABLE « aborted »", async () => {
    const fetchImpl = ((_u: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as typeof fetch;
    const ctrl = new AbortController();
    const p = createQaClient({ apiKey: "k", fetch: fetchImpl, maxRetries: 0 }).check({ system: "s", user: "u", effort: "low", maxTokens: 10, signal: ctrl.signal });
    ctrl.abort();
    const err = await p.catch((e: unknown) => e);
    expect(isQaModelUnavailable(err)).toBe(true);
    expect((err as QaModelUnavailableError).kind).toBe("aborted");
  });

  it("coût aux prix de Fable 5.1 (10 $ / 50 $ par million)", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 0, cacheWriteTokens: 0 };
    expect(estimateCostEur(QA_GLOBAL_MODEL, usage)).toBeCloseTo(60 * USD_TO_EUR, 4);
    expect(qaCostCents(usage)).toBe(Math.ceil(60 * USD_TO_EUR * 100));
    expect(qaCostCents({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 })).toBe(0);
  });
});
