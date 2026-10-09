import { describe, expect, it } from "vitest";
import { detectDelimiter, detectPlayerColumns, parseCsv, rowsToPostbackParams } from "./csv";

describe("CSV joueurs", () => {
  it("détecte le séparateur", () => {
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"x,y";b')).toBe(";");
  });
  it("lit guillemets, BOM et retours Windows", () => {
    const rows = parseCsv('﻿player_id,event,amount\r\n"12","ftd","20,5"\r\n13,"dep ""x""",3\r\n');
    expect(rows).toEqual([["player_id", "event", "amount"], ["12", "ftd", "20,5"], ["13", 'dep "x"', "3"]]);
  });
  it("repère les colonnes avec des en-têtes FR/EN", () => {
    const cols = detectPlayerColumns(["Joueur", "Événement", "Montant", "Devise", "Date", "Sub ID"]);
    expect(cols).toEqual({ subId: 5, playerId: 0, event: 1, amount: 2, currency: 3, date: 4, txid: null });
    expect(() => detectPlayerColumns(["a", "b"])).toThrow(/identifiant joueur/);
  });
  it("convertit les lignes en paramètres de postback", () => {
    const rows = parseCsv("sub_id;player_id;event;amount\nABC;1;ftd;20\n");
    const cols = detectPlayerColumns(rows[0]!);
    expect(rowsToPostbackParams(rows.slice(1), cols)).toEqual([{ player_id: "1", event: "ftd", sub_id: "ABC", amount: "20" }]);
  });
});
