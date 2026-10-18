// Client de l'API Venice (compatible OpenAI), contrat docs/ASSISTANT-CONVERSATION.md § 3.1. `fetch` injectable : aucun
// appel réseau dans les tests. Noms vérifiés dans la documentation officielle (docs.venice.ai, 18 octobre 2026) :
// `max_completion_tokens`, `response_format: { type: "json_schema", json_schema: { name, strict, schema } }`,
// `venice_parameters.include_venice_system_prompt` / `enable_web_search: "off"`, `reasoning: { enabled: false }`,
// réponse `choices[0].message.content` (chaîne ou liste de morceaux de texte), `usage.prompt_tokens` /
// `completion_tokens`, `cost.usd` + `cost.diem` (« coût de la demande réparti par monnaie de facturation » : `usd` n'est
// que la part en dollars, 1 DIEM ≈ 1 $ de calcul) ; `GET /models?type=text` sans clé ; `GET /api_keys/rate_limits` avec
// la clé.
import {
  VeniceError,
  isTransientVeniceError,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type VeniceErrorCode,
  type VeniceModelInfo,
} from "./types";

export const VENICE_BASE_URL = "https://api.venice.ai/api/v1";
export const VENICE_TIMEOUT_MS = 20_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type VeniceClientOptions = {
  fetch?: FetchLike;
  timeoutMs?: number;
  baseUrl?: string;
  /** Horloge (millisecondes), pour le délai d'attente après un 429. */
  now?: () => number;
};

const MAX_RETRY_AFTER_MS = 15 * 60_000;

// ------------------------------------------------------------------
// Erreurs
// ------------------------------------------------------------------

type ErrorInfo = { message: string; code: string | null };

/** Message et code d'un corps d'erreur : `{"error":"…"}`, `{"error":{message,code}}` ou texte brut. */
export function veniceErrorInfo(body: string): ErrorInfo {
  const raw = body.trim();
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const err = j.error;
    const topCode = typeof j.code === "string" ? j.code : null;
    if (typeof err === "string") return { message: err.slice(0, 300), code: topCode };
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      const message = typeof e.message === "string" ? e.message : JSON.stringify(e).slice(0, 300);
      const code =
        typeof e.code === "string" ? e.code : typeof e.type === "string" ? e.type : topCode;
      return { message: message.slice(0, 300), code };
    }
    if (typeof j.message === "string") return { message: j.message.slice(0, 300), code: topCode };
  } catch {
    // Corps non JSON : gardé tel quel (tronqué).
  }
  return { message: raw.slice(0, 300), code: null };
}

const BAD_MODEL = /INVALID_MODEL|MODEL_NOT_FOUND|invalid model|model not found|unknown model/i;

/** Classe une réponse en erreur selon son statut (et son code pour un 400). */
export function classifyVeniceStatus(
  status: number,
  info: ErrorInfo,
  rawBody = "",
): VeniceErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "balance";
  if (status === 429) return "rate_limit";
  if (status === 404 || status === 410) return "bad_model";
  if (status === 422) return "content_policy";
  if (status === 400)
    return BAD_MODEL.test(info.code ?? "") ||
      BAD_MODEL.test(info.message) ||
      BAD_MODEL.test(rawBody)
      ? "bad_model"
      : "bad_request";
  if (status >= 500) return "server";
  return "bad_request";
}

/**
 * Attente avant un nouvel essai après un 429 : `x-ratelimit-reset-requests` (horodatage Unix en secondes ou en
 * millisecondes, ou durée en secondes), sinon `retry-after` (secondes ou date HTTP), sinon `x-ratelimit-reset-tokens`
 * (secondes). Bornée à 15 minutes ; null si aucun en-tête n'est lisible.
 */
export function retryAfterFromHeaders(headers: Headers, nowMs: number): number | null {
  const clamp = (ms: number) => Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, Math.round(ms)));
  const reset = Number(headers.get("x-ratelimit-reset-requests") ?? "");
  if (Number.isFinite(reset) && reset > 0) {
    if (reset > 1e12) return clamp(reset - nowMs); // horodatage en millisecondes
    if (reset > 1e9) return clamp(reset * 1000 - nowMs); // horodatage en secondes
    return clamp(reset * 1000); // durée en secondes
  }
  const after = headers.get("retry-after");
  if (after) {
    const s = Number(after);
    if (Number.isFinite(s) && s >= 0) return clamp(s * 1000);
    const at = Date.parse(after);
    if (!Number.isNaN(at)) return clamp(at - nowMs);
  }
  const tokens = Number(headers.get("x-ratelimit-reset-tokens") ?? "");
  if (Number.isFinite(tokens) && tokens > 0) return clamp(tokens * 1000);
  return null;
}

