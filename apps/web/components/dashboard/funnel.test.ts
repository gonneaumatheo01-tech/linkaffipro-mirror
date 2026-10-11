import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { comparableVariation } from "@/lib/dashboard/display";
import type { FunnelStep } from "@/lib/dashboard/metrics";
import { NumCell } from "./cells";
import { Funnel } from "./funnel";

/** Texte visible (sans les phrases réservées aux lecteurs d'écran), balises retirées, espaces repliés. */
function visible(html: string): string {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const step = (key: string, value: number): FunnelStep => ({
  key,
  label: key,
  value,
  rate: null,
  loss: null,
});

describe("Parcours : variations par la règle commune", () => {
  it("étape à 0 la période d'avant : « nouveau », jamais « Pas de comparaison possible » ; 0 et 0 : rien", () => {
    const html = renderToStaticMarkup(
      createElement(Funnel, {
        steps: [step("entryClicks", 40), step("registrations", 0)],
        previous: [step("entryClicks", 0), step("registrations", 0)],
      }),
    );
    expect(visible(html)).toContain("Avant : 0 nouveau");
    expect(html).not.toContain("Pas de comparaison possible");
    // Inscriptions 0 → 0 : ni « 0 % » ni « — ».
    expect(visible(html)).not.toMatch(/0 %|—/);
  });

  it("base non nulle : le pourcentage", () => {
    const html = renderToStaticMarkup(
      createElement(Funnel, { steps: [step("joined", 12)], previous: [step("joined", 10)] }),
    );
    expect(visible(html)).toContain("+20 %");
  });
});

describe("cellule de chiffre : la variation juste sous la valeur, la précision ensuite", () => {
  it("« 0,99× / +83,3 % / 3 € de perte » : la variation ne se lit pas comme celle de la perte", () => {
    const html = renderToStaticMarkup(
      createElement(NumCell, {
        value: "0,99×",
        note: "3 € de perte",
        variation: comparableVariation(0.99, 0.54),
      }),
    );
    const text = visible(html);
    expect(text.indexOf("0,99×")).toBeLessThan(text.indexOf("+83,3 %"));
    expect(text.indexOf("+83,3 %")).toBeLessThan(text.indexOf("3 € de perte"));
  });
});
