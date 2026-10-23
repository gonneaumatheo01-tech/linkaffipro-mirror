import { describe, expect, it } from "vitest";
import { hasLibraryKeyword, parseLibraryCaption, tagsMatchRequest } from "./tags";

const personas = [{ id: "p_lea", name: "Léa" }];

describe("mots-clés de la médiathèque", () => {
  it("équipe, nature, persona et thème", () => {
    expect(parseLibraryCaption("#dating #source #lea", personas)).toMatchObject({
      teamKey: "dating",
      kind: "SOURCE",
      personaId: "p_lea",
      personaName: "Léa",
      theme: null,
    });
    expect(parseLibraryCaption("Nouvelle #Casino #Roulette", personas)).toMatchObject({
      teamKey: "casino",
      kind: null,
      theme: "roulette",
      tags: ["casino", "roulette"],
    });
    expect(parseLibraryCaption("#dating #référence #lea", personas)).toMatchObject({ kind: "REFERENCE" });
    expect(parseLibraryCaption("#photo", personas)).toMatchObject({ teamKey: null, kind: "PHOTO" });
  });
  it("sans mot-clé de médiathèque : rien", () => {
    expect(parseLibraryCaption("Superbe soirée #promo")).toBeNull();
    expect(hasLibraryKeyword(undefined)).toBe(false);
  });
  it("une demande de médias attend tous ses mots-clés", () => {
    expect(tagsMatchRequest(["dating", "source", "lea"], ["#dating", "source", "Léa"])).toBe(true);
    expect(tagsMatchRequest(["dating", "source"], ["dating", "source", "lea"])).toBe(false);
  });
});
