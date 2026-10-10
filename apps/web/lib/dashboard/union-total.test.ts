import { describe, expect, it } from "vitest";
import { EMPTY_TOTALS, type StatTotals } from "./metrics";
import { unionTotal } from "./union-total";

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
