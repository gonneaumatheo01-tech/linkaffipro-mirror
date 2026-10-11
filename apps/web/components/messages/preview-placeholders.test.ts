import { describe, expect, it } from "vitest";
import {
  markTemplatePlaceholders,
  placeholdersToComplete,
  PLACEHOLDER_MARK_CLASS,
} from "./preview-placeholders";

describe("repères à compléter dans l'aperçu d'un modèle", () => {
  it("met en évidence chaque repère connu, en gras ou non", () => {
    expect(markTemplatePlaceholders("Bonjour {prenom}, voici <b>{offre}</b>")).toBe(
      `Bonjour <mark class="${PLACEHOLDER_MARK_CLASS}">{prenom}</mark>, voici <b><mark class="${PLACEHOLDER_MARK_CLASS}">{offre}</mark></b>`,
    );
  });

  it("ne touche ni aux balises, ni aux adresses, ni aux mots inconnus entre accolades", () => {
    const html = '<a href="https://ex.com/?q={offre}">lien</a> {inconnu} {canal}';
    expect(markTemplatePlaceholders(html)).toBe(
      `<a href="https://ex.com/?q={offre}">lien</a> {inconnu} <mark class="${PLACEHOLDER_MARK_CLASS}">{canal}</mark>`,
    );
  });

  it("liste les repères à compléter une seule fois, dans l'ordre", () => {
    expect(
      placeholdersToComplete("{offre} puis <b>{canal}</b>, encore {offre} et {inconnu}"),
    ).toEqual(["offre", "canal"]);
    expect(placeholdersToComplete("Aucun repère ici.")).toEqual([]);
  });
});
