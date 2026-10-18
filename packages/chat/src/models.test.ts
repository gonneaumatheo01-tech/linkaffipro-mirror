import { describe, expect, it } from "vitest";
import type { VeniceModelInfo } from "./types";
import {
  USD_TO_EUR,
  clampMaxTokens,
  estimateCostEur,
  modelPriceUsdPerM,
  modelSupportsReasoning,
  selectableModels,
} from "./models";

function model(id: string, over: Partial<VeniceModelInfo> = {}): VeniceModelInfo {
  return {
    id,
    name: id,
    inputUsdPerM: 1,
    outputUsdPerM: 2,
    maxCompletionTokens: 4096,
    contextLength: 32768,
    supportsResponseSchema: true,
    supportsReasoning: false,
    uncensored: false,
    offline: false,
    deprecated: false,
    ...over,
  };
}

const models = [
  model("cher", { inputUsdPerM: 3, outputUsdPerM: 12 }),
  model("venice-uncensored-role-play", { inputUsdPerM: 0.5, outputUsdPerM: 2, uncensored: true }),
  model("sans-prix", { inputUsdPerM: null, outputUsdPerM: null }),
  model("hors-ligne", { offline: true, inputUsdPerM: 0.1, outputUsdPerM: 0.1 }),
  model("retire", { deprecated: true, inputUsdPerM: 0.1, outputUsdPerM: 0.1 }),
  model("sans-json", { supportsResponseSchema: false, inputUsdPerM: 0.1, outputUsdPerM: 0.1 }),
  model("raisonne", {
    supportsReasoning: true,
    inputUsdPerM: 1,
    outputUsdPerM: 4,
    maxCompletionTokens: 256,
  }),
  model("venice-uncensored-1-2", { inputUsdPerM: 0.2, outputUsdPerM: 0.9 }),
];

describe("modèles proposés dans les réglages", () => {
  it("sortie JSON stricte, en ligne, non retirés ; du moins cher au plus cher, sans prix à la fin", () => {
    expect(selectableModels(models).map((m) => m.id)).toEqual([
      "venice-uncensored-1-2",
      "venice-uncensored-role-play",
      "raisonne",
      "cher",
      "sans-prix",
    ]);
  });

  it("ne modifie pas la liste reçue", () => {
    const copy = [...models];
    selectableModels(models);
    expect(models).toEqual(copy);
  });
});

describe("coût estimé d'un appel", () => {
  it("cost.usd de Venice prioritaire (1 $ = 0,92 €, 4 décimales)", () => {
    expect(USD_TO_EUR).toBe(0.92);
    expect(
      estimateCostEur("cher", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, 0.01, models),
    ).toBe(0.0092);
    // Aucun jeton consommé : 0 est cru.
    expect(estimateCostEur("cher", { inputTokens: 0, outputTokens: 0 }, 0, models)).toBe(0);
  });

  it("coût renvoyé à 0 alors que des jetons ont été consommés : prix des jetons (le plafond protège)", () => {
    // Compte payé en DIEM sans `cost.diem` lu, ou champ manquant : 100 000 × 3 $ + 50 000 × 12 $ par million = 0,9 $
    // → 0,828 €.
    expect(estimateCostEur("cher", { inputTokens: 100_000, outputTokens: 50_000 }, 0, models)).toBe(
      0.828,
    );
  });

  it("sinon jetons × prix du modèle", () => {
    // 2 000 × 0,5 $ + 500 × 2 $ par million = 0,002 $ → 0,00184 € → 0,0018 €.
    expect(
      estimateCostEur(
        "venice-uncensored-role-play",
        { inputTokens: 2000, outputTokens: 500 },
        null,
        models,
      ),
    ).toBe(0.0018);
  });

  it("modèle sans prix ou inconnu : prix le plus élevé connu de la liste", () => {
    expect(modelPriceUsdPerM("sans-prix", models)).toEqual({ input: 3, output: 12 });
    expect(modelPriceUsdPerM("inconnu", models)).toEqual({ input: 3, output: 12 });
    // 1 M × 3 $ + 1 M × 12 $ = 15 $ → 13,8 €.
    expect(
      estimateCostEur(
        "inconnu",
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        undefined,
        models,
      ),
    ).toBe(13.8);
  });

  it("aucun prix connu : 2 $ en entrée et 8 $ en sortie par million", () => {
    expect(modelPriceUsdPerM("x", [])).toEqual({ input: 2, output: 8 });
    expect(estimateCostEur("x", { inputTokens: 1_000_000, outputTokens: 0 }, null, [])).toBe(1.84);
    expect(estimateCostEur("x", { inputTokens: 0, outputTokens: 1_000_000 }, Number.NaN, [])).toBe(
      7.36,
    );
  });
});

describe("longueur maximale et raisonnement", () => {
  it("entre 64 et 2000 jetons, jamais au-delà du maximum du modèle", () => {
    expect(clampMaxTokens(400, models[1])).toBe(400);
    expect(clampMaxTokens(10, null)).toBe(64);
    expect(clampMaxTokens(5000)).toBe(2000);
    expect(clampMaxTokens(400.6)).toBe(401);
    expect(clampMaxTokens(400, model("petit", { maxCompletionTokens: 256 }))).toBe(256);
    expect(clampMaxTokens(400, model("inconnu", { maxCompletionTokens: null }))).toBe(400);
    expect(clampMaxTokens(Number.NaN)).toBe(64);
  });

  it("raisonnement : d'après le cache, faux pour un modèle inconnu", () => {
    expect(modelSupportsReasoning("raisonne", models)).toBe(true);
    expect(modelSupportsReasoning("cher", models)).toBe(false);
    expect(modelSupportsReasoning("inconnu", models)).toBe(false);
  });
});
