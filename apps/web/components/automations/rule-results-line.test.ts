import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_RESULTS } from "@/lib/automations/results";
import { RuleResultsLine, RuleResultsSummary } from "./rule-results-line";

const text = (html: string) => html.replace(/<[^>]+>/g, "");

// Ligne « Depuis le début : 0 envoyé · 0 clic · … » des cartes : chaque morceau reste entier, mais la ligne doit
// pouvoir passer à la ligne entre deux morceaux (sinon la carte déborde sur un téléphone de 390 px).
describe("résultats d'une relance sur sa carte", () => {
  it("chaque morceau insécable, coupure possible entre deux morceaux", () => {
    const html = renderToStaticMarkup(
      createElement(RuleResultsLine, {
        results: { ...EMPTY_RESULTS, sent: 12, clicks: 3, registrations: 2, ftds: 1, gains: 50 },
      }),
    );
    const nowraps = html.split('<span class="whitespace-nowrap">').slice(1);
    expect(nowraps).toHaveLength(5);
    // Contenu d'un morceau : jusqu'à la 2e fermeture (le chiffre est dans un span). Aucun « · » dedans.
    for (const piece of nowraps)
      expect(piece.split("</span>").slice(0, 2).join("")).not.toContain("·");
    expect(html).toContain("Depuis le début");
    expect(html.replace(/<[^>]+>/g, "")).toContain(
      "12 envoyés · 3 clics · 2 inscriptions · 1 premier dépôt · ",
    );
  });

  it("relance sans résultat : une seule phrase, pas une rangée de zéros", () => {
    const html = renderToStaticMarkup(
      createElement(RuleResultsSummary, {
        results: EMPTY_RESULTS,
        attribution: true,
        label: "Depuis le début",
      }),
    );
    expect(text(html)).toBe("Pas encore de résultat");
  });

  it("relance sans bouton Offre : les envoyés seulement ; relance plus ancienne : depuis la date du suivi", () => {
    const html = renderToStaticMarkup(
      createElement(RuleResultsSummary, {
        results: { ...EMPTY_RESULTS, sent: 12 },
        attribution: false,
        label: "Depuis le 11 oct.",
      }),
    );
    expect(text(html)).toBe("Résultats depuis le 11 oct. : Depuis le 11 oct. : 12 envoyés");
    expect(html).not.toContain("clic");
  });
});
