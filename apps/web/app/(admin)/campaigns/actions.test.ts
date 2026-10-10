/**
 * Actions de la fiche campagne : détacher ou remplacer un lien le retire de la campagne, les canaux désactivés sont
 * conservés, les suppressions sont réservées aux ADMIN (et journalisées), le compte pub se change (et détache la
 * campagne pub suivie), et toute modification du périmètre relance le recalcul des statistiques.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "MANAGER",
  tx: [] as Array<{ model: string; op: string; args: unknown }>,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace", url });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: state.role })),
}));
const refresh = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/campaigns/refresh", () => ({
  refreshCampaignStats: refresh,
  invalidateCampaignCaches: vi.fn(),
}));
vi.mock("@/lib/campaigns/entry-links", () => ({ createCampaignEntryLink: vi.fn() }));
const mergeMod = vi.hoisted(() => ({
  mergeImportedCampaign: vi.fn(async (..._args: unknown[]) => ({
    adSets: 1,
    costs: 2,
    platformName: "Camp TT",
  })),
  findImportedShellByName: vi.fn(async (..._args: unknown[]) => null as unknown),
}));
vi.mock("@/lib/campaigns/merge", () => mergeMod);

const db = vi.hoisted(() => {
  const op = (model: string, name: string) =>
    vi.fn((args: unknown) => {
      const o = { model, op: name, args };
      return Object.assign(Promise.resolve(o), { __op: o });
    });
  return {
    prisma: {
      ad: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: op("ad", "update"),
        delete: op("ad", "delete"),
      },
      adSet: { findFirst: vi.fn(), delete: op("adSet", "delete") },
      adCost: {
        findFirst: vi.fn(async (..._args: unknown[]) => null as { id: string } | null),
        upsert: vi.fn(async () => ({})),
      },
      inviteLink: {
        findUnique: vi.fn(),
        update: op("inviteLink", "update"),
        updateMany: op("inviteLink", "updateMany"),
      },
      trackingLink: {
        update: op("trackingLink", "update"),
        updateMany: op("trackingLink", "updateMany"),
      },
      campaign: {
        findUnique: vi.fn(),
        update: vi.fn(async () => ({})),
        delete: vi.fn(async () => ({})),
      },
      channel: { findMany: vi.fn() },
      adAccountConnection: { findFirst: vi.fn() },
      affiliateCampaign: { findFirst: vi.fn() },
      $transaction: vi.fn(
        async (list: Array<{ __op: { model: string; op: string; args: unknown } }>) => {
          for (const x of list) state.tx.push(x.__op);
          return list;
        },
      ),
    },
    audit: vi.fn(async () => undefined),
    Prisma: { DbNull: "DbNull" },
  };
});
vi.mock("@linkaffipro/db", () => db);

import {
  addManualCostAction,
  addOfferAction,
  attachLinkAction,
  deleteAdAction,
  deleteAdSetAction,
  deleteCampaignAction,
  updateCampaignAction,
  updateChannelsAction,
} from "./actions";

function form(values: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values))
    for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

/** Paramètre d'une adresse de redirection (ex. le message `error`). */
function param(url: string, key: string): string {
  return new URLSearchParams(url.split("?")[1] ?? "").get(key) ?? "";
}

async function run(p: Promise<void>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const url = (err as { url?: string }).url;
    if (url) return url;
    throw err;
  }
  throw new Error("aucune redirection");
}

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "ADMIN";
  state.tx = [];
});

describe("liens d'une pub", () => {
  it("détacher : le lien et son lien goolink quittent la campagne", async () => {
    db.prisma.ad.findUnique.mockResolvedValue({ inviteLinkId: "il1", trackingLinkId: "tl1" });
    const url = await run(
      attachLinkAction(form({ campaignId: "c1", adId: "a1", inviteLinkId: "" })),
    );
    expect(url).toContain("ok=");
    expect(state.tx).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "inviteLink",
          args: { where: { id: "il1" }, data: { campaignId: null } },
        }),
        expect.objectContaining({
          model: "trackingLink",
          args: { where: { id: "tl1" }, data: { campaignId: null } },
        }),
      ]),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("remplacer : l'ancien lien quitte la campagne, le nouveau la rejoint", async () => {
    db.prisma.inviteLink.findUnique.mockResolvedValue({
      id: "il2",
      ad: null,
      trackingLinks: [{ id: "tl2" }],
    });
    db.prisma.ad.findUnique.mockResolvedValue({ inviteLinkId: "il1", trackingLinkId: "tl1" });
    await run(attachLinkAction(form({ campaignId: "c1", adId: "a1", inviteLinkId: "il2" })));
    const args = state.tx.map((o) => `${o.model}:${JSON.stringify(o.args)}`);
    expect(args).toContain(
      `inviteLink:${JSON.stringify({ where: { id: "il1" }, data: { campaignId: null } })}`,
    );
    expect(args).toContain(
      `trackingLink:${JSON.stringify({ where: { id: "tl1" }, data: { campaignId: null } })}`,
    );
    expect(args).toContain(
      `inviteLink:${JSON.stringify({ where: { id: "il2" }, data: { campaignId: "c1" } })}`,
    );
    expect(args).toContain(
      `trackingLink:${JSON.stringify({ where: { id: "tl2" }, data: { campaignId: "c1" } })}`,
    );
  });
});

