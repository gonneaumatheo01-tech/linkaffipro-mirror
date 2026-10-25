/**
 * Grand Chef : exécution des ordres de Kevin (phase 33, chantier A). Logique programmée, aucune IA.
 * - `runOrder` : revérifie pauses, plafonds, collisions et bornes, calcule les étapes (une fois, gardées pour la
 *   reprise), pose les dérogations datées, confie chaque étape au Chef de l'équipe (capacité du registre),
 *   passe l'ordre en cours. Idempotent par `(orderId, stepKey)` : relancé après un redémarrage, rien n'est doublé.
 * - `stopOrder` : missions non commencées annulées, celle en cours finit, dérogations fermées, ordre annulé.
 * - `extendOrder` : prolonge (30 jours au plus au total) ; `modifyOrder` : remplace les dérogations par le nouveau plan.
 * Chaîne : Kevin → Grand Chef (ici) → Chef (capacité) → agents (missions) ; aucun agent n'est appelé directement.
 */
import { agentAudit, agentEvent, nowOf } from "../admin/journal";
import type { ActorRef } from "../admin/team";
import { cancelMission } from "../missions/lifecycle";
import { ACTIVE_STATUSES, parseSteps } from "../missions/mission";
import { loadTeamSettings } from "../missions/settings";
import { checkBudgets } from "../orchestrator/budgets";
import { isTeamHalted } from "../orchestrator/pause";
import { addDaysToDay, parisDay, parisDayStart } from "../rules/time";
import { isTeamKey, TEAM_LABELS, type AgentsDeps, type ProviderKey, type TeamKey } from "../types";
import type { CapabilityPlanContext, OrderPlan, OrderStep, StepResult } from "./contract";
import { emitOrderEvent } from "./events";
import { overrideConflicts, type OverrideConflict } from "./overrides";
import { capability } from "./registry";
import { loadOrder, parseOrderPlan, patchProgress, progressOf, stepPending, toOrderRow, TERMINAL_ORDER_STATUSES, withOrderLock, type OrderProgress, type StepState, type TeamOrderDbRow } from "./store";
import { orderFacts } from "./facts";
import { frDay, MAX_ORDER_DAYS } from "./capabilities/kit";

export { activeOverridesFor, activeOverridesOn } from "./overrides";

export type RunOrderResult = {
  ok: boolean;
  status: string;
  message: string;
  steps: Array<{ stepKey: string; ok: boolean; message: string }>;
  /** Ordres qui ont déjà le même canal sur la même période (Kevin demande lequel garder). */
  conflicts?: OverrideConflict[];
  impossible?: Array<{ part: string; reason: string }>;
};

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Équipe qui travaille : l'équipe imitée (« comme si ») ou celle de l'ordre. */
function workingTeam(plan: OrderPlan | null, row: Pick<TeamOrderDbRow, "teamKey">, steps: readonly OrderStep[] = []): TeamKey | null {
  const s = steps.find((x) => isTeamKey(x.teamKey));
  const t = plan?.asIfTeamKey ?? (s?.teamKey as string | undefined) ?? plan?.teamKey ?? row.teamKey;
  return isTeamKey(t) ? t : null;
}

function ctxOf(plan: OrderPlan | null, now: Date): CapabilityPlanContext {
  return { now, mode: plan?.mode ?? "simulation", period: plan?.period ?? null };
}

