import { describe, expect, it } from "vitest";
import {
  formatVariation,
  hasTrend,
  nothingBefore,
  sparklinePath,
  trendOrNone,
  variationArrow,
  variationBetween,
  variationLabel,
  variationSentence,
  variationSummary,
  variationTone,
  variationToneOf,
} from "./stat-card-logic";

describe("variation d'après la valeur et sa base (règle unique « nouveau »)", () => {
  it("base nulle et valeur non nulle : « nouveau », jamais « > +999 % »", () => {
    const v = variationBetween(12, 0);
    expect(v).toEqual({ kind: "new", direction: "up" });
    expect(variationLabel(v)).toBe("nouveau");
    expect(variationSentence(v, "vs hier")).toBe("Nouveau : rien hier");
    expect(variationLabel(variationBetween(323, 0))).not.toContain("999");
    // Une perte qui apparaît (gains négatifs) : « nouveau » aussi, vers le bas.
    expect(variationBetween(-50, 0)).toEqual({ kind: "new", direction: "down" });
  });

  it("les deux nuls : rien à afficher (ni « 0 % », ni « Stable »)", () => {
    const v = variationBetween(0, 0);
    expect(v).toEqual({ kind: "none" });
    expect(variationLabel(v)).toBe("");
    expect(variationSentence(v, "vs hier")).toBe("");
    expect(variationToneOf(v, "up")).toBe("neutral");
    expect(variationArrow(v)).toBeNull();
  });

  it("une base de moins d'un demi-centime compte comme nulle (affichée « 0 € »)", () => {
    expect(variationBetween(40, 0.003).kind).toBe("new");
    expect(variationBetween(0.004, 0).kind).toBe("none");
    expect(variationBetween(-0.001, 0.002).kind).toBe("none");
  });

  it("base non nulle : pourcentage, plafonné à ±999 % à l'affichage", () => {
    expect(variationBetween(150, 100)).toEqual({ kind: "pct", pct: 50 });
    expect(variationLabel(variationBetween(150, 100))).toBe("+50 %");
    expect(variationLabel(variationBetween(5, 5))).toBe("0 %");
    expect(variationSentence(variationBetween(5, 5), "vs hier")).toBe("Stable vs hier");
    // Base petite mais non nulle : le plafond s'applique.
    expect(variationLabel(variationBetween(323, 0.5))).toBe("> +999 %");
    expect(variationSentence(variationBetween(323, 0.5), "vs hier")).toBe(
      "En hausse de plus de 999 % vs hier",
    );
    // Base négative : calcul sur la valeur absolue (de −50 € à +20 € = une hausse).
    expect(variationBetween(20, -50)).toEqual({ kind: "pct", pct: 140 });
  });

  it("pourcentage déjà calculé par la page : repris tel quel, null = pas de comparaison", () => {
    expect(variationBetween(323, -1.74, null)).toEqual({ kind: "unknown" });
    expect(variationBetween(120, 100, 20)).toEqual({ kind: "pct", pct: 20 });
    // La base nulle prime sur le pourcentage donné (deltaPct renvoie null ou 0 dans ces cas).
    expect(variationBetween(8, 0, null)).toEqual({ kind: "new", direction: "up" });
    expect(variationBetween(0, 0, 0)).toEqual({ kind: "none" });
  });

  it("valeur ou base absente : pas de comparaison possible", () => {
    for (const v of [
      variationBetween(null, 3),
      variationBetween(3, undefined),
      variationBetween(Number.NaN, 3),
      variationBetween(3, Number.POSITIVE_INFINITY),
    ]) {
      expect(v).toEqual({ kind: "unknown" });
      expect(variationLabel(v)).toBe("—");
      expect(variationSentence(v, "vs hier")).toBe("Pas de comparaison possible");
      expect(variationArrow(v)).toBeNull();
    }
  });

  it("couleur et flèche : « nouveau » suit le sens favorable comme un pourcentage", () => {
    expect(variationToneOf(variationBetween(12, 0), "up")).toBe("positive");
    expect(variationToneOf(variationBetween(-50, 0), "up")).toBe("negative");
    // Une dépense qui apparaît est un coût : en rouge.
    expect(variationToneOf(variationBetween(50, 0), "down")).toBe("negative");
    expect(variationToneOf(variationBetween(12, 0), "none")).toBe("neutral");
    expect(variationToneOf(variationBetween(90, 100), "down")).toBe("positive");
    expect(variationArrow(variationBetween(12, 0))).toBe("up");
    expect(variationArrow(variationBetween(-50, 0))).toBe("down");
    expect(variationArrow(variationBetween(90, 100))).toBe("down");
    expect(variationArrow(variationBetween(5, 5))).toBe("flat");
  });

  it("« rien … » d'après la fin de phrase de la comparaison", () => {
    expect(nothingBefore("vs hier")).toBe("rien hier");
    expect(nothingBefore("vs hier à la même heure")).toBe("rien hier à la même heure");
    expect(nothingBefore("vs période précédente")).toBe("rien la période précédente");
    expect(nothingBefore("vs la semaine dernière")).toBe("rien la semaine dernière");
    expect(nothingBefore("vs les 7 jours précédents")).toBe("rien les 7 jours précédents");
    expect(nothingBefore("")).toBe("rien avant");
    expect(variationSentence(variationBetween(3, 0), "vs période précédente")).toBe(
      "Nouveau : rien la période précédente",
    );
    expect(variationSentence(variationBetween(3, 0), "")).toBe("Nouveau : rien avant");
  });
});

