import { describe, expect, it } from "vitest";
import { createFakePrisma } from "../testing/fake-prisma";
import type { AgentsDeps } from "../types";
import { channelDrops, syncDropAlerts, CHANNEL_DROP_KIND } from "./alerts";
import { algoLevelOf, algoQuotaOf, ALGO_LEVEL_OPTIONS } from "./setup";
import { DEFAULT_ALGO_SETTINGS, parseAlgoSettings } from "./settings";
import { parisWeekStart } from "./week";
import { algoDue } from "../chiefs/algo";

describe("alertes de décrochage", () => {
  const s = DEFAULT_ALGO_SETTINGS;
  const base = { channelId: "c1", title: "VIP", views: 600, offerClicks: 30, prevViews: 1000, prevOfferClicks: 30 };
  it("baisse de plus de 30 % avec assez de données", () => {
    const d = channelDrops([base], s);
    expect(d).toHaveLength(1);
    expect(d[0]!.key).toBe("c1:views");
    expect(d[0]!.message).toContain("40 %");
    expect(channelDrops([{ ...base, views: 750 }], s)).toHaveLength(0);
    // Trop peu de vues la semaine d'avant : pas de conclusion.
    expect(channelDrops([{ ...base, prevViews: 500, views: 100 }], s)).toHaveLength(0);
    expect(channelDrops([{ ...base, views: 1000, offerClicks: 10 }], s)[0]!.key).toBe("c1:clicks");
  });
  it("une alerte par cible et par 24 h ; résolue quand la baisse disparaît", async () => {
    const prisma = createFakePrisma();
    let now = new Date("2026-10-26T10:00:00Z");
    const deps = { prisma, now: () => now } as unknown as AgentsDeps;
    const d = channelDrops([base], s);
    expect((await syncDropAlerts(deps, CHANNEL_DROP_KIND, d, now)).created).toBe(1);
    now = new Date(now.getTime() + 3_600_000);
    expect((await syncDropAlerts(deps, CHANNEL_DROP_KIND, d, now)).created).toBe(0);
    expect((await syncDropAlerts(deps, CHANNEL_DROP_KIND, [], now)).resolved).toBe(1);
    // Revenue dans les 24 h : pas de nouvelle notification.
    expect((await syncDropAlerts(deps, CHANNEL_DROP_KIND, d, now)).created).toBe(0);
    now = new Date(now.getTime() + 25 * 3_600_000);
    expect((await syncDropAlerts(deps, CHANNEL_DROP_KIND, d, now)).created).toBe(1);
  });
});

describe("réglages et questions de l'équipe Algorithme", () => {
  it("lecture tolérante des réglages", () => {
    expect(parseAlgoSettings(null)).toEqual(DEFAULT_ALGO_SETTINGS);
    const p = parseAlgoSettings({ minPosts: "30", maxPostsPerDay: 99, allowedHours: { byChannel: { c: { start: "10:00", end: "20:00" }, d: { start: "x" } } } });
    expect(p.minPosts).toBe(30);
    expect(p.maxPostsPerDay).toBe(6);
    expect(Object.keys(p.allowedHours.byChannel)).toEqual(["c"]);
  });
  it("réponses : niveau et quota", () => {
    expect(algoLevelOf(ALGO_LEVEL_OPTIONS[0]!)).toBe(0);
    expect(algoLevelOf(ALGO_LEVEL_OPTIONS[1]!)).toBe(1);
    expect(algoLevelOf(ALGO_LEVEL_OPTIONS[2]!)).toBe(2);
    expect(algoQuotaOf("1")).toBe(4);
    expect(algoQuotaOf("3")).toBe(8);
    expect(algoQuotaOf("10")).toBe(10);
    expect(algoQuotaOf("bof")).toBe(6);
  });
  it("nuit à partir de 4 h, lundi à partir de 6 h, une fois", () => {
    const mon = new Date("2026-10-26T06:30:00Z"); // lundi 7 h 30 à Paris
    expect(parisWeekStart(mon)).toBe("2026-10-26");
    expect(algoDue(mon, { nightly: null, weekly: null })).toEqual({ nightly: true, weekly: true });
    expect(algoDue(mon, { nightly: "2026-10-26", weekly: "2026-10-26" })).toEqual({ nightly: false, weekly: false });
    expect(algoDue(new Date("2026-10-27T01:00:00Z"), { nightly: "2026-10-26", weekly: "2026-10-26" })).toEqual({ nightly: false, weekly: false });
    expect(algoDue(new Date("2026-10-27T04:00:00Z"), { nightly: "2026-10-26", weekly: "2026-10-26" }).nightly).toBe(true);
  });
});
