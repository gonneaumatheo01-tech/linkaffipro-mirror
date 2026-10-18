import { describe, expect, it } from "vitest";
import { REJECT_CODES, type VeniceModelInfo } from "@linkaffipro/chat";
import { jargonIn } from "../../tests/vocabulary/jargon-scan";
import {
  aiFailureText,
  campaignOfferNote,
  offerChoiceGroups,
  personaDisplayName,
  personaListRow,
  personaModelOptions,
  rejectLabel,
  rejectLabels,
  styleLines,
  testBlockedReason,
  UNKNOWN_REJECT_LABEL,
} from "./view";

function model(over: Partial<VeniceModelInfo>): VeniceModelInfo {
  return {
    id: "m",
    name: "m",
    inputUsdPerM: 0.5,
    outputUsdPerM: 2,
    maxCompletionTokens: 4000,
    contextLength: 32000,
    supportsResponseSchema: true,
    supportsReasoning: false,
    uncensored: true,
    offline: false,
    deprecated: false,
    ...over,
  };
}

describe("liste des personas", () => {
  it("prénom, rôle, état Active / Inactive, offre liée, bots assistants seulement, conversations", () => {
    const row = personaListRow({
      id: "p1",
      name: "Léa",
      gender: "F",
      isActive: true,
      offer: { name: "Offre Rencontres", isActive: true },
      bots: [
        { username: "lea_bot", mode: "ASSISTANT" },
        { username: "autre_bot", mode: "STANDARD" },
      ],
      conversations: 12,
    });
    expect(row).toMatchObject({
      name: "Léa",
      role: "l'assistante",
      stateLabel: "Active",
      offerLabel: "Offre Rencontres",
      offerInactive: false,
      botsLabel: "@lea_bot",
      assistantBots: 1,
      conversations: 12,
    });
  });

  it("sans prénom, sans offre, sans bot ; offre devenue inactive signalée", () => {
    const item = {
      id: "p2",
      name: " ",
      gender: "M",
      isActive: false,
      offer: null,
      bots: [],
      conversations: 0,
    };
    const row = personaListRow(item);
    expect(row).toMatchObject({
      name: "Sans prénom",
      role: "l'assistant",
      stateLabel: "Inactive",
      offerLabel: "Aucune",
      botsLabel: "—",
    });
    expect(personaListRow({ ...item, offer: { name: "X", isActive: false } }).offerInactive).toBe(
      true,
    );
    expect(personaDisplayName(null)).toBe("Sans prénom");
  });
});

