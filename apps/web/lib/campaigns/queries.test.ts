/**
 * Totaux d'une campagne (fiche et liste /campaigns) : NGR daté (événements NGR de la période, jamais le cumul du
 * joueur), inscriptions et FTD sur les vraies dates Link Affi (registeredAt / ftdAt, jamais createdAt = date d'import),
 * ligne Total calculée sur les joueurs distincts de toutes les campagnes (pas une somme des lignes).
 *
 * Prisma est simulé par un petit évaluateur en mémoire : il comprend AND / OR, les bornes de dates (gte / lt),
 * `in`, `null` et les relations imbriquées ; les conditions sur des relations absentes des lignes sont ignorées.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Where = Record<string, unknown> | undefined;

function matches(row: Row, where: Where): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "AND") {
      if (!(v as Where[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (k === "OR") {
      if (!(v as Where[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (!(k in row)) continue;
    const val = row[k];
    if (v === null) {
      if (val !== null) return false;
      continue;
    }
    if (typeof v === "object" && !(v instanceof Date)) {
      if (val && typeof val === "object" && !(val instanceof Date)) {
        if (!matches(val as Row, v as Where)) return false;
        continue;
      }
      const o = v as Record<string, unknown>;
      if ("in" in o && !(o.in as unknown[]).includes(val)) return false;
      if ("not" in o && o.not === null && val === null) return false;
      if ("gte" in o && !(val instanceof Date && val >= (o.gte as Date))) return false;
      if ("lt" in o && !(val instanceof Date && val < (o.lt as Date))) return false;
      if ("lte" in o && !(val instanceof Date && val <= (o.lte as Date))) return false;
      continue;
    }
    if (val !== v) return false;
  }
  return true;
}

const data = vi.hoisted(() => ({
  players: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  campaigns: [] as Array<Record<string, unknown>>,
  costSources: [] as Array<{ campaignId: string; source: string }>,
  /** Lignes `AffiliateDailyStat` (part de revshare par offre et par jour). */
  revshare: [] as Array<Record<string, unknown>>,
}));

const db = vi.hoisted(() => ({
  adCost: { aggregate: vi.fn(), groupBy: vi.fn() },
  membership: { count: vi.fn() },
  click: { count: vi.fn() },
  player: { count: vi.fn(), findMany: vi.fn() },
  playerEvent: { aggregate: vi.fn() },
  affiliateDailyStat: { aggregate: vi.fn() },
  campaign: { findMany: vi.fn() },
  channel: { findMany: vi.fn() },
}));
vi.mock("@linkaffipro/db", () => ({ prisma: db }));
vi.mock("@/lib/dashboard/cache", () => ({ cachedDashboard: <T>(_n: string, fn: T) => fn }));

import { resolvePeriod } from "@/lib/periods";
import { campaignTotals, listCampaignsUncached, totalsForScopes } from "./queries";

const DAY = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * DAY);
const scope = (affiliateCampaignIds: string[]) => ({
  channelIds: [],
  inviteLinkIds: [],
  trackingLinkIds: [],
  affiliateCampaignIds,
});

