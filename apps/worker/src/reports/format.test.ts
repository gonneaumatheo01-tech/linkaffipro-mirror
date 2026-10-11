import { describe, expect, it } from "vitest";
import {
  EMPTY_METRICS,
  eur,
  ratio2,
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
    commissions: 150,
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
    commissions: 100,
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
      commissions: 90,
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
    // Base négative (gains d'avant en perte) : pas de pourcentage (même règle que le site), la valeur d'avant.
    expect(pct(20, -50)).toBe("avant -50");
    expect(pct(20, -50, eur)).toBe("avant \u221250,00 €");
    // Plafond d'affichage, comme sur le site.
    expect(pct(5000, 2)).toBe("> +999 %");
    expect(pct(999, 100)).toBe("+899 %");
  });
  it("formate les euros à la française, avec un vrai signe moins", () => {
    expect(eur(1234.5)).toMatch(/1.234,50 €/);
    expect(eur(-56.91)).toBe("\u221256,91 €");
    expect(eur(-0.001)).toBe("0,00 €");
    // Retour sur dépense pub négatif (commissions annulées) : vrai signe moins aussi.
    expect(ratio2(-0.45)).toBe("\u22120,45×");
    expect(ratio2(1.5)).toBe("1,50×");
  });
});

describe("brief quotidien", () => {
  it("contient les chiffres, les comparaisons, les ratios, le top et le statut", () => {
    const t = formatDailyBrief(base);
    expect(t).toContain("Brief du jour — jeudi 9 octobre");
    expect(t).toContain("Demandes : <b>10</b> (+25 %)");
    expect(t).toContain("Clics offres : <b>12</b> (nouveau)");
    expect(t).toContain("Premiers dépôts : <b>2</b> (+100 %)");
    expect(t).toContain("Revenu net : <b>42,50 €</b> (+325 %)");
    // Gains = commissions − dépense pub : 150 − 100 = 50 € (hier 100 − 80 = 20 €). Les dépôts et le revenu net
    // restent des indicateurs de volume, jamais additionnés.
    expect(t).toContain("💶 Commissions : <b>150,00 €</b> (+50 %)");
    expect(t).toContain("🏆 Gains : <b>50,00 €</b> (+150 %)");
    expect(t.indexOf("Dépense pub")).toBeLessThan(t.indexOf("Gains"));
    // Dépense 100 € : 8 acceptés, 4 inscriptions, 2 premiers dépôts ; retour sur dépense pub = commissions ÷ dépense.
    expect(t).toContain(
      "🧮 Coût par membre 12,50 € · coût par inscription 25,00 € · coût par premier dépôt 50,00 € · retour sur dépense pub 1,50×",
    );
    expect(t).toContain(
      "• TT &lt;FR&gt; vidéo 3 — 5 acceptés, 3 inscr., 2 premiers dépôts, 60,00 € dépensés, commissions 90,00 €, gains 30,00 €",
    );
    expect(t).not.toMatch(/bénéfice/i);
    expect(t).toContain("• Casino FR — 8 acceptés, 4 inscr., 2 premiers dépôts");
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
    expect(t).not.toContain("Coût par membre");
    // Sans dépense, les gains sont les commissions.
    expect(t).toContain("🏆 Gains : <b>150,00 €</b> (+50 %)");
    expect(t).not.toContain("Rien à signaler");
    expect(t).toContain("Alerte : Bot en difficulté &lt;x&gt;");
    expect(t).toContain("Aucun message programmé");
  });
});

describe("vocabulaire du client (docs/REFONTE-UX.md)", () => {
  const JARGON =
    /\b(FTDs?|NGR|ROAS|CPL|CPA)\b|sub[-_ ]?id|webhook|postback|cohorte|entonnoir|segment/i;
  it("ni le brief ni le rapport hebdomadaire ne montrent de terme technique", () => {
    const one = { ...EMPTY_METRICS, name: "Canal", approved: 1, registrations: 1, ftds: 1 };
    for (const t of [formatDailyBrief(base), formatWeeklyReport({ ...base, topChannels: [one] })])
      expect(t).not.toMatch(JARGON);
    expect(formatWeeklyReport({ ...base, topChannels: [one] })).toContain("1 premier dépôt");
  });
});

describe("gains : même règle que le site", () => {
  it("gains d'avant en perte : pas de pourcentage, la valeur d'avant", () => {
    const t = formatDailyBrief({
      ...base,
      current: { ...base.current, spend: 100, commissions: 640 },
      previous: { ...base.previous, spend: 776, commissions: 100 },
    });
    expect(t).toContain("🏆 Gains : <b>540,00 €</b> (avant \u2212676,00 €)");
  });

  it("top canaux : les primes des joueurs seulement, jamais de « gains » (ni dépense ni part du revenu)", () => {
    const t = formatDailyBrief({
      ...base,
      topChannels: [
        {
          ...EMPTY_METRICS,
          name: "Casino VIP",
          approved: 3,
          registrations: 2,
          ftds: 2,
          commissions: 140,
        },
      ],
    });
    expect(t).toContain(
      "• Casino VIP — 3 acceptés, 2 inscr., 2 premiers dépôts, primes des joueurs 140,00 €",
    );
    const channelLine = t.split("\n").find((l) => l.includes("Casino VIP"))!;
    expect(channelLine).not.toMatch(/gains|commissions/);
    // Les campagnes gardent leurs gains.
    expect(t).toContain("commissions 90,00 €, gains 30,00 €");
  });
});

describe("sans commission ni dépense", () => {
  it("ni ligne Commissions ni ligne Gains (rien à montrer)", () => {
    const zero = { ...base.current, spend: 0, commissions: 0 };
    const t = formatDailyBrief({
      ...base,
      current: zero,
      previous: { ...base.previous, spend: 0, commissions: 0 },
    });
    expect(t).not.toContain("Commissions");
    expect(t).not.toContain("Gains");
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
