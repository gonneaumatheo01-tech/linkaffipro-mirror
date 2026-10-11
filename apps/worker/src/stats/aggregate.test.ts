import { describe, expect, it } from "vitest";
import {
  aggregateDaily,
  dayKey,
  dayKeysBetween,
  dimensionsOf,
  parisMidnightUtc,
  type StatEvent,
} from "./aggregate";

describe("clés de jour Paris", () => {
  it("convertit en jour Paris (UTC+2 en été)", () => {
    expect(dayKey(new Date("2026-10-09T22:30:00Z"))).toBe("2026-10-10");
    expect(dayKey(new Date("2026-10-09T21:59:00Z"))).toBe("2026-10-09");
  });
  it("liste les jours entre deux dates", () => {
    expect(
      dayKeysBetween(new Date("2026-10-07T12:00:00Z"), new Date("2026-10-09T12:00:00Z")),
    ).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
  });
  it("retrouve minuit Paris", () => {
    const m = parisMidnightUtc("2026-10-09");
    expect(dayKey(m)).toBe("2026-10-09");
    expect(dayKey(new Date(m.getTime() - 60_000))).toBe("2026-10-08");
    expect(m.toISOString()).toBe("2026-10-08T22:00:00.000Z");
  });
});

describe("agrégation journalière", () => {
  const d = (h: string) => new Date(`2026-10-09T${h}:00Z`);
  const events: StatEvent[] = [
    {
      kind: "request",
      at: d("08:00"),
      channelId: "c1",
      campaignId: "p1",
      adId: "a1",
      vertical: "CASINO",
    },
    { kind: "request", at: d("09:00"), channelId: "c1", vertical: "CASINO" },
    {
      kind: "approved",
      at: d("09:30"),
      channelId: "c1",
      campaignId: "p1",
      adId: "a1",
      vertical: "CASINO",
    },
    { kind: "entryClick", at: d("07:00"), channelId: "c1", campaignId: "p1", adId: "a1" },
    { kind: "deposit", at: d("10:00"), amount: 20.5, channelId: "c1", campaignId: "p1" },
    { kind: "deposit", at: d("10:05"), amount: 0.004, channelId: "c1" },
    { kind: "ngr", at: d("11:00"), amount: 3.333, campaignId: "p1" },
    { kind: "spend", at: d("12:00"), amount: 15, campaignId: "p1", adId: "a1" },
    { kind: "request", at: new Date("2026-10-01T08:00:00Z"), channelId: "c1" },
  ];
  const rows = aggregateDaily(events, ["2026-10-08", "2026-10-09"]);
  const row = (dim: string) => rows.find((r) => r.date === "2026-10-09" && r.dimension === dim);

  it("cumule par dimension, 'all' compris", () => {
    expect(row("all")).toMatchObject({
      requests: 2,
      approved: 1,
      entryClicks: 1,
      deposits: 2,
      depositAmount: 20.5,
      ngr: 3.33,
      spend: 15,
    });
    expect(row("channel:c1")).toMatchObject({ requests: 2, approved: 1, deposits: 2, spend: 0 });
    expect(row("campaign:p1")).toMatchObject({
      requests: 1,
      approved: 1,
      entryClicks: 1,
      deposits: 1,
      ngr: 3.33,
      spend: 15,
    });
    expect(row("ad:a1")).toMatchObject({ requests: 1, spend: 15 });
    expect(row("vertical:CASINO")).toMatchObject({ requests: 2, approved: 1 });
  });
  it("ignore les jours hors fenêtre", () => {
    expect(rows.some((r) => r.date === "2026-10-01")).toBe(false);
  });
  it("arrondit les montants à 2 décimales", () => {
    expect(row("all")!.depositAmount).toBe(20.5);
  });
  it("liste les dimensions d'un événement", () => {
    expect(
      dimensionsOf({
        kind: "request",
        at: d("08:00"),
        channelId: "c",
        campaignId: null,
        vertical: "SPORTS",
      }),
    ).toEqual(["all", "channel:c", "vertical:SPORTS"]);
  });
  it("offre partagée : une ligne par campagne, une seule fois dans « all » et dans « toutes campagnes »", () => {
    const shared = aggregateDaily(
      [
        {
          kind: "registration",
          at: d("10:00"),
          campaignId: "A",
          extraCampaignIds: ["B", "A"],
          campaignVerticals: ["CASINO", "CASINO"],
          vertical: "CASINO",
        },
      ],
      ["2026-10-09"],
    );
    const r = (dim: string) => shared.find((x) => x.dimension === dim)?.registrations;
    expect(r("all")).toBe(1);
    expect(r("campaign:A")).toBe(1);
    expect(r("campaign:B")).toBe(1);
    expect(r("campaigns")).toBe(1);
    expect(r("campaigns:CASINO")).toBe(1);
    expect(
      dimensionsOf({ kind: "request", at: d("08:00"), campaignId: "A", extraCampaignIds: ["B"] }),
    ).toEqual(["all", "campaign:A", "campaign:B", "campaigns"]);
  });
  it("renvoie des lignes triées", () => {
    const dates = rows.map((r) => r.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("commissions du jour (phase 10)", () => {
  const at = (iso: string) => new Date(iso);
  const events: StatEvent[] = [
    // CPA créditée le 4 (Paris) pour un joueur venu d'un message du canal c1 (campagne p1, pub a1).
    {
      kind: "cpa",
      at: at("2026-10-04T11:36:48Z"),
      amount: 70,
      channelId: "c1",
      campaignId: "p1",
      adId: "a1",
      vertical: "SPORTS",
      campaignVerticals: ["SPORTS"],
    },
    {
      kind: "cpa",
      at: at("2026-10-04T13:42:27Z"),
      amount: 70,
      channelId: "c1",
      campaignId: "p1",
      adId: "a1",
      vertical: "SPORTS",
      campaignVerticals: ["SPORTS"],
    },
    // Annulée le 6 : retranchée le 6, pas le 4.
    {
      kind: "cpa",
      at: at("2026-10-06T06:17:01Z"),
      amount: -70,
      channelId: "c1",
      campaignId: "p1",
      adId: "a1",
      vertical: "SPORTS",
      campaignVerticals: ["SPORTS"],
    },
    // Part de revshare : au niveau offre (campagnes de l'offre), jamais dans un canal ni une pub.
    {
      kind: "revshare",
      at: at("2026-10-04T10:00:00Z"),
      amount: 13.0926,
      campaignId: "p1",
      extraCampaignIds: ["p2"],
      vertical: "SPORTS",
      campaignVerticals: ["SPORTS"],
    },
    {
      kind: "revshare",
      at: at("2026-10-06T10:00:00Z"),
      amount: 2.2795,
      campaignId: "p1",
      vertical: "SPORTS",
      campaignVerticals: ["SPORTS"],
    },
    { kind: "spend", at: at("2026-10-04T10:00:00Z"), amount: 50, campaignId: "p1", adId: "a1" },
  ];
  const rows = aggregateDaily(events, ["2026-10-04", "2026-10-05", "2026-10-06"]);
  const row = (date: string, dim: string) =>
    rows.find((r) => r.date === date && r.dimension === dim);

  it("CPA au jour du crédit, retranchée le jour de l'annulation ; commissions = CPA + revshare", () => {
    expect(row("2026-10-04", "all")).toMatchObject({
      cpaCommissions: 140,
      revshareCommissions: 13.09,
      commissions: 153.09,
      spend: 50,
    });
    expect(row("2026-10-06", "all")).toMatchObject({
      cpaCommissions: -70,
      revshareCommissions: 2.28,
      commissions: -67.72,
    });
    expect(row("2026-10-05", "all")).toBeUndefined();
  });

  it("campagnes : chaque campagne de l'offre, une seule fois dans « toutes campagnes »", () => {
    expect(row("2026-10-04", "campaign:p1")).toMatchObject({ commissions: 153.09 });
    expect(row("2026-10-04", "campaign:p2")).toMatchObject({
      cpaCommissions: 0,
      revshareCommissions: 13.09,
      commissions: 13.09,
    });
    expect(row("2026-10-04", "campaigns")).toMatchObject({ commissions: 153.09 });
    expect(row("2026-10-04", "campaigns:SPORTS")).toMatchObject({ commissions: 153.09 });
    expect(row("2026-10-04", "vertical:SPORTS")).toMatchObject({ commissions: 153.09 });
  });

  it("canal et pub : la CPA du joueur seulement (la part de revshare n'existe que par offre)", () => {
    expect(row("2026-10-04", "channel:c1")).toMatchObject({
      cpaCommissions: 140,
      revshareCommissions: 0,
      commissions: 140,
    });
    expect(row("2026-10-04", "ad:a1")).toMatchObject({ commissions: 140, spend: 50 });
  });
});
