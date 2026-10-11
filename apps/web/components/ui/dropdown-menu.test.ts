import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cn } from "./cn";
import {
  DROPDOWN_CONTENT_CLASS,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
} from "./dropdown-menu";

/**
 * Base UI lève « MenuGroupContext is missing » si un `Menu.GroupLabel` n'a pas de groupe parent : la page
 * entière tombait alors sur l'écran d'erreur (constaté sur /styleguide en ouvrant le menu « ⋯ »).
 */
describe("DropdownMenuLabel", () => {
  it("s'affiche seul, hors groupe, sans faire planter le rendu", () => {
    const html = renderToStaticMarkup(createElement(DropdownMenuLabel, null, "Message"));
    expect(html).toContain('role="presentation"');
    expect(html).toContain('data-slot="dropdown-menu-label"');
    expect(html).toContain(">Message</div>");
  });

  it("nomme son groupe quand il est dans un DropdownMenuGroup", () => {
    const html = renderToStaticMarkup(
      createElement(DropdownMenuGroup, null, createElement(DropdownMenuLabel, null, "Message")),
    );
    expect(html).toContain('role="group"');
    // Le libellé Base UI est masqué aux lecteurs d'écran : c'est le groupe qui porte le nom.
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="presentation"');
  });

  it("fonctionne aussi dans un DropdownMenuRadioGroup", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(DropdownMenuRadioGroup, null, createElement(DropdownMenuLabel, null, "Tri")),
      ),
    ).not.toThrow();
  });
});

describe("DropdownMenuContent : largeur", () => {
  const classes = (s: string) => s.split(/\s+/);

  it("prend la largeur de son texte, jamais moins que le bouton qui l'ouvre ni que 128 px", () => {
    const c = classes(DROPDOWN_CONTENT_CLASS);
    expect(c).toContain("w-auto");
    expect(c).toContain("min-w-[max(var(--anchor-width),8rem)]");
    // Jamais plus large que l'espace disponible (le texte passe à la ligne).
    expect(c).toContain("max-w-(--available-width)");
    expect(c).not.toContain("w-(--anchor-width)");
  });

  it("une largeur choisie par l'écran remplace la règle par défaut", () => {
    const fixed = classes(cn(DROPDOWN_CONTENT_CLASS, "w-60"));
    expect(fixed).toContain("w-60");
    expect(fixed).not.toContain("w-auto");
    const min = classes(cn(DROPDOWN_CONTENT_CLASS, "min-w-60"));
    expect(min).toContain("min-w-60");
    expect(min).not.toContain("min-w-[max(var(--anchor-width),8rem)]");
  });
});
