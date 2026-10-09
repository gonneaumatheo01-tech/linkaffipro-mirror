import { describe, expect, it } from "vitest";
import { fmtDateShort, fmtMoney, fmtPct, fmtRelative } from "./format";

describe("formats français", () => {
  it("formate les montants en euros", () => {
    expect(fmtMoney(1234.5).replace(/ | /g, " ")).toBe("1 234,50 €");
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney(0, "EUR", { digits: 0 }).replace(/ | /g, " ")).toBe("0 €");
  });
  it("formate les pourcentages à partir d'un ratio", () => {
    expect(fmtPct(0.153).replace(/ | /g, " ")).toBe("15,3 %");
    expect(fmtPct(null)).toBe("—");
  });
  it("formate une date courte en Europe/Paris", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(fmtDateShort(new Date("2026-10-01T22:30:00Z"), now)).toBe("2 oct.");
    expect(fmtDateShort(new Date("2025-01-05T10:00:00Z"), now)).toBe("5 janv. 2025");
    expect(fmtDateShort(null)).toBe("—");
  });
  it("formate une durée relative", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(fmtRelative(new Date("2026-10-09T11:57:00Z"), now)).toBe("il y a 3 min");
    expect(fmtRelative(new Date("2026-10-09T14:00:00Z"), now)).toBe("dans 2 h");
    expect(fmtRelative(new Date("2026-10-07T12:00:00Z"), now)).toBe("il y a 2 jours");
    expect(fmtRelative(new Date("2026-10-09T12:00:10Z"), now)).toBe("dans un instant");
  });
});
