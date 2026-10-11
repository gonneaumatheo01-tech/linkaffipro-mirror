import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { comparableVariation } from "@/lib/dashboard/display";
import { CampaignFigure, FigureDelta } from "./campaign-figure";

function visible(html: string): string {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("chiffre d'une carte de campagne : période d'avant en perte", () => {
  it("pas de pourcentage : « Avant : −62 € » à la place, jamais « +71,4 % » en vert", () => {
    const html = renderToStaticMarkup(
      createElement(
        "dl",
        null,
        createElement(CampaignFigure, {
          label: "Gains",
          value: "−18 €",
          variation: comparableVariation(-17.62, -61.61),
          before: "−62 €",
        }),
      ),
    );
    expect(visible(html)).toContain("Avant : −62 €");
    expect(html).not.toMatch(/71,4|text-success/);
    expect(html).toContain("pas de comparaison possible");
  });

  it("avec un pourcentage, la valeur d'avant n'est pas répétée", () => {
    const html = renderToStaticMarkup(
      createElement(FigureDelta, { variation: comparableVariation(120, 100), before: "100 €" }),
    );
    expect(visible(html)).toContain("+20 %");
    expect(visible(html)).not.toContain("Avant");
  });

  it("sans valeur d'avant fournie : « — » comme avant", () => {
    const html = renderToStaticMarkup(
      createElement(FigureDelta, { variation: comparableVariation(5, -3) }),
    );
    expect(visible(html)).toBe("—");
  });
});
