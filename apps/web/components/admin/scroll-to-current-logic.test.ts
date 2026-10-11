import { describe, expect, it } from "vitest";
import { centeredScrollLeft } from "./scroll-to-current-logic";

// Barre d'onglets de 358 px sur téléphone, 480 px de contenu (6 onglets).
const list = { left: 16, width: 358, scrollLeft: 0, scrollWidth: 480 };

describe("centeredScrollLeft", () => {
  it("amène l'onglet courant au centre de la barre", () => {
    // Onglet de 250 à 340 px dans la page : centre 295, centre de la barre 195 → défiler de 100 px.
    expect(centeredScrollLeft(list, { left: 250, width: 90 })).toBe(100);
  });

  it("ne dépasse jamais la fin de la barre (dernier onglet)", () => {
    // Fin maximale : 480 − 358 = 122.
    expect(centeredScrollLeft(list, { left: 420, width: 80 })).toBe(122);
  });

  it("ne descend jamais sous zéro (premier onglet)", () => {
    expect(centeredScrollLeft({ ...list, scrollLeft: 100 }, { left: -80, width: 120 })).toBe(0);
  });

  it("tient compte du défilement déjà fait", () => {
    // Barre déjà défilée de 40 px : l'onglet vu à 200–260 px est au contenu 224–284, centre 254 → 254 − 179 = 75.
    expect(centeredScrollLeft({ ...list, scrollLeft: 40 }, { left: 200, width: 60 })).toBe(75);
  });

  it("ne bouge pas une barre qui tient dans l'écran", () => {
    expect(
      centeredScrollLeft({ ...list, scrollWidth: 300, scrollLeft: 0 }, { left: 250, width: 60 }),
    ).toBe(0);
  });
});
