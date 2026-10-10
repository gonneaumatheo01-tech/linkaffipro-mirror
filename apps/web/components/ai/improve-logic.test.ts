import { describe, expect, it } from "vitest";
import { contextLine, translationAction, toAiLanguage, toAiVertical } from "./improve-logic";

describe("panneau de l'assistant : ligne d'information", () => {
  it("affiche la catégorie, le média et la limite de caractères", () => {
    expect(contextLine({ categoryName: "Bonus", hasMedia: true })).toBe(
      "Catégorie : Bonus · Média joint : oui · Limite : 1 024 caractères",
    );
    expect(contextLine({ categoryName: null, hasMedia: false })).toBe(
      "Catégorie : aucune · Média joint : non · Limite : 4 096 caractères",
    );
  });
  it("sans notion de catégorie chez l'hôte (envoi groupé, texte du bot) : pas de mention de catégorie", () => {
    expect(contextLine({ hasMedia: false })).toBe("Média joint : non · Limite : 4 096 caractères");
  });
});

describe("traductions : Utiliser, Enregistrer ou Copier", () => {
  it("même langue que le champ : Utiliser (remplace le champ)", () => {
    expect(translationAction("fr", "fr", false)).toBe("use");
    expect(translationAction("fr", "fr", true)).toBe("use");
  });
  it("autre langue avec un hôte qui gère les langues : enregistrer dans cette langue", () => {
    expect(translationAction("en", "fr", true)).toBe("save");
  });
  it("autre langue sans gestion des langues : Copier (ne jamais écraser le texte français)", () => {
    expect(translationAction("en", "fr", false)).toBe("copy");
  });
});

describe("normalisation du contexte reçu de l'hôte", () => {
  it("langue inconnue → français ; univers inconnu → non précisé", () => {
    expect(toAiLanguage("en")).toBe("en");
    expect(toAiLanguage("ar")).toBe("ar");
    expect(toAiLanguage("ru")).toBe("ru");
    expect(toAiLanguage("xx")).toBe("fr");
    expect(toAiLanguage(null)).toBe("fr");
    expect(toAiVertical("CASINO")).toBe("CASINO");
    expect(toAiVertical("autre")).toBeNull();
    expect(toAiVertical(undefined)).toBeNull();
  });
});