beforeEach(() => {
  vi.clearAllMocks();
  const now = new Date();
  // Deux joueurs importés aujourd'hui (createdAt = date d'import) : A inscrit il y a 40 jours, B il y a 3 jours.
  const a = {
    id: "A",
    affiliateCampaignId: "aff1",
    clickId: null,
    createdAt: now,
    registeredAt: ago(40),
    ftdAt: ago(40),
    ngr: 125,
  };
  const b = {
    id: "B",
    affiliateCampaignId: "aff1",
    clickId: null,
    createdAt: now,
    registeredAt: ago(3),
    ftdAt: null,
    ngr: 0,
  };
  data.players = [a, b];
  data.events = [
    { type: "NGR", amount: 100, occurredAt: ago(40), player: a },
    { type: "NGR", amount: 25, occurredAt: ago(3), player: a },
    { type: "FTD", amount: 50, occurredAt: ago(40), player: a },
  ];
  data.costSources = [];
  db.adCost.aggregate.mockResolvedValue({ _sum: { spend: 0 } });
  db.adCost.groupBy.mockImplementation(async () => data.costSources);
  db.membership.count.mockResolvedValue(0);
  db.click.count.mockResolvedValue(0);
  db.player.count.mockImplementation(
    async (args: { where: Where }) => data.players.filter((p) => matches(p, args.where)).length,
  );
  db.player.findMany.mockImplementation(async (args: { where: Where }) =>
    data.players.filter((p) => matches(p, args.where)),
  );
  db.playerEvent.aggregate.mockImplementation(async (args: { where: Where }) => {
    const rows = data.events.filter((e) => matches(e, args.where));
    return {
      _count: { _all: rows.length },
      _sum: { amount: rows.reduce((s, e) => s + Number(e.amount), 0) },
    };
  });
  data.revshare = [];
  db.affiliateDailyStat.aggregate.mockImplementation(async (args: { where: Where }) => ({
    _sum: {
      revshareRevenue: data.revshare
        .filter((r) => matches(r, args.where))
        .reduce((s, r) => s + Number(r.revshareRevenue), 0),
    },
  }));
  db.campaign.findMany.mockImplementation(async () => data.campaigns);
  db.channel.findMany.mockResolvedValue([]);
});

describe("commissions d'une campagne (phase 10) : gains = commissions − dépense pub", () => {
  const utcDay = (n: number) => new Date(`${ago(n).toISOString().slice(0, 10)}T00:00:00Z`);

  it("CPA : créditée au jour du crédit, retranchée le jour de l'annulation ; revshare de ses offres seulement", async () => {
    const [a] = data.players;
    data.events.push(
      { type: "CPA", amount: 70, occurredAt: ago(20), player: a },
      { type: "CPA_REVERSAL", amount: -70, occurredAt: ago(2), player: a },
    );
    data.revshare = [
      {
        affiliateCampaignId: "aff1",
        date: utcDay(1),
        sourceCreatedAt: null,
        revshareRevenue: 13.0926,
      },
      {
        affiliateCampaignId: "autre",
        date: utcDay(1),
        sourceCreatedAt: null,
        revshareRevenue: 500,
      },
    ];
    db.adCost.aggregate.mockResolvedValue({ _sum: { spend: 20 } });
    const s = scope(["aff1"]);
    // 7 jours : l'annulation (−70) et la part de revshare (13,09) ; la CPA créditée il y a 20 jours n'y est pas.
    const week = await campaignTotals("c1", s, resolvePeriod({ range: "7d" }));
    expect(week).toMatchObject({ cpaCommissions: -70, revshareCommissions: 13.09 });
    // 30 jours : crédit et annulation s'annulent.
    const month = await campaignTotals("c1", s, resolvePeriod({ range: "30d" }));
    expect(month).toMatchObject({ cpaCommissions: 0, revshareCommissions: 13.09, revenue: 25 });
    const cpaCall = db.playerEvent.aggregate.mock.calls.find((c) =>
      JSON.stringify((c[0] as { where: unknown }).where).includes("CPA_REVERSAL"),
    );
    expect(cpaCall).toBeDefined();
  });

  it("sans offre : aucune lecture de la part de revshare", async () => {
    const t = await campaignTotals("c1", scope([]), resolvePeriod({ range: "7d" }));
    expect(t.revshareCommissions).toBe(0);
    expect(db.affiliateDailyStat.aggregate).not.toHaveBeenCalled();
  });
});

