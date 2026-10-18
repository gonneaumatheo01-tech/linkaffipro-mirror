import { describe, expect, it, vi } from "vitest";
import { VeniceError, type LlmRequest } from "./types";
import {
  classifyVeniceStatus,
  completionCostUsd,
  createVeniceClient,
  isTransientKeyCheck,
  listVeniceModels,
  retryAfterFromHeaders,
  stripThinking,
  veniceErrorInfo,
  verifyVeniceKey,
} from "./venice";

/**
 * Réponse dont les en-têtes arrivent tout de suite mais dont le corps ne se termine jamais (Venice bloqué en cours
 * d'envoi). Le flux se ferme seulement quand l'appel est coupé, comme une vraie connexion.
 */
function stalledBody(signal: AbortSignal | null | undefined, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"choices":[{"message":{"content":"'));
      signal?.addEventListener("abort", () =>
        controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    },
  });
  return new Response(stream, { status, headers: { "content-type": "application/json" } });
}

// Faux `fetch` : enregistre les appels et rend une réponse préparée. Aucun appel réseau.
type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, init: init ?? {} };
    calls.push(call);
    return respond(call);
  });
  return { fn, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function completion(content: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    model: "venice-uncensored-role-play",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    ...extra,
  };
}

const schema = {
  type: "object",
  properties: { messages: { type: "array" } },
  required: ["messages"],
};

const req: LlmRequest = {
  model: "venice-uncensored-role-play",
  messages: [
    { role: "system", content: "Tu es Léa, l'assistante du canal." },
    { role: "user", content: "Salut" },
  ],
  temperature: 0.85,
  maxTokens: 400,
  jsonSchema: { name: "assistant_reply", schema },
};

async function failure(p: Promise<unknown>): Promise<VeniceError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(VeniceError);
    return err as VeniceError;
  }
  throw new Error("aucune erreur levée");
}

describe("client Venice : appel réussi", () => {
  it("envoie le corps exact du contrat et lit la réponse JSON stricte", async () => {
    const reply = JSON.stringify({
      messages: [{ text: "Moi c'est Léa, l'assistante du canal 😉" }],
    });
    const { fn, calls } = fakeFetch(() =>
      json(completion(reply, { cost: { usd: 0.00042, diem: 0 } }), 200, {
        "CF-RAY": "8f1a2b3c4d-CDG",
      }),
    );
    const client = createVeniceClient(" ma-cle-venice ", { fetch: fn });
    const res = await client.complete(req);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.venice.ai/api/v1/chat/completions");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ma-cle-venice");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      model: "venice-uncensored-role-play",
      messages: req.messages,
      temperature: 0.85,
      max_completion_tokens: 400,
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: { name: "assistant_reply", strict: true, schema },
      },
      venice_parameters: { include_venice_system_prompt: false, enable_web_search: "off" },
    });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);

    expect(res).toEqual({
      text: reply,
      model: "venice-uncensored-role-play",
      finishReason: "stop",
      usage: { inputTokens: 120, outputTokens: 40 },
      costUsd: 0.00042,
      requestId: "8f1a2b3c4d-CDG",
    });
  });

  it("coupe le raisonnement seulement pour un modèle qui raisonne", async () => {
    const { fn, calls } = fakeFetch(() => json(completion("{}")));
    const client = createVeniceClient("cle", {
      fetch: fn,
      baseUrl: "https://exemple.test/api/v1/",
    });
    await client.complete({ ...req, reasoning: true });
    await client.complete({ ...req, jsonSchema: undefined });
    expect(calls[0]!.url).toBe("https://exemple.test/api/v1/chat/completions");
    expect(JSON.parse(String(calls[0]!.init.body)).reasoning).toEqual({ enabled: false });
    const second = JSON.parse(String(calls[1]!.init.body));
    expect(second.reasoning).toBeUndefined();
    expect(second.response_format).toBeUndefined();
  });

  it("retire les blocs <think>…</think> et ignore reasoning_content", async () => {
    const content =
      '<think>\nIl faut répondre en JSON…\n</think>\n{"messages":[{"text":"Coucou"}]}';
    const body = completion(content);
    (body.choices[0]!.message as Record<string, unknown>).reasoning_content = "raisonnement caché";
    const { fn } = fakeFetch(() => json(body));
    const res = await createVeniceClient("cle", { fetch: fn }).complete(req);
    expect(res.text).toBe('{"messages":[{"text":"Coucou"}]}');
    expect(res.text).not.toContain("raisonnement");
  });

  it("contenu en morceaux, sans coût ni en-tête : texte recollé, coût et identifiant nuls", async () => {
    const { fn } = fakeFetch(() =>
      json(
        completion([
          { type: "text", text: '{"messages":' },
          { type: "text", text: "[]}" },
        ]),
      ),
    );
    const res = await createVeniceClient("cle", { fetch: fn }).complete(req);
    expect(res.text).toBe('{"messages":[]}');
    expect(res.costUsd).toBeNull();
    expect(res.requestId).toBeNull();
  });

  it("coût : part en dollars + part en DIEM (compte payé en DIEM : jamais 0 €)", async () => {
    const { fn } = fakeFetch(() => json(completion("{}", { cost: { usd: 0, diem: 0.0009 } })));
    const res = await createVeniceClient("cle", { fetch: fn }).complete(req);
    expect(res.costUsd).toBe(0.0009);
    expect(completionCostUsd({ usd: 0.0003, diem: 0.0002 })).toBe(0.0005);
    expect(completionCostUsd({ usd: 0.0004 })).toBe(0.0004);
    expect(completionCostUsd({ diem: 0.0004 })).toBe(0.0004);
    expect(completionCostUsd({ usd: -1, diem: "x" })).toBeNull();
    expect(completionCostUsd(undefined)).toBeNull();
  });

  it("réponse coupée (finish_reason « length ») : rendue telle quelle, à l'appelant de la rejeter", async () => {
    const body = completion('{"messages":[{"text":"Je');
    body.choices[0]!.finish_reason = "length";
    body.usage = { prompt_tokens: 100, completion_tokens: 400, total_tokens: 500 };
    const { fn } = fakeFetch(() => json(body));
    const res = await createVeniceClient("cle", { fetch: fn }).complete(req);
    expect(res.finishReason).toBe("length");
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 400 });
    expect(res.text).toBe('{"messages":[{"text":"Je');
  });
});

