import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ campaign: { findUnique: vi.fn() } }));
vi.mock("@linkaffipro/db", () => ({ prisma: db }));

import { campaignScope } from "./campaign-scope";

describe("périmètre d'une campagne pour les filtres", () => {
  beforeEach(() => vi.clearAllMocks());

  it("réunit canaux, liens d'entrée, liens goolink (directs et des pubs précises) et offres", async () => {
    db.campaign.findUnique.mockResolvedValue({
      channelIds: ["ch1", "ch2"],
      affiliateCampaignIds: ["aff1"],
      inviteLinks: [{ id: "il1" }],
      trackingLinks: [{ id: "tl1" }],
      adSets: [{ ads: [{ inviteLinkId: "il2", trackingLinkId: "tl2" }, { inviteLinkId: "il1", trackingLinkId: null }] }],
    });
    expect(await campaignScope("c1")).toEqual({ channelIds: ["ch1", "ch2"], inviteLinkIds: ["il1", "il2"], trackingLinkIds: ["tl1", "tl2"], affiliateCampaignIds: ["aff1"] });
    expect(db.campaign.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1" } }));
  });

  it("renvoie un périmètre vide pour une campagne inconnue", async () => {
    db.campaign.findUnique.mockResolvedValue(null);
    expect(await campaignScope("absente")).toEqual({ channelIds: [], inviteLinkIds: [], trackingLinkIds: [], affiliateCampaignIds: [] });
  });
});
