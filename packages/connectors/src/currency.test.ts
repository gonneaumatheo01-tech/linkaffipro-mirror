import { describe, expect, it } from "vitest";
import { mergeRates, parseRates, toEur } from "./currency";

describe("conversion en EUR", () => {
  it("laisse l'EUR tel quel et arrondit à 2 décimales", () => {
    expect(toEur(12.345, "eur", {})).toBe(12.35);
    expect(toEur(10, undefined, {})).toBe(10);
  });
  it("divise par le taux (unités par EUR) et refuse un taux inconnu", () => {
    expect(toEur(108, "USD", { USD: 1.08 })).toBe(100);
    expect(toEur(5, "GBP", {})).toBeNull();
    expect(toEur(5, "GBP", { GBP: 0 })).toBeNull();
  });
  it("fusionne les taux : saisie manuelle prioritaire, EUR toujours à 1", () => {
    expect(mergeRates({ USD: 1.1, EUR: 2 }, { USD: 1.05, GBP: 0.85 })).toEqual({ EUR: 1, USD: 1.05, GBP: 0.85 });
  });
  it("lit un JSON objet ou liste", () => {
    expect(parseRates({ usd: "1.2", bad: "x" })).toEqual({ USD: 1.2 });
    expect(parseRates([{ currency: "GBP", rate: 0.9 }, { currency: 1, rate: 2 }])).toEqual({ GBP: 0.9 });
  });
});
