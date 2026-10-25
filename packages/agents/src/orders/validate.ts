/**
 * Phase 33 (chantier B) — revalidation par le code du plan produit par l'IA (règle 2 : les capacités déclarées sont
 * la seule vérité). Pour chaque étape : capacité du registre (sinon refus), `parse` (paramètre hors schéma → refus),
 * bornes générales et de la capacité (durée ≤ 30 jours, quantité par jour, modes, canaux), `check` sur le réel
 * (raison + replis), `plan` (ce qui serait créé, SANS RIEN ÉCRIRE ; bornes et clamps de la capacité), puis
 * chevauchement avec un ordre vivant (même canal + même équipe + période qui se recoupe → une question « lequel
 * garder ? »). Le résultat dit s'il faut lancer, proposer la partie possible, poser une question ou proposer des
 * replis.
 */
import { nowOf } from "../admin/journal";
import { isTeamKey, type TeamKey } from "../types";
import {
  ORDER_LIMITS,
  type Alternative,
  type ImpossiblePart,
  type OrderPlan,
  type OrderStep,
  type OrderStepPlan,
} from "./contract";
import { FUTURE_TEAMS, LIVE_ORDER_STATUSES, interpretationOf, orderTeamLabel, periodEnd, type TeamOrderRow } from "./current";
import { capability, listCapabilities, type AnyCapability } from "./ports";
import { defaultStartDay, type PlannedOrder } from "./planner";
import type { BossDeps } from "../boss/contract";

export type ValidatedStep = { step: OrderStepPlan; capability: AnyCapability; params: Record<string, unknown>; planned: OrderStep[] };

/** Partie impossible, avec la capacité qui manque (bilan hebdomadaire) et l'équipe concernée. */
export type ImpossibleOut = ImpossiblePart & { suggestedCapability?: string | null; teamKey?: string | null; refused?: boolean };

export type OverlapInfo = { orderId: string; number: number; recap: string; channelId: string };

export type ValidationStatus = "ok" | "partial" | "empty" | "question" | "overlap";

export type ValidatedPlan = {
  plan: OrderPlan;
  steps: ValidatedStep[];
  plannedSteps: OrderStep[];
  impossible: ImpossibleOut[];
  /** Ce qui a été ramené dans une borne (« 50 posts par jour → 12, le maximum du canal »). */
  clamped: string[];
  overlap: OverlapInfo | null;
  /** Dépense fournisseur estimée (centimes). */
  costCents: number;
  channelIds: string[];
  fromDay: string | null;
  toDay: string | null;
  status: ValidationStatus;
  /** Équipe nommée mais absente du registre (« montage »). */
  missingTeam: string | null;
};

/**
 * Clés de paramètres reconnues comme « nombre de jours » et « par jour » (bornes générales). Les noms des schémas du
 * registre viennent en premier (`jours`, `paris_par_jour`, `posts_par_jour` : `orders/capabilities/*`) ; les autres
 * restent tolérés pour un plan d'IA approximatif.
 */
export const DAYS_KEYS = ["jours", "days", "nbJours", "duree"];
export const PER_DAY_KEYS = ["paris_par_jour", "posts_par_jour", "perDay", "parJour", "par_jour", "picksPerDay", "postsPerDay", "quantite"];

function clampNumber(v: unknown, max: number): { value: number; clamped: boolean } | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v > max ? { value: max, clamped: true } : { value: v, clamped: false };
}

/** Bornes générales et de la capacité sur les paramètres (avant `parse`) ; rend les messages de clamp (pur). */
export function clampParams(params: Record<string, unknown>, cap: Pick<AnyCapability, "limits">, unit: string): { params: Record<string, unknown>; clamped: string[] } {
  const out = { ...params };
  const clamped: string[] = [];
  const maxDays = Math.min(cap.limits.maxDays ?? ORDER_LIMITS.maxDays, ORDER_LIMITS.maxDays);
  for (const k of DAYS_KEYS) {
    const c = clampNumber(out[k], maxDays);
    if (c?.clamped) {
      clamped.push(`${out[k]} jours → ${maxDays}, le maximum`);
      out[k] = c.value;
    }
  }
  if (cap.limits.maxPerDay)
    for (const k of PER_DAY_KEYS) {
      const c = clampNumber(out[k], cap.limits.maxPerDay);
      if (c?.clamped) {
        clamped.push(`${out[k]} ${unit} par jour → ${cap.limits.maxPerDay}, le maximum`);
        out[k] = c.value;
      }
    }
  return { params: out, clamped };
}

/** Replis génériques d'une équipe : ses autres capacités (libellé = description), rejouables si sans paramètre requis. */
function teamAlternatives(teamKey: string, except: string | null): Alternative[] {
  return listCapabilities()
    .filter((c) => c.teamKey === teamKey && c.key !== except && c.key !== "question")
    .slice(0, 3)
    .map((c) => ({ label: c.description.charAt(0).toLowerCase() + c.description.slice(1) }));
}

