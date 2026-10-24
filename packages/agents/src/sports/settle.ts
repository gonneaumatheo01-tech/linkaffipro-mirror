/**
 * Résultats des paris (phase 23, tâche `agents-sports` `settle` toutes les 2 h) :
 * - paris publiés dont le match est sans doute fini (coup d'envoi + 105 min) : résultat lu chez le fournisseur (celui
 *   du pari : faux pour un pari de test), gagné / perdu / remboursé (`rules/bet-settle.ts`), statistiques du match
 *   gardées, `PostInsight.betResult` et la charge utile de la mission mis à jour (équipe Algorithme) ;
 *   résultat introuvable 3 jours après le match : remboursé (motif noté) ;
 * - missions en attente de validation dont le coup d'envoi approche : annulées, pari écarté ;
 * - paris proposés d'une mission terminée sans publication : écartés.
 */
import { agentEvent, nowOf } from "../admin/journal";
import { cancelMission } from "../missions/lifecycle";
import { json, parsePayload } from "../missions/mission";
import { loadTeamSettings } from "../missions/settings";
import { isTeamHalted } from "../orchestrator/pause";
import { OddsQuotaError } from "../providers/odds-quota";
import { resolveOddsProvider, type OddsResolveDeps } from "../providers/odds-registry";
import type { OddsResult } from "../providers/odds";
import { settleBet } from "../rules/bet-settle";
import type { AgentsDeps } from "../types";
import type { PickRow } from "./data";
import { parseSportsSettings } from "./settings";

export const MATCH_DURATION_MS = 105 * 60_000;
export const RESULT_GIVE_UP_MS = 3 * 86_400_000;

export type SettleRunResult = { checked: number; settled: number; voidedLate: number; expired: number; orphaned: number; error?: string; halted?: string };

export async function runSportsSettle(deps: OddsResolveDeps): Promise<SettleRunResult> {
  const now = nowOf(deps);
  const out: SettleRunResult = { checked: 0, settled: 0, voidedLate: 0, expired: 0, orphaned: 0 };
  // Équipe en pause (ou pause générale) : rien n'est lu chez le fournisseur ni modifié, on reprendra au passage suivant.
  const halt = await isTeamHalted(deps, "sports");
  if (halt.halted) return { ...out, halted: halt.reason ?? "pause" };
  const s = parseSportsSettings((await loadTeamSettings(deps.prisma, "sports")).settings);
  out.expired = await expireLateValidations(deps, now);
  out.orphaned = await skipOrphanPicks(deps);

  const picks = (await deps.prisma.bettingPick.findMany({
    where: { status: "PUBLISHED", kickoffAt: { lte: new Date(now.getTime() - MATCH_DURATION_MS) } },
    orderBy: { kickoffAt: "asc" },
    take: 200,
  })) as PickRow[];
  const results = new Map<string, OddsResult | null>();
  for (const pick of picks) {
    out.checked++;
    const source = (pick.reasoning as { source?: string } | null)?.source === "fake" ? "fake" : "live";
    const cacheKey = `${source}:${pick.eventId}`;
    if (!results.has(cacheKey)) {
      const resolved = await resolveOddsProvider(deps, { source, maxCalls: s.maxApiCallsPerMonth, fakeShiftMs: (pick.reasoning as { fakeShiftMs?: number } | null)?.fakeShiftMs ?? null });
      try {
        results.set(cacheKey, resolved ? await resolved.provider.getResult(pick.eventId) : null);
      } catch (err) {
        if (err instanceof OddsQuotaError) return { ...out, error: err.message };
        deps.logger?.warn({ err: (err as Error).message, eventId: pick.eventId }, "[agents] résultat non lu");
        results.set(cacheKey, null);
      }
    }
    const result = results.get(cacheKey) ?? null;
    let settlement = settleBet(pick, result);
    if (!settlement && now.getTime() - pick.kickoffAt.getTime() > RESULT_GIVE_UP_MS) {
      settlement = { outcome: "VOID", value: null, detail: "résultat introuvable 3 jours après le match" };
      out.voidedLate++;
    }
    if (!settlement) continue;
    await deps.prisma.bettingPick.update({
      where: { id: pick.id },
      data: {
        status: settlement.outcome,
        settledAt: now,
        result: json({ outcome: settlement.outcome, value: settlement.value, detail: settlement.detail, homeScore: result?.homeScore ?? null, awayScore: result?.awayScore ?? null, stats: result?.stats ?? {} }) as never,
      },
    });
    // Tous les posts du pari (un par canal de destination) : rattachés par leur mission, pas seulement le premier.
    const postIds = await pickPostIds(deps, pick);
    if (postIds.length) await deps.prisma.postInsight.updateMany({ where: { postId: { in: postIds } }, data: { betResult: settlement.outcome } });
    if (pick.missionId) {
      const m = await deps.prisma.agentMission.findUnique({ where: { id: pick.missionId }, select: { payload: true } });
      if (m) await deps.prisma.agentMission.update({ where: { id: pick.missionId }, data: { payload: json({ ...parsePayload(m.payload), betResult: settlement.outcome }) as never } });
    }
    await agentEvent(deps, "agents.sports.settled", { pickId: pick.id, eventId: pick.eventId, outcome: settlement.outcome, detail: settlement.detail });
    out.settled++;
  }
  return out;
}

