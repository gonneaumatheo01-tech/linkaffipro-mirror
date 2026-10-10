/** Erreur d'un connecteur, classée pour que le worker réagisse juste : reconnexion, attente, ou reprise. */
export type ConnectorErrorKind = "auth" | "rate_limit" | "permission" | "network" | "other";

export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  /** Attente conseillée avant de réessayer (secondes), pour les limites de débit. */
  readonly retryAfterSec: number | null;
  readonly platformCode: string | null;

  constructor(kind: ConnectorErrorKind, message: string, opts: { retryAfterSec?: number | null; platformCode?: string | number | null } = {}) {
    super(message);
    this.name = "ConnectorError";
    this.kind = kind;
    this.retryAfterSec = opts.retryAfterSec ?? null;
    this.platformCode = opts.platformCode === undefined || opts.platformCode === null ? null : String(opts.platformCode);
  }
}

export function isConnectorError(err: unknown): err is ConnectorError {
  return err instanceof ConnectorError;
}

/** Message en français simple pour l'interface (jamais de jeton dedans). */
export function describeConnectorError(err: unknown): string {
  if (isConnectorError(err)) {
    switch (err.kind) {
      case "auth":
        return `Connexion expirée ou révoquée : reconnectez le compte (${err.message}).`;
      case "rate_limit":
        return `Limite de requêtes atteinte chez la plateforme${err.retryAfterSec ? ` ; nouvel essai dans ${Math.ceil(err.retryAfterSec / 60)} min` : ""}.`;
      case "permission":
        return `Droits insuffisants chez la plateforme : ${err.message}.`;
      case "network":
        return `Plateforme injoignable : ${err.message}.`;
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
