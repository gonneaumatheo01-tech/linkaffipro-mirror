import { describe, expect, it } from "vitest";
import { aggregateByDay, dayKey, dayKeys, parseRange, rangeStart } from "./aggregate";

describe("agrégation par jour", () => {
  it("calcule la clé de jour en heure de Paris", () => {
    expect(dayKey(new Date("2026-10-08T22:30:00Z"))).toBe("2026-10-09"); // 00h30 à Paris (UTC+2)
    expect(dayKey(new Date("2026-10-08T21:30:00Z"))).toBe("2026-10-08");
  });
  it("liste les jours de la fenêtre", () => {
    const keys = dayKeys(3, new Date("2026-10-09T12:00:00Z"));
    expect(keys).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
  });
  it("compte par jour, ignore hors fenêtre, pondère", () => {
    const keys = dayKeys(2, new Date("2026-10-09T12:00:00Z"));
    const s = aggregateByDay(
      [new Date("2026-10-08T10:00:00Z"), new Date("2026-10-09T10:00:00Z"), new Date("2026-10-09T11:00:00Z"), new Date("2026-10-01T10:00:00Z"), { at: new Date("2026-10-09T12:00:00Z"), value: 2.5 }],
      keys,
    );
    expect(s.values).toEqual([1, 4.5]);
    expect(s.total).toBe(5.5);
  });
  it("début de fenêtre = minuit Paris", () => {
    const start = rangeStart("7d", new Date("2026-10-09T12:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-02T22:00:00.000Z");
    expect(parseRange("x")).toBe("7d");
    expect(parseRange("today")).toBe("today");
  });
});
