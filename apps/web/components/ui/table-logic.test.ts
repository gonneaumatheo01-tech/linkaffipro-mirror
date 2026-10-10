import { describe, expect, it } from "vitest";
import {
  NO_SCROLL,
  horizontalScrollState,
  sameScrollState,
  scrollRegionLabel,
} from "./table-logic";

describe("défilement horizontal des tableaux", () => {
  it("ne signale rien quand le tableau tient dans sa largeur", () => {
    expect(horizontalScrollState({ scrollLeft: 0, scrollWidth: 800, clientWidth: 800 })).toEqual(
      NO_SCROLL,
    );
    // Un pixel d'écart (arrondi du navigateur) ne compte pas.
    expect(horizontalScrollState({ scrollLeft: 0, scrollWidth: 801, clientWidth: 800 })).toEqual(
      NO_SCROLL,
    );
  });

  it("détecte un débordement, le début, le milieu et la fin", () => {
    expect(horizontalScrollState({ scrollLeft: 0, scrollWidth: 1200, clientWidth: 800 })).toEqual({
      overflowing: true,
      atStart: true,
      atEnd: false,
    });
    expect(horizontalScrollState({ scrollLeft: 200, scrollWidth: 1200, clientWidth: 800 })).toEqual(
      { overflowing: true, atStart: false, atEnd: false },
    );
    expect(
      horizontalScrollState({ scrollLeft: 399.5, scrollWidth: 1200, clientWidth: 800 }),
    ).toEqual({ overflowing: true, atStart: false, atEnd: true });
  });

  it("accepte un scrollLeft négatif (sens de lecture inversé)", () => {
    expect(
      horizontalScrollState({ scrollLeft: -400, scrollWidth: 1200, clientWidth: 800 }).atEnd,
    ).toBe(true);
  });

  it("compare deux états", () => {
    expect(sameScrollState(NO_SCROLL, { ...NO_SCROLL })).toBe(true);
    expect(sameScrollState(NO_SCROLL, { overflowing: true, atStart: true, atEnd: false })).toBe(
      false,
    );
  });

  it("nomme la zone défilante avec la légende du tableau", () => {
    expect(scrollRegionLabel("Campagnes actives")).toBe(
      "Campagnes actives (faites défiler horizontalement)",
    );
    expect(scrollRegionLabel("  ")).toBe("Tableau (faites défiler horizontalement)");
    expect(scrollRegionLabel(undefined)).toBe("Tableau (faites défiler horizontalement)");
  });
});
