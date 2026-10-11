import { describe, expect, it } from "vitest";
import {
  areaPath,
  axisMargin,
  barPath,
  barPercent,
  barWidth,
  chartAltText,
  closesOnPointerLeave,
  fmtTimes,
  formatAxis,
  formatValue,
  hasData,
  linePath,
  nearestIndex,
  niceStep,
  niceTicks,
  plotBox,
  seriesPoints,
  seriesSummary,
  tooltipLeft,
  xAt,
  xLabelIndices,
  yAt,
} from "./chart-logic";

/** Espaces français (insécable, fine insécable) remplacées par une espace simple, pour lire les attentes. */
const sp = (s: string) => s.replace(/[  ]/g, " ");

describe("échelle verticale", () => {
  it("pas ronds : 1, 2, 2,5, 5 × 10ⁿ", () => {
    expect(niceStep(10, 4)).toBe(2.5);
    expect(niceStep(100, 4)).toBe(25);
    expect(niceStep(7, 4)).toBe(2);
    expect(niceStep(1000, 4)).toBe(250);
    expect(niceStep(0.9, 4)).toBe(0.25);
    expect(niceStep(0, 4)).toBe(1);
  });

  it("comptes : jamais de pas décimal ni de 2,5", () => {
    expect(niceStep(3, 4, true)).toBe(1);
    expect(niceStep(10, 4, true)).toBe(5);
    expect(niceStep(100, 4, true)).toBe(25);
  });

  it("le zéro est toujours compris, les bornes tombent sur le pas", () => {
    expect(niceTicks([3, 7, 12])).toEqual({ min: 0, max: 15, ticks: [0, 5, 10, 15] });
    expect(niceTicks([120, 340, 980])).toEqual({
      min: 0,
      max: 1000,
      ticks: [0, 250, 500, 750, 1000],
    });
  });

  it("valeurs négatives : l'axe descend sous zéro", () => {
    const t = niceTicks([-30, 10, 45]);
    expect(t.min).toBeLessThan(0);
    expect(t.ticks).toContain(0);
    expect(t.min).toBeLessThanOrEqual(-30);
    expect(t.max).toBeGreaterThanOrEqual(45);
  });

  it("série nulle, vide ou non finie : de 0 à 1", () => {
    expect(niceTicks([0, 0, 0], 4, true)).toEqual({ min: 0, max: 1, ticks: [0, 1] });
    expect(niceTicks([])).toEqual({ min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] });
    expect(niceTicks([Number.NaN, Infinity], 4, true).ticks).toEqual([0, 1]);
  });

  it("pas de flottants parasites (0,1 + 0,2)", () => {
    const t = niceTicks([0.3]);
    for (const v of t.ticks) expect(String(v).length).toBeLessThan(6);
  });
});