/** Étapes d'un plan (parse + check + plan par le Chef), SANS écriture. */
export async function planSteps(deps: AgentsDeps, plan: OrderPlan, orderId?: string | null): Promise<{ steps: OrderStep[]; impossible: Array<{ part: string; reason: string }> }> {
  const steps: OrderStep[] = [];
  const impossible: Array<{ part: string; reason: string }> = [];
  const ctx = { ...ctxOf(plan, nowOf(deps)), orderId: orderId ?? null };
  for (const s of plan.steps) {
    const cap = capability(s.teamKey ?? plan.teamKey, s.capability);
    if (!cap) {
      impossible.push({ part: s.capability, reason: `L'équipe ${s.teamKey} ne sait pas faire « ${s.capability} ».` });
      continue;
    }
    const parsed = cap.parse(s.params);
    if (!parsed.ok) {
      impossible.push({ part: s.capability, reason: parsed.error });
      continue;
    }
    const check = await cap.check(deps, parsed.params);
    if (!check.ok) {
      impossible.push({ part: s.capability, reason: check.reason });
      continue;
    }
    steps.push(...(await cap.plan(deps, parsed.params, ctx)));
  }
  return { steps: steps.map(boundStep), impossible };
}

/** Garde-fou des bornes générales (30 jours au plus par dérogation). */
function boundStep(s: OrderStep): OrderStep {
  if (!s.overrides?.length) return s;
  return {
    ...s,
    overrides: s.overrides.map((o) => {
      const max = addDaysToDay(o.fromDay, MAX_ORDER_DAYS - 1);
      return o.toDay > max ? { ...o, toDay: max } : o;
    }),
  };
}

function periodOfSteps(steps: readonly OrderStep[]): { fromDay: string; toDay: string } | null {
  const all = steps.flatMap((s) => s.overrides ?? []);
  if (!all.length) return null;
  return { fromDay: all.map((o) => o.fromDay).sort()[0]!, toDay: all.map((o) => o.toDay).sort().reverse()[0]! };
}

/** Fournisseurs payants qu'un ordre peut faire dépenser (plafonds revérifiés avant le lancement). */
function paidProviders(team: TeamKey, steps: readonly OrderStep[]): ProviderKey[] {
  if (team !== "dating") return [];
  const out = new Set<ProviderKey>();
  for (const s of steps) {
    if (!s.costCents) continue;
    for (const o of s.overrides ?? []) {
      const mix = o.mix as { video?: number; photo?: number } | null | undefined;
      if (o.format === "video" || (mix?.video ?? 0) > 0) out.add("video");
      if (o.format === "photo" || (mix?.photo ?? 0) > 0) out.add("image");
    }
    if (!s.overrides?.length && s.params.format === "video") out.add("video");
    if (!s.overrides?.length && s.params.format === "photo") out.add("image");
  }
  return [...out];
}

/**
 * Plafond de dépense qui bloque encore un ordre (vidéo, photo, IA texte de l'équipe), ou null quand il s'est libéré
 * (nouveau mois, plafond relevé). Lecture seule.
 */
export async function orderBudgetOver(deps: AgentsDeps, row: TeamOrderDbRow): Promise<string | null> {
  const plan = parseOrderPlan(row.interpretation);
  const steps = progressOf(row.progress).plannedSteps ?? [];
  const team = workingTeam(plan, row, steps);
  if (!team) return null;
  const providers = [...new Set<ProviderKey>([...paidProviders(team, steps), ...(team !== "sports" ? (["llm"] as ProviderKey[]) : [])])];
  const over = await checkBudgets(deps, await loadTeamSettings(deps.prisma, team), providers, nowOf(deps));
  return over ? (over.reason ?? "Plafond de dépense atteint.") : null;
}

/** Pose les dérogations d'une étape (une seule ouverte par ordre, canal et équipe : jamais de doublon à la reprise). */
async function postOverrides(deps: AgentsDeps, orderId: string, step: OrderStep, mode: "simulation" | "real" = "simulation"): Promise<number> {
  let created = 0;
  for (const o of step.overrides ?? []) {
    // Garde-fou : un ordre « pour de faux » ne pose jamais de dérogation réelle (missions de test, canal Test).
    const isTest = o.isTest === true || mode !== "real";
    const existing = await deps.prisma.channelPlanOverride.findFirst({ where: { orderId, channelId: o.channelId, teamKey: o.teamKey, closedAt: null } });
    if (existing) continue;
    await deps.prisma.channelPlanOverride.create({
      data: {
        orderId,
        channelId: o.channelId,
        teamKey: o.teamKey,
        fromDay: o.fromDay,
        toDay: o.toDay,
        postsPerDay: o.postsPerDay ?? null,
        picksPerDay: o.picksPerDay ?? null,
        betCategoryId: o.betCategoryId ?? null,
        themes: o.themes ? json(o.themes) : undefined,
        mix: o.mix ? json(o.mix) : undefined,
        format: o.format ?? null,
        windowStart: o.windowStart ?? null,
        windowEnd: o.windowEnd ?? null,
        personaId: o.personaId ?? null,
        isTest,
      },
    });
    created++;
  }
  return created;
}

