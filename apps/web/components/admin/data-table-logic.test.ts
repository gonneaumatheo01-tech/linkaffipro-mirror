import { describe, expect, it } from "vitest";
import {
  MAX_COLUMNS,
  ariaSort,
  cellSortValue,
  numericColumnWarning,
  parseFormattedNumber,
  columnCountWarning,
  compareSortValues,
  firstDirection,
  nextSort,
  sortRows,
} from "./data-table-logic";

describe("tri du DataTable", () => {
  it("compare les nombres, les dates, les booléens et les textes en français", () => {
    expect(compareSortValues(2, 10)).toBeLessThan(0);
    expect(compareSortValues(10n, 2n)).toBeGreaterThan(0);
    expect(compareSortValues(new Date("2026-01-01"), new Date("2026-02-01"))).toBeLessThan(0);
    expect(compareSortValues(false, true)).toBeLessThan(0);
    // Ordre naturel (2 avant 10) et sans tenir compte des accents ni de la casse.
    expect(compareSortValues("Canal 2", "Canal 10")).toBeLessThan(0);
    expect(compareSortValues("école", "Ecole")).toBe(0);
    expect(compareSortValues("Été", "Zèbre")).toBeLessThan(0);
  });

  it("trie dans les deux sens en gardant les valeurs vides à la fin", () => {
    const rows = [
      { id: "a", v: 3 },
      { id: "b", v: null },
      { id: "c", v: 1 },
      { id: "d", v: 2 },
      { id: "e", v: undefined },
    ];
    const get = (r: (typeof rows)[number]) => r.v;
    expect(sortRows(rows, get, "asc").map((r) => r.id)).toEqual(["c", "d", "a", "b", "e"]);
    expect(sortRows(rows, get, "desc").map((r) => r.id)).toEqual(["a", "d", "c", "b", "e"]);
    // Ne modifie pas le tableau d'origine.
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("est stable : les égalités gardent l'ordre d'origine", () => {
    const rows = [
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "c", v: 1 },
      { id: "d", v: 2 },
    ];
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("traite une chaîne vide et NaN comme des valeurs vides", () => {
    const rows = [
      { id: "a", v: "" as string | number },
      { id: "b", v: "x" },
      { id: "c", v: Number.NaN },
    ];
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("passe d'un sens à l'autre puis revient à l'ordre d'origine", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", direction: "asc" });
    expect(nextSort({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    });
    expect(nextSort({ key: "name", direction: "desc" }, "name")).toBeNull();
    // Colonne de chiffres : du plus grand au plus petit d'abord.
    expect(nextSort(null, "ftd", "desc")).toEqual({ key: "ftd", direction: "desc" });
    expect(nextSort({ key: "ftd", direction: "desc" }, "ftd", "desc")).toEqual({
      key: "ftd",
      direction: "asc",
    });
    expect(nextSort({ key: "ftd", direction: "asc" }, "ftd", "desc")).toBeNull();
    // Autre colonne : on repart du premier sens.
    expect(nextSort({ key: "name", direction: "desc" }, "ftd", "desc")).toEqual({
      key: "ftd",
      direction: "desc",
    });
  });

  it("choisit le premier sens selon l'alignement de la colonne", () => {
    expect(firstDirection({ align: "right" })).toBe("desc");
    expect(firstDirection({ align: "left" })).toBe("asc");
    expect(firstDirection({})).toBe("asc");
    expect(firstDirection({ align: "right", sortFirst: "asc" })).toBe("asc");
  });

  it("donne l'attribut aria-sort de chaque en-tête", () => {
    expect(ariaSort({ key: "a", direction: "asc" }, "a")).toBe("ascending");
    expect(ariaSort({ key: "a", direction: "desc" }, "a")).toBe("descending");
    expect(ariaSort({ key: "a", direction: "desc" }, "b")).toBe("none");
    expect(ariaSort(null, "a")).toBe("none");
  });

  it("lit la valeur de tri d'une cellule simple (texte, nombre, date), pas d'un nœud React", () => {
    expect(cellSortValue("abc")).toBe("abc");
    expect(cellSortValue(12)).toBe(12);
    const d = new Date();
    expect(cellSortValue(d)).toBe(d);
    expect(cellSortValue({ type: "span", props: {} })).toBeNull();
    expect(cellSortValue(null)).toBeNull();
  });

  it("trie les montants déjà formatés en français (« 1 234 € ») comme des nombres", () => {
    const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
    const cells = [1234, 987, 15000, 42, 250].map((n) => eur.format(n));
    const rows = cells.map((c, i) => ({ id: String(i), c }));
    const get = (r: (typeof rows)[number]) => cellSortValue(r.c);
    expect(sortRows(rows, get, "desc").map((r) => r.c)).toEqual(
      [15000, 1234, 987, 250, 42].map((n) => eur.format(n)),
    );
    expect(sortRows(rows, get, "asc").map((r) => r.c)).toEqual(
      [42, 250, 987, 1234, 15000].map((n) => eur.format(n)),
    );
  });

  it("lit les nombres, montants et pourcentages au format français", () => {
    const pct = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });
    const usd = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" });
    expect(parseFormattedNumber(new Intl.NumberFormat("fr-FR").format(12345))).toBe(12345);
    expect(parseFormattedNumber("1 234,50 €")).toBe(1234.5);
    expect(parseFormattedNumber(pct.format(0.153))).toBe(15.3);
    expect(parseFormattedNumber(pct.format(-0.153))).toBe(-15.3);
    expect(parseFormattedNumber("−3,5 %")).toBe(-3.5);
    expect(parseFormattedNumber("+12 %")).toBe(12);
    expect(parseFormattedNumber(usd.format(1234.5))).toBe(1234.5);
    expect(parseFormattedNumber("0,8")).toBe(0.8);
    // Pas des nombres : du texte, un identifiant, une fraction, une durée.
    expect(parseFormattedNumber("Canal 2")).toBeNull();
    expect(parseFormattedNumber("12 / 40")).toBeNull();
    expect(parseFormattedNumber("3 j")).toBeNull();
    expect(parseFormattedNumber("tg-8f2k-91")).toBeNull();
    expect(parseFormattedNumber("1,2,3")).toBeNull();
    expect(parseFormattedNumber("")).toBeNull();
  });

  it("garde les cellules « — » (valeur absente) à la fin, dans les deux sens", () => {
    expect(cellSortValue("—")).toBeNull();
    expect(cellSortValue("–")).toBeNull();
    expect(cellSortValue(" - ")).toBeNull();
    const rows = ["12 €", "—", "3 €"].map((c, i) => ({ id: String(i), c }));
    const get = (r: (typeof rows)[number]) => cellSortValue(r.c);
    expect(sortRows(rows, get, "desc").map((r) => r.c)).toEqual(["12 €", "3 €", "—"]);
    expect(sortRows(rows, get, "asc").map((r) => r.c)).toEqual(["3 €", "12 €", "—"]);
  });

  it("lit les dates « 09/10/2026 14:05 » (fmtDate) dans l'ordre chronologique", () => {
    const v = cellSortValue("09/10/2026 14:05");
    expect(v).toBeInstanceOf(Date);
    expect(compareSortValues(v as Date, cellSortValue("10/09/2026") as Date)).toBeGreaterThan(0);
    expect(cellSortValue("31/02/2026")).toBe("31/02/2026");
  });

  it("garde le texte comme texte", () => {
    expect(cellSortValue("Casino week-end")).toBe("Casino week-end");
    expect(cellSortValue("Canal 10")).toBe("Canal 10");
  });

  it("avertit (développement) quand une colonne de chiffres reçoit du texte non triable", () => {
    expect(numericColumnWarning("Revenu net", ["12 €", "—", 4, null])).toBeNull();
    expect(numericColumnWarning("Membres", ["12 / 40", "3"])).toMatch(/Membres.*sortValues/);
  });

  it("avertit au-delà de 5 colonnes", () => {
    expect(MAX_COLUMNS).toBe(5);
    expect(columnCountWarning(5)).toBeNull();
    expect(columnCountWarning(6)).toMatch(/6 colonnes/);
  });
});
