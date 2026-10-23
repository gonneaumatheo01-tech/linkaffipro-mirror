/**
 * Bilan des paris (phase 23) : paris publiés dont le match tombe dans la période (hors paris de test), regroupés par
 * catégorie, ligue, bookmaker ou semaine (lundi, heure de Paris), puis `summarizeBets` (règle pure). Ligne du rapport
 * du matin de l'équipe.
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { SETTLED_OR_PUBLISHED, summarizeBets, type SummaryPick } from "../rules/bet-summary";
import { addDaysToDay, parisDay, parisWeekday } from "../rules/time";
import type { BetSummaryRow } from "./contracts";
import { testMissionIds } from "./data";
import { bookmakerLabel, frNumber, leagueLabel } from "./labels";

type Row = { categoryId: string; league: string; bookmaker: string; kickoffAt: Date; status: string; odds: number; oddsAtSend: number | null; missionId: string | null };

/** Lundi (heure de Paris) de la semaine d'une date. */
export function weekStart(at: Date): string {
  return addDaysToDay(parisDay(at), 1 - parisWeekday(at));
}

export async function computeBetSummary(prisma: PrismaClient, q: { from: Date; to: Date; by: "category" | "league" | "bookmaker" | "week" }): Promise<BetSummaryRow[]> {
  const rows = (await prisma.bettingPick.findMany({
    where: { status: { in: [...SETTLED_OR_PUBLISHED] }, kickoffAt: { gte: q.from, lt: q.to } },
    select: { categoryId: true, league: true, bookmaker: true, kickoffAt: true, status: true, odds: true, oddsAtSend: true, missionId: true },
  })) as Row[];
  const tests = await testMissionIds(prisma, rows.map((r) => r.missionId));
  const real = rows.filter((r) => !r.missionId || !tests.has(r.missionId));
  const names = new Map<string, string>();
  if (q.by === "category") {
    const cats = await prisma.betCategory.findMany({ where: { id: { in: [...new Set(real.map((r) => r.categoryId))] } }, select: { id: true, name: true } });
    for (const c of cats) names.set(c.id, c.name);
  }
  const picks: SummaryPick[] = real.map((r) => {
    const odds = r.oddsAtSend ?? r.odds;
    if (q.by === "category") return { key: r.categoryId, label: names.get(r.categoryId) ?? r.categoryId, status: r.status, odds };
    if (q.by === "league") return { key: r.league, label: leagueLabel(r.league), status: r.status, odds };
    if (q.by === "bookmaker") return { key: r.bookmaker, label: bookmakerLabel(r.bookmaker), status: r.status, odds };
    const w = weekStart(r.kickoffAt);
    return { key: w, label: `semaine du ${w.slice(8, 10)}/${w.slice(5, 7)}`, status: r.status, odds };
  });
  const out = summarizeBets(picks);
  return q.by === "week" ? out.sort((a, b) => a.key.localeCompare(b.key)) : out;
}

/** Ligne libre du rapport du matin : paris de la veille et bilan des 7 derniers jours. */
export async function sportsReportNotes(prisma: PrismaClient, since: Date, until: Date): Promise<string[]> {
  const [published, skipped] = await Promise.all([
    prisma.bettingPick.count({ where: { status: { in: [...SETTLED_OR_PUBLISHED] }, createdAt: { gte: since, lt: until } } }),
    prisma.bettingPick.count({ where: { status: "SKIPPED", updatedAt: { gte: since, lt: until } } }),
  ]);
  const week = await computeBetSummary(prisma, { from: new Date(until.getTime() - 7 * 86_400_000), to: until, by: "category" });
  const won = week.reduce((s, r) => s + r.won, 0);
  const lost = week.reduce((s, r) => s + r.lost, 0);
  const notes = [`paris : ${published} publié${published > 1 ? "s" : ""}, ${skipped} écarté${skipped > 1 ? "s" : ""}`];
  if (won + lost) {
    const profit = week.reduce((s, r) => s + (r.roi ?? 0) * (r.won + r.lost), 0);
    notes.push(`7 jours : ${won} gagné${won > 1 ? "s" : ""} / ${lost} perdu${lost > 1 ? "s" : ""}, rendement ${profit >= 0 ? "+" : ""}${frNumber((profit / (won + lost)) * 100, 1)} %`);
  }
  return notes;
}