/** Exécute les étapes pas encore faites (idempotent) ; rend l'état de chaque étape. */
async function executeSteps(deps: AgentsDeps, row: TeamOrderDbRow, steps: readonly OrderStep[], mode: "simulation" | "real"): Promise<Record<string, StepState>> {
  const now = nowOf(deps);
  const state: Record<string, StepState> = { ...(progressOf(row.progress).steps ?? {}) };
  for (const step of steps) {
    // Faite, ou en échec pour de bon (refus, ou 3 essais déjà) : jamais rejouée.
    if (!stepPending(state[step.stepKey])) continue;
    let result: StepResult;
    try {
      await postOverrides(deps, row.id, step, mode);
      const cap = capability(step.teamKey, step.capability);
      if (cap) result = await cap.run(deps, toOrderRow((await loadOrder(deps, row.id)) ?? row), step);
      else {
        deps.logger?.warn({ orderId: row.id, capability: step.capability, teamKey: step.teamKey }, "[orders] capacité inconnue");
        result = { ok: false, message: "Cette partie de l'ordre n'est plus faisable par l'équipe.", retryable: false };
      }
    } catch (err) {
      // Détail technique au journal seulement ; l'état garde une phrase simple.
      deps.logger?.warn({ err: (err as Error).message, orderId: row.id, step: step.stepKey }, "[orders] étape en erreur");
      result = { ok: false, message: "Un souci technique a empêché cette étape, je réessaie plus tard.", retryable: true };
    }
    const attempts = (state[step.stepKey]?.attempts ?? 0) + 1;
    state[step.stepKey] = {
      ok: result.ok,
      message: result.message.slice(0, 500),
      at: now.toISOString(),
      attempts,
      ...(result.ok ? {} : { retryable: result.retryable === true }),
      ...(result.missionIds ? { missionIds: result.missionIds } : {}),
      ...(result.postIds ? { postIds: result.postIds } : {}),
    };
    // Écrit après chaque étape : un arrêt au milieu reprend à l'étape suivante.
    await patchProgress(deps, row.id, { steps: state });
  }
  return state;
}

async function block(deps: AgentsDeps, row: TeamOrderDbRow, reason: string): Promise<RunOrderResult> {
  const p = progressOf(row.progress);
  await patchProgress(deps, row.id, { blockedReason: reason, blockedNotified: reason }, { status: "BLOCKED" });
  if (p.blockedNotified !== reason) {
    const fresh = (await loadOrder(deps, row.id)) ?? row;
    await emitOrderEvent(deps, { type: "blocked", order: toOrderRow(fresh), orderId: row.id, number: row.number, teamKey: row.teamKey, chatId: row.chatId, reason, facts: await orderFacts(deps, toOrderRow(fresh)) });
  }
  return { ok: false, status: "BLOCKED", message: reason, steps: [] };
}

/**
 * Lance (ou reprend) un ordre validé, sous le verrou de l'ordre (le départ par Kevin et le suivi `orders-tick` ne
 * tournent jamais en même temps : rien n'est doublé, pari ou post de test compris).
 */
