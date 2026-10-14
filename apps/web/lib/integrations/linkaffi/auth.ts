import { hashIntegrationApiKey } from "@linkaffipro/core";

/**
 * Authentification de Link Affi sur l'API d'intégration : en-tête `Authorization: Bearer <clé>`. La clé n'est jamais
 * stockée : on calcule son empreinte (SHA-256, `hashIntegrationApiKey`) et on cherche la ligne `IntegrationKey` qui la
 * porte (`apiKeyHash`, unique). Régénérer la clé remplace l'empreinte : l'ancienne clé est refusée aussitôt.
 */

export const LINKAFFI_PROVIDER = "linkaffi";

/** Une clé plus longue que ça n'est pas une des nôtres (évite de hacher n'importe quoi). */
const MAX_KEY_LENGTH = 256;

/** Clé lue dans l'en-tête `Authorization: Bearer <clé>` (insensible à la casse de « Bearer »), sinon null. */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^\s*bearer\s+(\S+)\s*$/i.exec(header ?? "");
  const token = m?.[1] ?? null;
  if (!token || token.length > MAX_KEY_LENGTH) return null;
  return token;
}

/** Recherche de la ligne de clé par empreinte (base en production, simulée dans les tests). */
export type IntegrationKeyLookup = (
  apiKeyHash: string,
) => Promise<{ provider: string; apiKeyHash: string | null } | null>;

export type IntegrationAuth =
  { ok: true; keyHash: string } | { ok: false; reason: "missing" | "invalid" };

/** Vérifie la clé de l'en-tête par son empreinte (jamais la clé elle-même hors de cette fonction). */
export async function authenticateLinkaffi(
  authorization: string | null | undefined,
  lookup: IntegrationKeyLookup,
): Promise<IntegrationAuth> {
  const token = bearerToken(authorization);
  if (!token) return { ok: false, reason: authorization?.trim() ? "invalid" : "missing" };
  const keyHash = hashIntegrationApiKey(token);
  const row = await lookup(keyHash);
  if (!row || row.provider !== LINKAFFI_PROVIDER || row.apiKeyHash !== keyHash)
    return { ok: false, reason: "invalid" };
  return { ok: true, keyHash };
}

/** Message de refus (401), en français, lisible par l'admin Link Affi. */
export function unauthorizedMessage(reason: "missing" | "invalid"): string {
  return reason === "missing"
    ? "Clé de connexion absente : envoyez l'en-tête « Authorization: Bearer <LINKAFFIPRO_API_KEY> »."
    : "Clé de connexion refusée : elle est fausse ou a été régénérée. Collez la clé actuelle (Réglages → Connexions → Campagnes Telegram des affiliés) dans le secret LINKAFFIPRO_API_KEY de Link Affi.";
}
