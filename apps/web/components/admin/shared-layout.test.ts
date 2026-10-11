/**
 * Rendu serveur des composants partagés corrigés à la vérification finale (phase 9) : en-tête de page sur
 * téléphone, bloc de formulaire, champ à copier. Pas de DOM : on lit le HTML rendu.
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyField } from "./copy-field";
import { FormSection } from "./form-section";
import { PageHeader } from "./page-header";

/** Attribut `class` de l'élément qui porte `data-slot="<slot>"`. */
function slotClass(html: string, slot: string): string {
  const m = new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`).exec(html);
  return /class="([^"]*)"/.exec(m?.[0] ?? "")?.[1] ?? "";
}

describe("PageHeader sur téléphone", () => {
  const html = renderToStaticMarkup(
    createElement(PageHeader, {
      title: "Messages",
      primaryAction: { label: "Programmer un message", href: "/messages/new" },
      secondaryActions: createElement("a", { href: "/messages/categories" }, "Comparer"),
    } as ComponentProps<typeof PageHeader>),
  );

  it("met les actions sur toute la largeur, sous le titre", () => {
    expect(slotClass(html, "page-actions").split(" ")).toContain("max-md:w-full");
  });

  it("place le bouton principal en premier (sans option de la page)", () => {
    expect(slotClass(html, "page-primary-action").split(" ")).toContain("max-md:order-first");
    // Sur ordinateur, l'ordre du code reste : secondaires puis principal, à droite.
    expect(html.indexOf("Comparer")).toBeLessThan(html.indexOf("Programmer un message"));
  });

  it("n'ajoute pas de conteneur vide sans bouton principal", () => {
    const none = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Réglages",
        secondaryActions: createElement("a", { href: "/x" }, "Lien"),
      } as ComponentProps<typeof PageHeader>),
    );
    expect(none).not.toContain("page-primary-action");
    const bare = renderToStaticMarkup(
      createElement(PageHeader, { title: "Seul" } as ComponentProps<typeof PageHeader>),
    );
    expect(bare).not.toContain("page-actions");
  });
});

describe("FormSection", () => {
  it("le bloc titre prend la place ; actions à gauche sur téléphone (comme le PageHeader), à droite sur ordinateur", () => {
    const html = renderToStaticMarkup(
      createElement(
        FormSection,
        {
          title: "Le message",
          description: "Ce que les membres vont lire, et où.",
          actions: createElement("a", { href: "/x" }, "+ Nouvelle catégorie"),
        } as ComponentProps<typeof FormSection>,
        "champs",
      ),
    );
    const title = /<div class="([^"]*)"><h2/.exec(html)?.[1] ?? "";
    expect(title.split(" ")).toEqual(expect.arrayContaining(["min-w-0", "flex-1"]));
    const actions = (/<div class="([^"]*)"><a href="\/x"/.exec(html)?.[1] ?? "").split(" ");
    expect(actions).toEqual(expect.arrayContaining(["md:ml-auto", "md:justify-end"]));
    // Sur téléphone, une action passée à la ligne reste à gauche, sous le titre.
    expect(actions).not.toContain("ml-auto");
    expect(actions).not.toContain("justify-end");
  });
});

describe("CopyField", () => {
  it("se relie à un libellé visible par son id (le libellé visible le nomme)", () => {
    const html = renderToStaticMarkup(
      createElement(CopyField, { value: "https://go.goolink.eu/ab", id: "pub-url" }),
    );
    expect(html).toContain('id="pub-url"');
    expect(html).not.toContain("aria-label=");
  });

  it("sans id, garde son nom pour les lecteurs d'écran", () => {
    const html = renderToStaticMarkup(
      createElement(CopyField, { value: "x", label: "Lien de la pub" }),
    );
    expect(html).toContain('aria-label="Lien de la pub"');
  });
});