/** Posts d'un pari : `BettingPick.postId` et tous les posts de sa mission (`Post.agentMissionId`). */
export async function pickPostIds(deps: AgentsDeps, pick: Pick<PickRow, "postId" | "missionId">): Promise<string[]> {
  const ids = new Set<string>(pick.postId ? [pick.postId] : []);
  if (pick.missionId) for (const p of await deps.prisma.post.findMany({ where: { agentMissionId: pick.missionId }, select: { id: true } })) ids.add(p.id);
  return [...ids];
}

/** Validation trop tardive : le coup d'envoi est trop proche, le pari n'est plus publiable. */
async function expireLateValidations(deps: AgentsDeps, now: Date): Promise<number> {
  const waiting = await deps.prisma.agentMission.findMany({ where: { teamKey: "sports", status: { in: ["WAITING_VALIDATION", "PENDING", "RUNNING"] } }, select: { id: true, payload: true } });
  let n = 0;
  for (const m of waiting) {
    const pickId = parsePayload(m.payload).pickId;
    if (typeof pickId !== "string") continue;
    const pick = (await deps.prisma.bettingPick.findUnique({ where: { id: pickId } })) as PickRow | null;
    if (!pick || pick.status !== "PROPOSED") continue;
    const cat = await deps.prisma.betCategory.findUnique({ where: { id: pick.categoryId }, select: { minMinutesBeforeKickoff: true } });
    if (pick.kickoffAt.getTime() - now.getTime() >= (cat?.minMinutesBeforeKickoff ?? 30) * 60_000) continue;
    await deps.prisma.bettingPick.update({ where: { id: pick.id }, data: { status: "SKIPPED", skipReason: "coup d'envoi trop proche avant la fin de la validation" } });
    await cancelMission(deps, m.id, { reason: "pari écarté : coup d'envoi trop proche" });
    await agentEvent(deps, "agents.sports.pick_skipped", { missionId: m.id, pickId: pick.id, reason: "coup d'envoi trop proche avant la fin de la validation" });
    n++;
  }
  return n;
}

/** Paris proposés dont la mission est terminée sans publication (échec, annulation) : écartés. */
async function skipOrphanPicks(deps: AgentsDeps): Promise<number> {
  const proposed = (await deps.prisma.bettingPick.findMany({ where: { status: "PROPOSED" }, select: { id: true, missionId: true } })) as Array<{ id: string; missionId: string | null }>;
  if (!proposed.length) return 0;
  const missions = await deps.prisma.agentMission.findMany({
    where: { id: { in: proposed.map((p) => p.missionId).filter((x): x is string => !!x) }, status: { in: ["DONE", "FAILED", "CANCELLED", "BLOCKED_BUDGET"] } },
    select: { id: true, status: true, lastError: true },
  });
  let n = 0;
  for (const p of proposed) {
    const m = missions.find((x) => x.id === p.missionId);
    if (!m) continue;
    await deps.prisma.bettingPick.update({ where: { id: p.id }, data: { status: "SKIPPED", skipReason: `mission ${m.status === "CANCELLED" ? "annulée" : "terminée sans publication"}${m.lastError ? ` : ${m.lastError}` : ""}`.slice(0, 300) } });
    n++;
  }
  return n;
}
