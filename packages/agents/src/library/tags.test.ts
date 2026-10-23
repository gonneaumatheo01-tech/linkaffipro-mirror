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

describe("thèmes casino d'une légende", () => {
  const known = ["machines-a-sous", "roulette", "bonus", "tournoi"];
  it("plusieurs thèmes, synonymes, accents, pluriels", async () => {
    const { parseCasinoThemes } = await import("./tags");
    const tags = (c: string) => parseLibraryCaption(c)!.tags;
    expect(parseCasinoThemes(tags("#casino #roulette #Bonus"), known)).toEqual({ themes: ["roulette", "bonus"], unknown: [] });
    for (const c of ["#casino #machines-a-sous", "#casino #machinesasous", "#casino #Machines_à_sous", "#casino #slots", "#casino #MACHINES-À-SOUS"])
      expect(parseCasinoThemes(tags(c), known).themes).toEqual(["machines-a-sous"]);
    expect(parseCasinoThemes(tags("#casino #roulettes #tournois"), known).themes).toEqual(["roulette", "tournoi"]);
  });
  it("thème inconnu proposé sous une clé propre ; #casino seul : aucun thème", async () => {
    const { parseCasinoThemes } = await import("./tags");
    expect(parseCasinoThemes(parseLibraryCaption("#casino #Crash_Game #roulette")!.tags, known)).toEqual({
      themes: ["roulette"],
      unknown: ["crash-game"],
    });
    expect(parseCasinoThemes(parseLibraryCaption("#casino")!.tags, known)).toEqual({ themes: [], unknown: [] });
    // Un synonyme d'un thème de départ retiré par l'équipe se propose sous sa clé canonique.
    expect(parseCasinoThemes(["casino", "slots"], ["roulette"]).unknown).toEqual(["machines-a-sous"]);
  });
});
