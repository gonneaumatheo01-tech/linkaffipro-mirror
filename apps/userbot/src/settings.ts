/**
 * Reglages de l'IA de conversation lus par le userbot (`Setting` `assistant.venice`, meme forme que le worker) :
 * relus a chaque tour pour qu'un changement fait dans Reglages → IA de conversation s'applique sans redemarrage.
 */
import {
  ASSISTANT_SETTING_KEY,
  parseAssistantConfig,
  type AssistantConfig,
} from "@linkaffipro/chat";
import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";

export type UserbotSettings = {
  /** Cle, modeles, temperature, maxTokens, plafond mensuel, liste des modeles. */
  config: AssistantConfig;
  /** Cle Venice en clair (null : absente ou illisible). Ne jamais la journaliser. */
  apiKey: string | null;
};

export async function loadUserbotSettings(): Promise<UserbotSettings> {
  const row = await prisma.setting.findUnique({ where: { key: ASSISTANT_SETTING_KEY } });
  const config = parseAssistantConfig(row?.value);
  let apiKey: string | null = null;
  if (config.apiKeyEncrypted) {
    try {
      apiKey = decrypt(config.apiKeyEncrypted).trim() || null;
    } catch {
      // Cle chiffree avec une autre APP_ENCRYPTION_KEY : traitee comme absente.
      apiKey = null;
    }
  }
  return { config, apiKey };
}
