import { describe, expect, it } from "vitest";
import { adsExportCell, ambiguousCpaHeaders, exportDelta } from "./export-cells";

describe("cellules des exports", () => {
  it("retour sur dépense pub arrondi dans le fichier seulement (le calcul garde le rapport exact)", () => {
    expect(adsExportCell(2.336819, "ratio")).toBe("2.34");
    expect(adsExportCell(12.5, "money")).toBe("12.50");
    expect(adsExportCell(7, "number")).toBe(7);
    expect(adsExportCell(null, "ratio")).toBe("");
  });

  it("variation : vide sur une base négative (règle du site), gardée sinon", () => {
    expect(exportDelta(-179.9, -676)).toBeNull();
    expect(exportDelta(20, 100)).toBe(20);
    expect(exportDelta(null, 0)).toBeNull();
  });

  it("« (CPA, » ne doit désigner qu'une colonne : le coût par inscription", () => {
    expect(ambiguousCpaHeaders(["Coût par inscription (CPA, €)", "Gains (€)"])).toEqual([]);
    expect(
      ambiguousCpaHeaders(["Coût par inscription (CPA, €)", "Primes par joueur (CPA, €)"]),
    ).toHaveLength(2);
    expect(ambiguousCpaHeaders(["Primes (CPA, €)"])).toEqual(["Primes (CPA, €)"]);
  });
});
