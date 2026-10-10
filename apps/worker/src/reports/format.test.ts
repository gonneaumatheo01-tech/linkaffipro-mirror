import { describe, expect, it } from "vitest";
import {
  EMPTY_METRICS,
  eur,
  formatDailyBrief,
  formatWeeklyReport,
  pct,
  type ReportData,
} from "./format";

const base: ReportData = {
  periodLabel: "jeudi 9 octobre",
  current: {
    ...EMPTY_METRICS,
    requests: 10,
    approved: 8,
    joined: 7,
    left: 1,
    entryClicks: 50,
    offerClicks: 12,
    registrations: 4,
    ftds: 2,
    deposits: 3,
    depositAmount: 150,
    ngr: 42.5,
    spend: 100,
  },
  previous: {
    ...EMPTY_METRICS,
    requests: 8,
    approved: 8,
    joined: 5,
    left: 0,
    entryClicks: 40,
    offerClicks: 0,
    registrations: 2,
    ftds: 1,
    deposits: 1,
    depositAmount: 20,
    ngr: 10,
    spend: 80,
  },
  topCampaigns: [
    {
      ...EMPTY_METRICS,
      name: "TT <FR> vidéo 3",
      approved: 5,
      registrations: 3,
      ftds: 2,
      spend: 60,
      ngr: 30,
    },
  ],
  topChannels: [{ ...EMPTY_METRICS, name: "Casino FR", approved: 8, registrations: 4, ftds: 2 }],
  openAlerts: [],
  sync: { lastSuccessAt: new Date("2026-10-09T07:00:00Z"), errors: [] },
  upcomingPosts: [{ channel: "Casino FR", scheduledAt: new Date("2026-10-09T18:00:00Z") }],
};

describe("pct et eur", () => {
  it("calcule les variations", () => {
    expect(pct(10, 8)).toBe("+25 %");
    expect(pct(9, 10)).toBe("−10 %");
    expect(pct(5, 5)).toBe("=");
    expect(pct(0, 0)).toBe("=");
    expect(pct(3, 0)).toBe("nouveau");
  });
  it("formate les euros à la française", () => {
    expect(eur(1234.5)).toMatch(/1.234,50 €/);
  });
});

describe("brief quotidien", () => {
  it("contient les chiffres, les comparaisons, les ratios, le top et le statut", () => {
    const t = formatDailyBrief(base);
    expect(t).toContain("Brief du jour — jeudi 9 octobre");
    expect(t).toContain("Demandes : <b>10</b> (+25 %)");
    expect(t).toContain("Clics offres : <b>12</b> (nouveau)");
    expect(t).toContain("CPL");
    expect(t).toMatch(/ROAS 0\.4[23]/);
    expect(t).toContain("TT &lt;FR&gt; vidéo 3");
    expect(t).toContain("Top campagnes");
    expect(t).toContain("Rien à signaler");
    expect(t).toContain("1 message programmé dans les 24 h");
    expect(t.length).toBeLessThan(4000);
  });
  it("sans dépense : pas de bloc ratios ; avec alerte : pas de « rien à signaler »", () => {
    const t = formatDailyBrief({
      ...base,
      current: { ...base.current, spend: 0 },
      previous: { ...base.previous, spend: 0 },
      openAlerts: [{ kind: "bot_webhook", message: "Bot en difficulté <x>" }],
      upcomingPosts: [],
    });
    expect(t).not.toContain("CPL");
    expect(t).not.toContain("Rien à signaler");
    expect(t).toContain("Alerte : Bot en difficulté &lt;x&gt;");
    expect(t).toContain("Aucun message programmé");
  });
});

describe("rapport hebdomadaire", () => {
  it("a un titre, la mention de comparaison et reste sous 4000 caractères", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...EMPTY_METRICS,
      name: `Pub ${i}`,
      approved: 5 - i,
      registrations: 1,
      ftds: 0,
    }));
    const t = formatWeeklyReport({
      ...base,
      periodLabel: "semaine du 29 sept. au 5 oct.",
      topCampaigns: many,
      topChannels: many,
    });
    expect(t).toContain("Rapport hebdomadaire — semaine du 29 sept. au 5 oct.");
    expect(t).toContain("Comparé à la semaine précédente");
    expect(t).toContain("Top campagnes de la semaine");
    expect(t).not.toContain("Top pubs");
    expect(t.length).toBeLessThan(4000);
  });
});
