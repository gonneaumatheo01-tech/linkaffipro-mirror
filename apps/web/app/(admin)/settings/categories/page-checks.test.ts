import { describe, expect, it } from "vitest";
import { currentLinks, h1Count, jargonIn, primaryButtonCount, visibleText } from "./page-checks";

describe("contrôles des tests de rendu des pages de Réglages", () => {
  it("compte les titres h1 et les boutons orange", () => {
    const html =
      '<h1 class="text-title">Équipe</h1><h2>Comptes</h2><a class="x bg-brand text-brand-foreground y">Inviter</a><button class="bg-surface">Annuler</button>';
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(1);
    expect(h1Count("<h2>a</h2>")).toBe(0);
  });

  it("liens de la page ouverte, quel que soit l'ordre des attributs", () => {
    expect(
      currentLinks(
        '<a href="/a">A</a><a aria-current="page" class="x" href="/b">B</a><a href="/c" aria-current="page">C</a>',
      ),
    ).toEqual(["/b", "/c"]);
  });

  it("texte visible : sans balises ni texte réservé aux lecteurs d'écran", () => {
    expect(
      visibleText(
        '<p>Les <span title="FTD">premiers dépôts<span class="sr-only"> (FTD)</span></span> d&#x27;hier &amp; plus</p>',
      ),
    ).toBe("Les premiers dépôts d'hier & plus");
  });

  it("repère le jargon, pas les mots du client", () => {
    expect(jargonIn("Les premiers dépôts et le revenu net")).toEqual([]);
    expect(jargonIn("FTD, NGR, sub-ID, envoi groupé, automatisations")).toEqual([
      "FTD",
      "NGR",
      "sub-ID",
      "envoi groupé",
      "automatisation",
    ]);
    // « FTD » au milieu d'un mot ne compte pas.
    expect(jargonIn("AFTDX")).toEqual([]);
  });
});
