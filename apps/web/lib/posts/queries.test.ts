import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {} }));
vi.mock("@/lib/dashboard/campaign-scope", () => ({ campaignScope: vi.fn() }));

import { postListWhere } from "./queries";

const base = { channelId: "", status: "", categoryId: "", from: "", to: "" };

describe("filtre « Campagne » de la liste des messages", () => {
  it("sans campagne : aucune condition supplémentaire", () => {
    expect(postListWhere(base)).toEqual({ isTemplate: false });
  });
  it("avec campagne : messages de ses canaux ou portant un bouton vers ses offres (ou un lien rattaché)", () => {
    const w = postListWhere({ ...base, campaignId: "c1" }, { channelIds: ["ch1"], inviteLinkIds: [], trackingLinkIds: [], affiliateCampaignIds: ["aff1"] });
    expect(w.isTemplate).toBe(false);
    const and = w.AND as Array<{ OR: unknown[] }>;
    expect(and[0]!.OR).toEqual([
      { trackingLinks: { some: { campaignId: "c1" } } },
      { channelId: { in: ["ch1"] } },
      { trackingLinks: { some: { affiliateCampaignId: { in: ["aff1"] } } } },
    ]);
  });
  it("se combine avec les autres filtres", () => {
    const w = postListWhere({ ...base, channelId: "ch2", status: "SENT", campaignId: "c1" }, { channelIds: ["ch1"], inviteLinkIds: [], trackingLinkIds: [], affiliateCampaignIds: [] });
    expect(w.channelId).toBe("ch2");
    expect(w.status).toBe("SENT");
    expect(w.AND).toHaveLength(1);
  });
});