describe("variation d'une carte de chiffre", () => {
  it("affiche le signe, une décimale au plus et le symbole %", () => {
    expect(formatVariation(12.5)).toBe("+12,5 %");
    expect(formatVariation(-3)).toBe("−3 %");
    expect(formatVariation(0)).toBe("0 %");
    expect(formatVariation(4.04)).toBe("+4 %");
    expect(formatVariation(0.25)).toBe("+0,3 %");
    // Au-delà de 100 % : pas de décimale.
    expect(formatVariation(345.6)).toBe("+346 %");
    expect(formatVariation(-100)).toBe("−100 %");
    expect(formatVariation(null)).toBe("—");
    expect(formatVariation(undefined)).toBe("—");
    expect(formatVariation(Number.NaN)).toBe("—");
  });

  it("plafonne l'affichage au-delà de 999 % (le calcul ne change pas)", () => {
    expect(formatVariation(999)).toBe("+999 %");
    expect(formatVariation(999.4)).toBe("+999 %");
    expect(formatVariation(999.6)).toBe("> +999 %");
    expect(formatVariation(1234.56)).toBe("> +999 %");
    expect(formatVariation(18661)).toBe("> +999 %");
    expect(formatVariation(-999)).toBe("−999 %");
    expect(formatVariation(-1500)).toBe("< −999 %");
    // La couleur suit toujours le sens.
    expect(variationTone(18661, "up")).toBe("positive");
    expect(variationTone(-1500, "up")).toBe("negative");
    expect(variationTone(1500, "down")).toBe("negative");
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
    // Au-delà du plafond : la même borne que l'affichage.
    expect(variationSummary(18661, "vs hier")).toBe("En hausse de plus de 999 % vs hier");
    expect(variationSummary(-1500, "vs la semaine d'avant")).toBe(
      "En baisse de plus de 999 % vs la semaine d'avant",
    );
    expect(variationSummary(999, "")).toBe("En hausse de 999 %");
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

  it("ne dessine rien quand toutes les valeurs sont nulles", () => {
    expect(sparklinePath([0, 0, 0, 0], 100, 30)).toBeNull();
    expect(sparklinePath([0, Number.NaN, 0], 100, 30)).toBeNull();
    // Une seule valeur non nulle suffit ; une série plate non nulle reste dessinée.
    expect(sparklinePath([0, 0, 3], 100, 30)).not.toBeNull();
    expect(sparklinePath([4, 4], 100, 30)).not.toBeNull();
  });
});

describe("règle de la mini-courbe (hasTrend, trendOrNone)", () => {
  it("demande deux valeurs au moins, dont une non nulle", () => {
    expect(hasTrend([0, 0, 0])).toBe(false);
    expect(hasTrend([4])).toBe(false);
    expect(hasTrend([])).toBe(false);
    expect(hasTrend(undefined)).toBe(false);
    expect(hasTrend(null)).toBe(false);
    expect(hasTrend([0, 1])).toBe(true);
    expect(hasTrend([-3, 0])).toBe(true);
    expect(hasTrend([Number.NaN, 2])).toBe(false);
  });

  it("rend la série (copie) ou rien", () => {
    expect(trendOrNone([0, 0, 0, 0])).toBeUndefined();
    expect(trendOrNone([])).toBeUndefined();
    expect(trendOrNone(null)).toBeUndefined();
    const src = [0, 2, 0];
    const out = trendOrNone(src);
    expect(out).toEqual([0, 2, 0]);
    expect(out).not.toBe(src);
    expect(trendOrNone([0, -1])).toEqual([0, -1]);
  });
});
