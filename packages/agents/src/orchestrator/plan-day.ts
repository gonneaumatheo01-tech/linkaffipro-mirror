/**
 * Plan du jour du Grand Chef : pour chaque équipe active et non en pause, les missions manquantes du jour par canal
 * (plans `ChannelAgentPlan` activés moins les missions déjà créées pour ce jour de Paris). Logique programmée.
 */
import { nowOf } from "../admin/journal";
import { chainOf } from "../chiefs/index";
import { createMission } from "../missions/lifecycle";
import { ensureTeamConfigs } from "../missions/settings";
import { parisDay } from "../rules/time";
import { TEAM_KEYS, isTeamKey, type AgentsDeps, type TeamKey } from "../types";
import { isTeamHalted } from "./pause";

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

export type PlanDayResult = { day: string; created: number; refused: Array<{ channelId: string; reason: string }> };

export async function planDay(deps: AgentsDeps, opts: { teamKey?: TeamKey } = {}): Promise<PlanDayResult> {
  const now = nowOf(deps);
  const day = parisDay(now);
  await ensureTeamConfigs(deps.prisma);
  const teams: TeamKey[] = [];
  for (const t of opts.teamKey ? [opts.teamKey] : TEAM_KEYS) {
    if (!chainOf(t).active) continue;
    if ((await isTeamHalted(deps, t)).halted) continue;
    teams.push(t);
  }
  const result: PlanDayResult = { day, created: 0, refused: [] };
  if (!teams.length) return result;
  const plans = await deps.prisma.channelAgentPlan.findMany({
    where: { enabled: true, teamKey: { in: teams } },
    select: { channelId: true, teamKey: true, postsPerDay: true },
  });
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
