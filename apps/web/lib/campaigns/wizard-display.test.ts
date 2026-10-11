import { describe, expect, it } from "vitest";
import {
  adsAdvancedCount,
  fieldIdOnStep,
  generalAdvancedCount,
  hiddenOffersLabel,
  IMPORT_STEPS,
  importStep,
  offerChipLabel,
  offersUniverseFirst,
  UNIVERSE_CHOICES,
  universeFirst,
} from "./wizard-display";
import { WIZARD_STEPS } from "./wizard";
import { JARGON } from "./display";

describe("assistant Nouvelle campagne : affichage", () => {
  it("étape 2 : les offres de l'univers choisi d'abord, ordre conservé dans chaque bloc", () => {
    const offers = [
      { id: "b1", vertical: "SPORTS" },
      { id: "c1", vertical: "casino" },
      { id: "x", vertical: null },
      { id: "b2", vertical: "SPORTS" },
      { id: "c2", vertical: "CASINO" },
    ];
    expect(offersUniverseFirst(offers, "CASINO").map((o) => o.id)).toEqual([
      "c1",
      "c2",
      "b1",
      "x",
      "b2",
    ]);
    expect(offersUniverseFirst(offers, "SPORTS").map((o) => o.id)).toEqual([
      "b1",
      "b2",
      "c1",
      "x",
      "c2",
    ]);
    // Sans univers (ou inconnu) : ordre d'origine, nouvelle liste.
    const same = offersUniverseFirst(offers, "");
    expect(same.map((o) => o.id)).toEqual(["b1", "c1", "x", "b2", "c2"]);
    expect(same).not.toBe(offers);
    expect(offersUniverseFirst(offers, null).map((o) => o.id)).toEqual(same.map((o) => o.id));
  });

  it("étape 3 : les canaux de l'univers choisi d'abord, avec la même règle que les offres", () => {
    const channels = [
      { id: "test", vertical: null },
      { id: "bonus", vertical: "CASINO" },
      { id: "foot", vertical: "SPORTS" },
      { id: "vip", vertical: "CASINO" },
    ];
    expect(universeFirst(channels, "CASINO").map((c) => c.id)).toEqual([
      "bonus",
      "vip",
      "test",
      "foot",
    ]);
    expect(universeFirst(channels, null).map((c) => c.id)).toEqual([
      "test",
      "bonus",
      "foot",
      "vip",
    ]);
    expect(offersUniverseFirst).toBe(universeFirst);
  });

  it("étape 2 : offres masquées au singulier et au pluriel", () => {
    expect(hiddenOffersLabel(1)).toBe("1 masquée");
    expect(hiddenOffersLabel(3)).toBe("3 masquées");
    expect(hiddenOffersLabel(1200)).toBe("1\u202f200 masquées");
  });

  it("étape 2 : une offre choisie sans répéter son programme", () => {
    expect(
      offerChipLabel({
        name: "Démo · Casino Royal — Bienvenue 200 %",
        programName: "Démo · Casino Royal",
      }),
    ).toBe("Démo · Casino Royal — Bienvenue 200 %");
    // Sans tenir compte de la casse ni des accents.
    expect(
      offerChipLabel({ name: "demo · casino royal — Tours", programName: "Démo · Casino Royal" }),
    ).toBe("demo · casino royal — Tours");
    expect(offerChipLabel({ name: "Bienvenue 200 %", programName: "Casino Royal" })).toBe(
      "Casino Royal · Bienvenue 200 %",
    );
    expect(offerChipLabel({ name: "Bienvenue", programName: "" })).toBe("Bienvenue");
  });

  it("erreur : le champ fautif s'il est sur l'étape affichée, sinon rien (bandeau en haut)", () => {
    expect(fieldIdOnStep("name", "general")).toBe("wz-name");
    expect(fieldIdOnStep("endAt", "general")).toBe("wz-end");
    expect(fieldIdOnStep("budgetDaily", "general")).toBe("wz-budget");
    expect(fieldIdOnStep("channelIds", "channels")).toBe("wz-channels");
    expect(fieldIdOnStep("entryChannelId", "ads")).toBe("wz-entry-channel");
    // Le nom se corrige aussi dans le récapitulatif de l'étape 4.
    expect(fieldIdOnStep("name", "ads")).toBe("wz-name-final");
    expect(fieldIdOnStep("channelIds", "ads")).toBeNull();
    expect(fieldIdOnStep("endAt", "offers")).toBeNull();
  });

  it("quatre étapes nommées comme la spécification, une ligne d'aide courte chacune, sans jargon", () => {
    expect(WIZARD_STEPS.map((s) => s.title)).toEqual([
      "Nom et univers",
      "Offres",
      "Canaux",
      "Pubs",
    ]);
    for (const s of WIZARD_STEPS) {
      expect(s.help.length, s.key).toBeLessThan(120);
      expect(JARGON.test(s.help), s.key).toBe(false);
    }
  });

  it("propose les trois univers du client puis « Sans univers »", () => {
    expect(UNIVERSE_CHOICES.map((c) => c.label)).toEqual([
      "Casino",
      "Paris sportifs",
      "Rencontres",
      "Sans univers",
    ]);
    expect(UNIVERSE_CHOICES.at(-1)!.value).toBe("");
  });

  it("compte les réglages facultatifs remplis de l'étape 1", () => {
    expect(generalAdvancedCount({})).toBe(0);
    expect(generalAdvancedCount({ budgetDaily: " ", startAt: "", endAt: null, notes: "" })).toBe(0);
    expect(
      generalAdvancedCount({ budgetDaily: "50", startAt: "2026-10-01", endAt: "", notes: "x" }),
    ).toBe(3);
  });

  it("compte les réglages facultatifs de l'étape 4 (la campagne pub importée suppose un compte)", () => {
    expect(adsAdvancedCount({ connectionId: "", importedCampaignId: "" })).toBe(0);
    expect(adsAdvancedCount({ connectionId: "conn", importedCampaignId: "" })).toBe(1);
    expect(adsAdvancedCount({ connectionId: "conn", importedCampaignId: "shell" })).toBe(2);
    expect(adsAdvancedCount({ connectionId: "", importedCampaignId: "shell" })).toBe(0);
  });
});

describe("import CSV : étapes", () => {
  it("trois étapes avec une ligne d'aide", () => {
    expect(IMPORT_STEPS.map((s) => s.title)).toEqual(["Fichier", "Vérification", "Import"]);
    for (const s of IMPORT_STEPS) expect(s.help.length).toBeGreaterThan(10);
  });

  it("sans aperçu : étape 1 ; nouvel aperçu : vérification ; sinon l'étape choisie pour cet aperçu", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(importStep(null, null)).toBe(0);
    expect(importStep(null, { preview: a, step: 2 })).toBe(0);
    expect(importStep(a, null)).toBe(1);
    expect(importStep(a, { preview: a, step: 2 })).toBe(2);
    expect(importStep(a, { preview: a, step: 0 })).toBe(0);
    expect(importStep(b, { preview: a, step: 2 })).toBe(1);
    expect(importStep(a, { preview: a, step: 9 })).toBe(2);
    expect(importStep(a, { preview: a, step: -1 })).toBe(0);
  });
});