export async function runOrder(deps: AgentsDeps, orderId: string): Promise<RunOrderResult> {
  const r = await withOrderLock(deps, orderId, () => runOrderLocked(deps, orderId));
  if (r.busy) {
    const row = await loadOrder(deps, orderId);
    return { ok: !!row && !(TERMINAL_ORDER_STATUSES as readonly string[]).includes(row.status), status: row?.status ?? "MISSING", message: "Ordre déjà en cours de lancement.", steps: [] };
  }
  return r.value;
}

/** Ordre remplacé par celui-ci (chevauchement : « garde le nouveau »), arrêté seulement au lancement effectif. */
function replacedOrderId(row: Pick<TeamOrderDbRow, "interpretation">): string | null {
  const v = (row.interpretation as { replaces?: unknown } | null)?.replaces;
  return typeof v === "string" ? v : null;
}

async function runOrderLocked(deps: AgentsDeps, orderId: string): Promise<RunOrderResult> {
  const row = await loadOrder(deps, orderId);
  if (!row) return { ok: false, status: "MISSING", message: "Ordre introuvable.", steps: [] };
  if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(row.status)) return { ok: false, status: row.status, message: "Cet ordre est déjà terminé.", steps: [] };
  const plan = parseOrderPlan(row.interpretation);
  if (!plan) {
    await deps.prisma.teamOrder.update({ where: { id: orderId }, data: { status: "FAILED" } });
    return { ok: false, status: "FAILED", message: "Plan de l'ordre illisible.", steps: [] };
  }
  const now = nowOf(deps);
  const progress = progressOf(row.progress);
  // Étapes calculées une seule fois (reprise à l'identique, même si le réel a bougé entre-temps à cause de l'ordre).
  let steps = progress.plannedSteps;
  if (!steps?.length) {
    const r = await planSteps(deps, plan, orderId);
    if (!r.steps.length) {
      await deps.prisma.teamOrder.update({ where: { id: orderId }, data: { status: "FAILED", impossible: json(r.impossible) as never } });
      return { ok: false, status: "FAILED", message: r.impossible.map((i) => i.reason).join(" ; ") || "Rien à faire.", steps: [], impossible: r.impossible };
    }
    steps = r.steps;
  }
  const team = workingTeam(plan, row, steps);
  if (team) {
    const halt = await isTeamHalted(deps, team);
    if (halt.halted) return block(deps, row, `L'équipe ${TEAM_LABELS[team]} est arrêtée (${halt.reason}) : rien ne sortira tant qu'elle l'est.`);
    const paid = paidProviders(team, steps);
    if (paid.length) {
      const over = await checkBudgets(deps, await loadTeamSettings(deps.prisma, team), paid, now);
      if (over) return block(deps, row, over.reason ?? "Plafond de dépense atteint.");
    }
  }
  const wanted = steps.flatMap((s) => s.overrides ?? []);
  const replaces = replacedOrderId(row);
  const conflicts = (await overrideConflicts(deps, wanted, orderId)).filter((c) => c.orderId !== replaces);
  if (conflicts.length) {
    const c = conflicts[0]!;
    return { ok: false, status: row.status, message: `Ce canal a déjà l'ordre n°${c.number ?? "?"} du ${frDay(c.fromDay)} au ${frDay(c.toDay)} : lequel garder ?`, steps: [], conflicts };
  }
  const period = periodOfSteps(steps);
  await patchProgress(
    deps,
    orderId,
    { plannedSteps: json(steps), blockedReason: null },
    {
      status: "RUNNING",
      ...(period && !row.startsAt ? { startsAt: parisDayStart(period.fromDay) } : {}),
      ...(period ? { endsAt: parisDayStart(addDaysToDay(period.toDay, 1)) } : {}),
    },
  );
  const fresh = (await loadOrder(deps, orderId))!;
  const state = await executeSteps(deps, fresh, steps, plan.mode === "real" ? "real" : "simulation");
  const results = steps.map((s) => ({ stepKey: s.stepKey, ok: state[s.stepKey]?.ok === true, message: state[s.stepKey]?.message ?? "" }));
  const allOk = results.every((r) => r.ok);
  const anyOk = results.some((r) => r.ok);
  const hasProduction = steps.some((s) => s.overrides?.length) || plan.kind === "ONE_SHOT" || steps.some((s) => state[s.stepKey]?.missionIds?.length);
  let status = "RUNNING";
  // Rien de réussi : en échec, sauf s'il reste un essai à faire (souci passager : le suivi rejoue, 3 fois au plus).
  const retrying = steps.some((s) => stepPending(state[s.stepKey]));
  if (!anyOk) status = retrying ? "RUNNING" : "FAILED";
  else if (!hasProduction && allOk) status = "DONE";
  const after = (await loadOrder(deps, orderId))!;
  const p2 = progressOf(after.progress);
  await patchProgress(deps, orderId, status === "DONE" ? { finishedAt: now.toISOString() } : {}, { status });
  const final = toOrderRow((await loadOrder(deps, orderId))!);
  // « Garde le nouveau » : l'ancien ordre n'est arrêté qu'une fois le nouveau vraiment lancé.
  if (replaces && status !== "FAILED") {
    const old = await loadOrder(deps, replaces);
    if (old && !(TERMINAL_ORDER_STATUSES as readonly string[]).includes(old.status)) await stopOrder(deps, replaces, { userId: row.createdById, via: "TELEGRAM" }, `remplacé par l'ordre n°${row.number}`);
  }
  if (!p2.startedNotified && status !== "FAILED") {
    await patchProgress(deps, orderId, { startedNotified: true });
    await agentAudit(deps, { userId: row.createdById, action: "agents.order.started", entityType: "TeamOrder", entityId: orderId, metadata: { number: row.number, teamKey: row.teamKey, steps: steps.map((s) => s.stepKey) } });
    const facts = await orderFacts(deps, final);
    await emitOrderEvent(deps, { type: status === "DONE" ? "finished" : "started", order: final, orderId, number: row.number, teamKey: row.teamKey, chatId: row.chatId, facts });
  }
  return { ok: status !== "FAILED", status, message: results.map((r) => r.message).filter(Boolean).join(" ") || "Ordre lancé.", steps: results };
}

