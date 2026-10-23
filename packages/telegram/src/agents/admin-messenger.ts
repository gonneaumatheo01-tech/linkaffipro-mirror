/**
 * Messager du dialogue admin pour les agents (CONTRAT, propriétaire : chantier B). Implémente `AdminMessenger`
 * (`@linkaffipro/agents`) : envoi au seul identifiant admin (`Setting` `admin.telegramUserId`) par le bot du dialogue
 * admin (celui de `notifyAdmin`), boutons inline, média joint (octets `MediaAsset`). Utilisé par le worker et le site.
 */
import type { AdminMessenger } from "@linkaffipro/agents";

export function createAdminMessenger(): AdminMessenger {
  throw new Error("createAdminMessenger : à écrire (chantier B)");
}
