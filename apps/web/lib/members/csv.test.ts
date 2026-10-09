import { describe, expect, it } from "vitest";
import { csvEscape, toCsv } from "./csv";

describe("export CSV", () => {
  it("échappe les guillemets, séparateurs et retours à la ligne", () => {
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape("a;b")).toBe('"a;b"');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
    expect(csvEscape("simple")).toBe("simple");
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01T00:00:00.000Z");
  });
  it("produit un fichier avec BOM et en-têtes", () => {
    const csv = toCsv(["Nom", "Dépôts"], [["Jean", 12.5], ['Marie "M"', 0]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Nom;Dépôts\r\nJean;12.5\r\n\"Marie \"\"M\"\"\";0\r\n");
  });
});
