/**
 * Synchro d'un compte pub connecté : une campagne pub encore inconnue est adoptée par une de nos campagnes du même
 * compte (sans campagne pub, même nom) au lieu de créer un doublon ; sinon une campagne pub « importée » est créée
 * avec son repère ; le nom d'une de nos campagnes n'est jamais remplacé par celui de la plateforme.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    campaign: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    adSet: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    ad: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    adCost: { upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    inviteLink: { findMany: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    trackingLink: { updateMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (list: unknown[]) => Promise.all(list)),
  },
  recordEvent: vi.fn(async () => undefined),
}));
vi.mock("@linkaffipro/db", () => db);
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import { applyInsights } from "./apply";

const connection = { id: "conn1", platform: "TIKTOK" as const, currency: "EUR", name: "Compte TT" };
const row = {
  date: "2026-10-09",
  campaignExternalId: "ext-1",
  campaignName: "tt-casinox-fr-2026-10",
  spend: 12.5,
  currency: "EUR",
  impressions: 100,
  clicks: 5,
};
const rates = { EUR: 1 } as never;

beforeEach(() => {
  vi.clearAllMocks();
  db.prisma.campaign.findFirst.mockResolvedValue(null);
  db.prisma.campaign.findMany.mockResolvedValue([]);
  db.prisma.campaign.update.mockResolvedValue({});
  db.prisma.campaign.create.mockResolvedValue({ id: "shell-new" });
  db.prisma.adCost.upsert.mockResolvedValue({});
  db.prisma.adCost.findMany.mockResolvedValue([]);
  db.prisma.adCost.deleteMany.mockResolvedValue({ count: 0 });
  db.prisma.inviteLink.findMany.mockResolvedValue([]);
});

describe("applyInsights : rattachement à nos campagnes", () => {
  it("adopte notre campagne du même compte au même nom au lieu de créer un doublon", async () => {
    db.prisma.campaign.findMany.mockResolvedValue([{ id: "ours", name: "TT-casinoX-FR-2026-10" }]);
    const r = await applyInsights(connection, [row], rates);
    expect(db.prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { connectionId: "conn1", externalCampaignId: null } }),
    );
    expect(db.prisma.campaign.create).not.toHaveBeenCalled();
    expect(db.prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: "ours" },
      data: expect.objectContaining({
        externalCampaignId: "ext-1",
        adPlatform: "TIKTOK",
        adExternalIds: { source: "linked", platformName: "tt-casinox-fr-2026-10" },
      }),
    });
    expect(db.prisma.adCost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          campaignId: "ours",
          levelKey: "campaign:ours",
          source: "API",
        }),
      }),
    );
    expect(r.adopted).toBe(1);
    expect(r.created.campaigns).toBe(0);
    expect(db.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ads.campaign_adopted" }),
    );
  });

  it("sans campagne correspondante : crée une campagne pub importée, marquée « sync »", async () => {
    db.prisma.campaign.findMany.mockResolvedValue([{ id: "ours", name: "Autre nom" }]);
    const r = await applyInsights(connection, [row], rates);
    expect(db.prisma.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalCampaignId: "ext-1",
          connectionId: "conn1",
          adExternalIds: { source: "sync", platformName: "tt-casinox-fr-2026-10" },
        }),
      }),
    );
    expect(r.created.campaigns).toBe(1);
    expect(r.adopted).toBe(0);
  });

  it("campagne déjà rattachée (une des nôtres) : son nom n'est jamais remplacé", async () => {
    db.prisma.campaign.findFirst.mockResolvedValueOnce({
      id: "ours",
      name: "Notre nom",
      adExternalIds: { source: "linked", platformName: "ancien nom TT" },
      affiliateCampaignIds: ["aff1"],
      channelIds: ["ch1"],
    });
    await applyInsights(connection, [row], rates);
    const data = db.prisma.campaign.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.name).toBeUndefined();
    expect(data.adExternalIds).toEqual({ source: "linked", platformName: "tt-casinox-fr-2026-10" });
  });

  it("campagne pub importée non renommée par l'équipe : suit le nom de la plateforme", async () => {
    db.prisma.campaign.findFirst.mockResolvedValueOnce({
      id: "shell",
      name: "ancien nom TT",
      adExternalIds: { source: "sync", platformName: "ancien nom TT" },
      affiliateCampaignIds: [],
      channelIds: [],
    });
    await applyInsights(connection, [row], rates);
    const data = db.prisma.campaign.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.name).toBe("tt-casinox-fr-2026-10");
  });
});

describe("applyInsights : priorité de l'API sur les coûts CSV et saisis", () => {
  it("CSV J-1 puis API J-1 sur la même campagne : la ligne CSV du jour est retirée (dépense comptée une fois)", async () => {
    db.prisma.campaign.findMany.mockResolvedValue([{ id: "ours", name: "TT-casinoX-FR-2026-10" }]);
    db.prisma.adCost.findMany.mockResolvedValue([
      { id: "csv-1", date: new Date("2026-10-09T00:00:00Z"), source: "CSV", spend: "12.50" },
    ]);
    const r = await applyInsights(connection, [row], rates);
    const where = db.prisma.adCost.findMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({
      source: { in: ["CSV", "MANUAL"] },
      date: { in: [new Date("2026-10-09T00:00:00.000Z")] },
    });
    // Tous les niveaux de la campagne : campagne, groupes, pubs.
    expect(where.OR).toEqual([
      { campaignId: "ours" },
      { adSet: { campaignId: "ours" } },
      { ad: { adSet: { campaignId: "ours" } } },
    ]);
    expect(db.prisma.adCost.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["csv-1"] } } });
    expect(db.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ads.costs_replaced_by_api",
        payload: expect.objectContaining({ campaignId: "ours", removed: 1, spend: 12.5 }),
      }),
    );
    expect(r.replacedCosts).toBe(1);
  });

  it("aucun coût CSV ou saisi les mêmes jours : rien n'est retiré", async () => {
    const r = await applyInsights(connection, [row], rates);
    expect(db.prisma.adCost.deleteMany).not.toHaveBeenCalled();
    expect(r.replacedCosts).toBe(0);
  });
});

describe("applyInsights : rattachement automatique d'une pub à un lien d'entrée", () => {
  const adRow = {
    ...row,
    adSetExternalId: "set-1",
    adSetName: "Groupe 1",
    adExternalId: "ad-1",
    adName: "Pub 1",
  };
  beforeEach(() => {
    db.prisma.campaign.findFirst.mockResolvedValueOnce({
      id: "ours",
      name: "Notre nom",
      adExternalIds: { source: "linked", platformName: "x" },
      affiliateCampaignIds: ["aff1"],
      channelIds: [],
    });
    db.prisma.adSet.findFirst.mockResolvedValue(null);
    db.prisma.adSet.create.mockResolvedValue({ id: "set-db" });
    db.prisma.ad.findFirst.mockResolvedValue(null);
    db.prisma.ad.create.mockResolvedValue({ id: "ad-db" });
    db.prisma.ad.update.mockResolvedValue({});
    db.prisma.inviteLink.findMany.mockResolvedValue([
      { id: "il1", name: "Pub 1", adName: null, campaignId: null, trackingLinks: [{ id: "tl1" }] },
    ]);
  });

  it("le lien rattaché entre aussi dans la campagne (il y reste si la pub est supprimée)", async () => {
    const r = await applyInsights(connection, [adRow], rates);
    expect(r.linked).toBe(1);
    // Seulement des liens libres ou déjà dans cette campagne (jamais ceux d'une autre campagne).
    expect(db.prisma.inviteLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ OR: [{ campaignId: null }, { campaignId: "ours" }] }],
        }),
      }),
    );
    expect(db.prisma.inviteLink.updateMany).toHaveBeenCalledWith({
      where: { id: "il1", campaignId: null },
      data: { campaignId: "ours" },
    });
    expect(db.prisma.trackingLink.updateMany).toHaveBeenCalledWith({
      where: { id: "tl1", campaignId: null },
      data: { campaignId: "ours" },
    });
  });
});
