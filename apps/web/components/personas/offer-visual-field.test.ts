import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OfferVisualField, type VisualOption } from "./offer-visual-field";

// Champ « Visuel de l'app » de la fiche d'une persona : l'étiquette `<Label htmlFor="persona-visual">` doit pointer
// vers un élément dans chacun des trois états (aucune image envoyée, images déjà envoyées, visuel choisi), avec l'aide
// reliée, et l'envoi d'une image (champ fichier masqué) doit montrer le focus clavier sur son libellé.
const IMAGES: VisualOption[] = [{ id: "img1", filename: "app.png", mimeType: "image/png" }];

function render(images: VisualOption[], value: string): string {
  return renderToStaticMarkup(
    createElement(OfferVisualField, {
      id: "persona-visual",
      images,
      value,
      onChange: vi.fn(),
      onUploaded: vi.fn(),
      describedBy: "persona-visual-help",
    }),
  );
}

const ids = (html: string) => html.match(/ id="persona-visual"/g)?.length ?? 0;

describe("Visuel de l'app : étiquette, aide et focus", () => {
  it("aucune image envoyée : l'étiquette pointe vers l'envoi d'une image", () => {
    const html = render([], "");
    expect(ids(html)).toBe(1);
    expect(html).toMatch(
      /<input id="persona-visual" type="file"[^>]*aria-describedby="persona-visual-help"/,
    );
    expect(html).toContain("has-[:focus-visible]:outline-2");
  });

  it("images déjà envoyées : l'étiquette pointe vers la liste, l'envoi garde l'aide", () => {
    const html = render(IMAGES, "");
    expect(ids(html)).toBe(1);
    expect(html).toMatch(
      /<select [^>]*id="persona-visual"[^>]*aria-describedby="persona-visual-help"/,
    );
    expect(html).toMatch(/<input type="file"[^>]*aria-describedby="persona-visual-help"/);
  });

  it("visuel choisi : l'étiquette pointe vers « Retirer le visuel »", () => {
    const html = render(IMAGES, "img1");
    expect(ids(html)).toBe(1);
    expect(html).toMatch(/<button[^>]*id="persona-visual"/);
    expect(html).toContain('aria-describedby="persona-visual-help"');
  });
});
