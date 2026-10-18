import { describe, expect, it } from "vitest";
import { canSendOffer, decideStage, offerAllowedNow, offerSendsAllowed } from "./journey";

const persona = {
  minExchangesBeforeOffer: 4,
  requireInterest: true,
  maxOfferSends: 2,
  hasOffer: true,
};
const conv = { memberMessages: 5, offerSends: 0, isMinor: false, isFirstAssistantTurn: false };
const yes = { send_offer: true, style_update: { interest: 7 } };

describe("canSendOffer", () => {
  it("le lien part quand toutes les règles sont réunies et que le modèle le propose", () => {
    expect(canSendOffer(conv, persona, yes)).toBe(true);
  });

  it("jamais au premier message de l'assistant, même si le modèle le propose", () => {
    expect(
      canSendOffer(
        { ...conv, isFirstAssistantTurn: true },
        { ...persona, minExchangesBeforeOffer: 0 },
        yes,
      ),
    ).toBe(false);
  });

  it("refusé : modèle contre, trop tôt, intérêt trop bas, plafond d'envois, mineur, sans offre, relance", () => {
    expect(canSendOffer(conv, persona, { ...yes, send_offer: false })).toBe(false);
    expect(canSendOffer({ ...conv, memberMessages: 3 }, persona, yes)).toBe(false);
    expect(canSendOffer(conv, persona, { send_offer: true, style_update: { interest: 5 } })).toBe(
      false,
    );
    expect(
      canSendOffer(
        conv,
        { ...persona, requireInterest: false },
        { send_offer: true, style_update: { interest: 1 } },
      ),
    ).toBe(true);
    expect(canSendOffer({ ...conv, offerSends: 2 }, persona, yes)).toBe(false);
    expect(canSendOffer({ ...conv, isMinor: true }, persona, yes)).toBe(false);
    expect(canSendOffer(conv, { ...persona, hasOffer: false }, yes)).toBe(false);
    expect(canSendOffer(conv, persona, yes, "follow_up")).toBe(false);
  });

  it("au moins 1 message de la personne, 1 à 3 envois", () => {
    expect(
      offerAllowedNow({ ...conv, memberMessages: 0 }, { ...persona, minExchangesBeforeOffer: 0 }),
    ).toBe(false);
    expect(offerSendsAllowed({ maxOfferSends: 9 })).toBe(3);
    expect(offerSendsAllowed({ maxOfferSends: 0 })).toBe(1);
  });
});

describe("decideStage : le modèle propose, le code décide", () => {
  const base = {
    proposed: null,
    offerSent: false,
    kind: "reply" as const,
    isFirstAssistantTurn: false,
    offerSendsBefore: 0,
  };
  it("premier message → WELCOME ; ensuite au moins CHAT", () => {
    expect(
      decideStage({
        ...base,
        current: "WELCOME",
        isFirstAssistantTurn: true,
        proposed: "PROPOSAL",
      }),
    ).toBe("WELCOME");
    expect(decideStage({ ...base, current: "WELCOME", proposed: "WELCOME" })).toBe("CHAT");
  });
  it("LINK_SENT seulement si le lien part vraiment", () => {
    expect(decideStage({ ...base, current: "PROPOSAL", proposed: "LINK_SENT" })).toBe("PROPOSAL");
    expect(decideStage({ ...base, current: "CHAT", offerSent: true })).toBe("LINK_SENT");
  });
  it("CONVERTED et CLOSED jamais proposés par le modèle, jamais quittés ici", () => {
    expect(decideStage({ ...base, current: "CHAT", proposed: "CONVERTED" })).toBe("CHAT");
    expect(decideStage({ ...base, current: "CHAT", proposed: "CLOSED" })).toBe("CHAT");
    expect(decideStage({ ...base, current: "CONVERTED", offerSent: true })).toBe("CONVERTED");
  });
  it("pas de retour en arrière ; relance → FOLLOW_UP ; réponse après relance → étape d'avant", () => {
    expect(decideStage({ ...base, current: "PROPOSAL", proposed: "CHAT" })).toBe("PROPOSAL");
    expect(decideStage({ ...base, current: "CHAT", proposed: "PROPOSAL" })).toBe("PROPOSAL");
    expect(decideStage({ ...base, current: "LINK_SENT", kind: "follow_up" })).toBe("FOLLOW_UP");
    expect(
      decideStage({ ...base, current: "FOLLOW_UP", proposed: "CHAT", offerSendsBefore: 1 }),
    ).toBe("LINK_SENT");
    expect(decideStage({ ...base, current: "FOLLOW_UP", proposed: "CHAT" })).toBe("CHAT");
  });
});