describe("totaux d'une campagne : dates réelles Link Affi", () => {
  it("NGR daté : 7 jours ≠ 90 jours (somme des événements NGR de la période, pas le cumul du joueur)", async () => {
    const s = scope(["aff1"]);
    const week = await campaignTotals("c1", s, resolvePeriod({ range: "7d" }));
    const quarter = await campaignTotals("c1", s, resolvePeriod({ range: "90d" }));
    expect(week.revenue).toBe(25);
    expect(quarter.revenue).toBe(125);
    const ngrCall = db.playerEvent.aggregate.mock.calls.find(
      (c) => (c[0] as { where: { type: unknown } }).where.type === "NGR",
    );
    expect(ngrCall).toBeDefined();
  });

  it("la date d'import (createdAt) ne compte pas : inscriptions et FTD sur registeredAt / ftdAt", async () => {
    const s = scope(["aff1"]);
    const week = await campaignTotals("c1", s, resolvePeriod({ range: "7d" }));
    expect(week.registrations).toBe(1);
    expect(week.ftds).toBe(0);
    const quarter = await campaignTotals("c1", s, resolvePeriod({ range: "90d" }));
    expect(quarter.registrations).toBe(2);
    expect(quarter.ftds).toBe(1);
    expect(quarter.deposits).toBe(1);
    expect(quarter.depositAmount).toBe(50);
    const playerQueries = JSON.stringify([
      db.player.count.mock.calls,
      db.player.findMany.mock.calls,
    ]);
    expect(playerQueries).not.toContain("createdAt");
  });
});

describe("ligne Total de /campaigns : joueurs distincts", () => {
  it("deux campagnes qui partagent une offre : le joueur commun n'est compté qu'une fois", async () => {
    const period = resolvePeriod({ range: "90d" });
    const one = await campaignTotals("c1", scope(["aff1"]), period);
    const two = await campaignTotals("c2", scope(["aff1"]), period);
    expect(one.registrations + two.registrations).toBe(4);
    const total = await totalsForScopes(
      [
        { campaignId: "c1", scope: scope(["aff1"]) },
        { campaignId: "c2", scope: scope(["aff1"]) },
      ],
      period,
    );
    expect(total.registrations).toBe(2);
    expect(total.revenue).toBe(125);
  });

  it("aucune campagne : totaux à zéro sans requête", async () => {
    const total = await totalsForScopes([], resolvePeriod({ range: "7d" }));
    expect(total).toMatchObject({ spend: 0, registrations: 0, revenue: 0 });
    expect(db.player.count).not.toHaveBeenCalled();
  });
});

describe("badge de source des coûts", () => {
  const campaign = (over: Record<string, unknown>) => ({
    id: "c1",
    name: "Camp",
    adPlatform: "TIKTOK",
    vertical: null,
    status: "ACTIVE",
    channelIds: [],
    affiliateCampaignIds: [],
    externalCampaignId: null,
    connectionId: null,
    adExternalIds: null,
    inviteLinks: [],
    trackingLinks: [],
    adSets: [],
    ...over,
  });

  it("« API » seulement s'il existe des coûts reçus par l'API (un compte choisi ne suffit pas)", async () => {
    data.campaigns = [campaign({ connectionId: "conn1" })];
    const period = resolvePeriod({ range: "7d" });
    expect((await listCampaignsUncached(period)).rows[0]!.source).toBeNull();
    data.costSources = [{ campaignId: "c1", source: "API" }];
    expect((await listCampaignsUncached(period)).rows[0]!.source).toBe("api");
  });

  it("« importée » seulement pour une coquille créée par la synchro, pas pour une campagne rattachée", async () => {
    const period = resolvePeriod({ range: "7d" });
    data.campaigns = [
      campaign({
        externalCampaignId: "ext1",
        adExternalIds: { source: "sync", platformName: "Camp" },
      }),
    ];
    expect((await listCampaignsUncached(period)).rows[0]!.importedFrom).toBe("TIKTOK");
    data.campaigns = [
      campaign({
        externalCampaignId: "ext1",
        affiliateCampaignIds: ["aff1"],
        adExternalIds: { source: "linked", platformName: "TT camp" },
      }),
    ];
    expect((await listCampaignsUncached(period)).rows[0]!.importedFrom).toBeNull();
  });

  it("la liste renvoie aussi le total sur les joueurs distincts", async () => {
    data.campaigns = [
      campaign({ id: "c1", affiliateCampaignIds: ["aff1"] }),
      campaign({ id: "c2", affiliateCampaignIds: ["aff1"] }),
    ];
    const r = await listCampaignsUncached(resolvePeriod({ range: "90d" }));
    expect(r.rows.map((x) => x.metrics.registrations)).toEqual([2, 2]);
    expect(r.total.registrations).toBe(2);
    expect(r.previousTotal).toBeNull();
  });
});
