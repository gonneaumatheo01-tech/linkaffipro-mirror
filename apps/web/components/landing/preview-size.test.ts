import { describe, expect, it } from "vitest";
import { PREVIEW_DRAWN_WIDTH, PREVIEW_SCREEN } from "./phone-preview";
import { largePreviewWidth } from "./preview-size";

describe("aperçu en grand d'une page : taille du téléphone dessiné", () => {
  it("grand écran : taille réelle (390 px de large)", () => {
    expect(largePreviewWidth({ width: 1920, height: 1080 })).toBe(PREVIEW_SCREEN.width);
  });

  it("ordinateur portable : toute la hauteur de la fenêtre, plus grand que l'aperçu du formulaire", () => {
    const w = largePreviewWidth({ width: 1440, height: 780 });
    expect(w).toBe(346);
    expect(w).toBeGreaterThan(PREVIEW_DRAWN_WIDTH);
    // Le téléphone et son cadre tiennent dans la hauteur de la fenêtre.
    expect((w * PREVIEW_SCREEN.height) / PREVIEW_SCREEN.width + 16 + 32 + 40).toBeLessThanOrEqual(
      780,
    );
  });

  it("téléphone de 390 px : la largeur de l'écran, jamais plus haut que l'écran", () => {
    expect(largePreviewWidth({ width: 390, height: 844 })).toBe(302);
    expect(largePreviewWidth({ width: 390, height: 600 })).toBe(256);
  });

  it("tablette juste au-dessus du passage côte à côte : les textes à côté réduisent la largeur", () => {
    expect(largePreviewWidth({ width: 768, height: 1024 })).toBe(368);
  });

  it("fenêtre minuscule ou inconnue : jamais moins de 200 px ; rendu serveur : la taille du formulaire", () => {
    expect(largePreviewWidth({ width: 300, height: 400 })).toBe(200);
    expect(largePreviewWidth(null)).toBe(PREVIEW_DRAWN_WIDTH);
    expect(largePreviewWidth({ width: 0, height: 0 })).toBe(PREVIEW_DRAWN_WIDTH);
  });
});
