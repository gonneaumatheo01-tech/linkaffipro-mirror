import { describe, expect, it } from "vitest";
import { toPersonaInput, type PersonaRow } from "./rules";

const persona: PersonaRow = {
  name: "Léa",
  gender: "F",
  personality: "",
  tone: "",
  languages: ["fr"],
  interests: [],
  extraPrompt: null,
  model: null,
  temperature: null,
  minExchangesBeforeOffer: 4,
  requireInterest: true,
  maxOfferSends: 2,
  followUpAfterHours: 24,
  followUpsMax: 2,
  affiliateCampaignId: null,
  offerPitch: "",
  offerButtonText: "Découvrir l'app",
  offerMediaAssetId: null,
};
const extras = { offerUsable: false, channelTitle: null, botName: null };

describe("heures de relance conseillées (phase 21) transmises au moteur", () => {
  it("lues seulement si le champ est rempli (recommandation appliquée)", () => {
    expect(toPersonaInput(persona, extras).suggestedFollowUpHours).toBeNull();
    expect(toPersonaInput({ ...persona, suggestedFollowUpHours: null }, extras).suggestedFollowUpHours).toBeNull();
    expect(toPersonaInput({ ...persona, suggestedFollowUpHours: [] }, extras).suggestedFollowUpHours).toBeNull();
    expect(toPersonaInput({ ...persona, suggestedFollowUpHours: [20, 19, 3] }, extras).suggestedFollowUpHours).toEqual([19, 20]);
  });
});
