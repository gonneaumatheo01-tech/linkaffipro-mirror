/**
 * Plan du jour du Grand Chef : pour chaque équipe active et non en pause, les missions manquantes du jour par canal
 * (plans `ChannelAgentPlan` activés moins les missions déjà créées pour ce jour de Paris). Logique programmée.
 * Phase 33 : les dérogations datées des ordres de Kevin (`ChannelPlanOverride`) sont lues AVANT les plans : un canal
 * qui a une dérogation active ce jour-là suit la dérogation (missions liées à l'ordre), pas son plan de base, qui ne
 * change jamais ; après `toDay` ou la fermeture de l'ordre, le plan de base reprend tout seul.
 */
import { nowOf } from "../admin/journal";
import { chainOf } from "../chiefs/index";
import { createMission } from "../missions/lifecycle";
import { ensureTeamConfigs } from "../missions/settings";
import { parisDay } from "../rules/time";
import { TEAM_KEYS, isTeamKey, type AgentsDeps, type TeamKey } from "../types";
import { isTeamHalted } from "./pause";
import { activeOverridesOn } from "../orders/overrides";
import { planOrderMissions } from "../orders/day-missions";

export type PlanRow = { channelId: string; teamKey: string; postsPerDay: number };
export type MissingMission = { channelId: string; teamKey: TeamKey; count: number };

/** Règle pure : missions à créer = quota du plan − missions déjà créées ce jour pour ce canal (jamais négatif). */
export function missingMissions(plans: readonly PlanRow[], existing: ReadonlyArray<{ channelId: string | null }>, teams: readonly TeamKey[]): MissingMission[] {
  const done = new Map<string, number>();
  for (const m of existing) if (m.channelId) done.set(m.channelId, (done.get(m.channelId) ?? 0) + 1);
  const out: MissingMission[] = [];
  for (const p of plans) {
    if (!isTeamKey(p.teamKey) || !teams.includes(p.teamKey)) continue;
    const count = Math.max(0, p.postsPerDay - (done.get(p.channelId) ?? 0));
    if (count > 0) out.push({ channelId: p.channelId, teamKey: p.teamKey, count });
  }
  return out;
}

export type PlanDayResult = {
  day: string;
  created: number;
  refused: Array<{ channelId: string; reason: string }>;
  /** Phase 33 : missions des ordres de Kevin créées ce passage. */
  orders?: { created: number; refused: number };
};

export async function planDay(deps: AgentsDeps, opts: { teamKey?: TeamKey } = {}): Promise<PlanDayResult> {
  const now = nowOf(deps);
  const day = parisDay(now);
  await ensureTeamConfigs(deps.prisma);
  const teams: TeamKey[] = [];
  for (const t of opts.teamKey ? [opts.teamKey] : TEAM_KEYS) {
    if (!chainOf(t).active) continue;
    // Paris sportifs : missions créées par les passages du Chef Paris (catégories), jamais par les plans de canaux.
    if (t === "sports") continue;
    if ((await isTeamHalted(deps, t)).halted) continue;
    teams.push(t);
  }
  const result: PlanDayResult = { day, created: 0, refused: [] };
  // Dérogations des ordres d'abord (toutes équipes, Paris sportifs compris : le Chef de l'équipe ne voit pas les ordres).
  // Une erreur de lecture des dérogations n'empêche jamais le plan du jour (journalisée, plans de base seulement).
  let overrides: Awaited<ReturnType<typeof activeOverridesOn>> = [];
  try {
    overrides = (await activeOverridesOn(deps, day)).filter((o) => !opts.teamKey || o.teamKey === opts.teamKey);
  } catch (err) {
    deps.logger?.warn({ err: (err as Error).message, day }, "[agents] dérogations des ordres illisibles : plan du jour sans elles");
  }
  if (overrides.length) {
    try {
      const r = await planOrderMissions(deps, day, overrides);
      result.created += r.created;
      result.refused.push(...r.refused.map((x) => ({ channelId: x.channelId, reason: x.reason })));
      result.orders = { created: r.created, refused: r.refused.length };
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message, day }, "[agents] missions des ordres non créées");
    }
  }
  // Un ordre « pour de faux » sur un vrai canal (dérogation de test) ne remplace pas son plan de base : il publie sur
  // le canal Test, le canal garde sa production habituelle. Une dérogation réelle (ou celle du canal Test) remplace.
  let testChannels = new Set<string>();
  try {
    const ids = [...new Set(overrides.filter((o) => o.isTest).map((o) => o.channelId))];
    if (ids.length) testChannels = new Set(((await deps.prisma.channel.findMany({ where: { id: { in: ids }, isTest: true }, select: { id: true } })) as Array<{ id: string }>).map((c) => c.id));
  } catch {
    testChannels = new Set();
  }
  const overridden = new Set(overrides.filter((o) => !o.isTest || testChannels.has(o.channelId)).map((o) => o.channelId));
  if (!teams.length) return result;
  const plans = (
    await deps.prisma.channelAgentPlan.findMany({
      where: { enabled: true, teamKey: { in: teams } },
      select: { channelId: true, teamKey: true, postsPerDay: true },
    })
  ).filter((p) => !overridden.has(p.channelId));
  if (!plans.length) return result;
  const existing = await deps.prisma.agentMission.findMany({
    where: { planDay: day, isTest: false, createdBy: "GRAND_CHEF", channelId: { in: plans.map((p) => p.channelId) } },
    select: { channelId: true },
  });
  for (const m of missingMissions(plans, existing, teams)) {
    for (let i = 0; i < m.count; i++) {
      const r = await createMission(deps, { teamKey: m.teamKey, channelId: m.channelId, createdBy: "GRAND_CHEF", planDay: day });
      if (r.ok) result.created++;
      else {
        result.refused.push({ channelId: m.channelId, reason: r.reason });
        break;
      }
    }
  }
  return result;
}