describe("client Venice : erreurs classées", () => {
  it("clé vide : refus local, Venice n'est jamais appelé (il répondrait 402 x402)", async () => {
    const { fn } = fakeFetch(() =>
      json({ error: "Payment required", code: "PAYMENT_REQUIRED" }, 402, {
        "PAYMENT-REQUIRED": "x402",
      }),
    );
    const err = await failure(createVeniceClient("   ", { fetch: fn }).complete(req));
    expect(err.code).toBe("no_key");
    expect(fn).not.toHaveBeenCalled();
  });

  it("401 : clé refusée (corps en chaîne)", async () => {
    const { fn } = fakeFetch(() => json({ error: "Authentication failed" }, 401));
    const err = await failure(createVeniceClient("cle", { fetch: fn }).complete(req));
    expect(err.code).toBe("auth");
    expect(err.status).toBe(401);
    expect(err.message).toContain("Authentication failed");
    expect(err.message).not.toContain("cle");
  });

  it("403 : clé refusée aussi", async () => {
    const { fn } = fakeFetch(() => json({ error: "IP not allowed" }, 403));
    expect((await failure(createVeniceClient("k", { fetch: fn }).complete(req))).code).toBe("auth");
  });

  it("402 : solde vide", async () => {
    const { fn } = fakeFetch(() =>
      json({ error: "Insufficient balance", code: "INSUFFICIENT_BALANCE" }, 402),
    );
    const err = await failure(createVeniceClient("k", { fetch: fn }).complete(req));
    expect(err.code).toBe("balance");
    expect(err.message).toContain("INSUFFICIENT_BALANCE");
  });

  it("429 : trop de demandes, attente lue dans x-ratelimit-reset-requests (secondes ou millisecondes)", async () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    const inSeconds = String(Math.floor(now / 1000) + 30);
    const { fn } = fakeFetch(() =>
      json({ error: { message: "Rate limit exceeded", code: "RATE_LIMIT_EXCEEDED" } }, 429, {
        "x-ratelimit-reset-requests": inSeconds,
      }),
    );
    const err = await failure(createVeniceClient("k", { fetch: fn, now: () => now }).complete(req));
    expect(err.code).toBe("rate_limit");
    expect(err.retryAfterMs).toBe(30_000);
    expect(err.message).toContain("RATE_LIMIT_EXCEEDED");

    const inMs = String(now + 12_500);
    const { fn: fn2 } = fakeFetch(() =>
      json({ error: "Rate limit exceeded" }, 429, { "x-ratelimit-reset-requests": inMs }),
    );
    expect(
      (await failure(createVeniceClient("k", { fetch: fn2, now: () => now }).complete(req)))
        .retryAfterMs,
    ).toBe(12_500);
  });

  it("429 sans en-tête de fin de fenêtre : retry-after, sinon aucune attente connue", async () => {
    const { fn } = fakeFetch(() => json({ error: "Too many" }, 429, { "retry-after": "7" }));
    expect((await failure(createVeniceClient("k", { fetch: fn }).complete(req))).retryAfterMs).toBe(
      7000,
    );
    const { fn: fn2 } = fakeFetch(() => json({ error: "Too many" }, 429));
    expect(
      (await failure(createVeniceClient("k", { fetch: fn2 }).complete(req))).retryAfterMs,
    ).toBeUndefined();
  });

  it("503 MODEL_AT_CAPACITY, 500 et 504 : panne passagère de Venice", async () => {
    for (const [status, body] of [
      [503, { error: { message: "Model at capacity", code: "MODEL_AT_CAPACITY" } }],
      [500, { error: "Inference failed" }],
      [504, { error: "Request timeout" }],
    ] as const) {
      const { fn } = fakeFetch(() => json(body, status));
      const err = await failure(createVeniceClient("k", { fetch: fn }).complete(req));
      expect(err.code).toBe("server");
      expect(err.status).toBe(status);
    }
  });

  it("modèle inconnu ou retiré : 400 INVALID_MODEL, 404, 410", async () => {
    for (const [status, body] of [
      [400, { error: { message: "Invalid model specified", code: "INVALID_MODEL" } }],
      [400, { error: "Specified model not found", code: "INVALID_MODEL" }],
      [404, { error: "Model not found" }],
      [410, { error: "This model has been retired" }],
    ] as const) {
      const { fn } = fakeFetch(() => json(body, status));
      expect((await failure(createVeniceClient("k", { fetch: fn }).complete(req))).code).toBe(
        "bad_model",
      );
    }
  });

  it("422 : refus de contenu ; autre 400 : demande refusée", async () => {
    const { fn } = fakeFetch(() => json({ error: "Content policy violation" }, 422));
    expect((await failure(createVeniceClient("k", { fetch: fn }).complete(req))).code).toBe(
      "content_policy",
    );
    const { fn: fn2 } = fakeFetch(() =>
      json(
        {
          error: "Invalid request parameters",
          details: { temperature: { _errors: ["trop haut"] } },
        },
        400,
      ),
    );
    expect((await failure(createVeniceClient("k", { fetch: fn2 }).complete(req))).code).toBe(
      "bad_request",
    );
  });

  it("délai dépassé : timeout ; panne réseau : network", async () => {
    const hang = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
          );
        }),
    );
    const err = await failure(
      createVeniceClient("k", { fetch: hang, timeoutMs: 20 }).complete(req),
    );
    expect(err.code).toBe("timeout");

    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await failure(createVeniceClient("k", { fetch: down }).complete(req))).code).toBe(
      "network",
    );
  });

  it("en-têtes reçus puis corps bloqué : timeout aussi (le délai couvre la lecture du corps)", async () => {
    const stall = vi.fn(async (_url: string, init?: RequestInit) => stalledBody(init?.signal));
    const started = Date.now();
    const err = await failure(
      createVeniceClient("k", { fetch: stall, timeoutMs: 30 }).complete(req),
    );
    expect(err.code).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2000);

    // Même chose pour une erreur dont le corps n'arrive jamais.
    const stall429 = vi.fn(async (_url: string, init?: RequestInit) =>
      stalledBody(init?.signal, 429),
    );
    expect(
      (await failure(createVeniceClient("k", { fetch: stall429, timeoutMs: 30 }).complete(req)))
        .code,
    ).toBe("timeout");
  });

  it("corps bloqué sans réaction à la coupure : le délai s'applique quand même", async () => {
    // Corps qui ignore la coupure (faux serveur têtu) : seule la course contre le délai rend la main.
    const stubborn = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode("{"));
            },
          }),
          { status: 200 },
        ),
    );
    expect(
      (await failure(createVeniceClient("k", { fetch: stubborn, timeoutMs: 30 }).complete(req)))
        .code,
    ).toBe("timeout");
  });

  it("réponse 200 illisible : panne passagère", async () => {
    const { fn } = fakeFetch(() => new Response("<html>oops</html>", { status: 200 }));
    expect((await failure(createVeniceClient("k", { fetch: fn }).complete(req))).code).toBe(
      "server",
    );
  });
});

