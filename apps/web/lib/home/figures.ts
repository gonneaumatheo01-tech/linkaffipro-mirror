/**
 * Chiffres du jour de l'accueil (fonctions pures, testées dans figures.test.ts) : fenêtres « aujourd'hui » et « hier »
 * en heure de Paris, gains du jour, variation, décomposition affichée sous le chiffre.
 *
 * Gains du jour (phase 10, définition unique, @linkaffipro/core) : nos commissions du jour − dépense pub du jour.
 * Commissions = CPA de « nos » joueurs (créditées − annulées, chacune à son heure réelle Link Affi) + part de revshare
 * de nos offres (agrégat Link Affi du jour). Dépense = coûts `AdCost` du jour (une ligne par jour, sans heure). Les
 * dépôts et le revenu net sont l'argent du casino : ils ne comptent pas (ils restent dans les Statistiques).
 * Même définition que les campagnes (lib/campaigns/metrics.ts) et les rapports Telegram.
 */
import { commissionsOf, gainsOf } from "@linkaffipro/core";
import type { Variation } from "@/components/admin/stat-card-logic";
import { withMinusSign } from "@/lib/campaigns/cards";
import { dayKey } from "@/lib/dashboard/aggregate";
import { comparableVariation, unknownBefore } from "@/lib/dashboard/display";
import { fmtMoney } from "@/lib/format";
import { parisMidnightUtc, shiftDay } from "@/lib/periods";

export type TimeWindow = { start: Date; end: Date };

export type DayWindows = {
  /** Jour civil de Paris (AAAA-MM-JJ). */
  todayKey: string;
  yesterdayKey: string;
  /** Minuit Paris → maintenant. */
  today: TimeWindow;
  /** Minuit Paris d'hier → même durée écoulée qu'aujourd'hui (ou toute la journée d'hier, voir `sameTime`). */
  yesterday: TimeWindow;
  /**
   * Part de la journée d'hier couverte par `yesterday` (0 à 1 ; 1 sans « même heure »). Sert à ramener la dépense pub
   * d'hier, qui n'a pas d'heure, à la même heure (voir `yesterdaySoFar`). Hier dure 23, 24 ou 25 h.
   */
  yesterdayShare: number;
};

/**
 * Comparaison « vs hier à la même heure » (par défaut) : à 9 h, on compare la matinée d'aujourd'hui à celle d'hier,
 * pas à la journée entière d'hier (sinon chaque matin afficherait une baisse trompeuse). `sameTime = false` :
 * journée entière d'hier.
 */
export const HOME_COMPARE_SAME_TIME = true;

export function dayWindows(now: Date, sameTime = HOME_COMPARE_SAME_TIME): DayWindows {
  const todayKey = dayKey(now);
  const yesterdayKey = shiftDay(todayKey, -1);
  const todayStart = parisMidnightUtc(todayKey);
  const yesterdayStart = parisMidnightUtc(yesterdayKey);
  const elapsed = Math.max(0, now.getTime() - todayStart.getTime());
  const yesterdayEnd = sameTime
    ? new Date(Math.min(yesterdayStart.getTime() + elapsed, todayStart.getTime()))
    : todayStart;
  const yesterdayLength = todayStart.getTime() - yesterdayStart.getTime();
  return {
    todayKey,
    yesterdayKey,
    today: { start: todayStart, end: now },
    yesterday: { start: yesterdayStart, end: yesterdayEnd },
    yesterdayShare:
      yesterdayLength > 0
        ? Math.min(1, (yesterdayEnd.getTime() - yesterdayStart.getTime()) / yesterdayLength)
        : 1,
  };
}

/** Libellé de la comparaison affiché sous chaque chiffre. */
export function comparisonLabel(sameTime = HOME_COMPARE_SAME_TIME): string {
  return sameTime ? "vs hier à la même heure" : "vs hier";
}

/** Totaux d'une journée (ou d'un début de journée) pour l'accueil. */
export type DayTotals = {
  /** Entrées dans un canal (adhésions avec `joinedAt` dans la fenêtre). */
  members: number;
  /** Premiers dépôts de nos joueurs (`ftdAt` dans la fenêtre). */
  ftds: number;
  /** Commissions CPA de nos joueurs dans la fenêtre (événements CPA − CPA_REVERSAL, datés à la minute), en euros. */
  cpaCommissions: number;
  /**
   * Part de revshare de nos offres pour le jour (agrégat Link Affi, sans heure), en euros. Pour « hier à la même
   * heure », celle de la journée entière ramenée à la part de journée écoulée (`yesterdaySoFar`).
   */
  revshareCommissions: number;
  /**
   * Dépense pub du jour (`AdCost`), en euros. Pour « hier à la même heure », la dépense de la journée entière ramenée
   * à la part de journée écoulée (`yesterdaySoFar`).
   */
  spend: number;
};