/** Canaux touchés : dérogations prévues, sinon la portée. */
function channelsOf(plan: OrderPlan, planned: OrderStep[]): string[] {
  const ids = new Set<string>();
  for (const st of planned) for (const o of st.overrides ?? []) ids.add(o.channelId);
  const scope = plan.scope as { channelIds?: string[] };
  if (!ids.size && Array.isArray(scope.channelIds)) for (const id of scope.channelIds) ids.add(id);
  return [...ids];
}

/** Période couverte (dérogations prévues, sinon la période du plan). */
function periodOf(plan: OrderPlan, planned: OrderStep[]): { fromDay: string | null; toDay: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  for (const st of planned)
    for (const o of st.overrides ?? []) {
      if (!from || o.fromDay < from) from = o.fromDay;
      if (!to || o.toDay > to) to = o.toDay;
    }
  if (!from && plan.period) {
    from = plan.period.start;
    to = periodEnd(plan.period.start, plan.period.days);
  }
  return { fromDay: from, toDay: to };
}

/** Ordre vivant qui se recoupe (même canal, même équipe, période commune), sauf `excludeOrderId`. */
export async function findOverlap(
  deps: BossDeps,
  input: { teamKey: string; channelIds: string[]; fromDay: string | null; toDay: string | null; excludeOrderId?: string | null },
): Promise<OverlapInfo | null> {
  if (!input.channelIds.length || !input.fromDay || !input.toDay) return null;
  const rows = (await deps.prisma.teamOrder.findMany({
    where: { status: { in: [...LIVE_ORDER_STATUSES] } },
    orderBy: { createdAt: "desc" },
    take: 50,
  })) as unknown as TeamOrderRow[];
  for (const r of rows) {
    if (r.id === input.excludeOrderId) continue;
    const interp = interpretationOf(r);
    if (!interp?.fromDay || !interp.toDay) continue;
    const team = interp.asIfTeamKey ?? r.teamKey;
    if (team !== input.teamKey) continue;
    if (interp.toDay < input.fromDay || interp.fromDay > input.toDay) continue;
    const common = (interp.channelIds ?? []).find((c) => input.channelIds.includes(c));
    if (common) return { orderId: r.id, number: r.number, recap: r.recap, channelId: common };
  }
  return null;
}

/**
 * Revalide un plan (règle 2). Ne lève jamais pour une étape : une erreur d'une capacité devient une partie
 * impossible (« je n'ai pas pu vérifier »).
 */