describe("choix de l'offre, de la campagne et du modèle", () => {
  it("offres de l'univers Rencontres d'abord, jamais le mot technique de l'univers dans les groupes", () => {
    const groups = offerChoiceGroups([
      {
        id: "c",
        name: "Casino Max",
        programName: "Casino Max",
        vertical: "CASINO",
        isActive: true,
      },
      { id: "d2", name: "Zen Love", programName: "Love Corp", vertical: "DATING", isActive: true },
      { id: "d1", name: "Amour", programName: "Love Corp", vertical: "DATING", isActive: false },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Rencontres", "Autres univers"]);
    expect(groups[0]!.options.map((o) => o.value)).toEqual(["d1", "d2"]);
    expect(groups[0]!.options[0]!.label).toBe("Amour · Love Corp (inactive)");
    expect(groups[1]!.options[0]!.label).toBe("Casino Max");
    for (const g of groups) expect(jargonIn(g.label)).toEqual([]);
  });

  it("sans offre de Rencontres : un seul groupe « Offres »", () => {
    const groups = offerChoiceGroups([
      { id: "c", name: "Casino", programName: "", vertical: null, isActive: true },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Offres"]);
  });

  it("avertit quand l'offre n'est pas une offre de la campagne choisie", () => {
    const campaign = { id: "c1", name: "Rencontres été", affiliateCampaignIds: ["aff1"] };
    expect(campaignOfferNote(campaign, "aff1")).toBeNull();
    expect(campaignOfferNote(campaign, "aff2")).toMatch(/Rencontres été/);
    expect(campaignOfferNote(null, "aff2")).toBeNull();
    expect(campaignOfferNote(campaign, "")).toBeNull();
  });

  it("modèles : « modèle par défaut des réglages » d'abord, du moins cher au plus cher, modèle actuel gardé", () => {
    const options = personaModelOptions(
      [
        model({ id: "cher", name: "cher", inputUsdPerM: 5, outputUsdPerM: 10 }),
        model({ id: "eco", name: "Éco", inputUsdPerM: 0.1, outputUsdPerM: 0.2 }),
        model({ id: "retire", deprecated: true }),
      ],
      "venice-uncensored-role-play",
      "ancien",
    );
    expect(options.map((o) => o.value)).toEqual(["", "ancien", "eco", "cher"]);
    expect(options[0]!.label).toContain("venice-uncensored-role-play");
    expect(options[1]!.label).toContain("absent de la liste");
    expect(options[2]!.label).toContain("Éco (eco)");
  });
});

describe("panneau « Tester »", () => {
  it("style détecté en lignes courtes", () => {
    expect(styleLines({})).toEqual([]);
    expect(
      styleLines({
        tone: "flirty",
        length: "short",
        emojis: "few",
        register: "casual",
        language: "fr",
        interest: 7,
      }),
    ).toEqual([
      "Ton : joueur, dragueur",
      "Messages courts",
      "Quelques emojis",
      "Registre familier",
      "Écrit en français",
      "Intérêt estimé : 7/10",
    ]);
  });

  it("refus des contrôles en français, sans doublon", () => {
    expect(rejectLabels(["link", "markdown", "link", "inconnu"])).toEqual([
      "lien ou pseudo dans le texte",
      "mise en forme interdite",
      "réponse refusée",
    ]);
  });

  it("consignes internes dévoilées : refus expliqué en clair", () => {
    expect(rejectLabels(["leak"])).toEqual(["a dévoilé ses consignes internes"]);
  });

  it("chaque code de refus du moteur (packages/chat) a son libellé, pour les deux genres, sans jargon", () => {
    expect(REJECT_CODES.length).toBeGreaterThan(0);
    const missing = REJECT_CODES.filter(
      (code) =>
        rejectLabel(code, "F") === UNKNOWN_REJECT_LABEL ||
        rejectLabel(code, "M") === UNKNOWN_REJECT_LABEL,
    );
    expect(missing).toEqual([]);
    for (const code of REJECT_CODES) {
      expect(jargonIn(rejectLabel(code, "F"))).toEqual([]);
      expect(rejectLabel(code, "F")).not.toContain("_");
    }
  });

  it("refus qui parlent de la persona : accordés à son genre", () => {
    expect(rejectLabels(["denies_assistant", "intro_missing"])).toEqual([
      "a nié être une assistante",
      "ne s'est pas présentée comme l'assistante du canal",
    ]);
    expect(rejectLabels(["denies_assistant", "intro_missing"], "M")).toEqual([
      "a nié être un assistant",
      "ne s'est pas présenté comme l'assistant du canal",
    ]);
  });

  it("pannes de l'IA expliquées à l'équipe", () => {
    expect(aiFailureText("auth")).toMatch(/clé/);
    expect(aiFailureText("balance")).toMatch(/solde/);
    expect(aiFailureText(null)).toMatch(/ne répond pas/);
  });

  it("test impossible sans clé (phrase adaptée au rôle) ou plafond atteint", () => {
    expect(testBlockedReason({ hasKey: false, isAdmin: true, spentEur: 0, capEur: 30 })).toMatch(
      /^Collez d'abord la clé Venice/,
    );
    expect(testBlockedReason({ hasKey: false, isAdmin: false, spentEur: 0, capEur: 30 })).toMatch(
      /^Un administrateur/,
    );
    expect(testBlockedReason({ hasKey: true, isAdmin: true, spentEur: 30, capEur: 30 })).toMatch(
      /Plafond mensuel atteint/,
    );
    expect(testBlockedReason({ hasKey: true, isAdmin: false, spentEur: 2, capEur: 30 })).toBeNull();
  });

  it("plafond réglé à 0 € : dit comme un choix, jamais « atteint »", () => {
    for (const isAdmin of [true, false]) {
      const r = testBlockedReason({ hasKey: true, isAdmin, spentEur: 0, capEur: 0 });
      expect(r).toMatch(/^Plafond mensuel réglé à 0 €/);
      expect(r).not.toMatch(/atteint/);
    }
  });
});
