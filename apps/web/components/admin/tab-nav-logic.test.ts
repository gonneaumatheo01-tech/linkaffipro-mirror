import { describe, expect, it } from "vitest";
import {
  tabCount,
  tabItemClass,
  tabLinkClass,
  tabListClass,
  tabNavBorderClass,
  tabShortLabel,
} from "./tab-nav-logic";

const classes = (s: string) => s.split(/\s+/).filter(Boolean);

describe("tabLinkClass", () => {
  it("souligne l'onglet ouvert d'orange, sans jamais de fond orange plein (un seul bouton orange par écran)", () => {
    for (const phone of ["scroll", "grid"] as const) {
      const active = classes(tabLinkClass(phone, true));
      expect(active).toContain("border-brand");
      expect(active).toContain("font-semibold");
      expect(active).not.toContain("bg-brand");
      expect(active).not.toContain("bg-primary");
      expect(classes(tabLinkClass(phone, false))).not.toContain("border-brand");
    }
  });

  it("garde des cibles tactiles d'au moins 40 px sur téléphone", () => {
    expect(classes(tabLinkClass("scroll", false))).toContain("h-10");
    // Grille : boutons de 44 px, libellé sur deux lignes au besoin.
    expect(classes(tabLinkClass("grid", false))).toContain("min-h-11");
    expect(classes(tabLinkClass("grid", false))).not.toContain("whitespace-nowrap");
  });

  it("a toujours un focus visible", () => {
    for (const phone of ["scroll", "grid"] as const) {
      expect(classes(tabLinkClass(phone, false))).toEqual(
        expect.arrayContaining(["focus-visible:outline-2", "focus-visible:outline-solid"]),
      );
    }
  });

  it("dessine le même onglet souligné sur ordinateur dans les deux présentations", () => {
    const grid = classes(tabLinkClass("grid", true));
    expect(grid).toContain("md:border-b-2");
    expect(grid).toContain("md:bg-transparent");
    expect(classes(tabLinkClass("scroll", true))).toContain("border-b-2");
  });
});

describe("tabListClass", () => {
  it("rangée qui défile sur téléphone", () => {
    expect(classes(tabListClass("scroll"))).toEqual(
      expect.arrayContaining(["flex", "overflow-x-auto", "-mb-px"]),
    );
  });

  it("grille de 2 ou 3 colonnes sur téléphone, rangée qui défile sur ordinateur", () => {
    expect(classes(tabListClass("grid", 3))).toEqual(
      expect.arrayContaining(["grid", "grid-cols-3", "md:flex", "md:overflow-x-auto"]),
    );
    expect(classes(tabListClass("grid"))).toContain("grid-cols-2");
  });

  it("les éléments d'une rangée qui défile ne rétrécissent pas", () => {
    expect(classes(tabItemClass("scroll"))).toContain("shrink-0");
    expect(classes(tabItemClass("grid"))).toEqual(
      expect.arrayContaining(["min-w-0", "md:shrink-0"]),
    );
  });

  it("trait sous la barre : partout en rangée, seulement sur ordinateur en grille", () => {
    expect(classes(tabNavBorderClass("scroll"))).toContain("border-b");
    expect(classes(tabNavBorderClass("grid"))).toEqual(["md:border-b", "md:border-border"]);
  });
});

describe("tabShortLabel", () => {
  it("rend le libellé court seulement s'il diffère", () => {
    expect(tabShortLabel({ label: "Vue d'ensemble", short: "Résumé" })).toBe("Résumé");
    expect(tabShortLabel({ label: "Pubs", short: "Pubs" })).toBeNull();
    expect(tabShortLabel({ label: "Pubs", short: "  " })).toBeNull();
    expect(tabShortLabel({ label: "Pubs" })).toBeNull();
  });
});

describe("tabCount", () => {
  it("n'affiche une pastille que pour un nombre positif", () => {
    expect(tabCount({ count: 3 })).toBe(3);
    expect(tabCount({ count: 0 })).toBeNull();
    expect(tabCount({ count: -2 })).toBeNull();
    expect(tabCount({ count: null })).toBeNull();
    expect(tabCount({})).toBeNull();
    expect(tabCount({ count: Number.NaN })).toBeNull();
  });
});
