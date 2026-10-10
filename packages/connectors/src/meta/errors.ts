/**
 * Classification des erreurs de la Graph API Meta (v25.0) en `ConnectorError`, pour que le worker réagisse juste :
 * - `auth` : jeton invalide ou expiré (codes 190, 102) → la connexion passe « à reconnecter » ;
 * - `permission` : droits insuffisants (code 10, codes 200 à 299) → idem, l'utilisateur doit réaccorder les droits ;
 * - `rate_limit` : limite d'appels (codes 4, 17, 32, 613, 80000, 80004 ; HTTP 429) → nouvel essai plus tard ;
 * - `network` : plateforme injoignable ou réponse 5xx ;
 * - `other` : tout le reste.
 * Aucun jeton ne figure jamais dans les messages.
 */
import { ConnectorError, type ConnectorErrorKind } from "../errors";

export type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number | string;
    error_subcode?: number | string;
    fbtrace_id?: string;
    error_user_msg?: string;
  };
};

const AUTH_CODES = new Set([190, 102]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80004]);

export function metaErrorKind(code: number | null, httpStatus: number): ConnectorErrorKind {
  if (code !== null) {
    if (AUTH_CODES.has(code)) return "auth";
    if (code === 10 || (code >= 200 && code <= 299)) return "permission";
    if (RATE_LIMIT_CODES.has(code)) return "rate_limit";
  }
  if (httpStatus === 429) return "rate_limit";
  if (httpStatus === 401 || httpStatus === 403) return "auth";
  if (httpStatus >= 500) return "network";
  return "other";
}

/**
 * Attente conseillée (secondes) lue dans les en-têtes d'usage de Meta :
 * - `X-Business-Use-Case-Usage` : `{ "<business_id>": [{ estimated_time_to_regain_access: <minutes>, … }] }` ;
 * - `X-Ad-Account-Usage` : `{ reset_time_duration: <secondes> }`.
 * `null` si rien d'exploitable.
 */
export function retryAfterFromHeaders(headers: Headers | null | undefined): number | null {
  if (!headers) return null;
  const buc = parseJsonHeader(headers.get("x-business-use-case-usage"));
  if (buc && typeof buc === "object") {
    let maxMinutes = 0;
    for (const value of Object.values(buc as Record<string, unknown>)) {
      const list = Array.isArray(value) ? value : [value];
      for (const entry of list) {
        const minutes = Number(
          (entry as { estimated_time_to_regain_access?: unknown })?.estimated_time_to_regain_access,
        );
        if (Number.isFinite(minutes) && minutes > maxMinutes) maxMinutes = minutes;
      }
    }
    if (maxMinutes > 0) return Math.ceil(maxMinutes * 60);
  }
  const adAccount = parseJsonHeader(headers.get("x-ad-account-usage")) as {
    reset_time_duration?: unknown;
  } | null;
  const reset = Number(adAccount?.reset_time_duration);
  if (Number.isFinite(reset) && reset > 0) return Math.ceil(reset);
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter);
  return null;
}

function parseJsonHeader(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Construit l'erreur classée à partir d'une réponse HTTP de la Graph API (corps déjà lu). */
export function metaErrorFromResponse(
  httpStatus: number,
  body: unknown,
  headers?: Headers | null,
): ConnectorError {
  const err = (body as MetaErrorBody | null)?.error;
  const rawCode = err?.code;
  const code = rawCode === undefined || rawCode === null || rawCode === "" ? null : Number(rawCode);
  const kind = metaErrorKind(code !== null && Number.isFinite(code) ? code : null, httpStatus);
  const retryAfterSec = kind === "rate_limit" ? (retryAfterFromHeaders(headers) ?? 15 * 60) : null;
  const message = describe(kind, err?.error_user_msg ?? err?.message, code, httpStatus);
  return new ConnectorError(kind, message, {
    retryAfterSec,
    platformCode: code !== null && Number.isFinite(code) ? code : httpStatus,
  });
}

function describe(
  kind: ConnectorErrorKind,
  platformMessage: string | undefined,
  code: number | null,
  httpStatus: number,
): string {
  const detail = platformMessage ? scrub(platformMessage) : `HTTP ${httpStatus}`;
  const suffix = code !== null && Number.isFinite(code) ? ` (code Meta ${code})` : "";
  switch (kind) {
    case "auth":
      return `jeton Meta refusé${suffix} : ${detail}`;
    case "permission":
      return `${detail}${suffix}`;
    case "rate_limit":
      return `limite d'appels Meta${suffix} : ${detail}`;
    case "network":
      return `Meta a répondu ${httpStatus}${platformMessage ? ` : ${scrub(platformMessage)}` : ""}`;
    default:
      return `erreur Meta${suffix} : ${detail}`;
  }
}

/** Retire tout ce qui ressemble à un jeton ou à un secret d'un message (par précaution). */
export function scrub(text: string): string {
  return text
    .replace(/(access_token|client_secret|fb_exchange_token)=[^&\s"']+/gi, "$1=***")
    .replace(/\bEAA[A-Za-z0-9]{20,}/g, "***")
    .slice(0, 300);
}

/** Erreur réseau (fetch rejeté) → `network`, sans URL ni jeton. */
export function metaNetworkError(err: unknown): ConnectorError {
  const message = err instanceof Error ? scrub(err.message) : String(err);
  return new ConnectorError("network", `graph.facebook.com injoignable : ${message}`);
}
