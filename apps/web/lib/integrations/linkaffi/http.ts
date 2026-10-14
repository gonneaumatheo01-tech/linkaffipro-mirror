/**
 * Réponses de l'API d'intégration appelée par Link Affi (`/api/integrations/linkaffi/v1`, contrat
 * `docs/LINKAFFI-PARTENAIRES.md` § 1) : JSON, jamais mises en cache, erreurs `{ error, message }` avec un code stable
 * en anglais (`error`, lu par la fonction Link Affi) et une phrase en français (`message`, montrée à l'admin Link Affi).
 */

/** Codes d'erreur stables de l'API (champ `error`). */
export type IntegrationErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "invalid_json"
  | "invalid_body"
  | "invalid_query"
  | "payload_too_large"
  | "not_found"
  | "method_not_allowed"
  | "channel_not_found"
  | "campaign_not_found"
  | "invite_link_not_found"
  | "affiliate_mismatch"
  | "invite_link_disabled"
  | "reactivation_refused"
  | "no_bot"
  | "telegram_refused"
  | "telegram_unavailable"
  | "internal_error";

/** Erreur prévue d'une route : convertie telle quelle en réponse JSON par `withLinkaffiIntegration`. */
export class IntegrationError extends Error {
  constructor(
    readonly status: number,
    readonly code: IntegrationErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
    readonly details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

/** Réponse JSON de succès (jamais en cache). */
export function integrationJson(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

/** Réponse d'erreur `{ error, message }` (+ `details` pour une validation). */
export function integrationError(err: IntegrationError): Response {
  return Response.json(
    {
      error: err.code,
      message: err.message,
      ...(err.details?.length ? { details: err.details } : {}),
    },
    { status: err.status, headers: { ...NO_STORE, ...err.headers } },
  );
}
