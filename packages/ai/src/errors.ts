import type { AiUsage } from "./types";

export type AiErrorCode =
  | "invalid_output"
  | "no_valid_version"
  | "too_long"
  | "auth"
  | "rate_limit"
  | "network"
  | "api"
  | "unsupported";

/**
 * Erreur lisible pour l'utilisateur (jamais de clé ni de détail technique sensible dans `message`).
 * `usage` et `costEur` : ce qui a déjà été facturé avant l'échec (compté dans le plafond mensuel).
 */
export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly usage?: AiUsage,
    public readonly costEur?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}
