import { describe, expect, it } from "vitest";
import { fmtMoney } from "@/lib/format";
import {
  EMPTY_DAY,
  comparisonLabel,
  dayWindows,
  homeFigures,
  homeMoney,
  moneyDigits,
  dayCommissions,
  dayGains,
  gainsBreakdown,
  gainsHint,
  gainsValue,
  variation,
  yesterdaySoFar,
} from "./figures";

/** Montants attendus, avec le vrai signe moins (U+2212) comme la page Campagnes. */
const minus = (s: string) => s.replace("-", "\u2212");
const eur0 = (n: number) => minus(fmtMoney(n, "EUR", { digits: 0 }));
const eur2 = (n: number) => minus(fmtMoney(n, "EUR", { digits: 2 }));

describe("dayWindows (heure de Paris)", () => {
  it("aujourd'hui commence à minuit Paris (UTC+2 en été) et hier à la même heure", () => {
    // 10 octobre 2026, 09:30 à Paris = 07:30 UTC.
    const now = new Date("2026-10-10T07:30:00Z");
    const w = dayWindows(now);
    expect(w.todayKey).toBe("2026-10-10");
    expect(w.yesterdayKey).toBe("2026-10-09");
    expect(w.today.start.toISOString()).toBe("2026-10-09T22:00:00.000Z");
    expect(w.today.end).toBe(now);
    expect(w.yesterday.start.toISOString()).toBe("2026-10-08T22:00:00.000Z");
    // Même durée écoulée (9 h 30) : hier 09:30 Paris.
    expect(w.yesterday.end.toISOString()).toBe("2026-10-09T07:30:00.000Z");
    // 9 h 30 sur une journée de 24 h.
    expect(w.yesterdayShare).toBeCloseTo(9.5 / 24, 10);
  });

  it("juste après minuit Paris, le jour a déjà changé alors qu'il est encore la veille en UTC", () => {
    const now = new Date("2026-10-09T22:05:00Z"); // 00:05 le 10 à Paris
    const w = dayWindows(now);
    expect(w.todayKey).toBe("2026-10-10");
    expect(w.today.start.toISOString()).toBe("2026-10-09T22:00:00.000Z");
    expect(w.yesterday.end.toISOString()).toBe("2026-10-08T22:05:00.000Z");
  });

  it("en hiver (UTC+1), minuit Paris est 23 h UTC la veille", () => {
    const w = dayWindows(new Date("2026-12-15T12:00:00Z"));
    expect(w.today.start.toISOString()).toBe("2026-12-14T23:00:00.000Z");
    expect(w.yesterday.start.toISOString()).toBe("2026-12-13T23:00:00.000Z");
  });

  it("le lendemain du passage à l'heure d'hiver, hier (25 h) est borné à minuit", () => {
    // 25 octobre 2026 : passage à l'heure d'hiver ; le 26 à 23:30 Paris, hier dure 25 h mais on s'arrête à minuit.
    const w = dayWindows(new Date("2026-10-26T22:30:00Z"));
    expect(w.yesterday.end.getTime()).toBeLessThanOrEqual(w.today.start.getTime());
    expect(w.yesterdayShare).toBeLessThanOrEqual(1);
  });

  it("part de la journée d'hier couverte : sur 25 h le jour du passage à l'heure d'hiver", () => {
    // 26 octobre 2026 à 12:30 Paris (UTC+1) : 12 h 30 écoulées ; hier (le 25) a duré 25 h.
    const w = dayWindows(new Date("2026-10-26T11:30:00Z"));
    expect(w.yesterday.start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(w.yesterdayShare).toBeCloseTo(12.5 / 25, 10);
  });

  it("sans « même heure » : toute la journée d'hier", () => {
    const now = new Date("2026-10-10T07:30:00Z");
    const w = dayWindows(now, false);
    expect(w.yesterday.end.toISOString()).toBe("2026-10-09T22:00:00.000Z");
    expect(w.yesterdayShare).toBe(1);
    expect(comparisonLabel(false)).toBe("vs hier");
    expect(comparisonLabel(true)).toBe("vs hier à la même heure");
  });
});

describe("hier à la même heure : dépense pub et part de revshare ramenées à la part de journée écoulée", () => {
  it("la dépense et la part de revshare d'hier (journée entière, sans heure) suivent la part de journée écoulée", () => {
    const y = { members: 4, ftds: 1, cpaCommissions: 70, revshareCommissions: 12, spend: 120 };
    // À 9 h sur 24 h : 120 × 9/24 = 45 et 12 × 9/24 = 4,50 ; les autres chiffres (déjà comptés jusqu'à la même
    // heure, dont les commissions par joueur datées à la minute) ne bougent pas.
    expect(yesterdaySoFar(y, 9 / 24)).toEqual({ ...y, revshareCommissions: 4.5, spend: 45 });
    expect(yesterdaySoFar(y, 1)).toEqual(y);
    expect(yesterdaySoFar(y, 0)).toMatchObject({ spend: 0, revshareCommissions: 0 });
    // Arrondi au centime, part bornée entre 0 et 1.
    expect(yesterdaySoFar({ ...y, spend: 10 }, 2 / 3).spend).toBe(6.67);
    expect(yesterdaySoFar(y, 1.5).spend).toBe(120);
    expect(yesterdaySoFar(y, -1).spend).toBe(0);
    expect(yesterdaySoFar(y, Number.NaN).spend).toBe(120);
  });

  it("à 9 h, même activité qu'hier à 9 h et même rythme de dépense : gains stables, pas +400 %", () => {
    const w = dayWindows(new Date("2026-10-10T07:00:00Z")); // 09:00 Paris
    const today = { members: 0, ftds: 0, cpaCommissions: 100, revshareCommissions: 0, spend: 40 };
    const yesterdayFullSpend = { ...today, spend: 120 };
    // Sans la correction : 60 vs −20 → +400 %.
    expect(homeFigures(today, yesterdayFullSpend).gains.delta).toBe(400);
    // Avec : hier à 9 h = 100 − 120 × 9/24 = 55 → +9,1 %.
    const f = homeFigures(today, yesterdaySoFar(yesterdayFullSpend, w.yesterdayShare));
    expect(f.gains).toMatchObject({ value: 60, previous: 55, delta: 9.1 });
    expect(f.gains.variation).toEqual({ kind: "pct", pct: 9.1 });
  });
});

describe("gains du jour", () => {
  it("commissions (CPA nette + part de revshare) − dépense pub ; jamais les dépôts ni le revenu net", () => {
    expect(dayCommissions({ cpaCommissions: 140, revshareCommissions: 13.09 })).toBe(153.09);
    expect(dayGains({ cpaCommissions: 140, revshareCommissions: 13.09, spend: 50 })).toBe(103.09);
    // Une CPA annulée aujourd'hui se retranche aujourd'hui.
    expect(dayGains({ cpaCommissions: -70, revshareCommissions: 2.28, spend: 0 })).toBe(-67.72);
    expect(dayGains({ cpaCommissions: 0, revshareCommissions: 0, spend: 40 })).toBe(-40);
    // Les totaux du jour n'ont plus de dépôts ni de revenu net : ils ne peuvent pas s'y glisser.
    expect(Object.keys(EMPTY_DAY).sort()).toEqual([
      "cpaCommissions",
      "ftds",
      "members",
      "revshareCommissions",
      "spend",
    ]);
  });

  it("décomposition affichée sous le chiffre : « commissions X € − pub Y € »", () => {
    expect(gainsBreakdown({ commissions: 120, spend: 50 })).toBe(
      `commissions ${eur0(120)} − pub ${eur0(50)}`,
    );
    // Commissions négatives (annulation) : écrites avec leur signe.
    expect(gainsBreakdown({ commissions: -70, spend: 10 })).toBe(
      `commissions ${eur0(-70)} − pub ${eur0(10)}`,
    );
    // Centimes : tous les montants à deux décimales.
    expect(gainsBreakdown({ commissions: 25.5, spend: 0 })).toBe(
      `commissions ${eur2(25.5)} − pub ${eur2(0)}`,
    );
  });

  it("le gros chiffre a les mêmes décimales que sa décomposition", () => {
    expect(gainsValue({ commissions: 150, spend: 50 })).toBe(eur0(100));
    expect(gainsValue({ commissions: 25.5, spend: 0 })).toBe(eur2(25.5));
    expect(gainsValue({ commissions: 0, spend: 75 })).toBe(eur0(-75));
  });

  it("moneyDigits et homeMoney", () => {
    expect(moneyDigits([1, 2, 3])).toBe(0);
    expect(moneyDigits([1, 2.5])).toBe(2);
    expect(moneyDigits([0.1 + 0.2])).toBe(2);
    expect(homeMoney(1234)).toBe(eur0(1234));
    expect(homeMoney(12.5)).toBe(eur2(12.5));
  });

  it("montant négatif : vrai signe moins (U+2212), jamais le trait d'union", () => {
    expect(homeMoney(-96.9)).toMatch(/^\u221296,90\s€$/);
    expect(homeMoney(-151.64, 2)).not.toContain("-");
    expect(homeMoney(-75, 0)).toMatch(/^\u221275\s€$/);
    expect(gainsValue({ commissions: -12.5, spend: 40 })).toMatch(/^\u221252,50\s€$/);
    expect(homeMoney(0)).not.toContain("\u2212");
  });
});

describe("variation vs hier", () => {
  it("pourcentage à une décimale", () => {
    expect(variation(12, 10)).toBe(20);
    expect(variation(9, 12)).toBe(-25);
    expect(variation(1, 3)).toBe(-66.7);
  });

  it("calculée sur la valeur absolue d'hier (gains négatifs)", () => {
    expect(variation(20, -50)).toBe(140);
    expect(variation(-100, -50)).toBe(-100);
  });

  it("zéro hier : stable si zéro aujourd'hui, pas de comparaison sinon", () => {
    expect(variation(0, 0)).toBe(0);
    expect(variation(5, 0)).toBeNull();
    expect(variation(Number.NaN, 1)).toBeNull();
  });

  it("homeFigures assemble les trois chiffres et la décomposition d'aujourd'hui", () => {
    const today = { members: 12, ftds: 3, cpaCommissions: 140, revshareCommissions: 10, spend: 50 };
    const yesterday = {
      members: 10,
      ftds: 0,
      cpaCommissions: 50,
      revshareCommissions: 0,
      spend: 0,
    };
    const f = homeFigures(today, yesterday);
    expect(f.members).toMatchObject({ value: 12, previous: 10, delta: 20 });
    expect(f.ftds).toMatchObject({ value: 3, previous: 0, delta: null });
    expect(f.gains).toMatchObject({ value: 100, previous: 50, delta: 100 });
    expect(f.breakdown).toEqual({ commissions: 150, spend: 50 });
    expect(homeFigures(EMPTY_DAY, EMPTY_DAY).gains.delta).toBe(0);
  });
});

describe("variation affichée (règle commune des cartes)", () => {
  it("hier valait 0 : « nouveau », jamais « > +999 % » ; les deux à 0 : rien", () => {
    const f = homeFigures({ ...EMPTY_DAY, members: 25, cpaCommissions: 70 }, EMPTY_DAY);
    expect(f.members.variation).toEqual({ kind: "new", direction: "up" });
    expect(f.gains.variation).toEqual({ kind: "new", direction: "up" });
    expect(f.ftds.variation).toEqual({ kind: "none" });
  });

  it("même règle que les campagnes et les Statistiques : pas de pourcentage quand hier était en perte", () => {
    const f = homeFigures(
      { ...EMPTY_DAY, members: 4, cpaCommissions: 20 },
      { ...EMPTY_DAY, members: 2, spend: 50 },
    );
    expect(f.members.variation).toEqual({ kind: "pct", pct: 100 });
    // Gains passés de −50 € à +20 € : « Pas de comparaison possible », et la valeur d'hier sous le chiffre.
    expect(f.gains.variation).toEqual({ kind: "unknown" });
    expect(gainsHint(f)).toBe(`commissions ${eur0(20)} − pub ${eur0(0)} · Avant : ${eur0(-50)}`);
  });

  it("hier positif : pourcentage, et la ligne ne donne que la décomposition", () => {
    const f = homeFigures(
      { ...EMPTY_DAY, cpaCommissions: 120, spend: 50 },
      { ...EMPTY_DAY, cpaCommissions: 100, spend: 50 },
    );
    expect(f.gains.variation).toEqual({ kind: "pct", pct: 40 });
    expect(gainsHint(f)).toBe(`commissions ${eur0(120)} − pub ${eur0(50)}`);
  });
});
