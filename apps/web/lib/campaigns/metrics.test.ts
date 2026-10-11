import { describe, expect, it } from "vitest";
import { computeMetrics, fmtEur, fmtRatio } from "./metrics";

describe("métriques de pub", () => {
  it("calcule CPL, CPA, coût par FTD, retour sur dépense pub et gains (commissions − dépense)", () => {
    const m = computeMetrics({
      spend: 100,
      members: 50,
      registrations: 10,
      ftds: 4,
      revenue: 250,
      cpaCommissions: 140,
      revshareCommissions: 13.09,
    });
    expect(m.cpl).toBe(2);
    expect(m.cpa).toBe(10);
    expect(m.costPerFtd).toBe(25);
    expect(m.commissions).toBe(153.09);
    // Retour sur dépense pub = commissions ÷ dépense ; le revenu net (argent du casino) n'y entre jamais.
    expect(m.roas).toBeCloseTo(1.5309, 6);
    expect(m.gains).toBe(53.09);
    expect(m).not.toHaveProperty("profit");
  });
  it("les dépôts et le revenu net ne s'ajoutent jamais aux gains", () => {
    const m = computeMetrics({
      spend: 30,
      members: 0,
      registrations: 0,
      ftds: 0,
      revenue: 900,
      depositAmount: 5000,
    });
    expect(m.commissions).toBe(0);
    expect(m.gains).toBe(-30);
    expect(m.roas).toBe(0);
  });
  it("évite les divisions par zéro", () => {
    const m = computeMetrics({ spend: 0, members: 0, registrations: 0, ftds: 0, revenue: 0 });
    expect(m.cpl).toBeNull();
    expect(m.roas).toBeNull();
    expect(m.gains).toBe(0);
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
    // Commissions négatives (annulations) : vrai signe moins.
    expect(fmtRatio(-0.45)).toBe("\u22120,45×");
  });
});