describe("outils de lecture", () => {
  it("corps d'erreur : chaîne, objet, texte brut", () => {
    expect(veniceErrorInfo('{"error":"Authentication failed"}')).toEqual({
      message: "Authentication failed",
      code: null,
    });
    expect(
      veniceErrorInfo('{"error":{"message":"Model at capacity","code":"MODEL_AT_CAPACITY"}}'),
    ).toEqual({
      message: "Model at capacity",
      code: "MODEL_AT_CAPACITY",
    });
    expect(veniceErrorInfo('{"error":"Bad","code":"INVALID_MODEL"}')).toEqual({
      message: "Bad",
      code: "INVALID_MODEL",
    });
    expect(veniceErrorInfo("Bad Gateway")).toEqual({ message: "Bad Gateway", code: null });
  });

  it("classement par statut", () => {
    const info = { message: "x", code: null };
    expect(classifyVeniceStatus(502, info)).toBe("server");
    expect(classifyVeniceStatus(413, info)).toBe("bad_request");
    expect(classifyVeniceStatus(400, info, '{"error":"x","details":"INVALID_MODEL"}')).toBe(
      "bad_model",
    );
  });

  it("attente après un 429 : bornée entre 1 s et 15 min", () => {
    const now = 1_760_000_000_000;
    const h = (v: Record<string, string>) => new Headers(v);
    expect(
      retryAfterFromHeaders(h({ "x-ratelimit-reset-requests": String(now / 1000 - 5) }), now),
    ).toBe(1000);
    expect(
      retryAfterFromHeaders(h({ "x-ratelimit-reset-requests": String(now / 1000 + 86_400) }), now),
    ).toBe(900_000);
    expect(retryAfterFromHeaders(h({ "x-ratelimit-reset-requests": "20" }), now)).toBe(20_000);
    expect(retryAfterFromHeaders(h({ "x-ratelimit-reset-tokens": "3" }), now)).toBe(3000);
    expect(retryAfterFromHeaders(h({}), now)).toBeNull();
  });

  it("blocs de raisonnement : fermés, ouverts jamais refermés, fin orpheline", () => {
    expect(stripThinking("<think>a</think>b<THINK>c</THINK> d")).toBe("b d");
    expect(stripThinking('{"a":1}<think>coupé')).toBe('{"a":1}');
    expect(stripThinking('raisonnement</think>{"a":1}')).toBe('{"a":1}');
    expect(stripThinking("  rien  ")).toBe("rien");
  });
});

