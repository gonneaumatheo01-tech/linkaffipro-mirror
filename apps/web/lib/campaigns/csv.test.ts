import { describe, expect, it } from "vitest";
import {
  applySavedMapping,
  columnSamples,
  detectColumns,
  detectDateFormat,
  detectNumberFormat,
  detectPlatform,
  detectSeparator,
  importReportText,
  mappingToSaved,
  parseCsv,
  parseCsvDate,
  parseCsvNumber,
  skippedSummary,
  skippedToReportLines,
  splitLine,
  toCostRows,
} from "./csv";

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
  it("convertit en lignes de coût, ignore les totaux et signale les montants illisibles", () => {
    const t = parseCsv("Date,Campaign name,Ad name,Cost,Clicks\n2026-10-01,C1,A1,10.5,3\n2026-10-01,,,10.5,3\n2026-10-02,C1,A1,x,0");
    const r = toCostRows(t, detectColumns(t.headers), "TIKTOK");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ date: "2026-10-01", campaign: "C1", ad: "A1", spend: 10.5, clicks: 3 });
    expect(r.skipped).toEqual([
      { line: 3, reason: "no_name", value: "" },
      { line: 4, reason: "spend_invalid", value: "x" },
    ]);
    expect(r.errors).toEqual(["Ligne 4 : montant illisible « x »"]);
  });
});

describe("détection de la plateforme", () => {
  it("reconnaît TikTok Ads Manager avec une bonne confiance", () => {
    const d = detectPlatform(["Date", "Campaign name", "Ad group name", "Ad name", "Cost", "Impressions", "Clicks (destination)", "CPC (destination)"]);
    expect(d.platform).toBe("TIKTOK");
    expect(d.confidence).toBeGreaterThanOrEqual(80);
    expect(d.matched).toContain("Ad group name");
  });
  it("reconnaît Meta Ads Manager en anglais et en français", () => {
    expect(detectPlatform(["Reporting starts", "Reporting ends", "Campaign name", "Ad set name", "Ad name", "Amount spent (EUR)", "Impressions", "Link clicks"]).platform).toBe("META");
    const fr = detectPlatform(["Début des rapports", "Nom de la campagne", "Nom de l'ensemble de publicités", "Nom de la publicité", "Montant dépensé (EUR)", "Impressions", "Clics sur un lien"]);
    expect(fr.platform).toBe("META");
    expect(fr.confidence).toBeGreaterThanOrEqual(80);
  });
  it("retombe sur le CSV générique sans marqueur, avec une confiance selon les colonnes clés", () => {
    expect(detectPlatform(["Jour", "Campagne", "Dépense"])).toMatchObject({ platform: "OTHER", confidence: 50 });
    expect(detectPlatform(["a", "b", "c"])).toMatchObject({ platform: "OTHER", confidence: 20 });
  });
  it("tranche entre deux plateformes proches avec une confiance réduite", () => {
    const d = detectPlatform(["Date", "Campaign name", "Ad set name", "Cost"]);
    expect(d.platform).toBe("META");
    expect(d.confidence).toBeLessThan(50);
  });
});