/** Une mission pas encore commencée : en attente, aucune étape lancée. */
function notStarted(m: { status: string; steps: unknown }): boolean {
  if (m.status !== "PENDING") return false;
  return parseSteps(m.steps).every((s) => s.status === "PENDING" || s.status === "SKIPPED") && !parseSteps(m.steps).some((s) => s.startedAt);
}

/**
 * Arrête un ordre : missions non commencées annulées, celle(s) en cours laissées finir, dérogations fermées
 * (`closedAt`), ordre annulé. Forme unique (site, Kevin, Grand Chef) : `actor` = qui arrête (journalisé dans
 * l'`AuditLog` ; absent = l'admin qui a donné l'ordre), `reason` = motif facultatif (« annulé dans la minute »).
 */
export async function stopOrder(
  deps: AgentsDeps,
  orderId: string,
  actor?: ActorRef | null,
  reason?: string | null,
): Promise<{ ok: boolean; message: string; cancelled: number; running: number }> {
  const row = await loadOrder(deps, orderId);
  if (!row) return { ok: false, message: "Ordre introuvable.", cancelled: 0, running: 0 };
  if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(row.status)) return { ok: false, message: "Cet ordre est déjà terminé.", cancelled: 0, running: 0 };
  const now = nowOf(deps);
  const why = reason?.trim() ? reason.trim().slice(0, 200) : `ordre n°${row.number} arrêté`;
  const userId = actor ? (actor.userId ?? null) : row.createdById;
  const missions = (await deps.prisma.agentMission.findMany({ where: { orderId, status: { in: [...ACTIVE_STATUSES] } }, select: { id: true, status: true, steps: true } })) as Array<{ id: string; status: string; steps: unknown }>;
  let cancelled = 0;
  let running = 0;
  for (const m of missions) {
    if (notStarted(m)) {
      await cancelMission(deps, m.id, { reason: why });
      cancelled++;
    } else running++;
  }
  await deps.prisma.channelPlanOverride.updateMany({ where: { orderId, closedAt: null }, data: { closedAt: now } });
  await deps.prisma.betCategory.updateMany({ where: { createdByOrderId: orderId, active: true }, data: { active: false } });
  await patchProgress(deps, orderId, { stoppedAt: now.toISOString() }, { status: "CANCELLED" });
  await agentAudit(deps, { userId, action: "agents.order.stopped", entityType: "TeamOrder", entityId: orderId, metadata: { number: row.number, cancelled, running, reason: why, via: actor?.via ?? null } });
  await agentEvent(deps, "agents.order.stopped", { orderId, number: row.number, cancelled, running });
  return {
    ok: true,
    cancelled,
    running,
    message: `Ordre n°${row.number} arrêté : ${cancelled} production${cancelled > 1 ? "s" : ""} annulée${cancelled > 1 ? "s" : ""}${running ? `, ${running} déjà en cours finit` : ""}.`,
  };
}

