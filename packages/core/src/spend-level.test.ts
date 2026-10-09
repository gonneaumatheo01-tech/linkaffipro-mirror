import { describe, expect, it } from "vitest";
import { aggregatePlayers, computeSpendLevel, parseSpendThresholds } from "./spend-level";

describe("niveau de dépense", () => {
  it("AUCUN sans joueur", () => {
    expect(computeSpendLevel({ hasPlayer: false, registered: false, depositCount: 0, depositTotal: 0 })).toBe("AUCUN");
  });
  it("INSCRIT sans dépôt", () => {
    expect(computeSpendLevel({ hasPlayer: true, registered: true, depositCount: 0, depositTotal: 0 })).toBe("INSCRIT");
  });
  it("AUCUN avec joueur non inscrit et sans dépôt", () => {
    expect(computeSpendLevel({ hasPlayer: true, registered: false, depositCount: 0, depositTotal: 0 })).toBe("AUCUN");
  });
  it("DEPOSANT après un FTD", () => {
    expect(computeSpendLevel({ hasPlayer: true, registered: true, depositCount: 1, depositTotal: 20 })).toBe("DEPOSANT");
  });
  it("REGULIER à partir de 3 dépôts", () => {
    expect(computeSpendLevel({ hasPlayer: true, registered: true, depositCount: 3, depositTotal: 90 })).toBe("REGULIER");
    expect(computeSpendLevel({ hasPlayer: true, registered: true, depositCount: 2, depositTotal: 90 })).toBe("DEPOSANT");
  });
  it("VIP à partir du seuil cumulé, quel que soit le nombre de dépôts", () => {
    expect(computeSpendLevel({ hasPlayer: true, registered: true, depositCount: 1, depositTotal: 500 })).toBe("VIP");
    expect(computeSpendLevel({ hasPlayer: true, registered: true, depositCount: 10, depositTotal: 499 })).toBe("REGULIER");
  });
  it("respecte des seuils personnalisés", () => {
    const t = { vip: 100, regularDeposits: 2 };
    expect(computeSpendLevel({ hasPlayer: true, registered: true, depositCount: 2, depositTotal: 40 }, t)).toBe("REGULIER");
    expect(computeSpendLevel({ hasPlayer: true, registered: true, depositCount: 1, depositTotal: 100 }, t)).toBe("VIP");
  });
  it("lit les seuils avec repli sur les défauts", () => {
    expect(parseSpendThresholds(null)).toEqual({ vip: 500, regularDeposits: 3 });
    expect(parseSpendThresholds({ vip: 1000 })).toEqual({ vip: 1000, regularDeposits: 3 });
    expect(parseSpendThresholds({ vip: -5, regularDeposits: "x" })).toEqual({ vip: 500, regularDeposits: 3 });
  });
  it("agrège plusieurs joueurs", () => {
    const agg = aggregatePlayers([
      { registeredAt: null, depositCount: 1, depositTotal: 20 },
      { registeredAt: new Date(), depositCount: 2, depositTotal: 30 },
    ]);
    expect(agg).toEqual({ hasPlayer: true, registered: true, depositCount: 3, depositTotal: 50 });
    expect(computeSpendLevel(agg)).toBe("REGULIER");
    expect(aggregatePlayers([])).toEqual({ hasPlayer: false, registered: false, depositCount: 0, depositTotal: 0 });
  });
});