describe("formats de nombres et de dates", () => {
  it("devine le format des nombres d'une colonne", () => {
    expect(detectNumberFormat(["1 234,56", "12,50", "3,00"])).toBe("fr");
    expect(detectNumberFormat(["1,234.56", "12.50", "3.00"])).toBe("en");
    expect(detectNumberFormat(["1.234,56", "2.000,00"])).toBe("fr");
    expect(detectNumberFormat(["12", "3"])).toBe("auto");
    expect(detectNumberFormat(["1,234", "2,000"])).toBe("auto");
  });
  it("lit les nombres selon le format imposé", () => {
    expect(parseCsvNumber("1.234,56", "fr")).toBe(1234.56);
    expect(parseCsvNumber("1.234,56")).toBe(1234.56);
    expect(parseCsvNumber("1,234", "fr")).toBe(1.234);
    expect(parseCsvNumber("1,234", "en")).toBe(1234);
    expect(parseCsvNumber("12.5", "fr")).toBe(125); // le point est un séparateur de milliers en fr
    expect(parseCsvNumber("€ 1 234,5", "fr")).toBe(1234.5);
  });
  it("devine le format des dates d'une colonne", () => {
    expect(detectDateFormat(["2026-10-09", "2026-10-10"])).toBe("ymd");
    expect(detectDateFormat(["13/10/2026", "09/10/2026"])).toBe("dmy");
    expect(detectDateFormat(["10/13/2026", "10/09/2026"])).toBe("mdy");
    expect(detectDateFormat(["09/10/2026"], "META")).toBe("mdy");
    expect(detectDateFormat(["09/10/2026"], "TIKTOK")).toBe("dmy");
    expect(detectDateFormat([])).toBe("auto");
  });
  it("lit les dates selon le format imposé et les variantes", () => {
    expect(parseCsvDate("09/10/2026", "OTHER", "dmy")).toBe("2026-10-09");
    expect(parseCsvDate("09/10/2026", "OTHER", "mdy")).toBe("2026-09-10");
    expect(parseCsvDate("09.10.2026")).toBe("2026-10-09");
    expect(parseCsvDate("2026/10/09")).toBe("2026-10-09");
    expect(parseCsvDate("13/13/2026", "OTHER", "mdy")).toBeNull();
  });
  it("applique les formats aux lignes et produit le rapport", () => {
    const t = parseCsv("Jour;Campagne;Dépense\n10/09/2026;C1;1.234,56\n11/09/2026;C1;\nn/a;C1;5\n12/09/2026;;3");
    const r = toCostRows(t, detectColumns(t.headers), "OTHER", { numberFormat: "fr", dateFormat: "mdy" });
    expect(r.rows).toEqual([{ date: "2026-10-09", campaign: "C1", adset: "", ad: "", spend: 1234.56, impressions: 0, clicks: 0, currency: null }]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["spend_empty", "date_invalid", "no_name"]);
    expect(skippedSummary(r.skipped)).toEqual([
      { reason: "spend_empty", label: "montant vide", count: 1 },
      { reason: "date_invalid", label: "date illisible", count: 1 },
      { reason: "no_name", label: "ligne de total ou sans nom de pub", count: 1 },
    ]);
    expect(importReportText(1, r.skipped)).toBe("1 ligne importée, 3 ignorées (1 : montant vide, 1 : date illisible, 1 : ligne de total ou sans nom de pub)");
    expect(importReportText(2, [], 1)).toBe("2 lignes importées, 1 en erreur à l'enregistrement");
    expect(skippedToReportLines(r.skipped)[1]).toBe("Ligne 4 : date illisible « n/a »");
    expect(columnSamples(t, 2)).toEqual(["1.234,56", "5", "3"]);
  });
});

describe("correspondance mémorisée", () => {
  it("mémorise par nom d'en-tête et se réapplique même si les colonnes changent d'ordre", () => {
    const headers = ["Jour", "Campagne", "Dépense totale", "Clics"];
    const saved = mappingToSaved(headers, { date: 0, campaign: 1, spend: 2, clicks: 3 });
    expect(saved).toEqual({ date: "Jour", campaign: "Campagne", spend: "Dépense totale", clicks: "Clics" });
    expect(applySavedMapping(["Clics", "Dépense Totale", "Campagne", "jour"], saved)).toEqual({ date: 3, campaign: 2, spend: 1, clicks: 0 });
  });
  it("renvoie null si la date ou la dépense manque dans le nouveau fichier", () => {
    expect(applySavedMapping(["Jour", "Campagne"], { date: "Jour", spend: "Dépense" })).toBeNull();
    expect(applySavedMapping(["Jour"], null)).toBeNull();
  });
});
