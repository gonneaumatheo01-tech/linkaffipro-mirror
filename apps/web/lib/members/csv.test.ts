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
  it("neutralise les formules (texte venu de Telegram ou de Link Affi), jamais les nombres", () => {
    // Ouvert dans Excel, une cellule qui commence par = + - @ s'exécuterait comme une formule.
    expect(csvEscape('=HYPERLINK("https://x";"Cliquez")')).toBe(
      `"'=HYPERLINK(""https://x"";""Cliquez"")"`,
    );
    expect(csvEscape("=1+1")).toBe("'=1+1");
    expect(csvEscape("+33 cmd")).toBe("'+33 cmd");
    expect(csvEscape("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvEscape("\t=1")).toBe("'\t=1");
    expect(csvEscape("\r=1")).toBe(`"'\r=1"`);
    // Nombres (déjà formatés à la française ou non) et textes ordinaires : intacts.
    expect(csvEscape(-12.5)).toBe("-12.5");
    expect(csvEscape("-12,50")).toBe("-12,50");
    expect(csvEscape("+3")).toBe("+3");
    expect(csvEscape("-0.5")).toBe("-0.5");
    expect(csvEscape(csvNumber(-1234.5))).toBe("-1234,50");
    expect(csvEscape("Paul — Casino")).toBe("Paul — Casino");
    expect(csvEscape("a=b")).toBe("a=b");
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
