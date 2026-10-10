import { describe, expect, it } from "vitest";
import { groupImportErrors, ignoredRows, importErrorLines } from "./import-report";

describe("rapport d'un import CSV", () => {
  it("ne garde que les lignes de texte", () => {
    expect(importErrorLines(["a", 3, null, "b"])).toEqual(["a", "b"]);
    expect(importErrorLines(null)).toEqual([]);
    expect(importErrorLines({ x: 1 })).toEqual([]);
  });

  it("regroupe les lignes ignorées par raison, la plus fréquente d'abord", () => {
    expect(
      groupImportErrors([
        "Ligne 3 : montant illisible « abc »",
        "Ligne 4 : date illisible « n/a »",
        "Ligne 9 : date illisible « 32/13/2026 »",
        "Ligne 12 : date illisible",
        "Pub inconnue",
      ]),
    ).toEqual([
      { reason: "date illisible", count: 3 },
      { reason: "montant illisible", count: 1 },
      { reason: "erreur à l'enregistrement", count: 1 },
    ]);
    expect(groupImportErrors([])).toEqual([]);
  });

  it("lignes ignorées, jamais négatives", () => {
    expect(ignoredRows({ rows: 40, imported: 37 })).toBe(3);
    expect(ignoredRows({ rows: 2, imported: 5 })).toBe(0);
  });
});
