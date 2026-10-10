/**
 * Réglages de l'assistant IA (Setting `ai.config`) : clé Anthropic chiffrée, modèles, plafond mensuel,
 * limite par utilisateur, textes de la mention des risques. La clé n'est jamais renvoyée au navigateur.
 */
import { decrypt, encrypt } from "@linkaffipro/core";
import { prisma, toJsonValue } from "@linkaffipro/db";
import { DEFAULT_MODEL, DEFAULT_RISK_NOTICE, QUALITY_MODEL, isAiModelId, type AiModelId, type AiRiskNotice } from "@linkaffipro/ai";

export const AI_CONFIG_KEY = "ai.config";
export const DEFAULT_MONTHLY_CAP_EUR = 20;
export const DEFAULT_PER_USER_DAILY_LIMIT = 50;

export type AiConfig = {
  apiKeyEncrypted: string | null;
  defaultModel: AiModelId;
  qualityModel: AiModelId;
  monthlyCapEur: number;
  perUserDailyLimit: number;
  riskNotice: AiRiskNotice;
  verifiedAt: string | null;
  lastError: string | null;
};

/** État affichable (sans la clé). */
export type AiConfigState = Omit<AiConfig, "apiKeyEncrypted"> & { hasKey: boolean; keyHint: string | null };

const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : def);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function parseAiConfig(value: unknown): AiConfig {
  const v = (value ?? {}) as Record<string, unknown>;
  const notice = (v.riskNotice ?? {}) as Record<string, unknown>;
  return {
    apiKeyEncrypted: str(v.apiKeyEncrypted),
    defaultModel: isAiModelId(v.defaultModel) ? v.defaultModel : DEFAULT_MODEL,
    qualityModel: isAiModelId(v.qualityModel) ? v.qualityModel : QUALITY_MODEL,
    monthlyCapEur: num(v.monthlyCapEur, DEFAULT_MONTHLY_CAP_EUR),
    perUserDailyLimit: Math.round(num(v.perUserDailyLimit, DEFAULT_PER_USER_DAILY_LIMIT)),
    riskNotice: { casino: str(notice.casino) ?? DEFAULT_RISK_NOTICE.casino, sports: str(notice.sports) ?? DEFAULT_RISK_NOTICE.sports },
    verifiedAt: str(v.verifiedAt),
    lastError: str(v.lastError),
  };
}

export async function loadAiConfig(): Promise<AiConfig> {
  const row = await prisma.setting.findUnique({ where: { key: AI_CONFIG_KEY } });
  return parseAiConfig(row?.value);
}

export async function loadAiConfigState(): Promise<AiConfigState> {
  const { apiKeyEncrypted, ...rest } = await loadAiConfig();
  let keyHint: string | null = null;
  if (apiKeyEncrypted) {
    try {
      const key = decrypt(apiKeyEncrypted);
      keyHint = `${key.slice(0, 7)}…${key.slice(-4)}`;
    } catch {
      keyHint = "(illisible : recollez la clé)";
    }
  }
  return { ...rest, hasKey: Boolean(apiKeyEncrypted), keyHint };
}

export async function saveAiConfig(patch: Partial<AiConfig> & { apiKey?: string | null }): Promise<void> {
  const current = await loadAiConfig();
  const { apiKey, ...rest } = patch;
  const next: AiConfig = { ...current, ...rest };
  if (apiKey) {
    next.apiKeyEncrypted = encrypt(apiKey.trim());
    next.verifiedAt = null;
    next.lastError = null;
  }
  await prisma.setting.upsert({ where: { key: AI_CONFIG_KEY }, create: { key: AI_CONFIG_KEY, value: toJsonValue(next) }, update: { value: toJsonValue(next) } });
}

/** Clé en clair pour un appel (null si absente ou illisible). Ne jamais la journaliser. */
export async function loadAiApiKey(config?: AiConfig): Promise<string | null> {
  const c = config ?? (await loadAiConfig());
  if (!c.apiKeyEncrypted) return null;
  try {
    return decrypt(c.apiKeyEncrypted);
  } catch {
    return null;
  }
}
