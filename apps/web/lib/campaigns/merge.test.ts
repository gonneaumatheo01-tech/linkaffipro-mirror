/**
 * « Rattacher une campagne pub importée » : la campagne pub créée par la synchro d'un compte connecté (coquille sans
 * offre ni canal) est fondue dans une de nos campagnes : groupes et pubs, coûts, statistiques et liens déplacés,
 * identifiant externe, compte et plateforme copiés, coquille supprimée, action journalisée.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ops: Array<{ model: string; op: string; args: unknown }> = [];
let overlaps: Array<{ id: string; spend: string; source: string }> = [];
const db = vi.hoisted(() => {
  const record = (model: string, op: string) =>
    vi.fn((args: unknown) => {
      return { __op: { model, op, args } };
    });
  return {
    campaign: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: record("campaign", "update"),
      delete: record("campaign", "delete"),
    },
    adSet: { update: record("adSet", "update") },
    adCost: {
      findMany: vi.fn(),
      deleteMany: record("adCost", "deleteMany"),
      updateMany: record("adCost", "updateMany"),
    },
    dailyStat: {
      deleteMany: record("dailyStat", "deleteMany"),
      updateMany: record("dailyStat", "updateMany"),
    },
    inviteLink: { updateMany: record("inviteLink", "updateMany") },
    trackingLink: { updateMany: record("trackingLink", "updateMany") },
    $transaction: vi.fn(),
  };
});
const audit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@linkaffipro/db", () => ({ prisma: db, audit }));

import { findImportedShellByName, mergeImportedCampaign, planAdSetNames } from "./merge";
import { pickShellByName } from "./ad-link";

const target = {
  id: "ours",
  name: "Notre campagne",
  externalCampaignId: null,
  adExternalIds: null,
  affiliateCampaignIds: ["aff1"],
  channelIds: ["ch1"],
  connectionId: null,
  adPlatform: null,
  adSets: [{ id: "s-ours", name: "Groupe 1" }],
};
const shell = {
  id: "shell",
  name: "TT casino octobre",
  externalCampaignId: "ext-1",
  adExternalIds: { source: "sync", platformName: "TT casino octobre" },
  affiliateCampaignIds: [],
  channelIds: [],
  connectionId: "conn1",
  adPlatform: "TIKTOK",
  adSets: [
    { id: "s1", name: "Groupe 1" },
    { id: "s2", name: "FR 18-34" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  ops.length = 0;
  overlaps = [];
  db.campaign.findUnique.mockImplementation(async (args: { where: { id: string } }) =>
    args.where.id === "ours" ? target : args.where.id === "shell" ? shell : null,
  );
  db.adCost.findMany.mockImplementation(
    async (args: { where: { levelKey?: string; source?: unknown } }) => {
      // Jours couverts par l'API dans la campagne pub importée (tous niveaux).
      if (args.where.source === "API") return [{ date: new Date("2026-10-01T00:00:00Z") }];
      // Coûts CSV / saisis de notre campagne ces jours-là.
      if (args.where.source && typeof args.where.source === "object") return overlaps;
      return args.where.levelKey === "campaign:shell"
        ? [{ id: "cost-shell-1", date: new Date("2026-10-01T00:00:00Z"), source: "API" }]
        : [{ id: "cost-ours-conflict" }];
    },
  );
  db.$transaction.mockImplementation(async (list: Array<{ __op: (typeof ops)[number] }>) => {
    for (const x of list) ops.push(x.__op);
    return list;
  });
});

describe("noms des groupes déplacés", () => {
  it("rend unique un nom déjà pris dans la campagne cible", () => {
    expect(
      planAdSetNames(
        ["Groupe 1"],
        [
          { id: "s1", name: "Groupe 1" },
          { id: "s2", name: "FR 18-34" },
          { id: "s3", name: "Groupe 1" },
        ],
      ),
    ).toEqual([
      { id: "s1", name: "Groupe 1 (2)" },
      { id: "s2", name: "FR 18-34" },
      { id: "s3", name: "Groupe 1 (3)" },
    ]);
  });
});

describe("rattacher une campagne pub importée", () => {
  it("déplace groupes, coûts, statistiques et liens, copie l'identifiant externe, supprime la coquille et journalise", async () => {
    const r = await mergeImportedCampaign({ targetId: "ours", shellId: "shell", userId: "u1" });
    expect(r).toMatchObject({ adSets: 2, platformName: "TT casino octobre" });
    const find = (model: string, op: string) => ops.filter((o) => o.model === model && o.op === op);
    expect(find("adSet", "update").map((o) => o.args)).toEqual([
      { where: { id: "s1" }, data: { campaignId: "ours", name: "Groupe 1 (2)" } },
      { where: { id: "s2" }, data: { campaignId: "ours", name: "FR 18-34" } },
    ]);
    expect(find("adCost", "deleteMany").map((o) => o.args)).toEqual([
      { where: { id: { in: ["cost-ours-conflict"] } } },
    ]);
    expect(find("adCost", "updateMany").map((o) => o.args)).toEqual([
      {
        where: { levelKey: "campaign:shell" },
        data: { levelKey: "campaign:ours", campaignId: "ours" },
      },
      { where: { campaignId: "shell" }, data: { campaignId: "ours" } },
    ]);
    expect(find("dailyStat", "deleteMany")[0]!.args).toEqual({
      where: { dimension: "campaign:shell" },
    });
    expect(find("dailyStat", "updateMany")[0]!.args).toEqual({
      where: { campaignId: "shell" },
      data: { campaignId: "ours" },
    });
    expect(find("inviteLink", "updateMany")[0]!.args).toEqual({
      where: { campaignId: "shell" },
      data: { campaignId: "ours" },
    });
    expect(find("trackingLink", "updateMany")[0]!.args).toEqual({
      where: { campaignId: "shell" },
      data: { campaignId: "ours" },
    });
    expect(find("campaign", "delete")[0]!.args).toEqual({ where: { id: "shell" } });
    expect(find("campaign", "update")[0]!.args).toEqual({
      where: { id: "ours" },
      data: {
        externalCampaignId: "ext-1",
        connectionId: "conn1",
        adPlatform: "TIKTOK",
        adExternalIds: { source: "linked", platformName: "TT casino octobre" },
      },
    });
    // La coquille est supprimée après le déplacement de tout ce qu'elle portait.
    const order = ops.map((o) => `${o.model}.${o.op}`);
    expect(order.indexOf("campaign.delete")).toBeGreaterThan(
      order.lastIndexOf("trackingLink.updateMany"),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "campaign.ad_campaign_attached",
        entityId: "ours",
        userId: "u1",
      }),
    );
  });

  it("refuse une campagne qui n'est pas une campagne pub importée libre", async () => {
    db.campaign.findUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === "ours"
        ? target
        : { ...shell, affiliateCampaignIds: ["aff2"], adExternalIds: { source: "linked" } },
    );
    await expect(
      mergeImportedCampaign({ targetId: "ours", shellId: "shell", userId: "u1" }),
    ).rejects.toThrow(/importée/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuse si notre campagne suit déjà une autre campagne pub", async () => {
    db.campaign.findUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === "ours" ? { ...target, externalCampaignId: "ext-autre" } : shell,
    );
    await expect(
      mergeImportedCampaign({ targetId: "ours", shellId: "shell", userId: "u1" }),
    ).rejects.toThrow(/déjà/);
  });

  it("refuse de se rattacher à elle-même", async () => {
    await expect(
      mergeImportedCampaign({ targetId: "shell", shellId: "shell", userId: "u1" }),
    ).rejects.toThrow();
  });
});

describe("priorité de l'API sur les coûts CSV et saisis", () => {
  it("CSV J-5 de notre campagne + API J-5 de la campagne pub : la ligne CSV est retirée (dépense comptée une fois)", async () => {
    overlaps = [
      { id: "csv-j5", spend: "40.00", source: "CSV" },
      { id: "manual-j5", spend: "2.50", source: "MANUAL" },
    ];
    await mergeImportedCampaign({ targetId: "ours", shellId: "shell", userId: "u1" });
    const overlapQuery = db.adCost.findMany.mock.calls
      .map((c) => (c as unknown as [{ where: Record<string, unknown> }])[0].where)
      .find((w) => typeof w.source === "object")!;
    expect(overlapQuery).toEqual({
      source: { in: ["CSV", "MANUAL"] },
      date: { in: [new Date("2026-10-01T00:00:00Z")] },
      OR: [
        { campaignId: "ours" },
        { adSet: { campaignId: "ours" } },
        { ad: { adSet: { campaignId: "ours" } } },
      ],
    });
    const deletes = ops.filter((o) => o.model === "adCost" && o.op === "deleteMany");
    expect(deletes.map((o) => o.args)).toContainEqual({
      where: { id: { in: ["csv-j5", "manual-j5"] } },
    });
    // Retirées avant que les coûts de la campagne pub ne rejoignent notre campagne.
    const order = ops.map((o) => `${o.model}.${o.op}`);
    expect(order.indexOf("adCost.deleteMany")).toBeLessThan(order.indexOf("adCost.updateMany"));
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ replacedByApiCosts: 2, replacedByApiSpend: 42.5 }),
      }),
    );
  });

  it("aucun coût CSV ou saisi les jours couverts par l'API : rien d'autre n'est retiré", async () => {
    await mergeImportedCampaign({ targetId: "ours", shellId: "shell", userId: "u1" });
    const deletes = ops.filter((o) => o.model === "adCost" && o.op === "deleteMany");
    expect(deletes).toHaveLength(1);
  });
});

describe("rapprochement par le nom avec une campagne pub déjà importée", () => {
  const shells = [
    { id: "s1", name: "TT-casinoX-FR-2026-10" },
    { id: "s2", name: "Autre campagne" },
  ];
  it("règle pure : même nom (casse, accents et espaces ignorés), une seule candidate", () => {
    expect(pickShellByName("tt-casinox-fr-2026-10 ", shells)?.id).toBe("s1");
    expect(pickShellByName("Inconnue", shells)).toBeNull();
    expect(
      pickShellByName("Autre campagne", [...shells, { id: "s3", name: "autre  campagne" }]),
    ).toBeNull();
    expect(pickShellByName("", shells)).toBeNull();
  });

  it("ne propose que des campagnes pub importées libres du compte (jamais une des nôtres)", async () => {
    db.campaign.findMany.mockResolvedValue([
      {
        id: "s1",
        name: "TT-casinoX-FR-2026-10",
        externalCampaignId: "ext-1",
        adExternalIds: { source: "sync", platformName: "TT-casinoX-FR-2026-10" },
        affiliateCampaignIds: [],
        channelIds: [],
      },
      {
        id: "ours-2",
        name: "TT-casinoX-FR-2026-10",
        externalCampaignId: "ext-2",
        adExternalIds: { source: "linked", platformName: "x" },
        affiliateCampaignIds: ["aff1"],
        channelIds: [],
      },
    ]);
    const r = await findImportedShellByName("conn1", "tt-casinox-fr-2026-10", "c1");
    expect(r?.id).toBe("s1");
    expect(db.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectionId: "conn1", externalCampaignId: { not: null }, id: { not: "c1" } },
      }),
    );
  });
});
