// Modèles Venice : liste proposée dans les réglages, coût estimé d'un appel, longueur maximale, raisonnement
// (contrat docs/ASSISTANT-CONVERSATION.md § 2). Pur : travaille sur le cache `AssistantConfig.models`.
import type { LlmUsage, VeniceModelInfo } from "./types";

/** Taux USD → EUR constant (même constante que packages/ai ; la facture réelle est en dollars chez Venice). */
export const USD_TO_EUR = 0.92;

/** Prix retenus quand aucun prix n'est connu (dollars par million de jetons), par prudence. */
export const UNKNOWN_PRICE_USD_PER_M = { input: 2, output: 8 } as const;

/** Bornes de la longueur maximale d'une réponse (jetons). */
export const MAX_TOKENS_RANGE = { min: 64, max: 2000 } as const;

function totalPrice(m: VeniceModelInfo): number | null {
  if (m.inputUsdPerM === null || m.outputUsdPerM === null) return null;
  return m.inputUsdPerM + m.outputUsdPerM;
}

/**
 * Modèles proposés dans les listes des réglages : sortie JSON stricte possible, en ligne, non retirés ; du moins cher
 * au plus cher (prix d'entrée + prix de sortie), les modèles sans prix à la fin.
 */
export function selectableModels(models: readonly VeniceModelInfo[]): VeniceModelInfo[] {
  return models
    .filter((m) => m.supportsResponseSchema && !m.offline && !m.deprecated)
    .sort((a, b) => {
      const pa = totalPrice(a);
      const pb = totalPrice(b);
      if (pa === null && pb === null) return a.id.localeCompare(b.id);
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb || a.id.localeCompare(b.id);
    });
}

export function findModel(id: string, models: readonly VeniceModelInfo[]): VeniceModelInfo | null {
  return models.find((m) => m.id === id) ?? null;
}

/** Prix d'un modèle ; modèle absent ou sans prix : prix le plus élevé connu, à défaut 2 $ / 8 $ par million. */
export function modelPriceUsdPerM(
  modelId: string,
  models: readonly VeniceModelInfo[],
): { input: number; output: number } {
  const m = findModel(modelId, models);
  if (m && m.inputUsdPerM !== null && m.outputUsdPerM !== null)
    return { input: m.inputUsdPerM, output: m.outputUsdPerM };
  const inputs = models.map((x) => x.inputUsdPerM).filter((x): x is number => x !== null);
  const outputs = models.map((x) => x.outputUsdPerM).filter((x): x is number => x !== null);
  return {
    input: m?.inputUsdPerM ?? (inputs.length ? Math.max(...inputs) : UNKNOWN_PRICE_USD_PER_M.input),
    output:
      m?.outputUsdPerM ?? (outputs.length ? Math.max(...outputs) : UNKNOWN_PRICE_USD_PER_M.output),
  };
}

/**
 * Coût estimé d'un appel en euros, arrondi à 4 décimales : coût renvoyé par Venice s'il existe (`cost.usd` +
 * `cost.diem`, voir `completionCostUsd`), sinon jetons × prix du modèle (prix le plus élevé connu pour un modèle sans
 * prix). Un coût renvoyé à 0 alors que des jetons ont été consommés (part payée autrement, champ manquant) n'est pas
 * cru : le prix des jetons est compté, pour que le plafond mensuel protège toujours.
 */
export function estimateCostEur(
  modelId: string,
  usage: LlmUsage,
  costUsd: number | null | undefined,
  models: readonly VeniceModelInfo[],
): number {
  const input = Math.max(0, usage.inputTokens || 0);
  const output = Math.max(0, usage.outputTokens || 0);
  const reported =
    typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0 ? costUsd : null;
  let usd: number;
  if (reported !== null && (reported > 0 || input + output === 0)) usd = reported;
  else {
    const price = modelPriceUsdPerM(modelId, models);
    usd = (input * price.input + output * price.output) / 1_000_000;
  }
  return Math.round(usd * USD_TO_EUR * 10_000) / 10_000;
}

/** Longueur maximale d'une réponse : entier entre 64 et 2000, et jamais au-delà de ce que le modèle accepte. */
export function clampMaxTokens(maxTokens: number, model?: VeniceModelInfo | null): number {
  const n = Number.isFinite(maxTokens) ? Math.round(maxTokens) : MAX_TOKENS_RANGE.min;
  let out = Math.min(MAX_TOKENS_RANGE.max, Math.max(MAX_TOKENS_RANGE.min, n));
  const cap = model?.maxCompletionTokens;
  if (typeof cap === "number" && cap > 0) out = Math.min(out, cap);
  return out;
}

/** Le modèle raisonne-t-il (on lui demande alors de ne pas le faire : `reasoning: { enabled: false }`) ? */
export function modelSupportsReasoning(id: string, models: readonly VeniceModelInfo[]): boolean {
  return findModel(id, models)?.supportsReasoning ?? false;
}
