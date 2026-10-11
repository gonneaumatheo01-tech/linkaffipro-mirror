/**
 * Chiffres du jour de l'accueil (fonctions pures, testées dans figures.test.ts) : fenêtres « aujourd'hui » et « hier »
 * en heure de Paris, bénéfice du jour, variation, décomposition affichée sous le chiffre.
 *
 * Bénéfice du jour (formule validée par le client, docs/REFONTE-UX.md) : dépôts du jour + revenu net (NGR) du jour
 * − dépense pub du jour. Les dépôts et le revenu net sont ceux de « nos » joueurs (événements datés de Link Affi),
 * la dépense est la somme des coûts `AdCost` du jour (une ligne par jour, sans heure).
 * Ne pas confondre avec le « bénéfice » d'une campagne (revenu net − dépense pub, lib/campaigns/metrics.ts) : le bloc
 * « Campagnes actives » de l'accueil l'écrit en toutes lettres.
 */
import { withMinusSign } from "@/lib/campaigns/cards";
import { dayKey } from "@/lib/dashboard/aggregate";
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
  /** Montant des dépôts de nos joueurs (événements FTD, DEPOSIT, REDEPOSIT), en euros. */
  deposits: number;
  /** Revenu net (somme des événements NGR datés) de nos joueurs, en euros. */
  ngr: number;
  /**
   * Dépense pub du jour (`AdCost`), en euros. Pour « hier à la même heure », la dépense de la journée entière ramenée
   * à la part de journée écoulée (`yesterdaySoFar`).
   */
  spend: number;
};

export const EMPTY_DAY: DayTotals = { members: 0, ftds: 0, deposits: 0, ngr: 0, spend: 0 };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * « Hier à la même heure » pour la dépense pub : un coût `AdCost` n'a pas d'heure (une ligne par jour) et celui d'hier
 * est complet, alors que celui d'aujourd'hui n'en est qu'à l'heure de la dernière synchro. Sans correction, chaque
 * matin comparerait la dépense d'une matinée à celle d'une journée entière (bénéfice d'hier écrasé, hausse trompeuse).
 * La dépense d'hier est donc ramenée à la part de journée écoulée (`share`, voir `dayWindows`), en la supposant
 * répartie sur la journée ; les autres chiffres, datés à la minute, sont déjà comptés jusqu'à la même heure.
 */
export function yesterdaySoFar(yesterday: DayTotals, share: number): DayTotals {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 1;
  return { ...yesterday, spend: round2(yesterday.spend * s) };
}

/** Bénéfice = dépôts + revenu net − dépense pub (arrondi au centime). */
export function profitOf(t: Pick<DayTotals, "deposits" | "ngr" | "spend">): number {
  return round2(t.deposits + t.ngr - t.spend);
}

/**
 * Variation en % (une décimale) de `previous` à `current`, calculée sur la valeur absolue de `previous` : un bénéfice
 * qui passe de −50 € à +20 € est une hausse (+140 %), pas une baisse. 0 → 0 : stable ; x → 0 avec x ≠ 0 : null
 * (pas de comparaison possible).
 */
export function variation(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export type HomeFigure = { value: number; previous: number; delta: number | null };

export type HomeFigures = {
  members: HomeFigure;
  ftds: HomeFigure;
  profit: HomeFigure;
  /** Composantes du bénéfice d'aujourd'hui (décomposition sous le chiffre). */
  breakdown: Pick<DayTotals, "deposits" | "ngr" | "spend">;
};

function figure(value: number, previous: number): HomeFigure {
  return { value, previous, delta: variation(value, previous) };
}

export function homeFigures(today: DayTotals, yesterday: DayTotals): HomeFigures {
  return {
    members: figure(today.members, yesterday.members),
    ftds: figure(today.ftds, yesterday.ftds),
    profit: figure(profitOf(today), profitOf(yesterday)),
    breakdown: { deposits: today.deposits, ngr: today.ngr, spend: today.spend },
  };
}

/**
 * Ligne grise sous un chiffre du jour quand la variation ne se calcule pas (hier valait 0 et aujourd'hui non) : la
 * valeur d'hier, connue, est plus utile que « Pas de comparaison possible ». Null quand la variation s'affiche.
 */
export function previousHint(
  f: HomeFigure,
  format: (n: number) => string,
  sameTime = HOME_COMPARE_SAME_TIME,
): string | null {
  if (f.delta !== null) return null;
  return `${sameTime ? "Hier à la même heure" : "Hier"} : ${format(f.previous)}`;
}

/** Nombre de décimales des montants affichés ensemble : 0 si tous sont des euros ronds, 2 sinon. */
export function moneyDigits(values: readonly number[]): 0 | 2 {
  return values.every((v) => Number.isInteger(round2(v))) ? 0 : 2;
}

/** Montant de l'accueil (« 1 234 € », « −50 € » avec le vrai signe moins comme la page Campagnes, « 12,50 € »). */
export function homeMoney(n: number, digits: 0 | 2 = moneyDigits([n])): string {
  return withMinusSign(fmtMoney(round2(n), "EUR", { digits }));
}

type Breakdown = Pick<DayTotals, "deposits" | "ngr" | "spend">;

function breakdownDigits(b: Breakdown): 0 | 2 {
  return moneyDigits([b.deposits, b.ngr, b.spend, profitOf(b)]);
}

/** Bénéfice affiché en gros (même nombre de décimales que sa décomposition). */
export function profitValue(b: Breakdown): string {
  return homeMoney(profitOf(b), breakdownDigits(b));
}

/**
 * Décomposition affichée sous le bénéfice : « dépôts 120 € + revenu net 30 € − pub 50 € ». Un revenu net négatif
 * est soustrait (« − revenu net 30 € ») ; les montants ont tous le même nombre de décimales que le total.
 */
export function profitBreakdown(b: Breakdown): string {
  const digits = breakdownDigits(b);
  const m = (n: number) => homeMoney(Math.abs(n), digits);
  const ngrSign = b.ngr < 0 ? "−" : "+";
  return `dépôts ${m(b.deposits)} ${ngrSign} revenu net ${m(b.ngr)} − pub ${m(b.spend)}`;
}
