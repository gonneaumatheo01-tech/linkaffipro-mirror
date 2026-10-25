import type { AiUsage } from "./types";

/**
 * Modèles proposés et prix publics (platform.claude.com, 10 octobre 2026), en dollars par million de jetons.
 * Lecture de cache à 10 % du prix d'entrée, écriture de cache à 125 %.
 */
export const AI_MODELS = {
  "claude-haiku-5-5": { label: "Claude Haiku 5.5 — rapide et économique", inputUsdPerM: 0.1, outputUsdPerM: 0.5 },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5 — qualité supérieure", inputUsdPerM: 2, outputUsdPerM: 10 },
} as const;
export type AiModelId = keyof typeof AI_MODELS;
export const AI_MODEL_IDS = Object.keys(AI_MODELS) as AiModelId[];
export const DEFAULT_MODEL: AiModelId = "claude-haiku-5-5";
export const QUALITY_MODEL: AiModelId = "claude-sonnet-5-5";
/**
 * Phase 33 : planificateur des ordres de Kevin (raisonnement sur plusieurs contraintes). Hors de la liste proposée dans
 * Réglages → IA (réservé à cette tâche), mais connu du calcul de coût.
 */
export const PLANNER_MODEL = "claude-opus-5-5";
const INTERNAL_MODEL_PRICES: Record<string, { inputUsdPerM: number; outputUsdPerM: number }> = {
  [PLANNER_MODEL]: { inputUsdPerM: 4, outputUsdPerM: 20 },
};

/** Taux USD → EUR constant (estimation ; la facture réelle est en dollars chez Anthropic). */
export const USD_TO_EUR = 0.92;

export function isAiModelId(v: unknown): v is AiModelId {
  return typeof v === "string" && v in AI_MODELS;
}

/** Coût estimé en euros, arrondi à 4 décimales. Modèle inconnu : tarif le plus élevé connu, Opus (prudence). */
export function estimateCostEur(model: string, usage: AiUsage): number {
  const price = isAiModelId(model) ? AI_MODELS[model] : (INTERNAL_MODEL_PRICES[model] ?? INTERNAL_MODEL_PRICES[PLANNER_MODEL]!);
  const usd =
    (usage.inputTokens * price.inputUsdPerM +
      usage.cacheWriteTokens * price.inputUsdPerM * 1.25 +
      usage.cachedTokens * price.inputUsdPerM * 0.1 +
      usage.outputTokens * price.outputUsdPerM) /
    1_000_000;
  return Math.round(usd * USD_TO_EUR * 10_000) / 10_000;
}
