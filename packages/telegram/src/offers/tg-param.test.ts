/**
 * Phase 13 : lien d'offre d'un membre amené par un affilié Link Affi → `&tg=<clé de sa campagne Telegram>` en plus du
 * sub-ID, seulement sur un lien d'offre Link Affi et pendant l'attribution ; clé de l'offre Link Affi relue par le bot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    trackingLink: { findUnique: vi.fn(), update: vi.fn() },
    affiliateCampaign: { findMany: vi.fn() },
    post: { findUnique: vi.fn() },
    member: { upsert: vi.fn() },
    memberBotState: { upsert: vi.fn() },
    click: { create: vi.fn(), count: vi.fn() },
    postStats: { upsert: vi.fn() },
  },
  recordEvent: vi.fn(async () => undefined),
  toJsonValue: (v: unknown) => v,
}));
vi.mock("@linkaffipro/db", () => db);
vi.mock("@linkaffipro/queue", () => ({
  emitAutomationEvent: vi.fn(),
  emitLinkaffiEvent: vi.fn(),
}));

import { isLinkaffiOfferUrl, offerDestination } from "./logic";
import { prismaOfferDeps } from "./prisma-deps";

const NOW = new Date("2026-10-14T12:00:00Z");
const TEMPLATE = "https://linkaffi.me/go/47eb8mwc?sub_id={subid}";

describe("adresse finale d'un clic d'offre", () => {
  const base = {
    template: TEMPLATE,
    subId: "Ab12Cd34Ef56",
    memberId: "m1",
    postId: null,
    offerCampaignKey: "47eb8mwc",
    now: NOW,
  };

  it("membre d'un affilié, attribution à vie : `&tg=` ajouté au lien Link Affi, sub-ID inchangé", () => {
    expect(
      offerDestination({
        ...base,
        affiliate: { campaignKey: "paulTG01", attributionEndsAt: null },
      }),
    ).toEqual({
      destination: "https://linkaffi.me/go/47eb8mwc?sub_id=Ab12Cd34Ef56&tg=paulTG01",
      telegramCampaignKey: "paulTG01",
    });
  });

  it("attribution en cours (durée limitée) : `tg` ; terminée : rien", () => {
    const later = new Date(NOW.getTime() + 86_400_000);
    expect(
      offerDestination({
        ...base,
        affiliate: { campaignKey: "paulTG01", attributionEndsAt: later },
      }).telegramCampaignKey,
    ).toBe("paulTG01");
    const ended = offerDestination({
      ...base,
      affiliate: { campaignKey: "paulTG01", attributionEndsAt: NOW },
    });
    expect(ended).toEqual({
      destination: "https://linkaffi.me/go/47eb8mwc?sub_id=Ab12Cd34Ef56",
      telegramCampaignKey: null,
    });
  });

  it("membre sans affilié : lien d'origine", () => {
    for (const affiliate of [null, undefined, { campaignKey: null, attributionEndsAt: null }])
      expect(offerDestination({ ...base, affiliate })).toEqual({
        destination: "https://linkaffi.me/go/47eb8mwc?sub_id=Ab12Cd34Ef56",
        telegramCampaignKey: null,
      });
  });

  it("jamais sur une autre adresse : offre non Link Affi, lien court, page d'atterrissage, autre clé", () => {
    const affiliate = { campaignKey: "paulTG01", attributionEndsAt: null };
    expect(
      offerDestination({ ...base, affiliate, offerCampaignKey: null }).telegramCampaignKey,
    ).toBeNull();
    for (const template of [
      "https://casino.example/landing?sub={subid}",
      "https://linkaffi.me/s/47eb8mwc?sub_id={subid}",
      "https://linkaffi.me/go/autrecle?sub_id={subid}",
    ]) {
      const r = offerDestination({ ...base, affiliate, template });
      expect(r.telegramCampaignKey).toBeNull();
      expect(r.destination).not.toContain("tg=");
    }
  });

  it("domaine propre de l'offre Link Affi : `tg` ajouté aussi", () => {
    const r = offerDestination({
      ...base,
      template: "https://go.monsite.fr/go/47eb8mwc?sub_id={subid}",
      affiliate: { campaignKey: "paulTG01", attributionEndsAt: null },
    });
    expect(r.destination).toBe("https://go.monsite.fr/go/47eb8mwc?sub_id=Ab12Cd34Ef56&tg=paulTG01");
  });

  it("reconnaît le lien de suivi Link Affi `/go/<clé>`", () => {
    expect(isLinkaffiOfferUrl("https://linkaffi.me/go/47eb8mwc?sub_id=x", "47eb8mwc")).toBe(true);
    expect(isLinkaffiOfferUrl("https://linkaffi.me/go/47eb8mwc/?sub_id=x", "47eb8mwc")).toBe(true);
    expect(isLinkaffiOfferUrl("https://linkaffi.me/go/47eb8mwcX", "47eb8mwc")).toBe(false);
    expect(isLinkaffiOfferUrl("javascript:alert(1)//go/47eb8mwc", "47eb8mwc")).toBe(false);
    expect(isLinkaffiOfferUrl("pas une adresse", "47eb8mwc")).toBe(false);
  });
});

function link(over: Record<string, unknown> = {}) {
  return {
    id: "tl1",
    kind: "OFFER",
    isActive: true,
    postId: null,
    channelId: "c1",
    channel: { id: "c1", language: "fr" },
    destinationTemplate: "https://autre.example/?s={subid}",
    affiliateCampaignId: "aff1",
    affiliateCampaign: {
      trackingUrlTemplate: TEMPLATE,
      isActive: true,
      campaignKey: "47eb8mwc",
      program: { source: "LINKAFFI" },
    },
    campaignId: null,
    campaign: null,
    ...over,
  };
}

describe("clé Link Affi de l'offre (resolveOffer)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offre Link Affi : sa clé", async () => {
    db.prisma.trackingLink.findUnique.mockResolvedValue(link());
    const r = await prismaOfferDeps.resolveOffer("abc12345", null);
    expect(r).toMatchObject({ destinationTemplate: TEMPLATE, offerCampaignKey: "47eb8mwc" });
  });

  it("offre d'un autre programme (import, autre plateforme) : aucune clé", async () => {
    db.prisma.trackingLink.findUnique.mockResolvedValue(
      link({
        affiliateCampaign: {
          trackingUrlTemplate: TEMPLATE,
          isActive: true,
          campaignKey: "47eb8mwc",
          program: { source: "CSV" },
        },
      }),
    );
    expect((await prismaOfferDeps.resolveOffer("abc12345", null))?.offerCampaignKey).toBeNull();
  });

  it("bouton sans offre Link Affi (adresse saisie) : aucune clé", async () => {
    db.prisma.trackingLink.findUnique.mockResolvedValue(
      link({ affiliateCampaignId: null, affiliateCampaign: null }),
    );
    const r = await prismaOfferDeps.resolveOffer("abc12345", null);
    expect(r).toMatchObject({
      destinationTemplate: "https://autre.example/?s={subid}",
      offerCampaignKey: null,
    });
  });

  it("offre remplacée par celle de la campagne : clé de l'offre utilisée", async () => {
    db.prisma.trackingLink.findUnique.mockResolvedValue(
      link({ campaignId: "camp1", campaign: { id: "camp1", affiliateCampaignIds: ["aff2"] } }),
    );
    db.prisma.affiliateCampaign.findMany.mockResolvedValue([
      {
        id: "aff2",
        trackingUrlTemplate: "https://linkaffi.me/go/newkey01?sub_id={subid}",
        isActive: true,
        campaignKey: "newkey01",
        program: { source: "LINKAFFI" },
      },
    ]);
    const r = await prismaOfferDeps.resolveOffer("abc12345", null);
    expect(r).toMatchObject({
      destinationTemplate: "https://linkaffi.me/go/newkey01?sub_id={subid}",
      offerCampaignKey: "newkey01",
    });
  });
});

describe("membre et clic (prisma)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("memberStarted renvoie l'affilié du membre (jamais celui d'un membre anonymisé)", async () => {
    const ends = new Date("2026-11-01T00:00:00Z");
    db.prisma.member.upsert.mockResolvedValueOnce({
      id: "m1",
      anonymizedAt: null,
      linkaffiCampaignKey: "paulTG01",
      affiliateAttributionEndsAt: ends,
    });
    const from = { id: 42, is_bot: false, first_name: "Jean" };
    expect(await prismaOfferDeps.memberStarted("bot_1", from)).toEqual({
      memberId: "m1",
      affiliate: { campaignKey: "paulTG01", attributionEndsAt: ends },
    });
    db.prisma.member.upsert.mockResolvedValueOnce({
      id: "m2",
      anonymizedAt: new Date(),
      linkaffiCampaignKey: "paulTG01",
      affiliateAttributionEndsAt: null,
    });
    expect(await prismaOfferDeps.memberStarted("bot_1", from)).toEqual({
      memberId: "m2",
      affiliate: null,
    });
  });

  it("recordOfferClick copie la campagne Telegram sur le clic et dans le journal", async () => {
    db.prisma.click.create.mockResolvedValue({ id: "click1" });
    db.prisma.click.count.mockResolvedValue(0);
    db.prisma.trackingLink.findUnique.mockResolvedValue({ affiliateCampaignId: "aff1" });
    await prismaOfferDeps.recordOfferClick({
      trackingLinkId: "tl1",
      postId: null,
      memberId: "m1",
      botId: "bot_1",
      subId: "Ab12Cd34Ef56",
      destination: "https://linkaffi.me/go/47eb8mwc?sub_id=Ab12Cd34Ef56&tg=paulTG01",
      linkaffiTelegramCampaignKey: "paulTG01",
    });
    expect(db.prisma.click.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ linkaffiTelegramCampaignKey: "paulTG01" }),
      }),
    );
    expect(db.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "click.offer",
        payload: expect.objectContaining({ linkaffiTelegramCampaignKey: "paulTG01" }),
      }),
    );
  });
});