/** Premier jour d'un ordre : son début réel (`startsAt`), sinon son interprétation, sinon ses dérogations. */
function orderFirstDay(row: TeamOrderDbRow, overrides: ReadonlyArray<{ fromDay: string }>): string | null {
  const interp = row.interpretation as { fromDay?: unknown; period?: { start?: unknown } } | null;
  const cands = [
    row.startsAt ? parisDay(row.startsAt) : null,
    typeof interp?.fromDay === "string" ? interp.fromDay : null,
    typeof interp?.period?.start === "string" ? interp.period.start : null,
    ...overrides.map((o) => o.fromDay),
  ].filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d));
  return cands.length ? cands.sort()[0]! : null;
}

const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

/**
 * Prolonge un ordre de `days` jours : 30 jours au plus depuis le DÉBUT de l'ordre (`startsAt`), jamais depuis une
 * dérogation reposée par une modification ; l'interprétation suit (`toDay`, `period.days`, lus par le chevauchement).
 */
export async function extendOrder(deps: AgentsDeps, orderId: string, days: number, actor?: ActorRef | null): Promise<{ ok: boolean; message: string; toDay?: string }> {
  const row = await loadOrder(deps, orderId);
  if (!row) return { ok: false, message: "Ordre introuvable." };
  if (!["RUNNING", "BLOCKED"].includes(row.status)) return { ok: false, message: "Seul un ordre en cours se prolonge." };
  const add = Math.max(1, Math.round(days));
  const open = (await deps.prisma.channelPlanOverride.findMany({ where: { orderId, closedAt: null } })) as Array<{ id: string; fromDay: string; toDay: string }>;
  if (!open.length) return { ok: false, message: "Cet ordre n'a pas de période à prolonger." };
  const fromDay = orderFirstDay(row, open) ?? open.map((o) => o.fromDay).sort()[0]!;
  const curTo = open.map((o) => o.toDay).sort().reverse()[0]!;
  const maxTo = addDaysToDay(fromDay, MAX_ORDER_DAYS - 1);
  let toDay = addDaysToDay(curTo, add);
  let note = "";
  if (toDay > maxTo) {
    toDay = maxTo;
    note = ` (ramené à ${MAX_ORDER_DAYS} jours, la durée maximale d'un ordre)`;
  }
  if (toDay <= curTo) return { ok: false, message: `L'ordre dure déjà ${MAX_ORDER_DAYS} jours, le maximum.` };
  await deps.prisma.channelPlanOverride.updateMany({ where: { orderId, closedAt: null }, data: { toDay } });
  await deps.prisma.betCategory.updateMany({ where: { createdByOrderId: orderId }, data: { expiresAt: parisDayStart(addDaysToDay(toDay, 1)) } });
  const totalDays = dayCount(fromDay, toDay);
  const p = progressOf(row.progress);
  const planned = (p.plannedSteps ?? []).map((s) => ({ ...s, overrides: s.overrides?.map((o) => ({ ...o, toDay })) }));
  const interp = (row.interpretation && typeof row.interpretation === "object" ? row.interpretation : {}) as Record<string, unknown>;
  const period = interp.period && typeof interp.period === "object" ? { ...(interp.period as object), start: fromDay, days: totalDays } : { start: fromDay, days: totalDays };
  const storedSteps = Array.isArray(interp.plannedSteps) ? (interp.plannedSteps as OrderStep[]).map((s) => ({ ...s, overrides: s.overrides?.map((o) => ({ ...o, toDay })) })) : interp.plannedSteps;
  await patchProgress(deps, orderId, { plannedSteps: planned, finishedAt: null }, {
    endsAt: parisDayStart(addDaysToDay(toDay, 1)),
    interpretation: json({ ...interp, period, fromDay: typeof interp.fromDay === "string" ? interp.fromDay : fromDay, toDay, ...(storedSteps ? { plannedSteps: storedSteps } : {}) }) as never,
  });
  await agentAudit(deps, { userId: actor?.userId ?? row.createdById, action: "agents.order.extended", entityType: "TeamOrder", entityId: orderId, metadata: { number: row.number, from: curTo, to: toDay, via: actor?.via ?? null } });
  return { ok: true, toDay, message: `Ordre n°${row.number} prolongé jusqu'au ${frDay(toDay)}${note}.` };
}

