import { describe, expect, it } from "vitest";
import {
  isAlgoSource,
  bestSlotFor,
  intensity,
  maxValue,
  parseChannelBestHours,
  recommendationSentence,
  slotLabel,
  type BestHoursCell,
} from "./types";

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

const sample = {
  channelId: "c1",
  weeks: 8,
  minPosts: 3,
  posts: 6,
  computedAt: "2026-10-09T10:00:00.000Z",
  categories: {
    all: {
      posts: 6,
      cells: [cell(2, 19, { clicksPerPost: 4 }), cell(5, 12, { clicksPerPost: 1 })],
      recommendation: {
        day: 2,
        hour: 19,
        posts: 3,
        metric: "clicksPerPost",
        value: 4,
        reactionsPerPost: 0.5,
      },
    },
    bonus: { posts: 2, cells: [cell(3, 10, { posts: 2 })], recommendation: null },
  },
};

describe("meilleurs horaires : lecture et libellés", () => {
  it("formate un créneau", () => {
    expect(slotLabel(2, 19)).toBe("mardi 19 h");
    expect(slotLabel(7, 0)).toBe("dimanche 0 h");
  });
  it("lit le JSON du worker et rejette une forme inconnue", () => {
    const d = parseChannelBestHours(sample)!;
    expect(d.channelId).toBe("c1");
    expect(d.categories.all!.recommendation?.hour).toBe(19);
    expect(d.categories.bonus!.recommendation).toBeNull();
    expect(parseChannelBestHours(null)).toBeNull();
    expect(parseChannelBestHours({ foo: 1 })).toBeNull();
    expect(parseChannelBestHours("x")).toBeNull();
  });
  it("trouve le créneau d'une catégorie, avec repli sur toutes catégories", () => {
    const d = parseChannelBestHours(sample);
    expect(bestSlotFor(d, "bonus")).toMatchObject({ day: 2, hour: 19, label: "mardi 19 h" });
    expect(bestSlotFor(d, "bonus", { fallbackToAll: false })).toBeNull();
    expect(bestSlotFor(d, null)).toMatchObject({ day: 2, hour: 19 });
    expect(bestSlotFor(null, "bonus")).toBeNull();
  });
  it("écrit une phrase de recommandation", () => {
    const d = parseChannelBestHours(sample)!;
    expect(recommendationSentence(d.categories.all, 3)).toContain("mardi 19 h");
    expect(recommendationSentence(d.categories.all, 3)).toContain("4 clic(s) par message");
    expect(recommendationSentence(d.categories.bonus, 3)).toContain("Pas assez de données");
    expect(recommendationSentence(undefined, 3)).toContain("Pas encore");
    expect(
      recommendationSentence(
        {
          posts: 3,
          cells: [],
          recommendation: {
            day: 1,
            hour: 8,
            posts: 3,
            metric: "ctr",
            value: 0.153,
            reactionsPerPost: 0,
          },
        },
        3,
      ),
    ).toContain("15,3 % de taux de clic");
  });
  it("met à l'échelle les couleurs", () => {
    const cells = [
      cell(1, 8, { clicksPerPost: 4 }),
      cell(1, 9, { clicksPerPost: 1 }),
      cell(1, 10, { clicksPerPost: 0 }),
    ];
    const max = maxValue(cells);
    expect(max).toBe(4);
    expect(intensity(cells[0], max)).toBe(4);
    expect(intensity(cells[1], max)).toBe(1);
    expect(intensity(cells[2], max)).toBe(1);
    expect(intensity(undefined, max)).toBe(0);
    expect(
      maxValue([cell(1, 8, { ctr: 0.2, clicksPerPost: 9 }), cell(1, 9, { clicksPerPost: 50 })]),
    ).toBe(0.2);
  });
});

describe("source des meilleurs horaires (phase 21)", () => {
  it("reconnaît le marqueur de l'équipe Algorithme, sous plusieurs formes", () => {
    expect(isAlgoSource("algo")).toBe(true);
    expect(isAlgoSource("agents-algo")).toBe(true);
    expect(isAlgoSource({ source: "horaires" })).toBe(true);
    expect(isAlgoSource({ computedBy: "algorithme" })).toBe(true);
    expect(isAlgoSource({ source: "worker" })).toBe(false);
    expect(isAlgoSource(null)).toBe(false);
  });
  it("la lecture du réglage du canal garde la source", () => {
    expect(parseChannelBestHours({ ...sample, source: "algo" })?.source).toBe("algo");
    expect(parseChannelBestHours(sample)?.source).toBeNull();
  });
});
