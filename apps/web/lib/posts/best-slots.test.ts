import { describe, expect, it } from "vitest";
import type { BestHoursCell, ChannelBestHours } from "@/lib/besthours/types";
import { calendarBestSlots, mergeCells, rankSlots, slotDetail, slotsInWeek } from "./best-slots";

const cell = (day: number, hour: number, extra: Partial<BestHoursCell> = {}): BestHoursCell => ({
  day,
  hour,
  posts: 3,
  views: 0,
  clicks: 0,
  uniqueClickers: 0,
  reactions: 0,
  ctr: null,
  clicksPerPost: 0,
  reactionsPerPost: 0,
  ...extra,
});

function channel(
  channelId: string,
  all: BestHoursCell[],
  categories: Record<string, BestHoursCell[]> = {},
): ChannelBestHours {
  const cats: ChannelBestHours["categories"] = {
    all: { posts: all.reduce((s, c) => s + c.posts, 0), cells: all, recommendation: null },
  };
  for (const [k, cells] of Object.entries(categories))
    cats[k] = { posts: cells.reduce((s, c) => s + c.posts, 0), cells, recommendation: null };
  return {
    channelId,
    weeks: 8,
    minPosts: 3,
    posts: cats.all!.posts,
    computedAt: "2026-10-09T04:00:00.000Z",
    categories: cats,
  };
}

describe("meilleurs créneaux : même règle que le worker", () => {
  it("classe par clics par message quand aucune vue n'est connue, au moins 3 messages par case", () => {
    const slots = rankSlots(
      [
        cell(2, 19, { clicks: 12, clicksPerPost: 4 }),
        cell(4, 12, { clicks: 6, clicksPerPost: 2 }),
        cell(6, 20, { clicks: 9, clicksPerPost: 3 }),
        cell(1, 8, { posts: 2, clicks: 20, clicksPerPost: 10 }), // trop peu de messages
        cell(7, 10, { clicks: 3, clicksPerPost: 1 }),
      ],
      3,
    );
    expect(slots.map((s) => [s.day, s.hour, s.rank])).toEqual([
      [2, 19, 1],
      [6, 20, 2],
      [4, 12, 3],
    ]);
    expect(slots[0]).toMatchObject({ label: "mardi 19 h", detail: "4 clics par message" });
  });
  it("taux de clic dès que des vues existent ; départage par réactions", () => {
    const slots = rankSlots(
      [
        cell(1, 9, { views: 100, uniqueClickers: 10, ctr: 0.1, clicksPerPost: 50 }),
        cell(3, 18, { views: 100, uniqueClickers: 20, ctr: 0.2, reactionsPerPost: 1 }),
        cell(5, 18, { views: 100, uniqueClickers: 20, ctr: 0.2, reactionsPerPost: 2 }),
        cell(6, 18, { clicksPerPost: 99 }), // sans vues : écartée
      ],
      3,
    );
    expect(slots.map((s) => `${s.day}:${s.hour}`)).toEqual(["5:18", "3:18", "1:9"]);
    expect(slots[0]!.detail).toBe("20 % de taux de clic");
  });
  it("rien sans données suffisantes", () => {
    expect(rankSlots([cell(1, 9, { posts: 1 })], 3)).toEqual([]);
    expect(rankSlots([], 3)).toEqual([]);
  });
  it("libellés", () => {
    expect(slotDetail("clicksPerPost", 1)).toBe("1 clic par message");
    expect(slotDetail("clicksPerPost", 2.5)).toBe("2,5 clics par message");
    expect(slotDetail("ctr", 0.153)).toBe("15,3 % de taux de clic");
  });
});

describe("plusieurs canaux réunis", () => {
  it("additionne les cases puis recalcule les moyennes", () => {
    const merged = mergeCells([
      [cell(2, 19, { posts: 2, clicks: 8 })],
      [cell(2, 19, { posts: 1, clicks: 1 }), cell(3, 9, { posts: 1, clicks: 1 })],
    ]);
    expect(merged).toEqual([
      expect.objectContaining({ day: 2, hour: 19, posts: 3, clicks: 9, clicksPerPost: 3 }),
      expect.objectContaining({ day: 3, hour: 9, posts: 1, clicksPerPost: 1 }),
    ]);
  });
  const a = channel("a", [cell(2, 19, { posts: 2, clicks: 8 }), cell(5, 12, { clicks: 3 })], {
    bonus: [cell(1, 10, { clicks: 30 })],
  });
  const b = channel("b", [cell(2, 19, { posts: 1, clicks: 1 }), cell(6, 20, { clicks: 15 })]);

  it("tous les canaux : un créneau peut naître de la somme de deux canaux", () => {
    const r = calendarBestSlots([a, b]);
    expect(r.slots.map((s) => `${s.day}:${s.hour}`)).toEqual(["6:20", "2:19", "5:12"]);
    expect(r).toMatchObject({ channels: 2, posts: 9, byCategory: false, minPosts: 3 });
  });
  it("canal filtré : ses créneaux seulement", () => {
    const r = calendarBestSlots([a, b], { channelId: "b" });
    expect(r.slots.map((s) => `${s.day}:${s.hour}`)).toEqual(["6:20"]);
    expect(r.channels).toBe(1);
  });
  it("catégorie filtrée : ses cases quand elles existent, sinon toutes catégories", () => {
    expect(calendarBestSlots([a, b], { categoryId: "bonus" }).slots[0]).toMatchObject({
      day: 1,
      hour: 10,
    });
    expect(calendarBestSlots([a, b], { categoryId: "bonus" }).byCategory).toBe(true);
    expect(calendarBestSlots([a, b], { categoryId: "inconnue" }).byCategory).toBe(false);
  });
  it("canal sans données : aucun créneau", () => {
    expect(calendarBestSlots([a, b], { channelId: "zzz" })).toMatchObject({
      slots: [],
      channels: 0,
    });
  });
  it("place les créneaux sur les jours de la semaine affichée", () => {
    const r = calendarBestSlots([a, b]);
    expect(slotsInWeek(r.slots, "2026-10-05").map((s) => `${s.day} ${s.hour}`)).toEqual([
      "2026-10-10 20",
      "2026-10-06 19",
      "2026-10-09 12",
    ]);
  });
});
