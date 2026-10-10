/**
 * Résolution d'un bouton Offre par le bot : le lien Link Affi suit la campagne du bouton. Si l'offre enregistrée sur
 * le bouton a été retirée de la campagne (ou désactivée), le bot prend la première offre active de la campagne et
 * le journalise (Event `offer.campaign_fallback`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    trackingLink: { findUnique: vi.fn() },
    affiliateCampaign: { findMany: vi.fn() },
    post: { findUnique: vi.fn() },
  },
  recordEvent: vi.fn(async () => undefined),
}));
vi.mock("@linkaffipro/db", () => db);
vi.mock("@linkaffipro/queue", () => ({ emitAutomationEvent: vi.fn() }));

import { prismaOfferDeps } from "./prisma-deps";
import { pickCampaignOffer } from "./logic";

const OLD = "https://linkaffi.me/go/oldkey01?sub_id={subid}";
const NEW = "https://linkaffi.me/go/newkey01?sub_id={subid}";

function link(over: Record<string, unknown> = {}) {
  return {
    id: "tl1",
    kind: "OFFER",
    isActive: true,
    postId: null,
    channelId: "c1",
    channel: { id: "c1", language: "fr" },
    destinationTemplate: OLD,
    affiliateCampaignId: "aff-old",
    affiliateCampaign: { trackingUrlTemplate: OLD, isActive: true },
    campaignId: "camp1",
    campaign: { id: "camp1", affiliateCampaignIds: ["aff-new", "aff-other"] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.prisma.affiliateCampaign.findMany.mockResolvedValue([
    { id: "aff-other", trackingUrlTemplate: "https://linkaffi.me/go/other001", isActive: true },
    { id: "aff-new", trackingUrlTemplate: NEW, isActive: true },
  ]);
});

describe("choix de l'offre d'une campagne (règle pure)", () => {
  const offers = [
    { id: "a", trackingUrlTemplate: "A", isActive: true },
    { id: "b", trackingUrlTemplate: "B", isActive: true },
    { id: "z", trackingUrlTemplate: "Z", isActive: false },
  ];
  it("garde l'offre du bouton si elle est toujours dans la campagne et active", () => {
    expect(pickCampaignOffer("b", ["a", "b"], offers)).toEqual({
      offerId: "b",
      template: "B",
      replaced: false,
    });
  });
  it("sinon prend la première offre active, dans l'ordre de la campagne", () => {
    expect(pickCampaignOffer("x", ["z", "b", "a"], offers)).toEqual({
      offerId: "b",
      template: "B",
      replaced: true,
    });
    expect(pickCampaignOffer("z", ["z", "a"], offers)).toEqual({
      offerId: "a",
      template: "A",
      replaced: true,
    });
  });
  it("aucune offre active dans la campagne : rien (on garde le lien d'origine)", () => {
    expect(pickCampaignOffer("x", ["z"], offers)).toBeNull();
    expect(pickCampaignOffer("x", [], offers)).toBeNull();
  });
});

describe("resolveOffer", () => {
  it("offre retirée de la campagne : première offre active de la campagne + Event", async () => {
    db.prisma.trackingLink.findUnique.mockResolvedValue(link());
    const r = await prismaOfferDeps.resolveOffer("abc12345", null);
    expect(r?.destinationTemplate).toBe(NEW);
    expect(db.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "offer.campaign_fallback",
        channelId: "c1",
        payload: expect.objectContaining({
          trackingLinkId: "tl1",
          campaignId: "camp1",
          fromAffiliateCampaignId: "aff-old",
          toAffiliateCampaignId: "aff-new",
        }),
      }),
    );
  });

  it("offre toujours dans la campagne : lien d'origine, aucun Event", async () => {
    db.prisma.trackingLink.findUnique.mockResolvedValue(
      link({ campaign: { id: "camp1", affiliateCampaignIds: ["aff-old", "aff-new"] } }),
    );
    db.prisma.affiliateCampaign.findMany.mockResolvedValue([
      { id: "aff-old", trackingUrlTemplate: OLD, isActive: true },
      { id: "aff-new", trackingUrlTemplate: NEW, isActive: true },
    ]);
    const r = await prismaOfferDeps.resolveOffer("abc12345", null);
    expect(r?.destinationTemplate).toBe(OLD);
    expect(db.recordEvent).not.toHaveBeenCalled();
  });

  it("bouton sans campagne (ancien) : lien d'origine, sans consulter les campagnes", async () => {
    db.prisma.trackingLink.findUnique.mockResolvedValue(link({ campaignId: null, campaign: null }));
    const r = await prismaOfferDeps.resolveOffer("abc12345", null);
    expect(r?.destinationTemplate).toBe(OLD);
    expect(db.prisma.affiliateCampaign.findMany).not.toHaveBeenCalled();
    expect(db.recordEvent).not.toHaveBeenCalled();
  });
});
