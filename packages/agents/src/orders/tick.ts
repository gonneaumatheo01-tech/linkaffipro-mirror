/**
 * Suivi des ordres par le Grand Chef (phase 33), tâche `orders-tick` toutes les 10 minutes (file
 * `agents-orchestrator`) : reprise des ordres interrompus (étapes pas encore faites), progression (`progress`), jour
 * terminé, fin automatique (`toDay` passé et missions terminées → DONE), échecs (au-delà de 2 → Kevin prévient),
 * plafond (`BLOCKED_BUDGET` → BLOCKED), reprise d'un ordre bloqué par une pause levée, catégories d'ordre expirées
 * remises inactives. Événements vers Kevin par `setOrderEventHook` (`./events`).
 */
import { nowOf } from "../admin/journal";
import { isTeamHalted } from "../orchestrator/pause";
import { hhmmToMinutes, parisDay, parisMinutes } from "../rules/time";
import { isTeamKey, type AgentsDeps } from "../types";
import { ORDER_LIMITS } from "./contract";
import { orderMissionFacts } from "./capabilities/kit";
import { emitOrderEvent } from "./events";
import { orderFacts } from "./facts";
import { orderBudgetOver, runOrder } from "./run";
import { loadOrder, parseOrderPlan, patchProgress, progressOf, stepPending, toOrderRow, type TeamOrderDbRow } from "./store";

export { setOrderEventHook, emitOrderEvent, type OrderEvent, type OrderEventHook, type OrderEventType } from "./events";

export type TickResult = { orders: number; resumed: number; finished: number; blocked: number; events: number; expiredCategories: number };

type OverrideLite = { fromDay: string; toDay: string; windowEnd: string | null; closedAt: Date | null; teamKey: string };

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export async function tickOrders(deps: AgentsDeps, now: Date = nowOf(deps)): Promise<TickResult> {
  const d: AgentsDeps = { ...deps, now: () => now };
  const out: TickResult = { orders: 0, resumed: 0, finished: 0, blocked: 0, events: 0, expiredCategories: 0 };
  // Catégories créées pour un ordre : jamais actives après leur expiration (ni en dehors de l'ordre).
  const expired = await d.prisma.betCategory.updateMany({ where: { createdByOrderId: { not: null }, expiresAt: { lt: now }, active: true }, data: { active: false } });
  out.expiredCategories = expired.count;
  const rows = (await d.prisma.teamOrder.findMany({ where: { status: { in: ["RUNNING", "BLOCKED"] } }, orderBy: { createdAt: "asc" }, take: 200 })) as TeamOrderDbRow[];
  for (const row of rows) {
    out.orders++;
    try {
      await tickOne(d, row, now, out);
    } catch (err) {
      d.logger?.warn({ err: (err as Error).message, orderId: row.id }, "[orders] suivi d'un ordre en erreur");
    }
  }
  return out;
}

