import { describe, expect, it } from "vitest";
import {
  cleanParams,
  hasActiveFilters,
  hasAnyParam,
  resetHref,
  shouldRestore,
} from "./remember-filters-logic";

const sp = (q: string) => new URLSearchParams(q);

describe("mémoire des filtres", () => {
  it("mémorise les filtres sans retour d'action, page ni valeur vide", () => {
    expect(cleanParams(sp("status=SENT&ok=Enregistré&page=3&q=&campaignId=c1"))).toBe(
      "status=SENT&campaignId=c1",
    );
    expect(cleanParams(sp("ok=1&page=2"))).toBe("");
  });

  it("rappelle la mémoire seulement sur une adresse nue", () => {
    expect(shouldRestore(sp(""), "status=SENT")).toBe(true);
    expect(shouldRestore(sp("ok=Envoyé&page=2"), "status=SENT")).toBe(true);
    expect(shouldRestore(sp(""), null)).toBe(false);
    expect(shouldRestore(sp(""), "")).toBe(false);
    expect(shouldRestore(sp("view=list"), "status=SENT")).toBe(false);
    expect(hasAnyParam(sp("view=list"))).toBe(true);
    expect(hasAnyParam(sp("ok=1"))).toBe(false);
  });
});

describe("« Effacer les filtres » : visible seulement s'il y a quelque chose à effacer", () => {
  it("caché sans filtre (adresse nue, retours, page, valeurs vides)", () => {
    expect(hasActiveFilters(sp(""))).toBe(false);
    expect(hasActiveFilters(sp("ok=Enregistré&error=&page=2"))).toBe(false);
    expect(hasActiveFilters(sp("status=&campaignId="))).toBe(false);
  });

  it("caché quand seule la vue ou l'onglet est choisi (ils restent après l'effacement)", () => {
    expect(hasActiveFilters(sp("view=calendar"))).toBe(false);
    expect(hasActiveFilters(sp("tab=ads&view=list"))).toBe(false);
    expect(hasActiveFilters(sp("mode=x"), ["mode"])).toBe(false);
  });

  it("visible dès qu'un filtre a une valeur", () => {
    expect(hasActiveFilters(sp("status=SENT"))).toBe(true);
    expect(hasActiveFilters(sp("view=list&channel=c1"))).toBe(true);
    expect(hasActiveFilters(sp("period=7d&page=2"))).toBe(true);
  });

  it("revient à la page sans filtre en gardant la vue et l'onglet", () => {
    expect(resetHref("/messages", sp("view=list&channel=c1&page=2"))).toBe("/messages?view=list");
    expect(resetHref("/campaigns", sp("vertical=CASINO&status=ACTIVE"))).toBe("/campaigns");
    expect(resetHref("/x", sp("tab=a&view=b&q=z"))).toBe("/x?view=b&tab=a");
    expect(resetHref("/x", sp("mode=m&q=z"), ["mode"])).toBe("/x?mode=m");
  });
});
