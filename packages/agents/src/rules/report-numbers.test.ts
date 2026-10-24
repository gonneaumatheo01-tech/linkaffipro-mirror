import { describe, expect, it } from "vitest";
import { allowedNumbers, inventedNumbers } from "./report-numbers";
import { adsCodeLines, parseAdsReportOutput, writeAdsReport, type AdsDailyFacts, type AdsWeeklyFacts } from "../agents/ads/report";
import { codeLines, parseReportOutput, type TeamFacts } from "../agents/synthese/report";

const weekly: AdsWeeklyFacts = {
  kind: "weekly",
  weekStart: "2026-10-19",
  weekLabel: "19 octobre",
  spend: 120,
  gains: 40,
  roas: 1.4,
  verticals: [{ label: "Casino", spend: 100, gains: 40, roas: 1.4, gainsChangePct: -35, spendChangePct: 12 }],
  cohort: null,
  recommendations: [{ rank: 1, action: "Arrêter", name: "Pub 2026 été", sentence: "Coût par inscription de 45 € sur 28 jours." }],
  connectorsMissing: false,
};

const ok = (line: string, facts: unknown = weekly) => inventedNumbers(line, allowedNumbers(facts));

describe("contrôle « aucun chiffre inventé »", () => {
  it("accepte les chiffres fournis avec leur signe", () => {
    expect(ok("Casino : gains en baisse de 35 % sur la semaine d'avant.")).toEqual([]);
    expect(ok("Casino : gains −35 %, dépense +12 %.")).toEqual([]);
    expect(ok("Semaine : 120 € dépensés, 40 € de gains, retour 1,4.")).toEqual([]);
  });
  it("refuse le signe contraire", () => {
    expect(ok("Casino : hausse de 35 % des gains.")).not.toEqual([]);
    expect(ok("Casino : gains +35 %.")).not.toEqual([]);
    expect(ok("Casino : 40 € de pertes cette semaine.")).not.toEqual([]);
    expect(ok("Dépense en baisse de 12 %.")).not.toEqual([]);
  });
  it("refuse les gains positifs écrits pour une perte", () => {
    const f = { ...weekly, gains: -40, verticals: [] };
    expect(ok("Gains de 40 € cette semaine.", f)).not.toEqual([]);
    expect(ok("40 € de pertes cette semaine.", f)).toEqual([]);
    expect(ok("Gains : -40 €.", f)).toEqual([]);
  });
  it("ne prend pas les nombres des dates, des noms ni des clés", () => {
    expect(ok("Semaine du 19 octobre : 120 € dépensés.")).toEqual([]);
    expect(ok("19 pubs actives.")).toEqual(["19"]);
    expect(ok("Arrêter « Pub 2026 été »."), "nom recopié").toEqual([]);
    expect(ok("2026 inscriptions.")).toEqual(["2026"]);
    expect(ok("Coût par inscription de 45 € sur 28 jours.")).toEqual([]);
    expect(ok("45 € par inscription.")).toEqual(["45"]);
  });
  it("plus de dispense des petits nombres 0 à 7", () => {
    expect(ok("Sur 7 jours, 3 pubs.")).toEqual(["7", "3"]);
  });
  it("refuse multiplicateurs, nombres en lettres et ordres de grandeur", () => {
    for (const l of ["Gains 3 fois plus élevés.", "Deux fois plus de gains.", "Gains doublés.", "La moitié de la dépense.", "Un tiers des pubs.", "Douze mille membres.", "1,4 million de vues.", "1,4k vues.", "Trois pubs à arrêter."])
      expect(ok(l), l).not.toEqual([]);
  });
  it("intervalle d'heures : le tiret n'est pas un signe", () => {
    expect(ok("Fenêtre 18-20 h.", { a: 18, b: 20 })).toEqual([]);
  });
  it("les lignes du code passent toujours le contrôle", () => {
    const daily: AdsDailyFacts = {
      kind: "daily", day: "2026-10-23", dayLabel: "jeudi 23 octobre", spend: 10, commissions: 5, gains: -5, roas: 0.5, connectorsMissing: false,
      best: { name: "Vidéo 1", campaign: null, spend: 4, gains: 2.5, roas: 1.63 }, worst: { name: "Vidéo 2", campaign: null, spend: 6, gains: -7.5, roas: null },
      recommendations: { STOP: 1, SCALE: 0, TEST: 0, WATCH: 2, total: 3 },
    };
    for (const f of [daily, weekly]) for (const l of adsCodeLines(f)) expect(ok(l, f), l).toEqual([]);
    const t: TeamFacts = {
      team: "casino", posts7d: 9, views7d: 1200, bestFormat: { label: "vidéo", ctrPct: 1.25 }, bestWindow: { day: "lundi", start: "18:00", end: "20:00", channel: "Canal 1" },
      best: null, applied: 2, proposed: 1, testsRunning: 1, testsClosed: ["La variante B gagne : 2,1 % contre 1,4 %."],
    };
    for (const l of codeLines(t)) expect(ok(l, t), l).toEqual([]);
  });
  it("rejet = repli sur le texte du code (Ads et Ce qui marche)", async () => {
    expect(parseAdsReportOutput(JSON.stringify({ lines: ["Casino : hausse de 35 % des gains."] }), weekly)).toBeNull();
    const llm = { complete: async () => ({ text: JSON.stringify({ lines: ["Gains 3 fois plus élevés."] }), costCents: 1 }) };
    const r = await writeAdsReport(weekly, { llm: llm as never, model: "m", pageUrl: "https://x" });
    expect(r.writtenBy).toBe("code");
    expect(r.lines).toEqual(adsCodeLines(weekly));
    const t: TeamFacts = { team: "dating", posts7d: 4, views7d: 10, bestFormat: null, bestWindow: null, best: null, applied: 0, proposed: 0, testsRunning: 0, testsClosed: [] };
    expect(parseReportOutput(JSON.stringify({ teams: { dating: ["Deux fois plus de vues."] } }), [t])).toEqual({});
    expect(parseReportOutput(JSON.stringify({ teams: { dating: ["4 posts cette semaine."] } }), [t])).toEqual({ dating: ["4 posts cette semaine."] });
  });
});
