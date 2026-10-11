import { describe, expect, it } from "vitest";
import { barListLayout, barTone } from "./bar-list-logic";

describe("barListLayout", () => {
  it("garde la grille des Statistiques quand les valeurs ont une précision", () => {
    expect(barListLayout("wide", true)).toEqual({
      columns: "md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,15rem)]",
      valueAlign: "md:text-left",
    });
  });

  it("sans précision, la colonne des valeurs prend juste la place des chiffres, alignés à droite", () => {
    const l = barListLayout("wide", false);
    expect(l.columns).toMatch(/_auto\]$/);
    expect(l.valueAlign).toBe("");
  });

  it("colonne des noms étroite pour « Version A » / « Version B »", () => {
    expect(barListLayout("narrow", false).columns).toBe("md:grid-cols-[6rem_minmax(0,1fr)_auto]");
    expect(barListLayout("narrow", true).columns).toBe(
      "md:grid-cols-[6rem_minmax(0,1fr)_minmax(0,15rem)]",
    );
  });
});

describe("barTone", () => {
  it("toutes les barres orange sans mise en avant", () => {
    expect(barTone(undefined, false)).toBe("brand");
    expect(barTone(false, false)).toBe("brand");
  });

  it("le gagnant reste orange, les autres passent en gris", () => {
    expect(barTone(true, true)).toBe("brand");
    expect(barTone(false, true)).toBe("muted");
    expect(barTone(undefined, true)).toBe("muted");
  });
});
