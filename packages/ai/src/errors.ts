export type AiErrorCode = "invalid_output" | "no_valid_version" | "auth" | "rate_limit" | "network" | "api" | "unsupported";

/** Erreur lisible pour l'utilisateur (jamais de clé ni de détail technique sensible dans `message`). */
export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}
