import { describe, expect, it } from "vitest";
import {
  daysBetween,
  parseCompare,
  parsePeriodKey,
  periodDates,
  periodDayKeys,
  periodEnd,
  periodLabel,
  periodLabelWithDates,
  periodParams,
  periodStart,
  previousPeriod,
  resolvePeriod,
  shiftDay,
  variationPct,
} from "./periods";

// Jeudi 9 octobre 2026, 14 h à Paris (UTC+2).
const now = new Date("2026-10-09T12:00:00Z");

describe("résolution des périodes", () => {
  it("par défaut : 7 derniers jours jusqu'à aujourd'hui (Paris)", () => {
    expect(resolvePeriod({}, now)).toEqual({
      key: "7d",
      from: "2026-10-03",
      to: "2026-10-09",
      days: 7,
    });
    expect(resolvePeriod({ range: "n'importe quoi" }, now).key).toBe("7d");
  });
  it("aujourd'hui, hier, 30 et 90 jours, mois en cours", () => {
    expect(resolvePeriod({ range: "today" }, now)).toEqual({
      key: "today",
      from: "2026-10-09",
      to: "2026-10-09",
      days: 1,
    });
    expect(resolvePeriod({ range: "yesterday" }, now)).toEqual({
      key: "yesterday",
      from: "2026-10-08",
      to: "2026-10-08",
      days: 1,
    });
    expect(resolvePeriod({ range: "30d" }, now)).toMatchObject({
      from: "2026-09-10",
      to: "2026-10-09",
      days: 30,
    });
    expect(resolvePeriod({ range: "90d" }, now)).toMatchObject({ from: "2026-07-12", days: 90 });
    expect(resolvePeriod({ range: "month" }, now)).toEqual({
      key: "month",
      from: "2026-10-01",
      to: "2026-10-09",
      days: 9,
    });
  });
  it("le jour Paris compte, pas le jour UTC", () => {
    // 23 h 30 UTC le 8 = 1 h 30 le 9 à Paris.
    expect(resolvePeriod({ range: "today" }, new Date("2026-10-08T23:30:00Z")).from).toBe(
      "2026-10-09",
    );
  });
  it("accepte les anciens paramètres 7 / 30 / 90 et les tableaux", () => {
    expect(parsePeriodKey("30")).toBe("30d");
    expect(parsePeriodKey(["90", "7"])).toBe("90d");
    expect(parsePeriodKey("x")).toBeNull();
    expect(resolvePeriod({ range: ["7"] }, now).key).toBe("7d");
  });
  it("période personnalisée : bornes remises dans l'ordre, tronquée à 366 jours, repli si invalide", () => {
    expect(resolvePeriod({ range: "custom", from: "2026-10-05", to: "2026-10-01" }, now)).toEqual({
      key: "custom",
      from: "2026-10-01",
      to: "2026-10-05",
      days: 5,
    });
    expect(resolvePeriod({ from: "2026-10-01", to: "2026-10-02" }, now).key).toBe("custom"); // sans `range`, deux dates suffisent
    expect(resolvePeriod({ range: "custom", from: "2026-02-30", to: "2026-10-02" }, now).key).toBe(
      "7d",
    );
    expect(
      resolvePeriod({ range: "custom", from: "2024-01-01", to: "2026-10-02" }, now),
    ).toMatchObject({ from: "2024-01-01", to: "2024-12-31", days: 366 });
  });
  it("période précédente de même longueur, collée à la période", () => {
    expect(previousPeriod(resolvePeriod({ range: "7d" }, now))).toEqual({
      key: "custom",
      from: "2026-09-26",
      to: "2026-10-02",
      days: 7,
    });
    expect(previousPeriod(resolvePeriod({ range: "today" }, now))).toMatchObject({
      from: "2026-10-08",
      to: "2026-10-08",
    });
    expect(previousPeriod(resolvePeriod({ range: "month" }, now))).toMatchObject({
      from: "2026-09-22",
      to: "2026-09-30",
      days: 9,
    });
  });
});

describe("outils de dates", () => {
  it("décale et compte les jours sans effet d'heure d'été", () => {
    expect(shiftDay("2026-03-29", 1)).toBe("2026-03-30");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(1);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(3);
    expect(periodDayKeys({ key: "custom", from: "2026-10-08", to: "2026-10-10", days: 3 })).toEqual(
      ["2026-10-08", "2026-10-09", "2026-10-10"],
    );
  });
  it("bornes UTC : minuit Paris du premier jour (inclus) et du lendemain du dernier (exclu)", () => {
    const p = resolvePeriod({ range: "yesterday" }, now);
    expect(periodStart(p).toISOString()).toBe("2026-10-07T22:00:00.000Z");
    expect(periodEnd(p).toISOString()).toBe("2026-10-08T22:00:00.000Z");
    // En hiver (UTC+1).
    expect(
      periodStart({ key: "custom", from: "2026-01-15", to: "2026-01-15", days: 1 }).toISOString(),
    ).toBe("2026-01-14T23:00:00.000Z");
    expect(periodDates(p)).toEqual({
      dateFrom: new Date("2026-10-08T00:00:00Z"),
      dateTo: new Date("2026-10-08T00:00:00Z"),
    });
  });
  it("libellés en français", () => {
    expect(periodLabel(resolvePeriod({ range: "7d" }, now))).toBe("7 derniers jours");
    expect(periodLabel({ key: "custom", from: "2026-10-01", to: "2026-10-09", days: 9 })).toBe(
      "Du 1 oct. au 9 oct. 2026",
    );
    expect(periodLabel({ key: "custom", from: "2025-12-30", to: "2026-01-02", days: 4 })).toBe(
      "Du 30 déc. 2025 au 2 janv. 2026",
    );
    expect(periodLabel({ key: "custom", from: "2026-10-09", to: "2026-10-09", days: 1 })).toBe(
      "Le 9 oct. 2026",
    );
    expect(periodLabelWithDates(resolvePeriod({ range: "7d" }, now))).toBe(
      "7 derniers jours (3 oct. – 9 oct. 2026)",
    );
    expect(periodLabelWithDates(resolvePeriod({ range: "today" }, now))).toBe(
      "Aujourd'hui (9 oct. 2026)",
    );
  });
  it("paramètres d'URL et comparaison", () => {
    expect(periodParams(resolvePeriod({ range: "30d" }, now))).toEqual({ range: "30d" });
    expect(
      periodParams({ key: "custom", from: "2026-10-01", to: "2026-10-05", days: 5 }, true),
    ).toEqual({ range: "custom", from: "2026-10-01", to: "2026-10-05", compare: "1" });
    expect(parseCompare("1")).toBe(true);
    expect(parseCompare(["on"])).toBe(true);
    expect(parseCompare(undefined)).toBe(false);
  });
  it("variation en pourcentage", () => {
    expect(variationPct(150, 100)).toBe(50);
    expect(variationPct(80, 100)).toBe(-20);
    expect(variationPct(1, 3)).toBe(-66.7);
    expect(variationPct(0, 0)).toBe(0);
    expect(variationPct(5, 0)).toBeNull();
  });
});
