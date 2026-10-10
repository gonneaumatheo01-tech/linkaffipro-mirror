import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup } from "./dropdown-menu";

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
