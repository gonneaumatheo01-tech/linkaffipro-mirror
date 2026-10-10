import { describe, expect, it } from "vitest";
import { parisBounds } from "./usage";

describe("bornes du mois et du jour en heure de Paris", () => {
  it("calcule le 1er du mois et minuit à Paris (été : UTC+2)", () => {
    const b = parisBounds(new Date("2026-07-15T23:30:00Z")); // 16 juillet 01:30 à Paris
    expect(b.dayStart.toISOString()).toBe("2026-07-15T22:00:00.000Z");
    expect(b.monthStart.toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });
  it("hiver : UTC+1", () => {
    const b = parisBounds(new Date("2026-01-10T12:00:00Z"));
    expect(b.dayStart.toISOString()).toBe("2026-01-09T23:00:00.000Z");
    expect(b.monthStart.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });
});