export async function validatePlan(deps: BossDeps, input: PlannedOrder | OrderPlan, opts: { excludeOrderId?: string | null } = {}): Promise<ValidatedPlan> {
  const now = nowOf(deps);
  const plan: OrderPlan = JSON.parse(JSON.stringify({ ...input, requestedTeam: undefined })) as OrderPlan;
  const requested = (input as PlannedOrder).requestedTeam ?? null;
  const clamped: string[] = [];
  const impossible: ImpossibleOut[] = (plan.impossible ?? []).map((p) => ({ ...p, teamKey: (p as ImpossibleOut).teamKey ?? requested ?? plan.teamKey }));
  const team = plan.asIfTeamKey ?? plan.teamKey;
  const unit = team === "sports" ? "paris" : "posts";

  // Bornes générales de la période (règle 6).
  if (plan.period) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.period.start)) plan.period.start = defaultStartDay(now);
    if (plan.period.days > ORDER_LIMITS.maxDays) {
      clamped.push(`${plan.period.days} jours → ${ORDER_LIMITS.maxDays}, le maximum d'un ordre`);
      plan.period.days = ORDER_LIMITS.maxDays;
    }
    if (plan.period.days < 1) plan.period.days = 1;
  }
  // « Faire comme si » : le canal Test seulement (un vrai canal garde son univers).
  const scope = plan.scope as { test?: boolean; channelIds?: string[] };
  if (plan.asIfTeamKey && !scope.test) {
    impossible.push({
      part: "faire comme si sur un vrai canal",
      reason: "un vrai canal garde son univers : je ne peux faire « comme si » que sur le canal Test",
      alternatives: [{ label: "le faire sur le canal Test", capability: undefined }],
      teamKey: plan.asIfTeamKey,
    });
    plan.steps = [];
  }

  const missingTeam = requested && !listCapabilities().some((c) => c.teamKey === requested) ? requested : null;
  const steps: ValidatedStep[] = [];
  for (const step of plan.steps) {
    const cap = capability(step.teamKey, step.capability);
    if (!cap) {
      const future = FUTURE_TEAMS[step.teamKey];
      impossible.push({
        part: step.capability.replace(/_/g, " "),
        reason: future
          ? `${future} arrive bientôt, pas encore possible de lui donner des ordres`
          : `ce n'est pas quelque chose que ${isTeamKey(step.teamKey) || ["ads", "inspiration"].includes(step.teamKey) ? `l'équipe ${orderTeamLabel(step.teamKey)}` : "les équipes"} sait faire`,
        alternatives: teamAlternatives(step.teamKey, null),
        suggestedCapability: step.capability.replace(/_/g, " "),
        teamKey: step.teamKey,
        refused: true,
      });
      continue;
    }
    const bounded = clampParams(step.params ?? {}, cap, unit);
    const parsed = cap.parse(bounded.params);
    if (!parsed.ok) {
      impossible.push({
        part: cap.description,
        reason: `la demande ne rentre pas dans ce que l'équipe sait faire (${parsed.error})`,
        alternatives: teamAlternatives(cap.teamKey, cap.key),
        teamKey: cap.teamKey,
        refused: true,
      });
      continue;
    }
    if (!cap.limits.modes.includes(plan.mode)) {
      impossible.push({
        part: cap.description,
        reason: plan.mode === "real" ? "ça ne se fait que pour de faux pour le moment" : "ça ne se fait qu'en vrai",
        alternatives: [],
        teamKey: cap.teamKey,
      });
      continue;
    }
    if (cap.limits.channels === "test" && !scope.test) {
      impossible.push({ part: cap.description, reason: "ça ne se fait que sur le canal Test", alternatives: [{ label: "le faire sur le canal Test" }], teamKey: cap.teamKey });
      continue;
    }
    let check;
    try {
      check = await cap.check(deps, parsed.params);
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, capability: cap.key }, "[orders] vérification en échec");
      check = { ok: false as const, reason: "je n'ai pas pu vérifier (lecture impossible pour le moment)", alternatives: [] };
    }
    if (!check.ok) {
      impossible.push({ part: cap.description, reason: check.reason, alternatives: check.alternatives.slice(0, 4), teamKey: cap.teamKey });
      continue;
    }
    let planned: OrderStep[];
    try {
      planned = await cap.plan(deps, parsed.params, { now, orderId: null, mode: plan.mode, period: plan.period ?? null });
    } catch (err) {
      impossible.push({ part: cap.description, reason: `je n'ai pas pu le préparer (${(err as Error).message.slice(0, 80)})`, alternatives: [], teamKey: cap.teamKey });
      continue;
    }
    clamped.push(...bounded.clamped);
    for (const p of planned) for (const c of p.clamped ?? []) if (!clamped.includes(c)) clamped.push(c);
    steps.push({ step: { ...step, params: parsed.params }, capability: cap, params: parsed.params, planned });
  }

  if (missingTeam) {
    // Ce qui manque vraiment, c'est l'équipe : sa raison passe avant celle de l'IA (« pas encore d'équipe Montage »).
    const reason = FUTURE_TEAMS[missingTeam]
      ? `pas encore d'équipe ${FUTURE_TEAMS[missingTeam]!.replace(/^l'équipe /, "")}, elle arrive bientôt`
      : `l'équipe ${missingTeam} n'existe pas encore : pas d'ordres possibles pour le moment`;
    const own = impossible.filter((i) => i.teamKey === missingTeam);
    if (own.length) for (const i of own) i.reason = reason;
    else impossible.push({ part: "cette demande", reason, alternatives: [], teamKey: missingTeam, suggestedCapability: null });
  }

  plan.steps = steps.map((s) => s.step);
  plan.impossible = impossible.map(({ part, reason, alternatives }) => ({ part, reason, alternatives }));
  const plannedSteps = steps.flatMap((s) => s.planned);
  const channelIds = channelsOf(plan, plannedSteps);
  const { fromDay, toDay } = periodOf(plan, plannedSteps);
  const costCents = plannedSteps.reduce((sum, p) => sum + Math.max(0, Math.round(p.costCents ?? 0)), 0);
  const overlap = steps.length
    ? await findOverlap(deps, { teamKey: team, channelIds, fromDay, toDay, excludeOrderId: opts.excludeOrderId ?? null }).catch(() => null)
    : null;
  const status: ValidationStatus = overlap
    ? "overlap"
    : steps.length === 0
      ? plan.questions.length && !impossible.length
        ? "question"
        : "empty"
      : impossible.length
        ? "partial"
        : "ok";
  return { plan, steps, plannedSteps, impossible, clamped, overlap, costCents, channelIds, fromDay, toDay, status, missingTeam };
}

/** L'équipe qui travaille pour cet ordre (« comme si » compris). */
export function workingTeam(plan: Pick<OrderPlan, "teamKey" | "asIfTeamKey">): string {
  return plan.asIfTeamKey ?? plan.teamKey;
}

export function isTeam(v: string): v is TeamKey {
  return isTeamKey(v);
}
