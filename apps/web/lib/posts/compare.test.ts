import { describe, expect, it } from "vitest";
import { withAverages, type CategoryTotals } from "./category-stats";
import { abMetricRows, rankCategories, toCategoryMeasure } from "./compare";

describe("graphique du test A/B", () => {
  const a = { variant: "A", views: 0, clicks: 9, uniqueClickers: 3, registrations: 1, ftds: 0 };
  const b = { variant: "B", views: 0, clicks: 4, uniqueClickers: 4, registrations: 1, ftds: 0 };
  it("mesures dans l'ordre, version en tête par mesure, égalité et zéro sans meneur", () => {
    const rows = abMetricRows([a, b]);
    expect(rows.map((r) => r.key)).toEqual(["uniqueClickers", "clicks", "registrations", "ftds"]);
    expect(rows.find((r) => r.key === "uniqueClickers")?.leader).toBe("B");
    expect(rows.find((r) => r.key === "clicks")?.leader).toBe("A");
    expect(rows.find((r) => r.key === "registrations")?.leader).toBeNull();
    expect(rows.find((r) => r.key === "ftds")?.leader).toBeNull();
    expect(rows.find((r) => r.key === "ftds")?.term).toBe("FTD");
  });
  it("taux de clic seulement quand toutes les versions ont des vues", () => {
    const rows = abMetricRows([
      { ...a, views: 100 },
      { ...b, views: 50 },
    ]);
    const ctr = rows.find((r) => r.key === "ctr");
    expect(ctr?.values).toEqual([
      { variant: "A", value: 0.03 },
      { variant: "B", value: 0.08 },
    ]);
    expect(ctr?.leader).toBe("B");
    expect(abMetricRows([{ ...a, views: 100 }, b]).some((r) => r.key === "ctr")).toBe(false);
  });
});

describe("graphique par catégorie", () => {
  const t = (name: string, posts: number, clicks: number, ftds = 0): CategoryTotals => ({
    categoryId: name,
    name,
    color: "#000000",
    posts,
    clicks,
    uniqueClickers: 0,
    offerClicks: 0,
    reactions: 0,
    registrations: 0,
    ftds,
    deposits: 0,
    depositAmount: 0,
  });
  it("classe par moyenne par message et écarte les catégories sans message", () => {
    const rows = withAverages([t("Bonus", 2, 10), t("Rappel", 4, 8, 2), t("Vide", 0, 0)]);
    expect(rankCategories(rows, "clicks").map((r) => r.name)).toEqual(["Bonus", "Rappel"]);
    expect(rankCategories(rows, "ftds").map((r) => r.name)).toEqual(["Rappel", "Bonus"]);
  });
  it("mesure inconnue : clics par message", () => {
    expect(toCategoryMeasure("ftds")).toBe("ftds");
    expect(toCategoryMeasure("n'importe")).toBe("clicks");
  });
});
