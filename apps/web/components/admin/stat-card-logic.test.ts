import { describe, expect, it } from "vitest";
import { formatVariation, sparklinePath, variationSummary, variationTone } from "./stat-card-logic";

describe("variation d'une carte de chiffre", () => {
  it("affiche le signe, une décimale au plus et le symbole %", () => {
    expect(formatVariation(12.5)).toBe("+12,5 %");
    expect(formatVariation(-3)).toBe("−3 %");
    expect(formatVariation(0)).toBe("0 %");
    expect(formatVariation(4.04)).toBe("+4 %");
    expect(formatVariation(0.25)).toBe("+0,3 %");
    // Au-delà de 100 % : pas de décimale, séparateur de milliers français.
    expect(formatVariation(1234.56).replace(/\u202f/g, " ")).toBe("+1 235 %");
    expect(formatVariation(null)).toBe("—");
    expect(formatVariation(undefined)).toBe("—");
    expect(formatVariation(Number.NaN)).toBe("—");
  });

  it("colore selon le sens favorable", () => {
    expect(variationTone(10, "up")).toBe("positive");
    expect(variationTone(-10, "up")).toBe("negative");
    // Coûts : une baisse est une bonne nouvelle.
    expect(variationTone(-10, "down")).toBe("positive");
    expect(variationTone(10, "down")).toBe("negative");
    // Neutre : aucune couleur.
    expect(variationTone(10, "none")).toBe("neutral");
    expect(variationTone(0, "up")).toBe("neutral");
    expect(variationTone(null, "up")).toBe("neutral");
    // Une variation qui s'arrondit à 0 n'est pas colorée.
    expect(variationTone(0.04, "up")).toBe("neutral");
  });

  it("résume la variation en une phrase pour les lecteurs d'écran", () => {
    expect(variationSummary(12.5, "vs hier")).toBe("En hausse de 12,5 % vs hier");
    expect(variationSummary(-3, "vs hier")).toBe("En baisse de 3 % vs hier");
    expect(variationSummary(0, "vs hier")).toBe("Stable vs hier");
    expect(variationSummary(null, "vs hier")).toBe("Pas de comparaison possible");
  });
});

describe("mini-courbe", () => {
  it("ne dessine rien avec moins de deux points", () => {
    expect(sparklinePath([], 100, 30)).toBeNull();
    expect(sparklinePath([5], 100, 30)).toBeNull();
  });

  it("place les points de gauche à droite, le plus haut en haut", () => {
    const p = sparklinePath([0, 10], 100, 30, 2)!;
    expect(p.line).toBe("M0,28L100,2");
    expect(p.area).toBe("M0,28L100,2L100,30L0,30Z");
    expect(p.last).toEqual({ x: 100, y: 2 });
  });

  it("gère les valeurs négatives et les séries plates", () => {
    const neg = sparklinePath([-10, 0, 10], 100, 30, 2)!;
    expect(neg.line).toBe("M0,28L50,15L100,2");
    const flat = sparklinePath([4, 4, 4], 100, 30, 2)!;
    expect(flat.line).toBe("M0,15L50,15L100,15");
  });

  it("ignore les valeurs non finies", () => {
    const p = sparklinePath([1, Number.NaN, 3], 100, 30, 2)!;
    expect(p.line).toBe("M0,28L100,2");
  });
});
