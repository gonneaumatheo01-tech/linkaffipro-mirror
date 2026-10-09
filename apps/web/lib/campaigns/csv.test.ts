import { describe, expect, it } from "vitest";
import { detectColumns, detectSeparator, parseCsv, parseCsvDate, parseCsvNumber, splitLine, toCostRows } from "./csv";

describe("parse CSV", () => {
  it("lit les trois séparateurs", () => {
    expect(parseCsv("a,b\n1,2").headers).toEqual(["a", "b"]);
    expect(parseCsv("a;b\n1;2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2").separator).toBe("\t");
  });
  it("gère les guillemets et le BOM", () => {
    const t = parseCsv('﻿"Campaign name","Amount spent (EUR)"\n"Casino, FR ""v2""","12,5"');
    expect(t.headers).toEqual(["Campaign name", "Amount spent (EUR)"]);
    expect(t.rows[0]).toEqual(['Casino, FR "v2"', "12,5"]);
  });
  it("regroupe un champ multiligne entre guillemets", () => {
    const t = parseCsv('a,b\n"ligne 1\nsuite",2');
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]![0]).toBe("ligne 1\nsuite");
  });
  it("détecte le séparateur", () => {
    expect(detectSeparator("a;b;c")).toBe(";");
    expect(splitLine('"x;y";z', ";")).toEqual(["x;y", "z"]);
  });
});

describe("détection des colonnes", () => {
  it("reconnaît un export TikTok Ads Manager", () => {
    const m = detectColumns(["Date", "Campaign name", "Ad group name", "Ad name", "Cost", "Impressions", "Clicks (destination)", "CPC (destination)"]);
    expect(m).toEqual({ date: 0, campaign: 1, adset: 2, ad: 3, spend: 4, impressions: 5, clicks: 6 });
  });
  it("reconnaît un export Meta Ads Manager (anglais et français)", () => {
    expect(detectColumns(["Reporting starts", "Reporting ends", "Campaign name", "Ad set name", "Ad name", "Amount spent (EUR)", "Impressions", "Link clicks", "Currency"])).toEqual({ date: 0, campaign: 2, adset: 3, ad: 4, spend: 5, impressions: 6, clicks: 7, currency: 8 });
    expect(detectColumns(["Début des rapports", "Nom de la campagne", "Nom de l'ensemble de publicités", "Nom de la publicité", "Montant dépensé (EUR)", "Impressions", "Clics sur un lien"])).toMatchObject({ date: 0, campaign: 1, adset: 2, ad: 3, spend: 4, impressions: 5, clicks: 6 });
  });
  it("ne prend pas « cost per » pour la dépense", () => {
    expect(detectColumns(["Day", "Campaign", "Cost per click", "Spend"])).toMatchObject({ spend: 3 });
  });
});

describe("dates et nombres", () => {
  it("lit les formats de date", () => {
    expect(parseCsvDate("2026-10-09")).toBe("2026-10-09");
    expect(parseCsvDate("2026-10-09 00:00:00")).toBe("2026-10-09");
    expect(parseCsvDate("09/10/2026", "TIKTOK")).toBe("2026-10-09");
    expect(parseCsvDate("10/09/2026", "META")).toBe("2026-10-09");
    expect(parseCsvDate("n/a")).toBeNull();
  });
  it("lit les nombres FR et EN", () => {
    expect(parseCsvNumber("1 234,56")).toBe(1234.56);
    expect(parseCsvNumber("1,234.56")).toBe(1234.56);
    expect(parseCsvNumber("€12.5")).toBe(12.5);
    expect(parseCsvNumber("")).toBe(0);
  });
  it("convertit en lignes de coût et ignore les totaux", () => {
    const t = parseCsv("Date,Campaign name,Ad name,Cost,Clicks\n2026-10-01,C1,A1,10.5,3\n2026-10-01,,,10.5,3\n2026-10-02,C1,A1,x,0");
    const r = toCostRows(t, detectColumns(t.headers), "TIKTOK");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ date: "2026-10-01", campaign: "C1", ad: "A1", spend: 10.5, clicks: 3 });
    expect(r.errors).toEqual([]);
  });
});
