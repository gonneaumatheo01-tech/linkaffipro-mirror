import { describe, expect, it } from "vitest";
import { parsePostListFilters } from "./queries";
import { templateCardTitle, templatesHref } from "./templates";

describe("galerie de modèles", () => {
  it("garde le titre des modèles de la bibliothèque (univers et thème sont en pastilles)", () => {
    expect(templateCardTitle("Casino · Bonus · Bonus du week-end")).toBe("Bonus du week-end");
    expect(templateCardTitle("Casino · Bonus · Titre · avec point")).toBe("Titre · avec point");
    expect(templateCardTitle("Mon modèle")).toBe("Mon modèle");
    expect(templateCardTitle("  ")).toBe("Modèle sans nom");
  });
  it("adresse des filtres, relue à l'identique par la page", () => {
    const href = templatesHref({ vertical: "SPORTS", theme: "rappel", categoryId: "k1" });
    expect(href).toBe("/messages?view=templates&vertical=SPORTS&theme=rappel&category=k1");
    const f = parsePostListFilters(new URLSearchParams(href.split("?")[1]));
    expect(f).toMatchObject({ vertical: "SPORTS", theme: "rappel", categoryId: "k1" });
    expect(templatesHref({ vertical: "", theme: "" })).toBe("/messages?view=templates");
  });
});
