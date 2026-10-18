/**
 * Réglages de l'assistant de conversation (`Setting` `assistant.venice`, contrat docs/ASSISTANT-CONVERSATION.md § 2) :
 * clé Venice chiffrée (AES-256-GCM, `encrypt` de core), activation, modèles, limites. La forme et la lecture tolérante
 * sont dans `packages/chat` (`parseAssistantConfig`) ; ici seulement la lecture et l'écriture en base. La clé n'est
 * jamais renvoyée au navigateur ni journalisée.
 */
import { decrypt, encrypt } from "@linkaffipro/core";
import { prisma, toJsonValue } from "@linkaffipro/db";
import {
  ASSISTANT_SETTING_KEY,
  assistantConfigState,
  parseAssistantConfig,
  type AssistantConfig,
  type AssistantConfigState,
} from "@linkaffipro/chat";

export { ASSISTANT_SETTING_KEY };

export async function loadAssistantConfig(): Promise<AssistantConfig> {
  const row = await prisma.setting.findUnique({ where: { key: ASSISTANT_SETTING_KEY } });
  return parseAssistantConfig(row?.value);
}

/** Réglages affichables (sans la clé : `hasKey` et un indice). */
export async function loadAssistantConfigState(): Promise<AssistantConfigState> {
  return assistantConfigState(await loadAssistantConfig(), decrypt);
}

export type AssistantConfigPatch = Partial<AssistantConfig> & {
  /** Nouvelle clé en clair (chiffrée avant l'écriture) ; vide ou absente = clé inchangée. */
  apiKey?: string | null;
};

/**
 * Enregistre une modification des réglages (fusionnée avec l'existant, relue par `parseAssistantConfig`). Une nouvelle
 * clé est chiffrée et remet la vérification à zéro (il faut cliquer de nouveau sur « Vérifier »).
 */
export async function saveAssistantConfig(patch: AssistantConfigPatch): Promise<AssistantConfig> {
  const current = await loadAssistantConfig();
  const { apiKey, ...rest } = patch;
  const merged: AssistantConfig = { ...current, ...rest };
  const key = apiKey?.trim();
  if (key) {
    merged.apiKeyEncrypted = encrypt(key);
    merged.verifiedAt = null;
    merged.lastError = null;
  }
  const next = parseAssistantConfig(merged);
  await prisma.setting.upsert({
    where: { key: ASSISTANT_SETTING_KEY },
    create: { key: ASSISTANT_SETTING_KEY, value: toJsonValue(next) },
    update: { value: toJsonValue(next) },
  });
  return next;
}

/** Clé en clair pour un appel (null si absente ou illisible). Ne jamais la journaliser. */
export async function loadAssistantApiKey(config?: AssistantConfig): Promise<string | null> {
  const c = config ?? (await loadAssistantConfig());
  if (!c.apiKeyEncrypted) return null;
  try {
    return decrypt(c.apiKeyEncrypted);
  } catch {
    return null;
  }
}