export const EMPTY_DAY: DayTotals = {
  members: 0,
  ftds: 0,
  cpaCommissions: 0,
  revshareCommissions: 0,
  spend: 0,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * « Hier à la même heure » pour la dépense pub et la part de revshare : ni un coût `AdCost` ni une ligne Link Affi du
 * jour n'ont d'heure, et ceux d'hier sont complets, alors que ceux d'aujourd'hui n'en sont qu'à la dernière synchro.
 * Sans correction, chaque matin comparerait une matinée à une journée entière (gains d'hier faussés, variation
 * trompeuse). Les deux sont donc ramenés à la part de journée écoulée (`share`, voir `dayWindows`), en les supposant
 * répartis sur la journée ; les autres chiffres, datés à la minute (dont les CPA), sont déjà comptés jusqu'à la même
 * heure.
 */
export function yesterdaySoFar(yesterday: DayTotals, share: number): DayTotals {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 1;
  return {
    ...yesterday,
    revshareCommissions: round2(yesterday.revshareCommissions * s),
    spend: round2(yesterday.spend * s),
  };
}

/** Commissions du jour = CPA nette + part de revshare (au centime). */
export function dayCommissions(
  t: Pick<DayTotals, "cpaCommissions" | "revshareCommissions">,
): number {
  return commissionsOf(t.cpaCommissions, t.revshareCommissions);
}

/** Gains du jour = commissions − dépense pub (au centime), la définition unique de @linkaffipro/core. */
export function dayGains(
  t: Pick<DayTotals, "cpaCommissions" | "revshareCommissions" | "spend">,
): number {
  return gainsOf(dayCommissions(t), t.spend);
}

/**
 * Variation en % (une décimale) de `previous` à `current`, calculée sur la valeur absolue de `previous` : des gains
 * qui passent de −50 € à +20 € sont une hausse (+140 %), pas une baisse. 0 → 0 : stable ; x → 0 avec x ≠ 0 : null
 * (pas de comparaison possible).
 */
export function variation(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export type HomeFigure = {
  value: number;
  previous: number;
  delta: number | null;
  /**
   * Variation affichée, règle unique du site (`comparableVariation`) : « nouveau » quand hier valait 0, rien si les deux
   * valent 0, pas de pourcentage quand hier était en perte (la valeur d'hier est écrite à la place, `gainsHint`).
   */
  variation: Variation;
};

/** Composantes des gains d'aujourd'hui (décomposition sous le chiffre). */
export type GainsBreakdown = { commissions: number; spend: number };

export type HomeFigures = {
  members: HomeFigure;
  ftds: HomeFigure;
  gains: HomeFigure;
  breakdown: GainsBreakdown;
};

function figure(value: number, previous: number): HomeFigure {
  return {
    value,
    previous,
    delta: variation(value, previous),
    variation: comparableVariation(value, previous),
  };
}

export function homeFigures(today: DayTotals, yesterday: DayTotals): HomeFigures {
  return {
    members: figure(today.members, yesterday.members),
    ftds: figure(today.ftds, yesterday.ftds),
    gains: figure(dayGains(today), dayGains(yesterday)),
    breakdown: { commissions: dayCommissions(today), spend: today.spend },
  };
}

/** Nombre de décimales des montants affichés ensemble : 0 si tous sont des euros ronds, 2 sinon. */
export function moneyDigits(values: readonly number[]): 0 | 2 {
  return values.every((v) => Number.isInteger(round2(v))) ? 0 : 2;
}

/** Montant de l'accueil (« 1 234 € », « −50 € » avec le vrai signe moins comme la page Campagnes, « 12,50 € »). */
export function homeMoney(n: number, digits: 0 | 2 = moneyDigits([n])): string {
  return withMinusSign(fmtMoney(round2(n), "EUR", { digits }));
}

function breakdownDigits(b: GainsBreakdown): 0 | 2 {
  return moneyDigits([b.commissions, b.spend, gainsOf(b.commissions, b.spend)]);
}

/** Gains affichés en gros (même nombre de décimales que leur décomposition). */
export function gainsValue(b: GainsBreakdown): string {
  return homeMoney(gainsOf(b.commissions, b.spend), breakdownDigits(b));
}

/**
 * Décomposition affichée sous les gains : « commissions 120 € − pub 50 € ». Des commissions négatives (une CPA
 * annulée aujourd'hui) gardent leur signe ; les montants ont tous le même nombre de décimales que le total.
 */
export function gainsBreakdown(b: GainsBreakdown): string {
  const digits = breakdownDigits(b);
  return `commissions ${homeMoney(b.commissions, digits)} − pub ${homeMoney(Math.abs(b.spend), digits)}`;
}

/**
 * Ligne sous les gains du jour : la décomposition, et la valeur d'hier quand aucun pourcentage n'est possible (hier en
 * perte) : « commissions 120 € − pub 50 € · Avant : −30 € ».
 */
export function gainsHint(f: Pick<HomeFigures, "gains" | "breakdown">): string {
  const before = unknownBefore(
    f.gains.variation,
    homeMoney(f.gains.previous, moneyDigits([f.gains.previous, f.gains.value])),
  );
  return [gainsBreakdown(f.breakdown), before].filter(Boolean).join(" · ");
}
