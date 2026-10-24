/**
 * Phase 27, chantier B : rythme d'un canal (pur). Heures de Paris (changement d'heure compris), tranches de 30 minutes.
 * - posts par jour = posts ÷ jours couverts (du premier au dernier jour de Paris inclus, ou `spanDays` imposé : 28 pour
 *   un canal du client) ; posts par semaine = posts par jour × 7 ;
 * - régularité = écart-type (de population) ÷ moyenne des posts par jour sur les jours couverts, jours sans post
 *   compris (0 = parfaitement régulier) ;
 * - délai médian entre deux posts consécutifs (minutes) ;
 * - heures de pointe = les 3 tranches les plus chargées (à égalité, la plus tôt d'abord).
 */
import type { Measure } from "../contract";
import { addDaysToDay, parisDay, parisMinutes, parisWeekday } from "../../rules/time";
import { mean, median, pct, roundTo, stdev } from "./stats";
import type { AnalysisPost } from "./types";

export const PEAK_SLOT_COUNT = 3;
export const WEEKDAY_LABELS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** Tranche de 30 minutes (Paris) d'un instant : « HH:MM » de début. */
export function slotOf(at: Date): string {
  const m = Math.floor(parisMinutes(at) / 30) * 30;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Jours de Paris du premier au dernier post, inclus. */
export function coveredDays(posts: readonly AnalysisPost[]): string[] {
  if (!posts.length) return [];
  const sorted = [...posts].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  const last = parisDay(sorted.at(-1)!.postedAt);
  const out: string[] = [];
  for (let d = parisDay(sorted[0]!.postedAt); d <= last; d = addDaysToDay(d, 1)) out.push(d);
  return out;
}

/** Nombre de posts par tranche de 30 minutes (Paris). */
export function slotCounts(posts: readonly AnalysisPost[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of posts) m.set(slotOf(p.postedAt), (m.get(slotOf(p.postedAt)) ?? 0) + 1);
  return m;
}

/** Heures de pointe : tranches les plus chargées, de la plus forte à la plus faible (à égalité, la plus tôt). */
export function peakSlotsOf(posts: readonly AnalysisPost[], count = PEAK_SLOT_COUNT): string[] {
  return [...slotCounts(posts).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([slot]) => slot);
}

export function rhythmMeasures(posts: readonly AnalysisPost[], opts: { spanDays?: number; days?: readonly string[] } = {}): { measures: Measure[]; peakSlots: string[] } {
  const n = posts.length;
  const days = opts.days ?? coveredDays(posts);
  const span = Math.max(1, opts.spanDays ?? days.length);
  const perDay = n / span;
  const byDay = new Map<string, number>();
  for (const p of posts) byDay.set(parisDay(p.postedAt), (byDay.get(parisDay(p.postedAt)) ?? 0) + 1);
  const daily = days.length ? days.map((d) => byDay.get(d) ?? 0) : [];
  while (opts.spanDays && daily.length < opts.spanDays) daily.push(0);
  const m = mean(daily);
  const sd = stdev(daily);
  const regularity = m && sd !== null ? roundTo(sd / m, 2) : null;
  const sorted = [...posts].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push((sorted[i]!.postedAt.getTime() - sorted[i - 1]!.postedAt.getTime()) / 60_000);
  const gap = median(gaps);
  const peakSlots = peakSlotsOf(posts);
  const counts = slotCounts(posts);
  const inPeak = peakSlots.reduce((s, k) => s + (counts.get(k) ?? 0), 0);
  const measures: Measure[] = [
    // Fenêtre imposée (canal du client) : 0 post par jour est une vraie mesure.
    { key: "postsPerDay", label: "Posts par jour", value: n || opts.spanDays ? roundTo(perDay, 1) : null, unit: "posts", sampleSize: n },
    { key: "postsPerWeek", label: "Posts par semaine", value: n || opts.spanDays ? roundTo(perDay * 7, 1) : null, unit: "posts", sampleSize: n },
    { key: "regularity", label: "Irrégularité (écart-type ÷ moyenne par jour, 0 = régulier)", value: regularity, sampleSize: daily.length },
    { key: "medianGapMinutes", label: "Délai médian entre deux posts", value: gap === null ? null : Math.round(gap), unit: "min", sampleSize: gaps.length },
    { key: "peakShare", label: "Part des posts dans les 3 heures de pointe", value: n ? pct(inPeak, n) : null, unit: "%", sampleSize: n },
    { key: "daysCovered", label: "Jours couverts", value: span, unit: "jours", sampleSize: n },
  ];
  for (const [slot, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    measures.push({ key: `slot.${slot}`, label: `Posts de ${slot} à ${endOf(slot)}`, value: c, unit: "posts", sampleSize: n });
  const byWeekday = new Map<number, number>();
  for (const p of posts) byWeekday.set(parisWeekday(p.postedAt), (byWeekday.get(parisWeekday(p.postedAt)) ?? 0) + 1);
  for (let d = 1; d <= 7; d++)
    measures.push({ key: `weekday.${d}`, label: `Posts le ${WEEKDAY_LABELS[d]}`, value: byWeekday.get(d) ?? 0, unit: "posts", sampleSize: n });
  return { measures, peakSlots };
}

function endOf(slot: string): string {
  const [h, m] = slot.split(":").map(Number) as [number, number];
  const t = h * 60 + m + 30;
  return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
}
