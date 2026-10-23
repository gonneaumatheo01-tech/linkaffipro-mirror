import { describe, expect, it } from "vitest";
import { buildBestHours, parisDayHour } from "./besthours";
import { buildChannelWindows, buildWindowCells, dailyRange, suggestedWindowsJson, windowsFromCells, type WindowCell } from "./windows";
import type { InsightRow } from "../posts/rank";

function row(i: number, day: number, hour: number, views2h: number, offerClicks: number, format = "TEXT"): InsightRow {
  return {
    postId: `p${i}`,
    channelId: "c1",
    vertical: null,
    format,
    theme: null,
    personaId: null,
    hourParis: hour,
    weekdayParis: day,
    textLength: 50,
    views2h,
    views24h: views2h * 2,
    viewsFinal: 1000,
    offerClicks,
    clicks: offerClicks,
    registrations: 0,
    ftds: 0,
    sentAt: new Date("2026-10-20T10:00:00Z"),
  };
}

const cell = (day: number, hour: number, score: number, posts = 3): WindowCell => ({ day, hour, posts, medianViews2h: null, ctr: null, score });

describe("fenêtres horaires", () => {
  it("heures contiguës à 80 % du meilleur du jour, cases trop maigres ignorées", () => {
    const cells = [cell(2, 18, 0.7), cell(2, 19, 1), cell(2, 20, 0.85), cell(2, 21, 0.5), cell(2, 22, 0.9), cell(2, 23, 0.95, 1)];
    const w = windowsFromCells(cells, { ratio: 0.8, minPostsPerCell: 3 });
    expect(w).toEqual([
      { day: 2, start: "19:00", end: "21:00", score: 1, posts: 6 },
      { day: 2, start: "22:00", end: "23:00", score: 0.9, posts: 3 },
    ]);
  });
  it("score = vues à 2 h et taux de clic ramenés au meilleur ; par type quand il a assez de posts", () => {
    const rows = [
      ...[0, 1, 2].map((i) => row(i, 3, 19, 200, 20, "VIDEO")),
      ...[3, 4, 5].map((i) => row(i, 3, 12, 100, 10)),
    ];
    const cells = buildWindowCells(rows);
    expect(cells.find((c) => c.hour === 19)!.score).toBe(1);
    expect(cells.find((c) => c.hour === 12)!.score).toBe(0.5);
    const w = buildChannelWindows(rows, { ratio: 0.8, minPostsPerCell: 3, minPosts: 3 });
    expect(w.all).toEqual([{ day: 3, start: "19:00", end: "20:00", score: 1, posts: 3 }]);
    expect(Object.keys(w.byFormat).sort()).toEqual(["TEXT", "VIDEO"]);
    expect(suggestedWindowsJson(w).some((x) => x.format === "VIDEO")).toBe(true);
  });
  it("plage quotidienne autour de la meilleure heure", () => {
    const cells = [cell(1, 18, 0.9), cell(2, 19, 1), cell(3, 20, 0.85), cell(4, 9, 0.2)];
    expect(dailyRange(cells, { ratio: 0.8, minPostsPerCell: 3 })).toEqual({ start: 18, end: 21 });
    expect(dailyRange([], { ratio: 0.8, minPostsPerCell: 3 })).toBeNull();
  });
});

describe("format `besthours` inchangé (lu par le site)", () => {
  it("mêmes clés et mêmes cases que le calcul historique", () => {
    const posts = [0, 1, 2].map((i) => ({
      channelId: "c1",
      categoryId: i === 0 ? "cat" : null,
      sentAt: new Date(`2026-10-2${i}T17:00:00Z`),
      views: 100,
      clicks: 4,
      uniqueClickers: 3,
      reactionsTotal: 1,
    }));
    const b = buildBestHours("c1", posts, new Date("2026-10-23T00:00:00Z"), 1);
    expect(Object.keys(b).sort()).toEqual(["categories", "channelId", "computedAt", "minPosts", "posts", "weeks"]);
    expect(Object.keys(b.categories).sort()).toEqual(["all", "cat"]);
    expect(Object.keys(b.categories.all!.cells[0]!).sort()).toEqual(
      ["clicks", "clicksPerPost", "ctr", "day", "hour", "posts", "reactions", "reactionsPerPost", "uniqueClickers", "views"].sort(),
    );
    expect(b.categories.all!.recommendation).toMatchObject({ metric: "ctr", value: 0.03, hour: 19 });
    expect(parisDayHour(new Date("2026-10-26T17:00:00Z"))).toEqual({ day: 1, hour: 18 });
  });
});