describe("canaux", () => {
  it("un canal désactivé déjà rattaché est conservé ; recalcul demandé", async () => {
    db.prisma.campaign.findUnique.mockResolvedValue({ channelIds: ["actif", "off"] });
    db.prisma.channel.findMany.mockResolvedValue([{ id: "actif" }, { id: "nouveau" }]);
    await run(updateChannelsAction(form({ campaignId: "c1", channelIds: ["nouveau"] })));
    expect(db.prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { channelIds: ["nouveau", "off"] },
    });
    expect(refresh).toHaveBeenCalled();
  });
});

describe("compte pub connecté", () => {
  const base = {
    campaignId: "c1",
    name: "Camp",
    adPlatform: "",
    vertical: "",
    status: "ACTIVE",
    budgetDaily: "",
    notes: "",
    startAt: "",
    endAt: "",
  };

  it("changer de compte : vérifié, plateforme reprise du compte, campagne pub suivie détachée", async () => {
    db.prisma.campaign.findUnique.mockResolvedValue({
      channelIds: [],
      connectionId: "old",
      externalCampaignId: "ext-1",
    });
    db.prisma.adAccountConnection.findFirst.mockResolvedValue({
      platform: "META",
      name: "Compte Meta",
    });
    db.prisma.channel.findMany.mockResolvedValue([]);
    await run(updateCampaignAction(form({ ...base, connectionId: "new" })));
    expect(db.prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          connectionId: "new",
          adPlatform: "META",
          externalCampaignId: null,
          adExternalIds: "DbNull",
        }),
      }),
    );
  });

  it("compte choisi alors que la campagne pub du même nom est déjà importée : reprise par le nom", async () => {
    db.prisma.campaign.findUnique.mockResolvedValue({
      channelIds: [],
      connectionId: null,
      externalCampaignId: null,
    });
    db.prisma.adAccountConnection.findFirst.mockResolvedValue({
      platform: "TIKTOK",
      name: "Compte TT",
    });
    db.prisma.channel.findMany.mockResolvedValue([]);
    mergeMod.findImportedShellByName.mockResolvedValueOnce({ id: "shell1", name: "camp" });
    const url = await run(updateCampaignAction(form({ ...base, connectionId: "new" })));
    expect(mergeMod.findImportedShellByName).toHaveBeenCalledWith("new", "Camp", "c1");
    expect(mergeMod.mergeImportedCampaign).toHaveBeenCalledWith({
      targetId: "c1",
      shellId: "shell1",
      userId: "u1",
      matchedByName: true,
    });
    expect(param(url, "ok")).toMatch(/même nom/);
  });

  it("campagne qui suit déjà une campagne pub du même compte : pas de rapprochement", async () => {
    db.prisma.campaign.findUnique.mockResolvedValue({
      channelIds: [],
      connectionId: "conn1",
      externalCampaignId: "ext-1",
    });
    db.prisma.channel.findMany.mockResolvedValue([]);
    await run(updateCampaignAction(form({ ...base, connectionId: "conn1" })));
    expect(mergeMod.findImportedShellByName).not.toHaveBeenCalled();
  });

  it("compte d'une autre plateforme que celle choisie : refusé", async () => {
    db.prisma.campaign.findUnique.mockResolvedValue({
      channelIds: [],
      connectionId: null,
      externalCampaignId: null,
    });
    db.prisma.adAccountConnection.findFirst.mockResolvedValue({
      platform: "META",
      name: "Compte Meta",
    });
    const url = await run(
      updateCampaignAction(form({ ...base, adPlatform: "TIKTOK", connectionId: "new" })),
    );
    expect(param(url, "error")).toMatch(/compte Meta/);
    expect(db.prisma.campaign.update).not.toHaveBeenCalled();
  });
});