describe("positions et tracés", () => {
  const box = plotBox(200, 100, { left: 40, right: 10, top: 10, bottom: 20 });

  it("zone de tracé sans les marges", () => {
    expect(box).toEqual({ left: 40, right: 190, top: 10, bottom: 80 });
    expect(plotBox(20, 10, { left: 40, right: 10, top: 10, bottom: 20 })).toEqual({
      left: 20,
      right: 20,
      top: 10,
      bottom: 10,
    });
  });

  it("courbe : du bord gauche au bord droit ; barres : au milieu de chaque bande ; un point seul au milieu", () => {
    expect(xAt(0, 3, box)).toBe(40);
    expect(xAt(2, 3, box)).toBe(190);
    expect(xAt(0, 1, box)).toBe(115);
    expect(xAt(0, 3, box, "band")).toBe(65);
    expect(xAt(2, 3, box, "band")).toBe(165);
  });

  it("la valeur la plus haute en haut, le minimum en bas", () => {
    const t = { min: 0, max: 10, ticks: [0, 10] };
    expect(yAt(10, t, box)).toBe(10);
    expect(yAt(0, t, box)).toBe(80);
    expect(yAt(5, t, box)).toBe(45);
  });

  it("points, courbe et surface d'une série", () => {
    const t = { min: 0, max: 10, ticks: [0, 10] };
    const pts = seriesPoints([0, 10, 5], t, box);
    expect(pts).toEqual([
      { x: 40, y: 80 },
      { x: 115, y: 10 },
      { x: 190, y: 45 },
    ]);
    expect(linePath(pts)).toBe("M40,80L115,10L190,45");
    expect(areaPath(pts, 80)).toBe("M40,80L115,10L190,45L190,80L40,80Z");
    expect(linePath(pts.slice(0, 1))).toBe("");
    expect(areaPath([], 80)).toBe("");
    // Une valeur absente compte comme zéro (pas de trou qui casse le tracé).
    expect(seriesPoints([Number.NaN], t, box)).toEqual([{ x: 115, y: 80 }]);
  });

  it("barres : 70 % de la bande, entre 2 et 24 px", () => {
    expect(barWidth(10)).toBe(7);
    expect(barWidth(100)).toBe(24);
    expect(barWidth(1)).toBe(2);
  });

  it("barre positive arrondie en haut, négative arrondie en bas, nulle absente", () => {
    const up = barPath(50, 10, 80, 20);
    expect(up.startsWith("M45,80V24Q45,20 49,20H51Q55,20 55,24V80Z")).toBe(true);
    const down = barPath(50, 10, 40, 70);
    expect(down).toBe("M45,40V66Q45,70 49,70H51Q55,70 55,66V40Z");
    expect(barPath(50, 10, 80, 80)).toBe("");
    // Barre plus basse que l'arrondi : arrondi réduit à sa hauteur.
    expect(barPath(50, 10, 80, 78)).toContain("Q45,78 47,78");
  });
});

