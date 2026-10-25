/**
 * Dérogations datées (`ChannelPlanOverride`, phase 33) posées par le Grand Chef pour un ordre : lues par le plan du jour
 * AVANT `ChannelAgentPlan`, éteintes seules après `toDay` ou dès `closedAt` (ordre arrêté). Le plan de base d'un canal
 * n'est jamais modifié par un ordre.
 */
import type { AgentsDeps } from "../types";
import type { OrderStep } from "./contract";

export type OverrideRow = {
  id: string;
  channelId: string;
  orderId: string;
  teamKey: string;
  fromDay: string;
  toDay: string;
  postsPerDay: number | null;
  picksPerDay: number | null;
  betCategoryId: string | null;
  themes: unknown;
  mix: unknown;
  format: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  personaId: string | null;
  isTest: boolean;
  closedAt: Date | null;
  createdAt: Date;
};

/** Dérogation active ce jour-là (pur) : ouverte, et le jour dans `[fromDay, toDay]`. */
export function overrideActiveOn(o: Pick<OverrideRow, "fromDay" | "toDay" | "closedAt">, day: string): boolean {
  return !o.closedAt && o.fromDay <= day && day <= o.toDay;
}

async function runningOrderIds(deps: Pick<AgentsDeps, "prisma">, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = (await deps.prisma.teamOrder.findMany({ where: { id: { in: [...new Set(ids)] }, status: "RUNNING" }, select: { id: true } })) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

/** Dérogations actives d'un jour (tous canaux), d'ordres en cours seulement, de la plus ancienne à la plus récente. */
export async function activeOverridesOn(deps: Pick<AgentsDeps, "prisma">, day: string, channelId?: string): Promise<OverrideRow[]> {
  const rows = (await deps.prisma.channelPlanOverride.findMany({
    where: { closedAt: null, fromDay: { lte: day }, toDay: { gte: day }, ...(channelId ? { channelId } : {}) },
    orderBy: { createdAt: "asc" },
  })) as OverrideRow[];
  const running = await runningOrderIds(deps, rows.map((r) => r.orderId));
  return rows.filter((r) => running.has(r.orderId) && overrideActiveOn(r, day));
}

/** Dérogations actives d'un canal un jour donné (CONTRAT : `activeOverridesFor`). */
export async function activeOverridesFor(deps: Pick<AgentsDeps, "prisma">, channelId: string, day: string): Promise<OverrideRow[]> {
  return activeOverridesOn(deps, day, channelId);
}

/** Les deux périodes se chevauchent (pur). */
export function periodsOverlap(a: { fromDay: string; toDay: string }, b: { fromDay: string; toDay: string }): boolean {
  return a.fromDay <= b.toDay && b.fromDay <= a.toDay;
}

export type OverrideConflict = { orderId: string; number: number | null; channelId: string; fromDay: string; toDay: string; teamKey: string };

/**
 * Ordres en cours qui ont déjà une dérogation ouverte sur le même canal pendant la même période (règle 6 : Kevin
 * demande lequel garder plutôt que d'empiler). Lecture seule.
 */
export async function overrideConflicts(
  deps: Pick<AgentsDeps, "prisma">,
  wanted: ReadonlyArray<Pick<NonNullable<OrderStep["overrides"]>[number], "channelId" | "fromDay" | "toDay">>,
  excludeOrderId?: string | null,
): Promise<OverrideConflict[]> {
  if (!wanted.length) return [];
  const rows = (await deps.prisma.channelPlanOverride.findMany({
    where: { closedAt: null, channelId: { in: [...new Set(wanted.map((w) => w.channelId))] } },
  })) as OverrideRow[];
  const others = rows.filter((r) => r.orderId !== excludeOrderId);
  const running = await runningOrderIds(deps, others.map((r) => r.orderId));
  const numbers = new Map(
    ((others.length
      ? await deps.prisma.teamOrder.findMany({ where: { id: { in: [...running] } }, select: { id: true, number: true } })
      : []) as Array<{ id: string; number: number }>).map((o) => [o.id, o.number]),
  );
  const out: OverrideConflict[] = [];
  for (const r of others) {
    if (!running.has(r.orderId)) continue;
    if (!wanted.some((w) => w.channelId === r.channelId && periodsOverlap(w, r))) continue;
    if (out.some((o) => o.orderId === r.orderId && o.channelId === r.channelId)) continue;
    out.push({ orderId: r.orderId, number: numbers.get(r.orderId) ?? null, channelId: r.channelId, fromDay: r.fromDay, toDay: r.toDay, teamKey: r.teamKey });
  }
  return out;
}

/** Thèmes d'une dérogation (liste de textes). */
export function overrideThemes(o: Pick<OverrideRow, "themes">): string[] {
  return Array.isArray(o.themes) ? (o.themes as unknown[]).filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
}

/** Mélange d'une dérogation, ou null. */
export function overrideMix(o: Pick<OverrideRow, "mix">): { video: number; photo: number; text: number } | null {
  const r = o.mix && typeof o.mix === "object" && !Array.isArray(o.mix) ? (o.mix as Record<string, unknown>) : null;
  if (!r) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
  const m = { video: n(r.video), photo: n(r.photo), text: n(r.text) };
  return m.video + m.photo + m.text > 0 ? m : null;
}
