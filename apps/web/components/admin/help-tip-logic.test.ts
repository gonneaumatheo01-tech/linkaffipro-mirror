import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpTip, Term } from "./help-tip";
import { INTERACTIVE_ANCESTORS, isInsideInteractive } from "./help-tip-logic";

/** Faux élément : `closest` renvoie un ancêtre si le sélecteur contient l'une des balises données. */
function fakeIn(...ancestors: string[]) {
  return {
    parentElement: {
      closest: (selector: string) =>
        ancestors.some((a) => selector.split(",").includes(a)) ? {} : null,
    },
  };
}

describe("Term et HelpTip : règles", () => {
  it("ne devient pas un bouton dans un bouton, un lien ou un libellé", () => {
    expect(isInsideInteractive(fakeIn("button"))).toBe(true);
    expect(isInsideInteractive(fakeIn("a[href]"))).toBe(true);
    expect(isInsideInteractive(fakeIn("label"))).toBe(true);
    expect(isInsideInteractive(fakeIn("[role=button]"))).toBe(true);
    expect(isInsideInteractive(fakeIn("div", "th"))).toBe(false);
    expect(isInsideInteractive({ parentElement: null })).toBe(false);
  });

  it("connaît les éléments interactifs courants", () => {
    for (const s of ["a[href]", "button", "label", "summary", "select", "textarea"]) {
      expect(INTERACTIVE_ANCESTORS.split(",")).toContain(s);
    }
  });
});

describe("Term et HelpTip : rendu serveur", () => {
  it("Term donne le terme technique aux lecteurs d'écran (pas seulement en title)", () => {
    const html = renderToStaticMarkup(
      createElement(Term, { term: "FTD" } as ComponentProps<typeof Term>, "Premiers dépôts"),
    );
    expect(html).toContain("Premiers dépôts");
    expect(html).toContain('<span class="sr-only"> (FTD)</span>');
  });

  it("Term sans terme rend le texte tel quel", () => {
    expect(
      renderToStaticMarkup(createElement(Term, {} as ComponentProps<typeof Term>, "Membres")),
    ).toBe("Membres");
  });

  it("HelpTip : bouton nommé, texte relié par aria-describedby, sans title en double", () => {
    const html = renderToStaticMarkup(
      createElement(
        HelpTip,
        { label: "Aide : coût par membre" } as ComponentProps<typeof HelpTip>,
        "Dépense pub / membres entrés.",
      ),
    );
    expect(html).toContain('aria-label="Aide : coût par membre"');
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<span id="${id}" hidden="">Dépense pub / membres entrés.</span>`);
    expect(html).not.toContain("title=");
    // La bulle n'est pas dans la page tant qu'elle est fermée (portail ouvert au survol, au toucher ou au focus).
    expect(html).not.toContain('role="tooltip"');
  });
});
