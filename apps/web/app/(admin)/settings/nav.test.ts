import { describe, expect, it } from "vitest";
import { SETTINGS_PAGES, settingsPagesFor } from "./nav";

describe("cartes de la page Réglages", () => {
  it("chaque carte a une adresse unique sous /settings, un libellé et une ligne d'aide", () => {
    const hrefs = SETTINGS_PAGES.map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const p of SETTINGS_PAGES) {
      expect(p.href).toMatch(/^\/settings\/[a-z]+$/);
      expect(p.label.trim()).not.toBe("");
      expect(p.description.trim()).not.toBe("");
    }
  });

  it("Bots et Journal sont rangés dans Réglages", () => {
    expect(SETTINGS_PAGES.find((p) => p.href === "/settings/bots")?.label).toBe("Bots");
    expect(SETTINGS_PAGES.find((p) => p.href === "/settings/journal")?.label).toBe("Journal");
  });

  it("un administrateur voit toutes les cartes, dans l'ordre", () => {
    expect(settingsPagesFor("ADMIN")).toEqual(SETTINGS_PAGES);
  });

  it("un manager ne voit que ce qu'il peut ouvrir (Bots, IA, Journal)", () => {
    expect(settingsPagesFor("MANAGER").map((p) => p.href)).toEqual([
      "/settings/bots",
      "/settings/ai",
      "/settings/journal",
    ]);
  });

  it("filtre aussi une liste fournie", () => {
    const pages = [
      { href: "/settings/a", label: "A", description: "a" },
      { href: "/settings/b", label: "B", description: "b", managers: true },
    ];
    expect(settingsPagesFor("MANAGER", pages).map((p) => p.href)).toEqual(["/settings/b"]);
    expect(settingsPagesFor("ADMIN", pages)).toHaveLength(2);
  });
});