async function tickOne(deps: AgentsDeps, row: TeamOrderDbRow, now: Date, out: TickResult): Promise<void> {
  const progress = progressOf(row.progress);
  const planned = progress.plannedSteps ?? [];
  // Ordre bloqué : il repart quand l'équipe reprend ET que le plafond s'est libéré (nouveau mois, plafond relevé) ; il
  // se termine à la fin de sa période même s'il est resté bloqué.
  if (row.status === "BLOCKED") {
    const plan = parseOrderPlan(row.interpretation);
    const team = plan?.asIfTeamKey ?? planned.find((s) => isTeamKey(s.teamKey))?.teamKey ?? row.teamKey;
    const ovs = (await deps.prisma.channelPlanOverride.findMany({ where: { orderId: row.id } })) as OverrideLite[];
    const lastDay = ovs.map((o) => o.toDay).sort().reverse()[0] ?? null;
    if (lastDay && parisDay(now) > lastDay) {
      await deps.prisma.betCategory.updateMany({ where: { createdByOrderId: row.id, active: true }, data: { active: false } });
      await patchProgress(deps, row.id, { finishedAt: now.toISOString(), blockedReason: null }, { status: "DONE" });
      const o = toOrderRow((await loadOrder(deps, row.id)) ?? row);
      await emitOrderEvent(deps, { type: "finished", order: o, orderId: row.id, number: row.number, teamKey: row.teamKey, chatId: row.chatId, facts: await orderFacts(deps, o) });
      out.finished++;
      out.events++;
      return;
    }
    if (isTeamKey(team) && (await isTeamHalted(deps, team)).halted) return;
    if (await orderBudgetOver(deps, row)) return;
    await patchProgress(deps, row.id, { blockedReason: null, blockedNotified: null, unblockedAt: now.toISOString() }, { status: "RUNNING" });
    const r = await runOrder(deps, row.id);
    if (r.status === "RUNNING") out.resumed++;
    return;
  }
  // Reprise après un arrêt : une étape jamais faite, ou en échec rejouable (3 essais au plus), est relancée, jamais doublée.
  const state = progress.steps ?? {};
  if (!planned.length || planned.some((s) => stepPending(state[s.stepKey]))) {
    const r = await runOrder(deps, row.id);
    if (r.ok) out.resumed++;
    const again = await loadOrder(deps, row.id);
    if (!again || again.status !== "RUNNING") return;
    row = again;
  }
  const facts = await orderMissionFacts(deps, row.id);
  const overrides = (await deps.prisma.channelPlanOverride.findMany({ where: { orderId: row.id } })) as OverrideLite[];
  const today = parisDay(now);
  const fromDay = overrides.map((o) => o.fromDay).sort()[0] ?? today;
  const toDay = overrides.map((o) => o.toDay).sort().reverse()[0] ?? today;
  const days = dayDiff(fromDay, toDay) + 1;
  const perDayPlanned = planned.flatMap((s) => s.overrides ?? []).reduce((s, o) => s + (o.postsPerDay ?? o.picksPerDay ?? 0), 0);
  const p = progressOf((await loadOrder(deps, row.id))?.progress);
  await patchProgress(deps, row.id, {
    missionsPlanned: perDayPlanned ? perDayPlanned * days : facts.missions,
    missionsCreated: facts.missions,
    missionsDone: facts.done,
    missionsFailed: facts.failed,
    missionsInProgress: facts.inProgress,
    waitingValidation: facts.waitingValidation,
    perDay: facts.perDay,
  });
  const order = () => loadOrder(deps, row.id).then((r) => toOrderRow(r ?? row));
  const event = async (type: "day_done" | "finished" | "failures" | "blocked", extra: { day?: string; reason?: string; failures?: number } = {}) => {
    const o = await order();
    const sent = await emitOrderEvent(deps, {
      type,
      order: o,
      orderId: row.id,
      number: row.number,
      teamKey: row.teamKey,
      chatId: row.chatId,
      days,
      ...(extra.day ? { day: extra.day, dayIndex: dayDiff(fromDay, extra.day) + 1 } : {}),
      ...(extra.reason ? { reason: extra.reason } : {}),
      ...(extra.failures !== undefined ? { failures: extra.failures } : {}),
      facts: await orderFacts(deps, o),
    });
    out.events++;
    return sent;
  };
  // Plafond atteint : ordre bloqué, Kevin prévient une fois. Après un déblocage (plafond libéré), seules les missions
  // bloquées DEPUIS comptent (les anciennes restent visibles, elles ne rebloquent pas l'ordre).
  const unblockedAt = typeof p.unblockedAt === "string" ? new Date(p.unblockedAt) : null;
  const blockedSince = unblockedAt
    ? ((await deps.prisma.agentMission.count({ where: { orderId: row.id, status: "BLOCKED_BUDGET", createdAt: { gte: unblockedAt } } })) as number)
    : facts.blockedBudget;
  if (blockedSince > 0) {
    const reason = facts.errors[0] ?? "Plafond de dépense atteint.";
    await patchProgress(deps, row.id, { blockedReason: reason, blockedNotified: reason }, { status: "BLOCKED" });
    if (p.blockedNotified !== reason) await event("blocked", { reason });
    out.blocked++;
    return;
  }
  // Échecs : au-delà de 2, Kevin prévient (une fois par nouveau palier).
  if (facts.failed > ORDER_LIMITS.failuresBeforeWarning && (p.failuresNotified ?? 0) < facts.failed) {
    await patchProgress(deps, row.id, { failuresNotified: facts.failed });
    await event("failures", { failures: facts.failed, reason: facts.errors.join(" ; ") || undefined });
  }
  // Jours terminés : un message par jour au plus (jour passé, ou fin de fenêtre passée et rien en cours ce jour-là).
  const notified = new Set(p.daysNotified ?? []);
  const end = overrides.map((o) => hhmmToMinutes(o.windowEnd)).filter((m): m is number => m !== null).sort((a, b) => b - a)[0] ?? 22 * 60;
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.parse(`${fromDay}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    if (day > today || notified.has(day)) continue;
    const dd = facts.perDay.find((x) => x.day === day);
    const over = day < today || parisMinutes(now) >= end;
    if (!over || (dd && dd.inProgress > 0)) continue;
    if (day === toDay) continue; // le dernier jour est couvert par le bilan de fin
    // Jour marqué « rapporté » seulement après l'envoi réussi (sinon retenté au passage suivant).
    if (!(await event("day_done", { day }))) continue;
    notified.add(day);
    await patchProgress(deps, row.id, { daysNotified: [...notified] });
  }
  // Fin : période passée (ou dérogations toutes fermées) et plus rien en cours.
  const allClosed = overrides.length > 0 && overrides.every((o) => o.closedAt);
  const periodOver = overrides.length ? today > toDay || allClosed : true;
  if (periodOver && facts.inProgress === 0) {
    await deps.prisma.betCategory.updateMany({ where: { createdByOrderId: row.id, active: true }, data: { active: false } });
    await patchProgress(deps, row.id, { finishedAt: now.toISOString() }, { status: "DONE" });
    await event("finished");
    out.finished++;
  }
}
