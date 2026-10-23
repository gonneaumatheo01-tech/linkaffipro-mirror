/**
 * Dépense des équipes chez les fournisseurs (`AgentUsage`, une ligne par équipe, fournisseur et mois de Paris).
 */
import type { Db as PrismaClient } from "@linkaffipro/db";
import { parisMonth } from "../rules/time";
import type { ProviderKey, TeamKey } from "../types";

export type UsageRow = { provider: string; cents: number; calls: number; alerted80: boolean; alerted100: boolean };

/** Ajoute une dépense (et un appel) au mois en cours. */
export async function recordUsage(
  prisma: PrismaClient,
  teamKey: TeamKey,
  provider: ProviderKey,
  cents: number,
  now: Date,
): Promise<void> {
  const month = parisMonth(now);
  const add = Math.max(0, Math.round(cents));
  await prisma.agentUsage.upsert({
    where: { teamKey_provider_month: { teamKey, provider, month } },
    create: { teamKey, provider, month, cents: add, calls: 1 },
    update: { cents: { increment: add }, calls: { increment: 1 } },
  });
}

/** Dépense du mois en cours d'une équipe, par fournisseur. */
export async function monthUsage(prisma: PrismaClient, teamKey: TeamKey, now: Date): Promise<UsageRow[]> {
  const rows = await prisma.agentUsage.findMany({ where: { teamKey, month: parisMonth(now) } });
  return rows.map((r) => ({
    provider: r.provider,
    cents: r.cents,
    calls: r.calls,
    alerted80: r.alerted80,
    alerted100: r.alerted100,
  }));
}

/** Total du mois en centimes (tous fournisseurs). */
export function totalCents(rows: readonly UsageRow[]): number {
  return rows.reduce((s, r) => s + r.cents, 0);
}
