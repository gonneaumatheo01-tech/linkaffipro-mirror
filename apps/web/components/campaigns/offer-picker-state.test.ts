import { describe, expect, it } from "vitest";
import { offerPickerState, pickOfferOption } from "./offer-picker-state";

const campaigns = [
  {
    id: "c1",
    name: "Casino FR",
    vertical: "CASINO",
    status: "ACTIVE",
    offers: [{ id: "aff1", name: "Offre 1", programName: "Casino X" }],
  },
  {
    id: "c2",
    name: "Multi",
    vertical: null,
    status: "ACTIVE",
    offers: [
      { id: "aff2", name: "Offre 2", programName: "Casino Y" },
      { id: "aff3", name: "Offre 3", programName: "Casino Z" },
    ],
  },
  { id: "c3", name: "Sans offre", vertical: null, status: "DRAFT", offers: [] },
];
const affiliates = [
  { id: "aff1", name: "Offre 1", programName: "Casino X" },
  { id: "aff9", name: "Offre 9", programName: "Autre" },
];

describe("choix du bouton Offre", () => {
  it("nouveau bouton : rien de choisi, aucun lien direct proposé", () => {
    const s = offerPickerState({}, campaigns, affiliates);
    expect(s).toMatchObject({ current: "", legacy: null, warning: null });
    expect(pickOfferOption("aff:aff9", {}, campaigns)).toBeNull();
  });

  it("ancien bouton sans campagne : seule sa propre offre apparaît dans « Sans campagne », avec une invitation à rattacher", () => {
    const s = offerPickerState({ affiliateCampaignId: "aff9" }, campaigns, affiliates);
    expect(s.current).toBe("aff:aff9");
    expect(s.legacy?.id).toBe("aff9");
    expect(s.warning).toMatch(/choisissez la campagne/);
    expect(pickOfferOption("aff:aff9", { affiliateCampaignId: "aff9" }, campaigns)).toEqual({
      affiliateCampaignId: "aff9",
    });
    expect(pickOfferOption("aff:aff1", { affiliateCampaignId: "aff9" }, campaigns)).toBeNull();
  });

  it("choisir une campagne prend sa première offre (ou garde l'offre actuelle si elle y est)", () => {
    expect(pickOfferOption("camp:c2", {}, campaigns)).toEqual({
      campaignId: "c2",
      affiliateCampaignId: "aff2",
    });
    expect(pickOfferOption("camp:c2", { affiliateCampaignId: "aff3" }, campaigns)).toEqual({
      campaignId: "c2",
      affiliateCampaignId: "aff3",
    });
    expect(pickOfferOption("camp:c3", {}, campaigns)).toBeNull();
  });

  it("l'offre du bouton n'est plus dans la campagne : avertissement et choix de l'offre forcé", () => {
    const s = offerPickerState(
      { campaignId: "c1", affiliateCampaignId: "aff-retiree" },
      campaigns,
      affiliates,
    );
    expect(s.current).toBe("camp:c1");
    expect(s.showOfferSelect).toBe(true);
    expect(s.warning).toMatch(/n'est plus dans la campagne/);
  });

  it("campagne supprimée ou sans offre : signalée", () => {
    const s = offerPickerState(
      { campaignId: "c3", affiliateCampaignId: "aff1" },
      campaigns,
      affiliates,
    );
    expect(s.missingCampaign).toBe(true);
    expect(s.warning).toMatch(/supprimée ou n'a plus d'offre/);
  });

  it("bouton correct : pas d'avertissement ; second menu seulement s'il y a plusieurs offres", () => {
    expect(
      offerPickerState({ campaignId: "c1", affiliateCampaignId: "aff1" }, campaigns, affiliates),
    ).toMatchObject({ warning: null, showOfferSelect: false });
    expect(
      offerPickerState({ campaignId: "c2", affiliateCampaignId: "aff3" }, campaigns, affiliates),
    ).toMatchObject({ warning: null, showOfferSelect: true });
  });
});
