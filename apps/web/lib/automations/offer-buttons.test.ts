import { beforeEach, describe, expect, it, vi } from "vitest";
import { linearToGraph, templateGraph } from "@linkaffipro/core";

const check = vi.hoisted(() => ({
  resolveOfferButton: vi.fn(async (..._args: unknown[]) => ({})),
}));
vi.mock("@/lib/campaigns/offer-button", () => check);

import {
  assertRuleOfferButtons,
  ruleOfferButtons,
  storedRuleHasOfferButton,
} from "./offer-buttons";

const offer = {
  text: "Voir l'offre",
  type: "OFFER" as const,
  campaignId: "c1",
  affiliateCampaignId: "a1",
};
const link = { text: "Aide", url: "https://x.y" };

beforeEach(() => vi.clearAllMocks());

describe("boutons « Offre (campagne) » d'une relance", () => {
  it("trouvés dans la liste d'actions et dans le parcours à branches, sans doublon", () => {
    const actions = [
      { type: "send_message" as const, text: "a", buttons: [[offer], [link]] },
      { type: "wait" as const, hours: 1 },
    ];
    expect(ruleOfferButtons({ actions, graph: linearToGraph(actions) })).toEqual([offer]);
    const graph = templateGraph("offer_no_signup", {
      message: { text: "b", buttons: [[{ ...offer, campaignId: "c2" }]] },
    });
    expect(ruleOfferButtons({ actions: [], graph })).toEqual([{ ...offer, campaignId: "c2" }]);
    expect(
      ruleOfferButtons({ actions: [{ type: "send_message", text: "c" }], graph: null }),
    ).toEqual([]);
  });

  it("chaque bouton est vérifié comme un bouton Offre de message (campagne et offre)", async () => {
    await assertRuleOfferButtons({
      actions: [{ type: "send_message", text: "a", buttons: [[offer, link]] }],
      graph: null,
    });
    expect(check.resolveOfferButton).toHaveBeenCalledTimes(1);
    expect(check.resolveOfferButton).toHaveBeenCalledWith({
      text: "Voir l'offre",
      type: "OFFER",
      campaignId: "c1",
      affiliateCampaignId: "a1",
    });
    check.resolveOfferButton.mockRejectedValueOnce(new Error("Bouton « Voir l'offre » : refusé"));
    await expect(
      assertRuleOfferButtons({
        actions: [{ type: "send_message", text: "a", buttons: [[offer]] }],
        graph: null,
      }),
    ).rejects.toThrow(/refusé/);
  });

  it("relance enregistrée (JSON brut) : a-t-elle un bouton Offre ? liste, parcours, parcours illisible", () => {
    const actions = [{ type: "send_message", text: "a", buttons: [[offer], [link]] }];
    expect(storedRuleHasOfferButton({ actions, graph: null })).toBe(true);
    expect(
      storedRuleHasOfferButton({ actions: [{ type: "send_message", text: "a" }], graph: null }),
    ).toBe(false);
    const graph = templateGraph("offer_no_signup", { message: { text: "b", buttons: [[offer]] } });
    expect(storedRuleHasOfferButton({ actions: [], graph })).toBe(true);
    expect(
      storedRuleHasOfferButton({
        actions: [],
        graph: templateGraph("offer_no_signup", { message: { text: "b", buttons: [[link]] } }),
      }),
    ).toBe(false);
    expect(storedRuleHasOfferButton({ actions: "abîmé", graph: null })).toBe(false);
    expect(storedRuleHasOfferButton({ actions: [], graph: { nodes: "abîmé" } })).toBe(false);
  });
});
