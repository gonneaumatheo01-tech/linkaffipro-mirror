/**
 * Agent Posts (équipe Algorithme, sans IA) : fiches `PostInsight` puis classements « ce qui marche » par canal et par
 * univers sur les 90 derniers jours.
 */
import type { AgentDefinition, AgentsDeps } from "../../types";
import { nowOf } from "../../admin/journal";
import { loadAlgoTeam } from "../../algo/settings";
import { computePostInsights, INSIGHT_HISTORY_DAYS, loadInsightRows } from "./insights";
import { rankAll, type ScopeRanking } from "./rank";

export type PostsAgentResult = {
  computed: number;
  considered: number;
  channels: ScopeRanking[];
  verticals: ScopeRanking[];
};

/** Libellés des personas (classements par persona). */
export async function personaNames(deps: Pick<AgentsDeps, "prisma">): Promise<Map<string, string>> {
  const rows = (await deps.prisma.persona.findMany({ select: { id: true, name: true } })) as Array<{ id: string; name: string }>;
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function runPostsAgent(deps: AgentsDeps, opts: { full?: boolean } = {}): Promise<PostsAgentResult> {
  const { settings } = await loadAlgoTeam(deps.prisma);
  const res = await computePostInsights(deps, opts);
  const since = new Date(nowOf(deps).getTime() - INSIGHT_HISTORY_DAYS * 86_400_000);
  const rows = await loadInsightRows(deps, { since });
  const ranks = rankAll(rows, settings, await personaNames(deps));
  return { ...res, ...ranks };
}

export const agent: AgentDefinition = {
  key: "posts",
  async run(_mission, ctx) {
    const r = await runPostsAgent(ctx);
    return { ok: true, summary: `${r.computed} fiche(s) de post recalculée(s) sur ${r.considered}` };
  },
};
