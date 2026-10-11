import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatCard, VariationText } from "./stat-card";
import { variationBetween } from "./stat-card-logic";

/** Texte lu à l'écran (balises retirées, espaces repliés). */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Texte visible seulement (sans les phrases réservées aux lecteurs d'écran). */
function visible(html: string): string {
  return text(html.replace(/<span class="sr-only">[^<]*<\/span>/g, ""));
}

function card(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    createElement(StatCard, { label: "Membres arrivés", value: "12", ...props }),
  );
}

describe("StatCard : variation", () => {
  it("base nulle : « nouveau » et « rien hier », jamais « > +999 % »", () => {
    const html = card({ variation: variationBetween(12, 0), comparison: "vs hier" });
    expect(visible(html)).toContain("nouveau rien hier");
    expect(html).toContain('<span class="sr-only">Nouveau : rien hier</span>');
    expect(html).not.toContain("999");
    expect(html).not.toContain("vs hier");
    // Hausse favorable : en vert.
    expect(html).toContain("text-success");
  });

  it("les deux nuls : aucune ligne de variation", () => {
    const html = card({ variation: variationBetween(0, 0), comparison: "vs hier" });
    expect(visible(html)).toBe("Membres arrivés 12");
    expect(html).not.toContain("Pas de comparaison");
    expect(html).not.toContain("0 %");
  });

  it("base non nulle : pourcentage et fin de phrase, plafond au-delà de 999 %", () => {
    expect(
      visible(card({ variation: variationBetween(150, 100), comparison: "vs hier" })),
    ).toContain("+50 % vs hier");
    expect(
      visible(card({ variation: variationBetween(323, 0.5), comparison: "vs hier" })),
    ).toContain("> +999 % vs hier");
  });

  it("variation inconnue : « Pas de comparaison possible »", () => {
    const html = card({ variation: variationBetween(3, null) });
    expect(visible(html)).toContain("Pas de comparaison possible");
  });

  it("ancienne forme `delta` inchangée", () => {
    expect(visible(card({ delta: 12.5, comparison: "vs hier" }))).toContain("+12,5 % vs hier");
    expect(visible(card({ delta: 0, comparison: "vs hier" }))).toContain("0 % vs hier");
    expect(visible(card({ delta: null }))).toContain("Pas de comparaison possible");
    expect(visible(card({}))).toBe("Membres arrivés 12");
    // `variation` prime sur `delta`.
    expect(visible(card({ delta: 5, variation: variationBetween(4, 0) }))).toContain("nouveau");
  });

  it("une dépense qui apparaît (coût) : « nouveau » en rouge", () => {
    const html = card({ variation: variationBetween(50, 0), favorable: "down" });
    expect(html).toContain("text-danger");
    expect(visible(html)).toContain("nouveau rien la période précédente");
  });
});

describe("VariationText (chiffres des cartes de campagne)", () => {
  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(VariationText, props as never));

  it("sans fin de phrase visible par défaut, phrase complète pour les lecteurs d'écran", () => {
    const html = render({ variation: variationBetween(3, 0) });
    expect(visible(html)).toBe("nouveau");
    expect(html).toContain("Nouveau : rien la période précédente");
  });

  it("rien quand les deux valent 0, « — » sans comparaison", () => {
    expect(render({ variation: variationBetween(0, 0) })).toBe("");
    const unknown = render({ variation: { kind: "unknown" } });
    expect(visible(unknown)).toBe("—");
    expect(unknown).toContain("Pas de comparaison possible");
  });
});
