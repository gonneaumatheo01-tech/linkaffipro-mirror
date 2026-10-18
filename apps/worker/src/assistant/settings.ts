/**
 * Réglages de l'assistant de conversation côté worker (`Setting` `assistant.venice`, forme et lecture tolérante dans
 * `packages/chat/src/config.ts`) : lecture avec la clé déchiffrée en mémoire (jamais journalisée), et relecture
 * quotidienne de la liste des modèles et de leurs prix (tâche `chat` `refresh-models`).
 */
import {
  ASSISTANT_SETTING_KEY,
  parseAssistantConfig,
  selectableModels,
  type AssistantConfig,
} from "@linkaffipro/chat";
import { decrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { logger } from "../logger";
import { chatRuntime } from "./runtime";

export type AssistantSettings = {
  config: AssistantConfig;
  /** Clé Venice en clair (null : absente ou illisible). Ne jamais la journaliser. */
  apiKey: string | null;
};

export async function loadAssistantSettings(): Promise<AssistantSettings> {
  const row = await prisma.setting.findUnique({ where: { key: ASSISTANT_SETTING_KEY } });
  const config = parseAssistantConfig(row?.value);
  let apiKey: string | null = null;
  if (config.apiKeyEncrypted) {
    try {
      apiKey = decrypt(config.apiKeyEncrypted).trim() || null;
    } catch {
      apiKey = null;
    }
  }
  return { config, apiKey };
}

/**
 * Relit la liste des modèles Venice (sans clé) et met à jour SEULEMENT `models` et `modelsFetchedAt` du réglage, par une
 * fusion faite par la base (`value || patch`) : jamais d'écrasement d'un réglage enregistré au même moment par un ADMIN
 * (clé, activation, plafond…). Les modèles gardés sont ceux proposés dans les réglages (`selectableModels`). Une panne
 * de Venice est sans conséquence (l'ancienne liste reste).
 */
export async function refreshAssistantModels(
  now: Date = chatRuntime().now(),
): Promise<{ ok: boolean; models: number; error?: string }> {
  let models;
  try {
    models = selectableModels(await chatRuntime().listModels());
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ err: error }, "assistant : liste des modèles Venice illisible");
    return { ok: false, models: 0, error };
  }
  if (models.length === 0) return { ok: false, models: 0, error: "liste vide" };
  const patch = JSON.stringify({ models, modelsFetchedAt: now.toISOString() });
  await prisma.$executeRaw`
    INSERT INTO "Setting" ("key", "value", "updatedAt")
    VALUES (${ASSISTANT_SETTING_KEY}, ${patch}::jsonb, ${now})
    ON CONFLICT ("key") DO UPDATE
      SET "value" = CASE WHEN jsonb_typeof("Setting"."value") = 'object'
                         THEN "Setting"."value" || EXCLUDED."value" ELSE EXCLUDED."value" END,
          "updatedAt" = EXCLUDED."updatedAt"`;
  logger.info({ models: models.length }, "assistant : modèles Venice relus");
  return { ok: true, models: models.length };
}
