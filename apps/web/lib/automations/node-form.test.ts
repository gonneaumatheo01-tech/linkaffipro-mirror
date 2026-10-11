import { describe, expect, it } from "vitest";
import {
  buttonsToEntries,
  buttonsToLines,
  delayToHours,
  draftButtonRows,
  entriesToButtons,
  previewButtonRows,
  toButtonEntry,
  languageChoiceCodes,
  parseLanguageCodes,
  fillMessageExamples,
  MESSAGE_FIELD_HELP,
  MESSAGE_WORDS,
  hoursToDelay,
  languagesToText,
  linesToButtons,
  textToLanguages,
  toggleInList,
} from "./node-form";

describe("conversions affichage ↔ formulaire", () => {
  it("durées : jours ronds affichés en jours, le reste en heures, aller-retour sans perte", () => {
    expect(hoursToDelay(48)).toEqual({ value: "2", unit: "days" });
    expect(hoursToDelay(36)).toEqual({ value: "36", unit: "hours" });
    expect(hoursToDelay(null)).toEqual({ value: "", unit: "hours" });
    for (const h of [1, 6, 24, 36, 48, 168, 2160]) {
      const d = hoursToDelay(h);
      expect(delayToHours(d.value, d.unit)).toBe(h);
    }
    expect(delayToHours("1,5", "days")).toBe(36);
    expect(delayToHours("", "hours")).toBeNull();
    expect(delayToHours("abc", "hours")).toBeNull();
  });

  it("boutons : une ligne par bouton, aller-retour sans perte", () => {
    const rows = [
      [{ text: "Voir l'offre", url: "https://go.goolink.eu/a" }],
      [{ text: "Aide", url: "http://x.y" }],
    ];
    const lines = buttonsToLines(rows);
    expect(lines).toBe("Voir l'offre | https://go.goolink.eu/a\nAide | http://x.y");
    expect(linesToButtons(lines)).toEqual({ ok: true, rows });
    expect(linesToButtons("\n  \n")).toEqual({ ok: true, rows: [] });
    expect(buttonsToLines(undefined)).toBe("");
  });

  it("boutons : erreurs en français", () => {
    expect(linesToButtons("| https://x.y")).toEqual({
      ok: false,
      error: "Bouton ligne 1 : écrivez le libellé avant le « | ».",
    });
    const r = linesToButtons("Voir | x.y");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Bouton « Voir » : ajoutez son adresse/);
    expect(
      linesToButtons(Array.from({ length: 11 }, (_, i) => `B${i} | https://x.y`).join("\n")).ok,
    ).toBe(false);
  });

  it("boutons saisis champ par champ (libellé, adresse) : même forme enregistrée", () => {
    const rows = [
      [{ text: "Voir l'offre", url: "https://go.goolink.eu/a" }],
      [{ text: "Aide", url: "http://x.y" }],
    ];
    const entries = buttonsToEntries(rows);
    expect(entries).toEqual([
      { text: "Voir l'offre", url: "https://go.goolink.eu/a" },
      { text: "Aide", url: "http://x.y" },
    ]);
    expect(entriesToButtons(entries)).toEqual({ ok: true, rows });
    expect(entriesToButtons([{ text: " ", url: "" }])).toEqual({ ok: true, rows: [] });
    expect(buttonsToEntries(undefined)).toEqual([]);
    expect(entriesToButtons([{ text: "x".repeat(80), url: "https://a.b" }])).toMatchObject({
      ok: true,
      rows: [[{ text: "x".repeat(64) }]],
    });
  });

  it("boutons saisis champ par champ : erreurs en français, avec la ligne fautive", () => {
    expect(entriesToButtons([{ text: "", url: "https://x.y" }])).toEqual({
      ok: false,
      index: 0,
      error: "Bouton 1 : écrivez son libellé.",
    });
    const r = entriesToButtons([
      { text: "Ok", url: "https://a.b" },
      { text: "Voir l'offre", url: "exemple.fr" },
    ]);
    expect(r).toMatchObject({ ok: false, index: 1 });
    expect(!r.ok && r.error).toMatch(/Bouton « Voir l'offre » : écrivez son adresse complète/);
    const many = Array.from({ length: 11 }, (_, i) => ({ text: `B${i}`, url: "https://x.y" }));
    expect(entriesToButtons(many)).toMatchObject({ ok: false, index: 10 });
  });

  it("bouton « Offre (campagne) » : campagne et offre gardées, aller-retour sans perte, à côté des liens", () => {
    const rows = [
      [
        {
          text: "Voir l'offre",
          type: "OFFER" as const,
          campaignId: "c1",
          affiliateCampaignId: "a1",
        },
      ],
      [{ text: "Aide", url: "https://x.y" }],
    ];
    const entries = buttonsToEntries(rows);
    expect(entries).toEqual([
      { kind: "offer", text: "Voir l'offre", url: "", campaignId: "c1", affiliateCampaignId: "a1" },
      { text: "Aide", url: "https://x.y" },
    ]);
    expect(entriesToButtons(entries)).toEqual({ ok: true, rows });
    // Ligne Offre laissée vide (rien choisi, aucun libellé) : ignorée comme une ligne de lien vide.
    expect(entriesToButtons([{ kind: "offer", text: "", url: "" }])).toEqual({
      ok: true,
      rows: [],
    });
  });

  it("brouillon de l'éditeur : boutons gardés tels que saisis, relus à l'identique", () => {
    const entries = [
      { kind: "offer" as const, text: "Voir", url: "", campaignId: "c1", affiliateCampaignId: "" },
      { text: "", url: "" },
      { text: "Aide", url: "https://x.y " },
    ];
    const rows = draftButtonRows(entries);
    expect(rows).toEqual([
      [{ text: "Voir", type: "OFFER", campaignId: "c1", affiliateCampaignId: "" }],
      [{ text: "Aide", url: "https://x.y" }],
    ]);
    expect(rows.flat().map(toButtonEntry)).toEqual([
      { kind: "offer", text: "Voir", url: "", campaignId: "c1", affiliateCampaignId: "" },
      { text: "Aide", url: "https://x.y" },
    ]);
  });

  it("aperçu : un bouton par ligne commencée, Offre comprise", () => {
    expect(
      previewButtonRows([
        { kind: "offer", text: " Voir l'offre ", url: "", campaignId: "c1" },
        { text: "", url: "" },
        { text: "Aide", url: "https://x.y" },
      ]),
    ).toEqual([[{ text: "Voir l'offre" }], [{ text: "Aide" }]]);
  });

  it("bouton « Offre (campagne) » : campagne ou libellé manquant signalés sur la ligne", () => {
    expect(entriesToButtons([{ kind: "offer", text: "Voir l'offre", url: "" }])).toEqual({
      ok: false,
      index: 0,
      error: "Bouton « Voir l'offre » : choisissez la campagne de l'offre.",
    });
    expect(
      entriesToButtons([
        { text: "Ok", url: "https://a.b" },
        { kind: "offer", text: " ", url: "", campaignId: "c1", affiliateCampaignId: "a1" },
      ]),
    ).toEqual({ ok: false, index: 1, error: "Bouton 2 : écrivez son libellé." });
  });

  it("langues en cases : celles des membres, puis celles déjà choisies ; autre langue contrôlée", () => {
    expect(languageChoiceCodes([{ code: "fr" }, { code: "en" }], ["EN", "de"])).toEqual([
      "fr",
      "en",
      "de",
    ]);
    expect(parseLanguageCodes("DE, it ; pt_BR x1 français")).toEqual({
      codes: ["de", "it", "pt-br"],
      invalid: ["x1", "français"],
    });
  });

  it("langues : texte libre ↔ codes", () => {
    expect(textToLanguages("FR, en ; es  fr")).toEqual(["fr", "en", "es"]);
    expect(languagesToText(["fr", "en"])).toBe("fr, en");
    expect(languagesToText(undefined)).toBe("");
  });

  it("cases à cocher", () => {
    expect(toggleInList(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleInList(["a", "b"], "a", false)).toEqual(["b"]);
    expect(toggleInList(undefined, "a", true)).toEqual(["a"]);
    expect(toggleInList(["a"], "a", true)).toEqual(["a"]);
  });

  it("aperçu : mots remplacés par des exemples", () => {
    expect(fillMessageExamples("Salut {prenom}, bienvenue sur {canal} ({inconnu})")).toBe(
      "Salut Léa, bienvenue sur Casino VIP ({inconnu})",
    );
  });
});

describe("aide sous le texte d'un message de relance", () => {
  it("nomme les repères comme les pastilles d'insertion, sans accolades", () => {
    expect(MESSAGE_WORDS.map((w) => w.label)).toEqual(["Prénom", "Nom du canal", "Nom du bot"]);
    expect(MESSAGE_FIELD_HELP).not.toMatch(/[{}]/);
    expect(MESSAGE_FIELD_HELP).toBe(
      "Les repères en couleur (Prénom, Nom du canal, Nom du bot) sont remplacés pour chaque personne.",
    );
  });
});
