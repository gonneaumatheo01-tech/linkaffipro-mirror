import { describe, expect, it } from "vitest";
import { FOCUSABLE_SELECTOR, scrollRegionLabel, scrollRegionNeedsFocus } from "./side-panel-logic";

describe("volet latéral : zone qui défile", () => {
  it("prend le focus seulement si elle défile et n'a rien de focalisable", () => {
    expect(
      scrollRegionNeedsFocus({ scrollHeight: 900, clientHeight: 600, hasFocusable: false }),
    ).toBe(true);
    // Un lien ou un bouton à l'intérieur suffit : la zone défile en suivant le focus.
    expect(
      scrollRegionNeedsFocus({ scrollHeight: 900, clientHeight: 600, hasFocusable: true }),
    ).toBe(false);
    // Pas de défilement : rien à faire (pas d'arrêt de tabulation inutile).
    expect(
      scrollRegionNeedsFocus({ scrollHeight: 600, clientHeight: 600, hasFocusable: false }),
    ).toBe(false);
    expect(
      scrollRegionNeedsFocus({ scrollHeight: 601, clientHeight: 600, hasFocusable: false }),
    ).toBe(false);
  });

  it("a un nom lu par les lecteurs d'écran", () => {
    expect(scrollRegionLabel("Léa M.")).toBe("Contenu : Léa M.");
    expect(scrollRegionLabel("  ")).toBe("Contenu du volet");
    expect(scrollRegionLabel({ type: "span" })).toBe("Contenu du volet");
    expect(scrollRegionLabel(undefined)).toBe("Contenu du volet");
  });

  it("reconnaît les éléments focalisables courants, pas les éléments désactivés ni tabindex=-1", () => {
    const parts = FOCUSABLE_SELECTOR.split(",");
    for (const s of [
      "a[href]",
      "button:not([disabled])",
      "summary",
      "[tabindex]:not([tabindex='-1'])",
    ])
      expect(parts).toContain(s);
    expect(parts).not.toContain("button");
    expect(parts).not.toContain("[tabindex]");
  });
});
