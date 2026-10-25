/**
 * Missions du jour des ordres de Kevin (phase 33, Grand Chef), appelées par `orchestrator/plan-day.ts` AVANT les plans
 * de canaux : pour chaque dérogation active du jour, les missions manquantes de l'ordre sur ce canal, créées avec
 * `orderId`, `planDay`, `createdBy = HUMAN`, `createdById` = l'admin qui a donné l'ordre. Équipe, quantité, thème,
 * format, fenêtre et persona viennent de la dérogation ; canal Test → missions `isTest` (publication en simulation sur
 * le canal Test quel que soit le mode de l'équipe). Validations et niveaux d'autonomie inchangés (même chaîne d'agents).
 * Paris sportifs : une sélection par jour, par ordre et par canal, à partir de la première heure de passage de
 * l'équipe (ou du début de la fenêtre), vers les canaux de l'ordre (jamais `BetCategory.channelIds`).
 */
import { nowOf } from "../admin/journal";
import { chainOf } from "../chiefs/index";
import { createMission } from "../missions/lifecycle";
import { isTeamHalted } from "../orchestrator/pause";
import { hasOddsKey } from "../providers/odds-registry";
import { hhmmToMinutes, parisMinutes } from "../rules/time";
import { loadCategory } from "../sports/data";
import { createBetMission } from "../sports/missions";
import { loadSportsSettings } from "../sports/settings";
import { isTeamKey, type AgentsDeps, type TeamKey } from "../types";
import { overrideMix, overrideThemes, type OverrideRow } from "./overrides";
import { loadOrder, parseOrderPlan, progressOf } from "./store";

export type OrderDayResult = { created: number; refused: Array<{ channelId: string; orderId: string; reason: string }> };

const FORMATS = new Set(["video", "photo", "text"]);

/** Rang du jour dans la dérogation (0 = premier jour). */
function dayIndex(o: Pick<OverrideRow, "fromDay">, day: string): number {
  return Math.max(0, Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${o.fromDay}T12:00:00Z`)) / 86_400_000));
}

/** Campagne du bouton d'offre prévue par l'étape de l'ordre pour ce canal (la dérogation n'a pas de colonne pour elle). */
function campaignOf(progress: unknown, channelId: string): string | null {
  const steps = progressOf(progress).plannedSteps ?? [];
  for (const s of steps)
    if (s.overrides?.some((o) => o.channelId === channelId) && typeof s.params.campaignId === "string") return s.params.campaignId;
  return null;
}

export async function planOrderMissions(deps: AgentsDeps, day: string, overrides: readonly OverrideRow[]): Promise<OrderDayResult> {
  const out: OrderDayResult = { created: 0, refused: [] };
  const halted = new Map<TeamKey, boolean>();
  for (const o of overrides) {
    if (!isTeamKey(o.teamKey) || !chainOf(o.teamKey).active) continue;
    const team = o.teamKey;
    if (!halted.has(team)) halted.set(team, (await isTeamHalted(deps, team)).halted);
    if (halted.get(team)) continue;
    const order = await loadOrder(deps, o.orderId);
    if (!order || order.status !== "RUNNING") continue;
    try {
      if (team === "sports") await sportsDay(deps, day, o, order.createdById, order.number, out);
      else await postsDay(deps, day, o, order, out);
    } catch (err) {
      out.refused.push({ channelId: o.channelId, orderId: o.orderId, reason: (err as Error).message.slice(0, 200) });
      deps.logger?.warn({ err: (err as Error).message, orderId: o.orderId }, "[orders] missions du jour non créées");
    }
  }
  return out;
}

async function postsDay(deps: AgentsDeps, day: string, o: OverrideRow, order: NonNullable<Awaited<ReturnType<typeof loadOrder>>>, out: OrderDayResult): Promise<void> {
  const team = o.teamKey as TeamKey;
  const perDay = Math.max(0, o.postsPerDay ?? 0);
  if (!perDay) return;
  const existing = await deps.prisma.agentMission.count({ where: { orderId: o.orderId, channelId: o.channelId, planDay: day } });
  const missing = perDay - existing;
  if (missing <= 0) return;
  const themes = overrideThemes(o);
  const mix = overrideMix(o);
  const plan = parseOrderPlan(order.interpretation);
  const campaignId = campaignOf(order.progress, o.channelId);
  const orderPlan = {
    ...(o.windowStart && o.windowEnd ? { windowStart: o.windowStart, windowEnd: o.windowEnd } : {}),
    ...(mix ? { mix } : {}),
    ...(themes.length ? { themes } : {}),
    ...(o.personaId ? { personaId: o.personaId } : {}),
    ...(campaignId ? { campaignId } : {}),
    postsPerDay: perDay,
  };
  const start = dayIndex(o, day) * perDay + existing;
  for (let i = 0; i < missing; i++) {
    const theme = themes.length ? themes[(start + i) % themes.length]! : null;
    const r = await createMission(deps, {
      teamKey: team,
      channelId: o.channelId,
      createdBy: "HUMAN",
      createdById: order.createdById,
      isTest: o.isTest,
      planDay: day,
      orderId: o.orderId,
      postsPerDay: perDay,
      ...(o.format && FORMATS.has(o.format) ? { format: o.format as "video" | "photo" | "text" } : {}),
      personaId: o.personaId ?? null,
      payload: { orderPlan, orderNumber: order.number, ...(theme ? { theme } : {}), ...(plan?.mode ? { orderMode: plan.mode } : {}) },
    });
    if (r.ok) out.created++;
    else {
      out.refused.push({ channelId: o.channelId, orderId: o.orderId, reason: r.reason });
      break;
    }
  }
}

async function sportsDay(deps: AgentsDeps, day: string, o: OverrideRow, createdById: string | null, number: number, out: OrderDayResult): Promise<void> {
  if (!o.betCategoryId) return;
  const wanted = Math.max(0, o.picksPerDay ?? 0);
  if (!wanted) return;
  // Une sélection par jour, par ordre et par canal (elle crée elle-même les missions sœurs des paris suivants).
  const existing = await deps.prisma.agentMission.count({ where: { orderId: o.orderId, channelId: o.channelId, planDay: day } });
  if (existing > 0) return;
  const now = nowOf(deps);
  const s = await loadSportsSettings(deps.prisma);
  const opensAt = hhmmToMinutes(o.windowStart) ?? (s.runHours[0] ?? 10) * 60;
  const closesAt = hhmmToMinutes(o.windowEnd) ?? 23 * 60;
  const minutes = parisMinutes(now);
  if (minutes < opensAt || minutes >= closesAt) return;
  const category = await loadCategory(deps.prisma, o.betCategoryId);
  if (!category) {
    out.refused.push({ channelId: o.channelId, orderId: o.orderId, reason: "catégorie de paris de l'ordre introuvable" });
    return;
  }
  const live = !!(deps as { providers?: { odds?: unknown } }).providers?.odds || (await hasOddsKey(deps.prisma));
  const r = await createBetMission(deps, {
    category,
    createdBy: "HUMAN",
    createdById,
    isTest: o.isTest,
    planDay: day,
    oddsSource: live ? "live" : "fake",
    reason: `ordre n°${number}`,
    orderId: o.orderId,
    channelIds: [o.channelId],
    picksWanted: wanted,
  });
  if (r.ok) out.created++;
  else out.refused.push({ channelId: o.channelId, orderId: o.orderId, reason: r.reason });
}
