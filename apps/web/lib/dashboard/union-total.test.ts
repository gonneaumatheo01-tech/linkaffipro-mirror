import { describe, expect, it } from "vitest";
import { EMPTY_TOTALS, addTotals, type StatTotals } from "./metrics";
import { dimensionDaily, unionDaily, unionTotal } from "./union-total";

const t = (registrations: number, spend = 0): StatTotals => ({
  ...EMPTY_TOTALS,
  registrations,
  spend,
});

describe("total « toutes campagnes » jour par jour", () => {
  it("prend la ligne sans doublon les jours où elle existe, la somme des campagnes les autres jours", () => {
    // Recalcul horaire (3 jours) passé : la ligne « campaigns » n'existe que pour les jours récents.
    const a = new Map([
      ["2026-09-20", t(5, 10)],
      ["2026-10-08", t(1, 2)],
    ]);
    const b = new Map([["2026-10-08", t(1, 3)]]); // même joueur sans clic, offre partagée
    const union = new Map([["2026-10-08", t(1, 5)]]);
    expect(unionTotal(union, [a, b])).toEqual(t(6, 15));
  });
  it("sans aucune ligne sans doublon : somme des lignes", () => {
    expect(
      unionTotal(undefined, [new Map([["2026-10-01", t(2)]]), new Map([["2026-10-01", t(3)]])]),
    ).toEqual(t(5));
  });
  it("aucune ligne : zéro", () => {
    expect(unionTotal(new Map(), [])).toEqual(EMPTY_TOTALS);
  });
});

describe("total « toutes campagnes » : série jour par jour (graphique de la page Pubs)", () => {
  it("même règle chaque jour, et la somme des jours est le total", () => {
    const a = new Map([
      ["2026-10-06", t(5, 10)],
      ["2026-10-08", t(1, 2)],
    ]);
    const b = new Map([["2026-10-08", t(1, 3)]]);
    const union = new Map([["2026-10-08", t(1, 5)]]);
    const keys = ["2026-10-06", "2026-10-07", "2026-10-08"];
    const days = unionDaily(keys, union, [a, b]);
    expect(days).toEqual([t(5, 10), EMPTY_TOTALS, t(1, 5)]);
    const sum = days.reduce((acc, d) => addTotals(acc, d), EMPTY_TOTALS);
    expect(sum).toEqual(unionTotal(union, [a, b]));
  });

  it("une campagne seule : sa propre série, zéro les jours sans ligne", () => {
    const a = new Map([["2026-10-07", t(2, 4)]]);
    expect(dimensionDaily(["2026-10-06", "2026-10-07"], a)).toEqual([EMPTY_TOTALS, t(2, 4)]);
    expect(dimensionDaily(["2026-10-06"], undefined)).toEqual([EMPTY_TOTALS]);
  });
});
