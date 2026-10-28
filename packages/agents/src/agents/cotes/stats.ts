/**
 * Agent Cotes et sélection, source « statistiques » (28 octobre 2026) : le bookmaker de la catégorie ne se lit pas
 * (site du client bloqué, ou réglé « L'équipe envoie la capture et la cote »). Les matchs et les tirs cadrés viennent
 * d'API-Football (offre gratuite) ; la sélection est `sports/stats-select.ts` ; chaque pari retenu attend ensuite la
 * capture et la cote de l'équipe (`sports/human-odds.ts`, `BettingPick.oddsLevel = human-pending`). La cote gardée à
 * ce stade est une ESTIMATION (raisonnement) : elle n'est jamais publiée, l'équipe donne la vraie.
 */
import { agentEvent } from "../../admin/journal";
import { json } from "../../missions/mission";
import { ApiFootballError, type ApiFootballClient } from "../../providers/apifootball";
import { ProviderError } from "../../providers/http";
import type { AgentContext, AgentResult, Mission } from "../../types";
import { recentPickKeys, type BetCategoryInfo } from "../../sports/data";
import { ODDS_LEVEL_HUMAN_PENDING } from "../../sports/human-odds-text";
import { createBetMission } from "../../sports/missions";
import { addKickoffTriggers } from "../../sports/passage-state";
import type { SportsSettings } from "../../sports/settings";
import { statsReasoningSentences } from "../../sports/format";
import { rankStatsPicks, statsEntitiesOf, type StatsCandidate } from "../../sports/stats-select";
import { statsMatches, tellApiFootballProblem, type HumanTarget } from "../../sports/stats-source";

const noPick = (summary: string, extra: Record<string, unknown> = {}): AgentResult => ({ ok: true, output: { noPick: true, noPickReason: summary, ...extra }, summary });

export async function runStatsSelection(
  mission: Mission,
  ctx: AgentContext,
  i: { category: BetCategoryInfo; s: SportsSettings; remaining: number; orderId: string | null; target: HumanTarget; client: ApiFootballClient },
): Promise<AgentResult> {
  const { category, s, remaining, orderId, target, client } = i;
  const entities = statsEntitiesOf(category.marketTypes);
  if (!entities.length) return noPick("statistiques : seuls les paris « tirs cadrés, plus de » sont choisis sans lire le site");
  const now = ctx.now();
  const window = { from: new Date(now.getTime() + category.minMinutesBeforeKickoff * 60_000), to: new Date(now.getTime() + s.lookaheadHours * 3_600_000) };
  let matches;
  try {
    matches = await statsMatches(client, category, window);
  } catch (err) {
    if (err instanceof ApiFootballError) {
      await tellApiFootballProblem(ctx, err);
      return noPick(err.message, { statsError: err.code });
    }
    if (err instanceof ProviderError && err.transient) return noPick(`${err.message} : nouvel essai au prochain passage`);
    throw err;
  }
  if (!matches.length) return noPick("aucun match à venir dans les ligues de la catégorie (statistiques)");
  const ranked = rankStatsPicks({
    matches,
    entities,
    minOdds: category.minOdds,
    maxOdds: category.maxOdds,
    targetBookmaker: target.key,
    minMinutesBeforeKickoff: category.minMinutesBeforeKickoff,
    recent: await recentPickKeys(ctx.prisma, now),
    now,
  });
  const chosen = ranked.candidates.slice(0, remaining);
  if (!mission.isTest && !orderId)
    await addKickoffTriggers(ctx, category.id, ranked.candidates.slice(remaining, remaining + 5).map((c) => c.match.kickoffAt), s.kickoffTriggerHours);
  const stats = `${matches.length} matchs étudiés (statistiques)`;
  if (!chosen.length) return noPick(`${stats}, aucun pari retenu`, { rejected: ranked.rejected });

  const picks = [];
  for (const c of chosen) picks.push(await createStatsPick(ctx, mission, category.id, c, target));
  for (const pick of picks.slice(1)) {
    const targets = Array.isArray(mission.payload.targetChannelIds) ? (mission.payload.targetChannelIds as string[]) : null;
    const r = await createBetMission(ctx, {
      category,
      createdBy: mission.isTest || orderId ? "HUMAN" : "GRAND_CHEF",
      isTest: mission.isTest,
      pickId: pick.id,
      oddsSource: "live",
      ...(orderId ? { orderId, channelIds: targets, createdById: await missionField(ctx, mission.id, "createdById"), planDay: await missionField(ctx, mission.id, "planDay") } : {}),
    });
    if (r.ok) await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { missionId: r.missionId } });
    else await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { status: "SKIPPED", skipReason: `mission non créée : ${r.reason}`.slice(0, 300) } });
  }
  await agentEvent(ctx, "agents.sports.picks", { missionId: mission.id, categoryId: category.id, picks: picks.map((p) => p.id), considered: ranked.considered, rejected: ranked.rejected, source: "stats" }, { channelId: mission.channelId });
  return {
    ok: true,
    output: { pickId: picks[0]!.id, oddsSource: "live", statsSource: true },
    summary: `${stats}, ${chosen.length} retenu${chosen.length > 1 ? "s" : ""} : capture et cote demandées à l'équipe (${target.label})`,
  };
}

async function missionField(ctx: AgentContext, missionId: string, field: "createdById" | "planDay"): Promise<string | null> {
  const row = (await ctx.prisma.agentMission.findUnique({ where: { id: missionId }, select: { createdById: true, planDay: true } })) as { createdById: string | null; planDay: string | null } | null;
  return row?.[field] ?? null;
}

function createStatsPick(ctx: AgentContext, mission: Mission, categoryId: string, c: StatsCandidate, target: HumanTarget) {
  const reasoning = { ...c.reasoning, targetLabel: target.label };
  const lines = statsReasoningSentences(c.match.homeTeam, c.match.awayTeam, reasoning);
  return ctx.prisma.bettingPick.create({
    data: {
      missionId: mission.id,
      categoryId,
      eventId: c.match.eventId,
      homeTeam: c.match.homeTeam,
      awayTeam: c.match.awayTeam,
      league: c.match.leagueId,
      kickoffAt: c.match.kickoffAt,
      marketId: c.marketId,
      marketLabel: c.marketLabel,
      selectionLabel: c.selectionLabel,
      line: c.line,
      bookmaker: target.key,
      // Estimation seulement (jamais publiée) : la vraie cote vient de l'équipe.
      odds: c.reasoning.estimatedOdds,
      consensusOdds: null,
      interestScore: c.reasoning.score,
      oddsLevel: ODDS_LEVEL_HUMAN_PENDING,
      reasoning: json({ ...reasoning, lines, summary: lines.join(" ") }) as never,
      status: "PROPOSED",
    },
  });
}