describe("liste des modèles Venice", () => {
  const data = [
    {
      id: "venice-uncensored-role-play",
      object: "model",
      type: "text",
      context_length: 32768,
      model_spec: {
        name: "Venice Role Play",
        maxCompletionTokens: 4096,
        availableContextTokens: 32768,
        offline: false,
        uncensored: true,
        capabilities: { supportsResponseSchema: true, supportsReasoning: false },
        pricing: { input: { usd: 0.5, diem: 0.5 }, output: { usd: 2, diem: 2 } },
      },
    },
    {
      id: "qwen3-235b",
      type: "text",
      model_spec: {
        name: "Qwen 3 235B",
        availableContextTokens: 131072,
        deprecation: { date: "2026-11-01T00:00:00.000Z" },
        capabilities: { supportsResponseSchema: true, supportsReasoning: true },
        pricing: { input: { usd: 0.9 }, output: { usd: 4.5 } },
      },
    },
    { id: "flux-dev", type: "image", model_spec: { name: "Flux" } },
    { id: "", type: "text" },
  ];

  it("GET /models?type=text sans clé, prix par million, capacités, retrait annoncé", async () => {
    const { fn, calls } = fakeFetch(() => json({ object: "list", data }));
    const models = await listVeniceModels({ fetch: fn });
    expect(calls[0]!.url).toBe("https://api.venice.ai/api/v1/models?type=text");
    expect(calls[0]!.init.method).toBe("GET");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(models).toEqual([
      {
        id: "venice-uncensored-role-play",
        name: "Venice Role Play",
        inputUsdPerM: 0.5,
        outputUsdPerM: 2,
        maxCompletionTokens: 4096,
        contextLength: 32768,
        supportsResponseSchema: true,
        supportsReasoning: false,
        uncensored: true,
        offline: false,
        deprecated: false,
      },
      {
        id: "qwen3-235b",
        name: "Qwen 3 235B",
        inputUsdPerM: 0.9,
        outputUsdPerM: 4.5,
        maxCompletionTokens: null,
        contextLength: 131072,
        supportsResponseSchema: true,
        supportsReasoning: true,
        uncensored: false,
        offline: false,
        deprecated: true,
      },
    ]);
  });

  it("panne de Venice : erreur classée", async () => {
    const { fn } = fakeFetch(() => json({ error: "down" }, 503));
    expect((await failure(listVeniceModels({ fetch: fn }))).code).toBe("server");
  });

  it("corps bloqué après les en-têtes : timeout", async () => {
    const stall = vi.fn(async (_url: string, init?: RequestInit) => stalledBody(init?.signal));
    expect((await failure(listVeniceModels({ fetch: stall, timeoutMs: 30 }))).code).toBe("timeout");
  });
});