const ERROR_LABELS: Record<VeniceErrorCode, string> = {
  auth: "Clé refusée par Venice",
  balance: "Solde Venice vide",
  rate_limit: "Trop de demandes envoyées à Venice",
  server: "Venice ne répond pas pour l'instant",
  bad_model: "Modèle inconnu ou retiré chez Venice",
  content_policy: "Demande refusée par Venice",
  timeout: "Venice a mis trop de temps à répondre",
  network: "Venice injoignable",
  bad_request: "Demande refusée par Venice",
  no_key: "Aucune clé Venice enregistrée",
};

/** Réponse HTTP lue en entier (corps compris) sous le délai maximal ; `body` null : corps illisible. */
type HttpResult = { ok: boolean; status: number; headers: Headers; body: string | null };

function errorFromResponse(res: HttpResult, nowMs: number): VeniceError {
  const body = res.body ?? "";
  const info = veniceErrorInfo(body);
  const code = classifyVeniceStatus(res.status, info, body);
  const retryAfterMs = code === "rate_limit" ? retryAfterFromHeaders(res.headers, nowMs) : null;
  const detail = [info.code, info.message].filter(Boolean).join(" : ");
  return new VeniceError(
    code,
    `${ERROR_LABELS[code]} (${res.status})${detail ? ` : ${detail}` : ""}`,
    {
      status: res.status,
      ...(retryAfterMs !== null ? { retryAfterMs } : {}),
    },
  );
}

const timeoutError = (timeoutMs: number) =>
  new VeniceError(
    "timeout",
    `${ERROR_LABELS.timeout} (plus de ${Math.round(timeoutMs / 1000)} s).`,
  );

/**
 * Appel `fetch` ET lecture complète du corps sous le même délai maximal : un Venice qui envoie les en-têtes puis se
 * bloque tombe aussi en `timeout` (sinon le tour resterait suspendu, sans nouvel essai ni modèle de repli). Panne
 * réseau → `network` ; corps illisible (coupure en cours de lecture) → `body` null.
 */
async function timedRequest(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<HttpResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Refus d'abord (il l'emporte dans la course), puis coupure de la connexion.
      reject(timeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });
  const run = async (): Promise<HttpResult> => {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (controller.signal.aborted || name === "AbortError" || name === "TimeoutError")
        throw timeoutError(timeoutMs);
      throw new VeniceError(
        "network",
        `${ERROR_LABELS.network} : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const body = await res.text().catch(() => null);
    return { ok: res.ok, status: res.status, headers: res.headers, body };
  };
  try {
    return await Promise.race([run(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Corps JSON d'une réponse ; `undefined` s'il est illisible. */
function jsonBody(res: HttpResult): unknown {
  if (res.body === null) return undefined;
  try {
    return JSON.parse(res.body) as unknown;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------
// Réponse
// ------------------------------------------------------------------

/** Retire les blocs de raisonnement `<think>…</think>` (et un bloc ouvert jamais refermé, ou une fin orpheline). */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = out.search(/<think>/i);
  if (open >= 0) out = out.slice(0, open);
  const close = out.search(/<\/think>/i);
  if (close >= 0) out = out.slice(close + "</think>".length);
  return out.trim();
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part &&
              typeof part === "object" &&
              typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "",
      )
      .join("");
  return "";
}

const tokens = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/**
 * Coût total d'un appel en dollars : `cost.usd` (part payée en dollars ou en crédits inclus) + `cost.diem` (part payée
 * en DIEM, 1 DIEM ≈ 1 $ de calcul) ; null si Venice n'en renvoie aucun.
 */
export function completionCostUsd(cost: unknown): number | null {
  const c = (cost && typeof cost === "object" ? cost : {}) as Record<string, unknown>;
  const usd = num(c.usd);
  const diem = num(c.diem);
  if (usd === null && diem === null) return null;
  return Math.round(((usd ?? 0) + (diem ?? 0)) * 1e10) / 1e10;
}

/** Lit une réponse `chat/completions` : `choices[0].message.content` seulement (jamais `reasoning_content`). */
export function parseCompletion(
  json: unknown,
  requestedModel: string,
  requestId: string | null,
): LlmResponse {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const choices = Array.isArray(j.choices) ? j.choices : [];
  const first = (choices[0] ?? {}) as { message?: { content?: unknown }; finish_reason?: unknown };
  const usage = (j.usage ?? {}) as Record<string, unknown>;
  return {
    text: stripThinking(contentText(first.message?.content)),
    model: typeof j.model === "string" && j.model ? j.model : requestedModel,
    finishReason: typeof first.finish_reason === "string" ? first.finish_reason : null,
    usage: {
      inputTokens: tokens(usage.prompt_tokens),
      outputTokens: tokens(usage.completion_tokens),
    },
    costUsd: completionCostUsd(j.cost),
    requestId,
  };
}

/** Corps exact envoyé à `POST /chat/completions` (contrat § 3.1). */
export function veniceRequestBody(req: LlmRequest): Record<string, unknown> {
  return {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature,
    max_completion_tokens: req.maxTokens,
    stream: false,
    ...(req.jsonSchema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema },
          },
        }
      : {}),
    venice_parameters: { include_venice_system_prompt: false, enable_web_search: "off" },
    ...(req.reasoning ? { reasoning: { enabled: false } } : {}),
  };
}

// ------------------------------------------------------------------
// Client
// ------------------------------------------------------------------

/**
 * Client Venice. Clé vide : refus local `no_key`, sans aucun appel (Venice répondrait 402 en proposant un paiement
 * par portefeuille). Chaque erreur est une `VeniceError` classée (auth, balance, rate_limit…).
 */
export function createVeniceClient(apiKey: string, opts: VeniceClientOptions = {}): LlmClient {
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const base = (opts.baseUrl ?? VENICE_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? VENICE_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const key = apiKey.trim();
  return {
    async complete(req: LlmRequest): Promise<LlmResponse> {
      if (!key)
        throw new VeniceError(
          "no_key",
          `${ERROR_LABELS.no_key} : collez la clé dans Réglages → IA de conversation.`,
        );
      const res = await timedRequest(
        fetchImpl,
        `${base}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(veniceRequestBody(req)),
        },
        timeoutMs,
      );
      if (!res.ok) throw errorFromResponse(res, now());
      const json = jsonBody(res);
      if (json === undefined)
        throw new VeniceError("server", `${ERROR_LABELS.server} : réponse illisible.`, {
          status: res.status,
        });
      return parseCompletion(json, req.model, res.headers.get("cf-ray"));
    },
  };
}