describe("suppressions (ADMIN seulement)", () => {
  it("un MANAGER ne supprime pas une campagne", async () => {
    state.role = "MANAGER";
    const url = await run(deleteCampaignAction(form({ campaignId: "c1" })));
    expect(param(url, "error")).toMatch(/réservée aux administrateurs/);
    expect(db.prisma.campaign.delete).not.toHaveBeenCalled();
  });

  it("un ADMIN supprime la campagne : journalisé, recalcul demandé", async () => {
    db.prisma.campaign.findUnique.mockResolvedValue({
      id: "c1",
      name: "Camp",
      externalCampaignId: null,
      connectionId: null,
      affiliateCampaignIds: ["aff1"],
      channelIds: [],
      _count: { adSets: 1, inviteLinks: 2, trackingLinks: 2 },
    });
    const url = await run(deleteCampaignAction(form({ campaignId: "c1" })));
    expect(url).toMatch(/^\/campaigns\?ok=/);
    expect(db.prisma.campaign.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(db.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "campaign.deleted", entityId: "c1" }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("une pub d'une autre campagne n'est pas supprimée", async () => {
    db.prisma.ad.findFirst.mockResolvedValue(null);
    const url = await run(deleteAdAction(form({ campaignId: "c1", adId: "a-autre" })));
    expect(param(url, "error")).toMatch(/introuvable/);
    expect(db.prisma.ad.delete).not.toHaveBeenCalled();
  });
});

describe("offres", () => {
  it("ajouter une offre relance le recalcul des statistiques (joueurs anciens de l'offre)", async () => {
    db.prisma.campaign.findUnique.mockResolvedValue({ affiliateCampaignIds: [] });
    db.prisma.affiliateCampaign.findFirst.mockResolvedValue({ id: "aff1", name: "Offre" });
    await run(addOfferAction(form({ campaignId: "c1", affiliateCampaignId: "aff1" })));
    expect(db.prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { affiliateCampaignIds: ["aff1"] },
    });
    expect(refresh).toHaveBeenCalled();
  });
});

describe("supprimer une pub ou un groupe : les liens d'entrée restent dans la campagne", () => {
  it("pub rattachée automatiquement (lien sans campagne) : le lien est rattaché à la campagne avant la suppression", async () => {
    db.prisma.ad.findFirst.mockResolvedValue({
      id: "a1",
      name: "Pub 1",
      inviteLinkId: "il1",
      trackingLinkId: "tl1",
      adSet: { name: "Groupe 1" },
    });
    const url = await run(deleteAdAction(form({ campaignId: "c1", adId: "a1" })));
    expect(url).toContain("ok=");
    const ops = state.tx.map((o) => `${o.model}.${o.op}`);
    expect(state.tx).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "inviteLink",
          op: "updateMany",
          args: { where: { id: { in: ["il1"] }, campaignId: null }, data: { campaignId: "c1" } },
        }),
        expect.objectContaining({
          model: "trackingLink",
          op: "updateMany",
          args: { where: { id: { in: ["tl1"] }, campaignId: null }, data: { campaignId: "c1" } },
        }),
      ]),
    );
    // Dans la même transaction, avant la suppression de la pub.
    expect(ops.indexOf("inviteLink.updateMany")).toBeLessThan(ops.indexOf("ad.delete"));
  });

  it("groupe supprimé : les liens de toutes ses pubs restent dans la campagne", async () => {
    db.prisma.adSet.findFirst.mockResolvedValue({
      id: "s1",
      name: "Groupe 1",
      _count: { ads: 2 },
      ads: [
        { inviteLinkId: "il1", trackingLinkId: "tl1" },
        { inviteLinkId: null, trackingLinkId: null },
        { inviteLinkId: "il2", trackingLinkId: null },
      ],
    });
    await run(deleteAdSetAction(form({ campaignId: "c1", adSetId: "s1" })));
    expect(state.tx).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "inviteLink",
          op: "updateMany",
          args: {
            where: { id: { in: ["il1", "il2"] }, campaignId: null },
            data: { campaignId: "c1" },
          },
        }),
        expect.objectContaining({ model: "adSet", op: "delete" }),
      ]),
    );
  });
});

describe("dépense saisie à la main", () => {
  const cost = {
    campaignId: "c1",
    level: "campaign:c1",
    date: "2026-10-05",
    spend: "40",
    impressions: "",
    clicks: "",
  };

  it("jour déjà couvert par l'API (Meta / TikTok) : refusée, l'API a priorité", async () => {
    db.prisma.adCost.findFirst.mockResolvedValue({ id: "api-1" });
    const url = await run(addManualCostAction(form(cost)));
    expect(param(url, "error")).toMatch(/API/);
    expect(db.prisma.adCost.upsert).not.toHaveBeenCalled();
    expect(db.prisma.adCost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: "API",
          date: new Date("2026-10-05T00:00:00.000Z"),
          OR: [
            { campaignId: "c1" },
            { adSet: { campaignId: "c1" } },
            { ad: { adSet: { campaignId: "c1" } } },
          ],
        }),
      }),
    );
  });

  it("jour sans coût API : enregistrée", async () => {
    db.prisma.adCost.findFirst.mockResolvedValue(null);
    const url = await run(addManualCostAction(form(cost)));
    expect(url).toContain("ok=");
    expect(db.prisma.adCost.upsert).toHaveBeenCalled();
  });
});