describe("vérification de la clé Venice", () => {
  const ok = {
    data: {
      accessPermitted: true,
      apiTier: { id: "paid", isCharged: true },
      balances: { USD: 12.3, DIEM: 0, BUNDLED_CREDITS: 0 },
      keyExpiration: null,
      rateLimits: [
        {
          apiModelId: "venice-uncensored-role-play",
          rateLimits: [
            { amount: 50, type: "RPM" },
            { amount: 1_000_000, type: "TPM" },
          ],
        },
      ],
    },
  };

  it("clé acceptée : solde et limites, sans dépenser de crédits", async () => {
    const { fn, calls } = fakeFetch(() => json(ok));
    const res = await verifyVeniceKey("cle", { fetch: fn });
    expect(calls[0]!.url).toBe("https://api.venice.ai/api/v1/api_keys/rate_limits");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer cle");
    expect(res).toEqual({
      ok: true,
      balanceUsd: 12.3,
      rateLimits: [{ modelId: "venice-uncensored-role-play", rpm: 50, rpd: null, tpm: 1_000_000 }],
    });
  });

  it("clé vide : aucun appel", async () => {
    const { fn } = fakeFetch(() => json(ok));
    const res = await verifyVeniceKey(" ", { fetch: fn });
    expect(res.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("refus en français simple : clé refusée, solde vide, accès coupé, Venice injoignable", async () => {
    const run = async (r: () => Response | Promise<Response>) =>
      verifyVeniceKey("cle", { fetch: fakeFetch(r).fn });
    const refused = await run(() => json({ error: "Authentication failed" }, 401));
    expect(refused).toMatchObject({ ok: false, code: "auth" });
    expect(!refused.ok && refused.error).toMatch(/^Clé refusée par Venice/);

    const empty = await run(() =>
      json({ ...ok, data: { ...ok.data, balances: { USD: 0, DIEM: 0, BUNDLED_CREDITS: 0 } } }),
    );
    expect(empty).toMatchObject({ ok: false, code: "balance" });
    expect(!empty.ok && empty.error).toMatch(/^Solde Venice vide/);

    const balance402 = await run(() => json({ error: "Insufficient balance" }, 402));
    expect(!balance402.ok && balance402.error).toMatch(/^Solde Venice vide/);

    const noAccess = await run(() => json({ data: { ...ok.data, accessPermitted: false } }));
    expect(noAccess).toMatchObject({ ok: false, code: "no_access" });

    const down = await run(() => {
      throw new TypeError("fetch failed");
    });
    expect(down).toMatchObject({ ok: false, code: "network" });
    expect(!down.ok && down.error).toMatch(/^Venice injoignable/);
  });

  it("corps bloqué après les en-têtes : Venice injoignable, sans rester suspendu", async () => {
    const stall = vi.fn(async (_url: string, init?: RequestInit) => stalledBody(init?.signal));
    const res = await verifyVeniceKey("cle", { fetch: stall, timeoutMs: 30 });
    expect(res).toMatchObject({ ok: false, code: "timeout" });
  });

  it("échec passager (panne, délai, trop de demandes, réseau) distingué d'un vrai refus", async () => {
    const run = async (r: () => Response | Promise<Response>) =>
      verifyVeniceKey("cle", { fetch: fakeFetch(r).fn });
    for (const status of [429, 500, 503, 504])
      expect(isTransientKeyCheck(await run(() => json({ error: "x" }, status)))).toBe(true);
    expect(
      isTransientKeyCheck(
        await run(() => {
          throw new TypeError("fetch failed");
        }),
      ),
    ).toBe(true);
    for (const status of [401, 402, 403, 400])
      expect(isTransientKeyCheck(await run(() => json({ error: "x" }, status)))).toBe(false);
    expect(
      isTransientKeyCheck(await run(() => json({ data: { ...ok.data, accessPermitted: false } }))),
    ).toBe(false);
    expect(isTransientKeyCheck(await run(() => json(ok)))).toBe(false);
  });

  it("solde en crédits inclus seulement : clé acceptée", async () => {
    const { fn } = fakeFetch(() =>
      json({
        data: { ...ok.data, balances: { USD: 0, DIEM: 0, BUNDLED_CREDITS: 25 }, rateLimits: [] },
      }),
    );
    expect(await verifyVeniceKey("cle", { fetch: fn })).toEqual({ ok: true, balanceUsd: 25 });
  });
});
