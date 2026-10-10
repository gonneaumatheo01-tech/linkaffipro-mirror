import { describe, expect, it } from "vitest";
import {
  matchesConditions,
  parseActions,
  parseConditions,
  renderActionText,
  summarizeActions,
} from "./automation";

describe("conditions", () => {
  it("valide et nettoie", () => {
    expect(
      parseConditions({
        channelIds: [" a ", ""],
        languages: ["FR"],
        inactiveDays: "7",
        spendLevels: ["VIP"],
      }),
    ).toEqual({ channelIds: ["a"], languages: ["fr"], inactiveDays: 7, spendLevels: ["VIP"] });
    expect(parseConditions(undefined)).toEqual({});
  });
  it("refuse les valeurs invalides", () => {
    expect(() => parseConditions({ spendLevels: ["ROI"] })).toThrow(/Niveau de dépense inconnu/);
    expect(() => parseConditions({ inactiveDays: 0 })).toThrow(/entier/);
    expect(() => parseConditions([])).toThrow(/objet/);
    // Vocabulaire : « campagnes » (les nôtres), plus « pubs ».
    expect(() => parseConditions({ campaignIds: "k1" })).toThrow(/campagnes/);
  });
  it("applique un ET logique et ignore les conditions vides", () => {
    const c = parseConditions({ channelIds: ["c1"], languages: ["fr"], inactiveDays: 3 });
    expect(matchesConditions({ channelId: "c1", languageCode: "fr-FR", inactiveDays: 5 }, c)).toBe(
      true,
    );
    expect(matchesConditions({ channelId: "c2", languageCode: "fr", inactiveDays: 5 }, c)).toBe(
      false,
    );
    expect(matchesConditions({ channelId: "c1", languageCode: "en", inactiveDays: 5 }, c)).toBe(
      false,
    );
    expect(matchesConditions({ channelId: "c1", languageCode: "fr", inactiveDays: 2 }, c)).toBe(
      false,
    );
    expect(matchesConditions({}, {})).toBe(true);
    expect(matchesConditions({ spendLevel: "VIP" }, { spendLevels: ["REGULIER", "VIP"] })).toBe(
      true,
    );
    expect(matchesConditions({ spendLevel: null }, { spendLevels: ["VIP"] })).toBe(false);
  });
});

describe("actions", () => {
  it("valide chaque type", () => {
    const actions = parseActions([
      {
        type: "send_message",
        text: "Salut {prenom}",
        buttons: [[{ text: "Voir", url: "https://x.y" }]],
      },
      { type: "wait", hours: 24 },
      { type: "tag", tag: " vip " },
      { type: "send_sequence", trigger: "APPROVED" },
      { type: "suggest_channel", channelId: "c2", text: "Rejoins-nous" },
      { type: "notify_team", text: "Nouveau dépôt" },
    ]);
    expect(actions).toHaveLength(6);
    expect(actions[2]).toEqual({ type: "tag", tag: "vip" });
    expect(summarizeActions(actions)).toBe(
      "Message → Attendre 24 h → Étiquette « vip » → Message du bot « Accepté » → Proposer un canal → Prévenir l'équipe",
    );
  });
  it("refuse les actions invalides avec un message en français", () => {
    expect(() => parseActions([{ type: "send_message", text: "" }])).toThrow(/texte du message/);
    expect(() => parseActions([{ type: "wait", hours: -1 }])).toThrow(/attendre/);
    expect(() =>
      parseActions([
        { type: "send_message", text: "x", buttons: [[{ text: "a", url: "ftp://z" }]] },
      ]),
    ).toThrow(/URL http/);
    expect(() => parseActions([{ type: "danse" }])).toThrow(/type inconnu/);
    expect(() =>
      parseActions(Array.from({ length: 9 }, () => ({ type: "tag", tag: "a" }))),
    ).toThrow(/maximum 8/);
  });
  it("remplace les placeholders", () => {
    expect(
      renderActionText("Salut {prenom}, bienvenue sur {canal} ({bot}) {inconnu}", {
        prenom: "Léa",
        canal: "Test",
        bot: "CasinoBot",
      }),
    ).toBe("Salut Léa, bienvenue sur Test (CasinoBot) {inconnu}");
  });
});