// ------------------------------------------------------------------
// Liste des modèles (sans clé)
// ------------------------------------------------------------------

/** Un modèle de `GET /models` au format du cache (`VeniceModelInfo`), ou null s'il n'est pas un modèle texte. */
export function parseVeniceModel(raw: unknown): VeniceModelInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id.trim()) return null;
  if (typeof r.type === "string" && r.type !== "text") return null;
  const spec = (r.model_spec ?? {}) as Record<string, unknown>;
  const caps = (spec.capabilities ?? {}) as Record<string, unknown>;
  const pricing = (spec.pricing ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const int = (v: unknown) => {
    const n = num(v);
    return n === null ? null : Math.round(n);
  };
  return {
    id: r.id.trim(),
    name: typeof spec.name === "string" && spec.name.trim() ? spec.name.trim() : r.id.trim(),
    inputUsdPerM: num(pricing.input?.usd),
    outputUsdPerM: num(pricing.output?.usd),
    maxCompletionTokens: int(spec.maxCompletionTokens),
    contextLength: int(r.context_length) ?? int(spec.availableContextTokens),
    supportsResponseSchema: caps.supportsResponseSchema === true,
    supportsReasoning: caps.supportsReasoning === true,
    uncensored: spec.uncensored === true,
    offline: spec.offline === true,
    deprecated: spec.deprecation !== undefined && spec.deprecation !== null,
  };
}

