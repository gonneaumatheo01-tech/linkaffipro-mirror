import { describe, expect, it } from "vitest";
import { computeMetrics, fmtEur, fmtRatio } from "./metrics";

describe("métriques de pub", () => {
  it("calcule CPL, CPA, coût par FTD, ROAS et bénéfice", () => {
    const m = computeMetrics({ spend: 100, members: 50, registrations: 10, ftds: 4, revenue: 250 });
    expect(m.cpl).toBe(2);
    expect(m.cpa).toBe(10);
    expect(m.costPerFtd).toBe(25);
    expect(m.roas).toBe(2.5);
    expect(m.profit).toBe(150);
  });
  it("évite les divisions par zéro", () => {
    const m = computeMetrics({ spend: 0, members: 0, registrations: 0, ftds: 0, revenue: 0 });
    expect(m.cpl).toBeNull();
    expect(m.roas).toBeNull();
    expect(m.profit).toBe(0);
    expect(fmtEur(m.cpl)).toBe("—");
    expect(fmtRatio(null)).toBe("—");
  });
  it("formate en euros", () => {
    expect(fmtEur(12.5)).toMatch(/12,50/);
  });
  it("formate un ratio à la française", () => {
    expect(fmtRatio(2.5)).toBe("2,50×");
    expect(fmtRatio(0)).toBe("0,00×");
    expect(fmtRatio(Number.NaN)).toBe("—");
  });
});
