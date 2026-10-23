/**
 * Chef Paris sportifs, déclenchement (phase 23, appelé par le passage du Grand Chef toutes les 30 min) : aux heures
 * de passage (10 h, 15 h, 18 h Paris, réglables) et 2 h avant les matchs retenus, une mission de sélection par
 * catégorie active qui n'a pas atteint son quota du jour et n'a pas déjà une sélection en cours. Rien sans clé de
 * cotes (ou fournisseur imposé), en pause, ou au plafond d'appels.
 */
import { nowOf } from "../admin/journal";
import { ACTIVE_STATUSES } from "../missions/mission";
import { loadTeamSettings } from "../missions/settings";
import { isTeamHalted } from "../orchestrator/pause";
import { oddsCallsThisMonth } from "../providers/odds-quota";
import { hasOddsKey } from "../providers/odds-registry";
import { parisDay } from "../rules/time";
import type { AgentsDeps } from "../types";
import { activeCategories, picksToday } from "./data";
import { createBetMission } from "./missions";
import { duePassage, readPassageState, writePassageState } from "./passage-state";
import { parseSportsSettings } from "./settings";

export type SportsPassageResult = { due: boolean; reason: string | null; created: number; refused: Array<{ categoryId: string; reason: string }>; skipped?: string };

export async function runSportsPassage(deps: AgentsDeps & { providers?: { odds?: unknown } }): Promise<SportsPassageResult> {
  const now = nowOf(deps);
  const out: SportsPassageResult = { due: false, reason: null, created: 0, refused: [] };
  const team = await loadTeamSettings(deps.prisma, "sports");
  const s = parseSportsSettings(team.settings);
  const state = await readPassageState(deps);
  const due = duePassage(state, now, s.runHours);
  await writePassageState(deps, due.next);
  out.due = due.due;
  out.reason = due.reason;
  if (!due.due) return out;
  if ((await isTeamHalted(deps, "sports")).halted) return { ...out, skipped: "équipe en pause" };
  if (!deps.providers?.odds && !(await hasOddsKey(deps.prisma))) return { ...out, skipped: "aucune clé de cotes" };
  if ((await oddsCallsThisMonth(deps.prisma, now)) >= s.maxApiCallsPerMonth) return { ...out, skipped: "plafond d'appels atteint" };

  const categories = (await activeCategories(deps.prisma)).filter((c) => !due.categoryIds || due.categoryIds.includes(c.id));
  if (!categories.length) return out;
  const running = await deps.prisma.agentMission.findMany({
    where: { teamKey: "sports", isTest: false, status: { in: [...ACTIVE_STATUSES] } },
    select: { payload: true, steps: true },
  });
  for (const c of categories) {
    if (c.picksPerDay - (await picksToday(deps.prisma, c.id, now)) <= 0) continue;
    // Une sélection en cours pour la catégorie (étape Cotes pas encore faite) : on ne la double pas.
    const selecting = running.some((m) => {
      const p = (m.payload ?? {}) as Record<string, unknown>;
      const first = Array.isArray(m.steps) ? (m.steps[0] as { agent?: string; status?: string } | undefined) : undefined;
      return p.categoryId === c.id && !p.pickId && first?.agent === "cotes" && first.status !== "DONE";
    });
    if (selecting) continue;
    const r = await createBetMission(deps, { category: c, createdBy: "GRAND_CHEF", planDay: parisDay(now), reason: due.reason ?? undefined });
    if (r.ok) out.created++;
    else out.refused.push({ categoryId: c.id, reason: r.reason });
  }
  return out;
}