/** Modèles texte de Venice (`GET /models?type=text`, sans clé). Erreur : `VeniceError`. */
export async function listVeniceModels(
  opts: Omit<VeniceClientOptions, "now"> = {},
): Promise<VeniceModelInfo[]> {
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const base = (opts.baseUrl ?? VENICE_BASE_URL).replace(/\/+$/, "");
  const res = await timedRequest(
    fetchImpl,
    `${base}/models?type=text`,
    { method: "GET", headers: { Accept: "application/json" } },
    opts.timeoutMs ?? VENICE_TIMEOUT_MS,
  );
  if (!res.ok) throw errorFromResponse(res, Date.now());
  const json = jsonBody(res);
  if (json === undefined)
    throw new VeniceError("server", `${ERROR_LABELS.server} : liste des modèles illisible.`, {
      status: res.status,
    });
  const data = (json as { data?: unknown } | null)?.data;
  const seen = new Set<string>();
  const out: VeniceModelInfo[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const m = parseVeniceModel(raw);
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

// ------------------------------------------------------------------
// Vérification de la clé
// ------------------------------------------------------------------

export type VeniceRateLimit = {
  modelId: string;
  rpm: number | null;
  rpd: number | null;
  tpm: number | null;
};

export type VeniceKeyCheck =
  | { ok: true; balanceUsd?: number; rateLimits?: VeniceRateLimit[] }
  | { ok: false; error: string; code: VeniceErrorCode | "no_access" };

/**
 * Échec passager de la vérification (Venice en panne, injoignable, trop lent, trop sollicité) : la clé n'est pas en
 * cause, rien ne doit être enregistré sur elle (ni refus, ni date de vérification).
 */
export function isTransientKeyCheck(result: VeniceKeyCheck): boolean {
  return !result.ok && result.code !== "no_access" && isTransientVeniceError(result.code);
}

/** Phrase en français simple pour un refus de la vérification. */
function keyCheckMessage(code: VeniceErrorCode, status?: number): string {
  switch (code) {
    case "auth":
      return status === 403
        ? "Clé refusée par Venice : l'accès à l'API est coupé pour cette clé, ou réservé à certaines connexions. Créez une nouvelle clé sans restriction."
        : "Clé refusée par Venice : vérifiez qu'elle est complète (collée en entier) et toujours active.";
    case "balance":
      return "Solde Venice vide : ajoutez des crédits dans votre compte Venice, puis cliquez de nouveau sur « Vérifier ».";
    case "rate_limit":
      return "Venice limite les essais pour l'instant : réessayez dans une minute.";
    case "timeout":
    case "network":
      return "Venice injoignable : réessayez dans quelques minutes.";
    case "server":
      return "Venice ne répond pas pour l'instant : réessayez dans quelques minutes.";
    case "no_key":
      return "Aucune clé enregistrée : collez la clé Venice, enregistrez, puis cliquez sur « Vérifier ».";
    default:
      return `Venice a refusé la vérification${status ? ` (erreur ${status})` : ""}.`;
  }
}

/** Vérifie la clé sans dépenser de crédits (`GET /api_keys/rate_limits`) : solde et limites par modèle. */
export async function verifyVeniceKey(
  apiKey: string,
  opts: Omit<VeniceClientOptions, "now"> = {},
): Promise<VeniceKeyCheck> {
  const key = apiKey.trim();
  if (!key) return { ok: false, code: "no_key", error: keyCheckMessage("no_key") };
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const base = (opts.baseUrl ?? VENICE_BASE_URL).replace(/\/+$/, "");
  let res: HttpResult;
  try {
    res = await timedRequest(
      fetchImpl,
      `${base}/api_keys/rate_limits`,
      { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } },
      opts.timeoutMs ?? VENICE_TIMEOUT_MS,
    );
  } catch (err) {
    const code = err instanceof VeniceError ? err.code : "network";
    return { ok: false, code, error: keyCheckMessage(code) };
  }
  if (!res.ok) {
    const e = errorFromResponse(res, Date.now());
    return { ok: false, code: e.code, error: keyCheckMessage(e.code, res.status) };
  }
  const json = jsonBody(res) as { data?: unknown } | null | undefined;
  if (json === undefined) return { ok: false, code: "server", error: keyCheckMessage("server") };
  const data: Record<string, unknown> =
    json?.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : {};
  if (data.accessPermitted === false)
    return {
      ok: false,
      code: "no_access",
      error:
        "Clé reconnue par Venice, mais sans accès à l'API : activez l'accès à l'API dans votre compte Venice.",
    };
  const balances = (data.balances ?? {}) as Record<string, unknown>;
  const usd = num(balances.USD);
  const credits = num(balances.BUNDLED_CREDITS);
  const diem = num(balances.DIEM);
  const charged = (data.apiTier as { isCharged?: unknown } | undefined)?.isCharged === true;
  if (
    charged &&
    (usd ?? 0) <= 0 &&
    (credits ?? 0) <= 0 &&
    (diem ?? 0) <= 0 &&
    (usd !== null || credits !== null)
  )
    return { ok: false, code: "balance", error: keyCheckMessage("balance") };
  const rateLimits: VeniceRateLimit[] = [];
  for (const row of Array.isArray(data.rateLimits) ? data.rateLimits : []) {
    const r = (row ?? {}) as { apiModelId?: unknown; rateLimits?: unknown };
    if (typeof r.apiModelId !== "string") continue;
    const of = (type: string) => {
      const hit = (Array.isArray(r.rateLimits) ? r.rateLimits : []).find(
        (l) => (l as { type?: unknown })?.type === type,
      ) as { amount?: unknown } | undefined;
      return num(hit?.amount);
    };
    rateLimits.push({ modelId: r.apiModelId, rpm: of("RPM"), rpd: of("RPD"), tpm: of("TPM") });
  }
  const balanceUsd =
    usd !== null || credits !== null ? Math.round(((usd ?? 0) + (credits ?? 0)) * 100) / 100 : null;
  return {
    ok: true,
    ...(balanceUsd !== null ? { balanceUsd } : {}),
    ...(rateLimits.length ? { rateLimits } : {}),
  };
}
