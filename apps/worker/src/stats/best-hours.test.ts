import { describe, expect, it } from "vitest";
import { buildBestHours, buildCells, parisDayHour, recommend, type BestHoursPost } from "./best-hours";

const post = (iso: string, extra: Partial<BestHoursPost> = {}): BestHoursPost => ({
  channelId: "c1",
  categoryId: null,
  sentAt: new Date(iso),
  views: 0,
  clicks: 0,
  uniqueClickers: 0,
  reactionsTotal: 0,
  ...extra,
});

describe("jour et heure de Paris", () => {
  it("convertit en heure d'été et d'hiver, lundi = 1, dimanche = 7", () => {
    // Mardi 6 octobre 2026 à 17:30 UTC = 19:30 à Paris (été).
    expect(parisDayHour(new Date("2026-10-06T17:30:00Z"))).toEqual({ day: 2, hour: 19 });
    // Dimanche 6 décembre 2026 à 23:30 UTC = lundi 00:30 à Paris (hiver).
    expect(parisDayHour(new Date("2026-12-06T23:30:00Z"))).toEqual({ day: 1, hour: 0 });
    expect(parisDayHour(new Date("2026-12-06T12:00:00Z"))).toEqual({ day: 7, hour: 13 });
  });
});

describe("cases jour × heure", () => {
  it("additionne les messages d'un même créneau et calcule les moyennes", () => {
    const cells = buildCells([
      post("2026-10-06T17:10:00Z", { clicks: 10, uniqueClickers: 8, views: 100, reactionsTotal: 4 }),
      post("2026-10-13T17:50:00Z", { clicks: 20, uniqueClickers: 12, views: 100, reactionsTotal: 2 }),
      post("2026-10-07T08:00:00Z", { clicks: 3 }),
    ]);
    expect(cells).toHaveLength(2);
    const tue = cells.find((c) => c.day === 2 && c.hour === 19)!;
    expect(tue.posts).toBe(2);
    expect(tue.ctr).toBe(0.1);
    expect(tue.clicksPerPost).toBe(15);
    expect(tue.reactionsPerPost).toBe(3);
    const wed = cells.find((c) => c.day === 3 && c.hour === 10)!;
    expect(wed.ctr).toBeNull();
    expect(wed.clicksPerPost).toBe(3);
  });
});

describe("recommandation", () => {
  it("renvoie null sous 3 messages dans chaque créneau", () => {
    const cells = buildCells([post("2026-10-06T17:00:00Z", { clicks: 50 }), post("2026-10-13T17:00:00Z", { clicks: 50 })]);
    expect(recommend(cells)).toBeNull();
  });
  it("classe par clics par message sans vues, par taux de clic avec vues", () => {
    const tuesdays = ["2026-09-15", "2026-09-22", "2026-09-29"].map((d) => post(`${d}T17:00:00Z`, { clicks: 2 }));
    const fridays = ["2026-09-18", "2026-09-25", "2026-10-02"].map((d) => post(`${d}T10:00:00Z`, { clicks: 9 }));
    const r = recommend(buildCells([...tuesdays, ...fridays]))!;
    expect(r).toMatchObject({ day: 5, hour: 12, metric: "clicksPerPost", value: 9, posts: 3 });

    const withViews = [
      ...tuesdays.map((p) => ({ ...p, views: 100, uniqueClickers: 20 })),
      ...fridays.map((p) => ({ ...p, views: 1000, uniqueClickers: 30 })),
    ];
    const r2 = recommend(buildCells(withViews))!;
    expect(r2).toMatchObject({ day: 2, hour: 19, metric: "ctr", value: 0.2 });
  });
  it("départage par réactions par message", () => {
    const a = ["2026-09-15", "2026-09-22", "2026-09-29"].map((d) => post(`${d}T17:00:00Z`, { clicks: 5, reactionsTotal: 1 }));
    const b = ["2026-09-18", "2026-09-25", "2026-10-02"].map((d) => post(`${d}T10:00:00Z`, { clicks: 5, reactionsTotal: 6 }));
    expect(recommend(buildCells([...a, ...b]))).toMatchObject({ day: 5, hour: 12, reactionsPerPost: 6 });
  });
});

describe("carte d'un canal", () => {
  it("sépare par catégorie, garde « all », ignore les autres canaux", () => {
    const posts = [
      post("2026-10-06T17:00:00Z", { categoryId: "bonus", clicks: 4 }),
      post("2026-10-06T18:00:00Z", { categoryId: "teasing", clicks: 1 }),
      post("2026-10-06T19:00:00Z", { clicks: 1 }),
      post("2026-10-06T19:00:00Z", { channelId: "autre", clicks: 100 }),
    ];
    const r = buildBestHours("c1", posts, new Date("2026-10-09T10:00:00Z"));
    expect(r.posts).toBe(3);
    expect(Object.keys(r.categories).sort()).toEqual(["all", "bonus", "teasing"]);
    expect(r.categories.all!.cells).toHaveLength(3);
    expect(r.categories.bonus!.posts).toBe(1);
    expect(r.categories.all!.recommendation).toBeNull();
    expect(r.computedAt).toBe("2026-10-09T10:00:00.000Z");
    expect(r.weeks).toBe(8);
  });
});
