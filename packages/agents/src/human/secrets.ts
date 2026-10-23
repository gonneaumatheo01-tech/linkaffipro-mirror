/**
 * Clés des fournisseurs (CONTRAT, propriétaire : chantier B). Rangées chiffrées dans `Setting`
 * (`packages/core/src/crypto.ts`), jamais renvoyées au navigateur, jamais dans `Event`, `AuditLog`, un log ou un message.
 */
import type { PrismaClient } from "@linkaffipro/db";
import type { AgentsDeps } from "../types";
import type { ActorRef } from "../admin/team";

/** Clés connues dans cette phase (les phases suivantes en ajoutent : fal, cotes, bookmaker…). */
export const SECRET_KEYS = [
  "providers.fal.apiKey",
  "providers.magichour.apiKey",
  "providers.odds.apiKey",
] as const;

export type SecretSummary = { set: boolean; last4: string | null; updatedAt: Date | null };

/** Enregistre (chiffrée) une clé ; renvoie seulement les 4 derniers caractères. */
export async function saveSecret(
  _deps: AgentsDeps,
  _key: string,
  _value: string,
  _actor: ActorRef,
): Promise<{ last4: string }> {
  throw new Error("saveSecret : à écrire (chantier B)");
}

/** Résumé affichable (jamais la valeur). */
export async function secretSummary(_prisma: PrismaClient, _key: string): Promise<SecretSummary> {
  throw new Error("secretSummary : à écrire (chantier B)");
}

/** Valeur en clair, côté serveur seulement (fournisseurs). */
export async function readSecret(_prisma: PrismaClient, _key: string): Promise<string | null> {
  throw new Error("readSecret : à écrire (chantier B)");
}

/** Vérification d'une clé quand un vérificateur existe ; `null` si aucun n'est prévu pour cette clé. */
export async function verifySecret(
  _deps: AgentsDeps,
  _key: string,
): Promise<{ ok: boolean; message: string } | null> {
  throw new Error("verifySecret : à écrire (chantier B)");
}

export async function deleteSecret(
  _deps: AgentsDeps,
  _key: string,
  _actor: ActorRef,
): Promise<void> {
  throw new Error("deleteSecret : à écrire (chantier B)");
}
