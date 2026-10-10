import { describe, expect, it } from "vitest";
import { keepInactiveChannels } from "./channels";

describe("canaux d'une campagne à l'enregistrement", () => {
  it("garde les canaux désactivés déjà rattachés (ils ne sont pas affichés comme cases à cocher)", () => {
    expect(keepInactiveChannels(["a"], ["a", "b", "off"], new Set(["a", "b"]))).toEqual([
      "a",
      "off",
    ]);
  });
  it("un canal actif décoché est bien retiré ; pas de doublon", () => {
    expect(keepInactiveChannels(["a", "a"], ["a", "b"], new Set(["a", "b"]))).toEqual(["a"]);
  });
  it("nouvelle campagne : seulement les cases cochées", () => {
    expect(keepInactiveChannels(["a", "b"], [], new Set(["a", "b"]))).toEqual(["a", "b"]);
  });
});
