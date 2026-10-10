/**
 * Classement des erreurs de la TikTok Marketing API v1.3.
 * TikTok répond presque toujours en HTTP 200 avec `{ code, message, request_id, data }` : `code` vaut 0 en cas de succès.
 * Codes observés (doc officielle + SDK `tiktok/tiktok-business-api-sdk`) :
 *   40105, 40001, 40100-40199 : jeton absent, incorrect, expiré ou révoqué  → `auth` (reconnexion) ;
 *   40002, 40104, 40112         : droits insuffisants, app non validée, annonceur non autorisé → `permission` ;
 *   40100 « too many requests », 50002, HTTP 429 : limite de requêtes → `rate_limit` (attente 60 s) ;
 *   réseau / JSON illisible : `network` ; le reste : `other` avec le message de TikTok.
 */
import { ConnectorError } from "../errors";

const PERMISSION_CODES = new Set([40002, 40104, 40112]);
const RATE_LIMIT_CODES = new Set([50002]);
const RATE_LIMIT_RETRY_SEC = 60;

/** Réponse enveloppe de l'API TikTok. */
export type TikTokEnvelope<T> = { code?: number; message?: string; request_id?: string; data?: T };

export function isRateLimitMessage(message: string): boolean {
  return /too many requests|rate limit|frequency|quota/i.test(message);
}

/** Construit la `ConnectorError` correspondant à un `code` TikTok non nul. */
export function tiktokError(
  code: number,
  message: string | undefined,
  requestId?: string,
): ConnectorError {
  const msg =
    (message?.trim() || `erreur TikTok ${code}`) + (requestId ? ` (réf. ${requestId})` : "");
  if (RATE_LIMIT_CODES.has(code) || (code === 40100 && isRateLimitMessage(message ?? ""))) {
    return new ConnectorError("rate_limit", msg, {
      retryAfterSec: RATE_LIMIT_RETRY_SEC,
      platformCode: code,
    });
  }
  if (PERMISSION_CODES.has(code))
    return new ConnectorError("permission", msg, { platformCode: code });
  if (code === 40105 || code === 40001 || (code >= 40100 && code <= 40199)) {
    return new ConnectorError("auth", msg, { platformCode: code });
  }
  return new ConnectorError("other", msg, { platformCode: code });
}

/** Erreur à partir d'un statut HTTP non 2xx (TikTok en renvoie rarement, sauf 429 et pannes). */
export function tiktokHttpError(status: number, body: string): ConnectorError {
  if (status === 429)
    return new ConnectorError("rate_limit", "trop de requêtes (HTTP 429)", {
      retryAfterSec: RATE_LIMIT_RETRY_SEC,
      platformCode: status,
    });
  if (status === 401 || status === 403)
    return new ConnectorError("auth", `accès refusé (HTTP ${status})`, { platformCode: status });
  if (status >= 500)
    return new ConnectorError("network", `TikTok indisponible (HTTP ${status})`, {
      platformCode: status,
    });
  return new ConnectorError(
    "other",
    `réponse inattendue de TikTok (HTTP ${status}) ${body.slice(0, 120)}`.trim(),
    { platformCode: status },
  );
}

/** Vrai si le code signale un jeton manquant/invalide (utilisé par la vérification heuristique de l'app). */
export function isAuthCode(code: number): boolean {
  return code === 40105 || code === 40001 || (code >= 40100 && code <= 40199);
}
