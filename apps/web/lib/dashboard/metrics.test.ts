import { describe, expect, it } from "vitest";
import { EMPTY_TOTALS, addTotals, bestHours, cohorts, deltaPct, derive, funnel, weekKey } from "./metrics";

describe("indicateurs dérivés", () => {
  it("calcule CPL, CPA, coût par FTD, ROAS et bénéfice", () => {
    const d = derive({ ...EMPTY_TOTALS, spend: 100, joined: 40, registrations: 10, ftds: 4, ngr: 250 });
    expect(d).toEqual({ cpl: 2.5, cpa: 10, costPerFtd: 25, roas: 2.5, profit: 150 });
  });
  it("renvoie null quand la division est impossible", () => {
    const d = derive({ ...EMPTY_TOTALS, spend: 0, ngr: 12 });
    expect(d.cpl).toBeNull();
    expect(d.roas).toBeNull();
    expect(d.profit).toBe(12);
  });
  it("additionne des totaux en arrondissant", () => {
    expect(addTotals(EMPTY_TOTALS, { spend: 0.1 }).spend).toBe(0.1);
    expect(addTotals({ ...EMPTY_TOTALS, spend: 0.1 }, { spend: 0.2 }).spend).toBe(0.3);
  });
});

describe("deltas", () => {
  it("calcule la variation en pourcentage", () => {
    expect(deltaPct(120, 100)).toBe(20);
    expect(deltaPct(80, 100)).toBe(-20);
    expect(deltaPct(0, 0)).toBe(0);
    expect(deltaPct(5, 0)).toBeNull();
  });
});

describe("entonnoir", () => {
  it("donne les taux et pertes entre étapes", () => {
    const f = funnel({ ...EMPTY_TOTALS, entryClicks: 200, requests: 100, approved: 90, joined: 80, offerClicks: 40, registrations: 10, ftds: 5, deposits: 8 });
    expect(f[0]).toMatchObject({ label: "Clics pub", value: 200, rate: null, loss: null });
    expect(f[1]).toMatchObject({ value: 100, rate: 50, loss: 50 });
    expect(f[2]).toMatchObject({ value: 90, rate: 90, loss: 10 });
    expect(f[7]).toMatchObject({ label: "Dépôts", value: 8, rate: 160 });
  });
  it("gère une étape précédente nulle", () => {
    const f = funnel({ ...EMPTY_TOTALS, requests: 3 });
    expect(f[1]!.rate).toBeNull();
  });
});

describe("cohortes", () => {
  it("regroupe par semaine d'arrivée (lundi Paris) et cumule J+7 / J+30", () => {
    const rows = cohorts([
      { memberId: "a", arrivedAt: new Date("2026-10-07T10:00:00Z"), registeredAt: new Date("2026-10-08T00:00:00Z"), ftdAt: new Date("2026-10-09T00:00:00Z"), deposits: [{ at: new Date("2026-10-09T00:00:00Z"), amount: 20 }, { at: new Date("2026-10-20T00:00:00Z"), amount: 30 }, { at: new Date("2026-11-20T00:00:00Z"), amount: 99 }], ngr: 12 },
      { memberId: "b", arrivedAt: new Date("2026-10-11T22:30:00Z"), registeredAt: null, ftdAt: null, deposits: [], ngr: 0 },
      { memberId: "c", arrivedAt: new Date("2026-10-13T10:00:00Z"), registeredAt: null, ftdAt: null, deposits: [], ngr: 4 },
    ]);
    expect(rows.map((r) => r.week)).toEqual(["2026-10-12", "2026-10-05"]);
    expect(rows[1]).toMatchObject({ members: 1, registered: 1, ftd: 1, deposits7: 20, deposits30: 50, ltv: 12 });
    expect(rows[0]).toMatchObject({ members: 2, registered: 0, ftd: 0, deposits7: 0, deposits30: 0, ltv: 2 });
  });
  it("calcule le lundi de la semaine", () => {
    expect(weekKey(new Date("2026-10-09T10:00:00Z"))).toBe("2026-10-05");
    expect(weekKey(new Date("2026-10-11T22:30:00Z"))).toBe("2026-10-12");
  });
});

describe("meilleurs horaires", () => {
  it("classe les heures par clics par message", () => {
    const rows = bestHours([
      { sentAt: new Date("2026-10-09T16:00:00Z"), clicks: 10 },
      { sentAt: new Date("2026-10-09T16:30:00Z"), clicks: 20 },
      { sentAt: new Date("2026-10-09T08:00:00Z"), clicks: 5 },
    ]);
    expect(rows[0]).toEqual({ hour: 18, posts: 2, clicks: 30, clicksPerPost: 15 });
    expect(rows[1]).toEqual({ hour: 10, posts: 1, clicks: 5, clicksPerPost: 5 });
  });
});
