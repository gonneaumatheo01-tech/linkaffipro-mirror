import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpTip, Term } from "./help-tip";
import {
  INTERACTIVE_ANCESTORS,
  isInsideInteractive,
  isInsideStretchedLink,
  STRETCHED_LINK_CONTAINERS,
  TERM_IN_CARD,
  TERM_TOUCH_TARGET,
  termMode,
  termTriggerClass,
} from "./help-tip-logic";

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

describe("Term : zone de toucher sur téléphone", () => {
  const classes = TERM_TOUCH_TARGET.split(" ");

  it("ajoute une cible invisible d'au moins 40 × 40 px, centrée sur le mot", () => {
    expect(classes).toEqual(
      expect.arrayContaining([
        "relative",
        "max-md:after:absolute",
        "max-md:after:h-10",
        "max-md:after:min-w-10",
        "max-md:after:-translate-x-1/2",
        "max-md:after:-translate-y-1/2",
      ]),
    );
  });

  it("ne change pas l'allure : seul le pseudo-élément, sur téléphone, reçoit des classes", () => {
    // Sur le mot lui-même : `relative` seulement (pas de marge, de hauteur de ligne ni de fond).
    expect(classes.filter((x) => !x.startsWith("max-md:after:"))).toEqual(["relative"]);
  });
});

describe("Term dans une carte à lien étiré (carte de campagne)", () => {
  it("reconnaît la carte de campagne et toute carte marquée data-stretched-link", () => {
    expect(STRETCHED_LINK_CONTAINERS.split(",")).toEqual(
      expect.arrayContaining(["[data-stretched-link]", "[data-slot=campaign-card]"]),
    );
    expect(isInsideStretchedLink(fakeIn("[data-slot=campaign-card]"))).toBe(true);
    expect(isInsideStretchedLink(fakeIn("[data-stretched-link]"))).toBe(true);
    expect(isInsideStretchedLink(fakeIn("div", "section"))).toBe(false);
    expect(isInsideStretchedLink({ parentElement: null })).toBe(false);
  });

  it("choisit le rendu : texte dans un élément interactif, carte dans une carte étirée, bulle ailleurs", () => {
    expect(termMode(fakeIn("button"))).toBe("text");
    // Un lien dans une carte étirée reste un lien : le terme y est du texte.
    expect(termMode(fakeIn("a[href]", "[data-slot=campaign-card]"))).toBe("text");
    expect(termMode(fakeIn("[data-slot=campaign-card]"))).toBe("card");
    expect(termMode(fakeIn("div"))).toBe("bubble");
  });

  it("ne pose aucune zone de toucher qui mordrait sur les chiffres voisins", () => {
    const card = termTriggerClass("card").split(" ");
    expect(card.some((x) => x.includes("after:"))).toBe(false);
    // Sur téléphone : transparent au toucher (la carte s'ouvre), jamais posé au-dessus du lien de la carte.
    expect(card).toContain("max-md:pointer-events-none");
    expect(card).not.toContain("relative");
    expect(card).not.toContain("z-10");
    // Sur ordinateur : au-dessus du lien de la carte, pour que la bulle s'ouvre au survol.
    expect(card).toEqual(expect.arrayContaining(["md:relative", "md:z-10"]));
    expect(termTriggerClass("card")).toBe(TERM_IN_CARD);
  });

  it("garde la zone de 40 px partout ailleurs", () => {
    expect(termTriggerClass("bubble")).toBe(TERM_TOUCH_TARGET);
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
