import { describe, expect, it } from "vitest";
import {
  automationOfferButtons,
  isOfferButton,
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

describe("bouton « Offre (campagne) » d'un message de relance (phase 10)", () => {
  const offer = {
    text: "Voir l'offre",
    type: "OFFER",
    campaignId: "camp1",
    affiliateCampaignId: "aff1",
  } as const;

  it("accepté à côté des liens simples, enregistré tel quel (campagne + offre, sans adresse)", () => {
    const [a] = parseActions([
      {
        type: "send_message",
        text: "Bonjour {prenom}",
        buttons: [[{ ...offer, text: " Voir l'offre " }], [{ text: "Site", url: "https://x.y" }]],
      },
    ]);
    expect(a).toMatchObject({
      type: "send_message",
      buttons: [[offer], [{ text: "Site", url: "https://x.y" }]],
    });
    const rows = (a as Extract<typeof a, { type: "send_message" }>).buttons!;
    expect(isOfferButton(rows[0]![0]!)).toBe(true);
    expect(isOfferButton(rows[1]![0]!)).toBe(false);
  });

  it("une règle existante à liens simples reste lue à l'identique", () => {
    const raw = [
      { type: "wait", hours: 24 },
      { type: "send_message", text: "Salut", buttons: [[{ text: "Voir", url: "https://x.y" }]] },
    ];
    expect(parseActions(raw)).toEqual([
      { type: "wait", hours: 24 },
      {
        type: "send_message",
        text: "Salut",
        buttons: [[{ text: "Voir", url: "https://x.y" }]],
        mediaAssetId: null,
        botId: null,
      },
    ]);
  });

  it("refuse un bouton Offre sans campagne, sans offre ou sans libellé (message en français)", () => {
    const send = (b: Record<string, unknown>) =>
      parseActions([{ type: "send_message", text: "x", buttons: [[b]] }]);
    expect(() => send({ ...offer, campaignId: "" })).toThrow(/choisissez la campagne/);
    expect(() => send({ ...offer, affiliateCampaignId: undefined })).toThrow(
      /choisissez la campagne/,
    );
    expect(() => send({ ...offer, text: "  " })).toThrow(/libellé/);
  });

  it("liste les boutons Offre d'une liste d'actions (vérification à l'enregistrement)", () => {
    const actions = parseActions([
      { type: "send_message", text: "a", buttons: [[offer, { text: "Site", url: "https://x.y" }]] },
      { type: "wait", hours: 1 },
      { type: "send_message", text: "b" },
    ]);
    expect(automationOfferButtons(actions)).toEqual([offer]);
  });
});