/** Une étape sans ses dates (comparaison « a-t-elle changé ? », pur). */
function stepShape(s: OrderStep): string {
  return JSON.stringify({ c: s.capability, t: s.teamKey, p: s.params, o: (s.overrides ?? []).map((o) => ({ ...o, fromDay: undefined })) });
}

/**
 * Modifie un ordre en cours : nouveau plan (revalidé par le chantier B). Les clés d'étape ne changent pas ; seules les
 * étapes dont les paramètres ont changé sont rejouées (leurs dérogations fermées puis reposées à partir d'aujourd'hui),
 * les autres gardent leur état et leurs dérogations (aucun nouveau pari de test, aucun plan réécrit). La période
 * d'origine est gardée : premier jour et dernier jour d'origine, 30 jours au plus depuis le début de l'ordre.
 * Accepte le plan seul ou `{ plan, steps }` (étapes déjà planifiées).
 */
export async function modifyOrder(
  deps: AgentsDeps,
  orderId: string,
  change: OrderPlan | { plan: OrderPlan; steps?: OrderStep[] },
  actor?: ActorRef | null,
): Promise<RunOrderResult> {
  const row = await loadOrder(deps, orderId);
  if (!row) return { ok: false, status: "MISSING", message: "Ordre introuvable.", steps: [] };
  if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(row.status)) return { ok: false, status: row.status, message: "Cet ordre est déjà terminé.", steps: [] };
  const plan = "plan" in change && (change as { plan?: unknown }).plan ? (change as { plan: OrderPlan }).plan : (change as OrderPlan);
  const given = "plan" in change ? (change as { steps?: OrderStep[] }).steps : undefined;
  const planned = given?.length ? { steps: given.map(boundStep), impossible: [] } : await planSteps(deps, plan, orderId);
  if (!planned.steps.length) return { ok: false, status: row.status, message: planned.impossible.map((i) => i.reason).join(" ; ") || "Nouveau plan vide.", steps: [], impossible: planned.impossible };
  const today = parisDay(nowOf(deps));
  const before = progressOf(row.progress);
  const oldSteps = before.plannedSteps ?? [];
  const oldOverrides = oldSteps.flatMap((s) => s.overrides ?? []);
  // Période d'origine : premier jour (début réel) et dernier jour d'origine ; une nouvelle durée se compte depuis le
  // premier jour, jamais depuis aujourd'hui.
  const first = orderFirstDay(row, oldOverrides);
  const oldTo = oldOverrides.length ? oldOverrides.map((o) => o.toDay).sort().reverse()[0]! : null;
  const oldDays = (row.interpretation as { period?: { days?: unknown } } | null)?.period?.days;
  const newDays = plan.period?.days;
  const maxTo = first ? addDaysToDay(first, MAX_ORDER_DAYS - 1) : null;
  const pinTo = (o: { fromDay: string; toDay: string }): string => {
    let to = oldTo ?? o.toDay;
    if (first && typeof newDays === "number" && typeof oldDays === "number" && newDays !== oldDays) to = addDaysToDay(first, newDays - 1);
    if (!oldTo && o.toDay) to = o.toDay;
    return maxTo && to > maxTo ? maxTo : to;
  };
  const steps = planned.steps.map((s) => ({
    ...s,
    overrides: s.overrides?.map((o) => {
      const from = first ?? o.fromDay;
      return { ...o, fromDay: from < today ? today : from, toDay: pinTo(o) };
    }),
  }));
  const oldByKey = new Map(oldSteps.map((s) => [s.stepKey, s]));
  const changed = new Set(steps.filter((s) => { const o = oldByKey.get(s.stepKey); return !o || stepShape(o) !== stepShape(s); }).map((s) => s.stepKey));
  const removed = oldSteps.filter((s) => !steps.some((n) => n.stepKey === s.stepKey)).map((s) => s.stepKey);
  // Dérogations à refaire : celles des étapes changées ou retirées (les autres restent ouvertes, telles quelles).
  const redo = [...changed, ...removed].flatMap((k) => (oldByKey.get(k)?.overrides ?? []).concat(steps.find((x) => x.stepKey === k)?.overrides ?? []));
  // Une étape inchangée qui partage un canal (et une équipe) avec une étape refaite est refaite aussi (même dérogation).
  const pair = (o: { channelId: string; teamKey: string }) => `${o.channelId}|${o.teamKey}`;
  const redoPairs = new Set(redo.map(pair));
  for (const st of steps) if (!changed.has(st.stepKey) && (st.overrides ?? []).some((o) => redoPairs.has(pair(o)))) changed.add(st.stepKey);
  const conflicts = await overrideConflicts(deps, steps.filter((s) => changed.has(s.stepKey)).flatMap((s) => s.overrides ?? []), orderId);
  if (conflicts.length) return { ok: false, status: row.status, message: `Ce canal a déjà l'ordre n°${conflicts[0]!.number ?? "?"} sur cette période : lequel garder ?`, steps: [], conflicts };
  const now = nowOf(deps);
  for (const o of redo) await deps.prisma.channelPlanOverride.updateMany({ where: { orderId, channelId: o.channelId, teamKey: o.teamKey, closedAt: null }, data: { closedAt: now } });
  // Étapes inchangées : même clé, même état (rien n'est rejoué) ; étapes changées : état remis à zéro.
  const keptSteps = Object.fromEntries(Object.entries(before.steps ?? {}).filter(([k]) => !changed.has(k) && !removed.includes(k)));
  // Une étape inchangée garde ses dérogations d'origine (dates comprises) dans les étapes prévues.
  const finalSteps = steps.map((s) => (changed.has(s.stepKey) ? s : (oldByKey.get(s.stepKey) ?? s)));
  await deps.prisma.teamOrder.update({
    where: { id: orderId },
    data: {
      interpretation: json({ ...(row.interpretation as object), ...plan }) as never,
      progress: json({ ...before, plannedSteps: finalSteps, steps: keptSteps, modifiedAt: now.toISOString(), finishedAt: null } satisfies OrderProgress) as never,
      status: "RUNNING",
    },
  });
  await agentAudit(deps, { userId: actor?.userId ?? row.createdById, action: "agents.order.modified", entityType: "TeamOrder", entityId: orderId, metadata: { number: row.number, changed: [...changed], removed } });
  const r = await runOrder(deps, orderId);
  return { ...r, message: r.ok ? `Ordre n°${row.number} modifié. ${r.message}` : r.message };
}
