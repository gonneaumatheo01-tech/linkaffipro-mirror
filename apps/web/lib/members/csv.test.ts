import { describe, expect, it } from "vitest";
import { csvDate, csvDay, csvEscape, csvNumber, toCsv } from "./csv";

describe("export CSV", () => {
  it("échappe les guillemets, séparateurs et retours à la ligne", () => {
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape("a;b")).toBe('"a;b"');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
    expect(csvEscape("simple")).toBe("simple");
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01T00:00:00.000Z");
  });
  it("formate les dates en Europe/Paris et les nombres à la française", () => {
    expect(csvDate(new Date("2026-10-09T12:05:00Z"))).toBe("09/10/2026 14:05");
    expect(csvDay(new Date("2026-01-31T23:30:00Z"))).toBe("01/02/2026");
    expect(csvDate(null)).toBe("");
    expect(csvNumber(12.5)).toBe("12,50");
    expect(csvNumber(null)).toBe("");
  });
  it("produit un fichier avec BOM et en-têtes", () => {
    const csv = toCsv(
      ["Nom", "Dépôts"],
      [
        ["Jean", 12.5],
        ['Marie "M"', 0],
      ],
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('Nom;Dépôts\r\nJean;12.5\r\n"Marie ""M""";0\r\n');
  });
});
