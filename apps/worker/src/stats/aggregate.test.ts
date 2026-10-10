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
