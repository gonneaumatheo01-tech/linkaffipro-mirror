import { describe, expect, it } from "vitest";
import { ARMED_LINK_FACT, announcesLink, extractPseudo } from "./pseudo";

describe("extractPseudo", () => {
  it("extrait le pseudo d'un fait « pseudo: xxx »", () => {
    expect(extractPseudo(["pseudo: darknight42"])).toBe("darknight42");
  });

  it("insensible à la casse et aux espaces", () => {
    expect(extractPseudo(["Pseudo : Kevin_le_boss"])).toBe("Kevin_le_boss");
    expect(extractPseudo(["PSEUDO:max"])).toBe("max");
  });

  it("null si aucun fait pseudo", () => {
    expect(extractPseudo([])).toBeNull();
    expect(extractPseudo(["il aime le foot", "23 ans"])).toBeNull();
  });

  it("null si le pseudo est vide", () => {
    expect(extractPseudo(["pseudo: "])).toBeNull();
    expect(extractPseudo(["pseudo:"])).toBeNull();
  });

  it("prend le premier pseudo trouvé", () => {
    expect(extractPseudo(["pseudo: first", "pseudo: second"])).toBe("first");
  });
});

describe("announcesLink", () => {
  it("détecte « je t'envoie le lien »", () => {
    expect(announcesLink(["attends je t'envoie le lien"])).toBe(true);
  });

  it("détecte « je te mets le lien »", () => {
    expect(announcesLink(["je te mets le lien juste en dessous"])).toBe(true);
  });

  it("détecte « je te file le lien »", () => {
    expect(announcesLink(["je te file le lien"])).toBe(true);
  });

  it("détecte « tiens le lien »", () => {
    expect(announcesLink(["tiens le lien"])).toBe(true);
  });

  it("détecte « voilà le lien »", () => {
    expect(announcesLink(["voilà le lien"])).toBe(true);
  });

  it("faux si pas d'annonce", () => {
    expect(announcesLink(["mdr t'es chaud toi"])).toBe(false);
    expect(announcesLink(["on parle de lien entre nous"])).toBe(false);
  });

  it("fonctionne sur plusieurs messages", () => {
    expect(announcesLink(["attends", "je t'envoie le lien"])).toBe(true);
  });
});

describe("ARMED_LINK_FACT", () => {
  it("est une chaîne constante", () => {
    expect(typeof ARMED_LINK_FACT).toBe("string");
    expect(ARMED_LINK_FACT.length).toBeGreaterThan(0);
  });
});
