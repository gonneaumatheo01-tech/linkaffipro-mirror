/** Compteurs d'usage de l'assistant IA : mois en cours (plafond), jour par utilisateur (limite), historique. */
import { prisma } from "@linkaffipro/db";

/** Début du mois et du jour en heure de Paris (stockage UTC). */
export function parisBounds(now = new Date()): { monthStart: Date; dayStart: Date } {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  const offset = parisOffset(now);
  return {
    monthStart: new Date(`${get("year")}-${get("month")}-01T00:00:00${offset}`),
    dayStart: new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00${offset}`),
  };
}

function parisOffset(d: Date): string {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "longOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT+01:00";
  const m = /GMT([+-]\d{2}:\d{2})/.exec(s);
  return m?.[1] ?? "+01:00";
}

export type AiMonthUsage = { count: number; costEur: number; byUser: Array<{ userId: string; name: string; count: number; costEur: number }> };

export async function monthUsage(now = new Date()): Promise<AiMonthUsage> {
  const { monthStart } = parisBounds(now);
  const rows = await prisma.aiSuggestion.groupBy({ by: ["userId"], where: { createdAt: { gte: monthStart } }, _count: { _all: true }, _sum: { costEur: true } });
  const users = rows.length ? await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  const byUser = rows
    .map((r) => ({ userId: r.userId, name: names.get(r.userId) ?? "Compte supprimé", count: r._count._all, costEur: Number(r._sum.costEur ?? 0) }))
    .sort((a, b) => b.costEur - a.costEur);
  return { count: byUser.reduce((s, u) => s + u.count, 0), costEur: Math.round(byUser.reduce((s, u) => s + u.costEur, 0) * 10_000) / 10_000, byUser };
}

export async function monthCostEur(now = new Date()): Promise<number> {
  const { monthStart } = parisBounds(now);
  const agg = await prisma.aiSuggestion.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { costEur: true } });
  return Number(agg._sum.costEur ?? 0);
}

export async function userDailyCount(userId: string, now = new Date()): Promise<number> {
  const { dayStart } = parisBounds(now);
  return prisma.aiSuggestion.count({ where: { userId, createdAt: { gte: dayStart } } });
}

export async function recentSuggestions(take = 50) {
  return prisma.aiSuggestion.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, kind: true, context: true, model: true, costEur: true, usedIndex: true, createdAt: true, inputTokens: true, outputTokens: true, cachedTokens: true, user: { select: { name: true } } },
  });
}
