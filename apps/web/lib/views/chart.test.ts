import { describe, expect, it } from "vitest";
import { buildSeries, niceMax, tickLabel } from "./chart";

const t = (h: number) => new Date(Date.UTC(2026, 9, 1, h));

describe("niceMax", () => {
  it("arrondit vers 1, 2, 5 × 10^n", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(130)).toBe(200);
    expect(niceMax(420)).toBe(500);
    expect(niceMax(1000)).toBe(1000);
  });
});

describe("buildSeries", () => {
  it("null sans relevé", () => {
    expect(buildSeries([], "views")).toBeNull();
  });
  it("trie les relevés, premier à gauche, dernier à droite, y inversé", () => {
    const s = buildSeries(
      [
        { at: t(2), views: 100, forwards: 2 },
        { at: t(0), views: 10, forwards: 0 },
      ],
      "views",
    )!;
    expect(s.first.x).toBe(s.padding.left);
    expect(s.last.x).toBe(s.width - s.padding.right);
    expect(s.first.y).toBeGreaterThan(s.last.y);
    expect(s.max).toBe(100);
    expect(s.yTicks[2]!.value).toBe(100);
    expect(s.xTicks).toHaveLength(2);
    expect(s.polyline.split(" ")).toHaveLength(2);
  });
  it("mesure « transferts » avec sa propre échelle, valeurs négatives ramenées à 0", () => {
    const s = buildSeries(
      [
        { at: t(0), views: 500, forwards: -1 },
        { at: t(1), views: 600, forwards: 3 },
      ],
      "forwards",
    )!;
    expect(s.max).toBe(3);
    expect(s.first.value).toBe(0);
    expect(s.yTicks[2]!.value).toBe(5);
  });
  it("un seul relevé : point centré, un seul repère horizontal", () => {
    const s = buildSeries([{ at: t(0), views: 5, forwards: 1 }], "views")!;
    expect(s.xTicks).toHaveLength(1);
    expect(s.first.x).toBe(s.padding.left + (s.width - s.padding.left - s.padding.right) / 2);
  });
  it("libellés : heure sur moins de 2 jours, date au-delà", () => {
    expect(tickLabel(new Date("2026-10-01T10:00:00Z"), 3600_000)).toBe("12:00");
    expect(tickLabel(new Date("2026-10-01T10:00:00Z"), 10 * 24 * 3600_000)).toBe("01/10");
  });
});