describe("axe horizontal, réticule et bulle", () => {
  const box = { left: 0, right: 100, top: 0, bottom: 50 };

  it("libellés : tous s'il y a la place, sinon régulièrement espacés avec le premier et le dernier", () => {
    expect(xLabelIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
    expect(xLabelIndices(30, 6)).toEqual([0, 6, 12, 18, 24, 29]);
    const ninety = xLabelIndices(90, 8);
    expect(ninety[0]).toBe(0);
    expect(ninety[ninety.length - 1]).toBe(89);
    expect(ninety.length).toBeLessThanOrEqual(8);
    expect(xLabelIndices(0, 5)).toEqual([]);
    expect(xLabelIndices(7, 1)).toEqual([6]);
  });

  it("le dernier libellé ne colle pas à l'avant-dernier", () => {
    const idx = xLabelIndices(10, 4); // pas de 3 : 0, 3, 6, puis 9
    expect(idx).toEqual([0, 3, 6, 9]);
    const close = xLabelIndices(8, 4); // pas de 3 : 0, 3, 6 ; 7 trop près de 6
    expect(close).toEqual([0, 3, 7]);
  });

  it("valeur la plus proche du pointeur, bornée", () => {
    expect(nearestIndex(0, 5, box)).toBe(0);
    expect(nearestIndex(60, 5, box)).toBe(2);
    expect(nearestIndex(64, 5, box)).toBe(3);
    expect(nearestIndex(500, 5, box)).toBe(4);
    expect(nearestIndex(-20, 5, box)).toBe(0);
    expect(nearestIndex(55, 4, box, "band")).toBe(2);
    expect(nearestIndex(10, 1, box)).toBe(0);
  });

  it("la bulle reste après un appui du doigt : seule la souris qui sort du graphique la ferme", () => {
    expect(closesOnPointerLeave("mouse")).toBe(true);
    // Doigt levé : pointerup puis pointerleave ; la bulle reste jusqu'au prochain appui (ou ailleurs).
    expect(closesOnPointerLeave("touch")).toBe(false);
    expect(closesOnPointerLeave("pen")).toBe(false);
    expect(closesOnPointerLeave("")).toBe(false);
  });

  it("bulle à droite du réticule, à gauche près du bord, jamais hors du cadre", () => {
    expect(tooltipLeft(50, 100, 400)).toBe(62);
    expect(tooltipLeft(350, 100, 400)).toBe(238);
    expect(tooltipLeft(60, 100, 150)).toBe(50);
  });

  it("marge des graduations selon le plus long libellé", () => {
    expect(axisMargin(["0", "1 000 €"])).toBe(59);
    expect(axisMargin([])).toBe(10);
  });
});

describe("valeurs affichées", () => {
  it("rapport au format français, jamais avec un point", () => {
    expect(fmtTimes(1)).toBe("1,00×");
    expect(fmtTimes(1.8)).toBe("1,80×");
    expect(fmtTimes(null)).toBe("—");
    // Commissions négatives (annulations) : vrai signe moins, jamais « -0,45× » ni « −0,00× ».
    expect(fmtTimes(-0.45)).toBe("\u22120,45×");
    expect(fmtTimes(-0.001)).toBe("0,00×");
    expect(formatValue(2.456, "ratio")).toBe("2,46×");
  });

  it("nombres et montants à la française, vrai signe moins", () => {
    expect(sp(formatValue(1234, "number"))).toBe("1 234");
    expect(sp(formatValue(2.5, "number"))).toBe("2,5");
    expect(sp(formatValue(1234.5, "money"))).toBe("1 235 €");
    expect(sp(formatValue(42.5, "money"))).toBe("42,50 €");
    expect(sp(formatValue(-300, "money"))).toBe("−300 €");
    expect(formatValue(Number.NaN, "number")).toBe("—");
  });

  it("graduations compactes", () => {
    expect(sp(formatAxis(1200, "number"))).toBe("1 200");
    expect(sp(formatAxis(12_000, "number"))).toBe("12 k");
    expect(sp(formatAxis(1_500_000, "number"))).toBe("1,5 M");
    expect(sp(formatAxis(300, "money"))).toBe("300 €");
    expect(sp(formatAxis(-50, "money"))).toBe("−50 €");
    expect(sp(formatAxis(25_000, "money"))).toBe("25 k €");
    expect(formatAxis(1.5, "ratio")).toBe("1,5×");
  });
});

describe("texte alternatif", () => {
  const labels = ["4 oct.", "5 oct.", "6 oct."];

  it("total, plus haut et plus bas avec leur jour", () => {
    expect(
      sp(seriesSummary({ label: "Membres entrés", values: [10, 80, 2] }, labels, "number")),
    ).toBe(
      "Membres entrés : 92 au total ; le plus haut : 80 le 5 oct. ; le plus bas : 2 le 6 oct.",
    );
  });

  it("pas de total pour un rapport ; une seule valeur ; rien sur la période", () => {
    expect(seriesSummary({ label: "Retour", values: [1, 2] }, labels, "ratio")).toBe(
      "Retour : le plus haut : 2,00× le 5 oct. ; le plus bas : 1,00× le 4 oct.",
    );
    expect(
      seriesSummary({ label: "Semaine", values: [12] }, ["29 sept."], "number", { total: false }),
    ).toBe("Semaine : 12 le 29 sept.");
    expect(seriesSummary({ label: "Départs", values: [0, 0, 0] }, labels, "number")).toBe(
      "Départs : aucune valeur sur la période",
    );
  });

  it("titre, période et chaque série (la période précédente avec ses propres jours)", () => {
    const alt = sp(
      chartAltText(
        "Revenu net jour par jour",
        [
          { label: "Cette période", values: [10, 20, 0] },
          { label: "Période précédente", values: [5, 0, 0] },
        ],
        labels,
        "money",
        { period: "3 derniers jours", previousLabels: ["1 oct.", "2 oct.", "3 oct."] },
      ),
    );
    expect(alt).toBe(
      "Revenu net jour par jour, 3 derniers jours. Cette période : 30,00 € au total ; le plus haut : 20,00 € le 5 oct. ; le plus bas : 0,00 € le 6 oct. Période précédente : 5,00 € au total ; le plus haut : 5,00 € le 1 oct. ; le plus bas : 0,00 € le 2 oct.",
    );
  });

  it("y a-t-il quelque chose à montrer ?", () => {
    expect(hasData([{ values: [0, 0] }, { values: [0] }])).toBe(false);
    expect(hasData([{ values: [0, -2] }])).toBe(true);
  });
});

describe("barres horizontales", () => {
  it("longueur en % de la plus grande, petite valeur visible, zéro vide", () => {
    expect(barPercent(50, 200)).toBe(25);
    expect(barPercent(1, 10_000)).toBe(0.5);
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(300, 200)).toBe(100);
  });
});
