/**
 * Agent Cotes et sélection (équipe Paris sportifs, phase 23) : matchs à venir des ligues de la catégorie (du délai
 * minimal jusqu'à 48 h), cotes des marchés de la catégorie (un appel groupé, cache 5 min), classement transparent
 * (`select.ts`), N meilleurs → `BettingPick` PROPOSED avec le raisonnement chiffré. Le 1er pari continue dans cette
 * mission, les suivants partent dans des missions sœurs. Rien d'intéressant, quota du jour atteint ou plafond
 * d'appels : la mission se termine sans post (`noPick`). Les coups d'envoi des meilleurs candidats non retenus
 * déclenchent un passage 2 h avant (`agents.sports.triggers`).
 */
import { agentEvent } from "../../admin/journal";
import { marketsForEvents } from "../../providers/odds-batch";
import { OddsQuotaError } from "../../providers/odds-quota";
import { resolveOddsProvider } from "../../providers/odds-registry";
import type { AgentDefinition, AgentResult, Mission } from "../../types";
import { json } from "../../missions/mission";
import { loadCategory, picksToday, recentPickKeys, settledSamples } from "../../sports/data";
import { createBetMission } from "../../sports/missions";
import { addKickoffTriggers } from "../../sports/passage-state";
import { parseSportsSettings } from "../../sports/settings";
import { rankCandidates, type Candidate } from "./select";

/** Matchs examinés au plus par passage (un appel groupé couvre 25 matchs). */
const MAX_EVENTS = 40;

const noPick = (summary: string, extra: Record<string, unknown> = {}): AgentResult => ({ ok: true, output: { noPick: true, noPickReason: summary, ...extra }, summary });

export const agent: AgentDefinition = {
  key: "cotes",
  async run(mission, ctx) {
    if (typeof mission.payload.pickId === "string") return { ok: true, skipped: true, summary: "pari déjà choisi" };
    const category = await loadCategory(ctx.prisma, mission.payload.categoryId as string | undefined);
    if (!category) return { ok: false, error: "Catégorie de paris introuvable.", retryable: false };
    const s = parseSportsSettings(ctx.settings.settings);
    const now = ctx.now();
    const remaining = mission.isTest ? 1 : category.picksPerDay - (await picksToday(ctx.prisma, category.id, now));
    if (remaining <= 0) return noPick(`quota du jour atteint (${category.picksPerDay} paris)`);

    const source = mission.payload.oddsSource === "fake" || mission.isTest ? "fake" : "live";
    const resolved = await resolveOddsProvider(ctx, { source, maxCalls: s.maxApiCallsPerMonth });
    if (!resolved) return noPick("aucune clé de cotes : rien à chercher");
    try {
      const from = new Date(now.getTime() + category.minMinutesBeforeKickoff * 60_000);
      const to = new Date(now.getTime() + s.lookaheadHours * 3_600_000);
      const events = (await resolved.provider.listEvents({ sport: category.sport, leagues: category.leagues, from, to }))
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .slice(0, MAX_EVENTS);
      if (!events.length) return noPick("aucun match à venir dans les ligues de la catégorie");
      const markets = await marketsForEvents(resolved.provider, events.map((e) => e.eventId), category.marketTypes);
      const [recent, samples] = await Promise.all([recentPickKeys(ctx.prisma, now), settledSamples(ctx.prisma, now)]);
      const ranked = rankCandidates({
        events,
        markets,
        criteria: category,
        minMinutesBeforeKickoff: category.minMinutesBeforeKickoff,
        minInterestScore: s.minInterestScore,
        minBookmakers: s.minBookmakers,
        recent,
        samples,
        now,
        source: resolved.source,
      });
      const chosen = ranked.candidates.slice(0, remaining);
      if (!mission.isTest)
        await addKickoffTriggers(ctx, category.id, ranked.candidates.slice(remaining, remaining + 5).map((c) => c.event.startsAt), s.kickoffTriggerHours);
      const stats = `${events.length} matchs, ${ranked.considered} sélections`;
      if (!chosen.length) return noPick(`${stats}, aucun pari intéressant`, { rejected: ranked.rejected });

      const picks = [];
      for (const c of chosen) picks.push(await createPick(ctx, mission, category.id, c));
      // Paris suivants : une mission sœur chacun (même catégorie, même source).
      for (const pick of picks.slice(1)) {
        const r = await createBetMission(ctx, { category, createdBy: mission.isTest ? "HUMAN" : "GRAND_CHEF", isTest: mission.isTest, pickId: pick.id, oddsSource: resolved.source });
        if (r.ok) await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { missionId: r.missionId } });
        else await ctx.prisma.bettingPick.update({ where: { id: pick.id }, data: { status: "SKIPPED", skipReason: `mission non créée : ${r.reason}`.slice(0, 300) } });
      }
      await agentEvent(ctx, "agents.sports.picks", { missionId: mission.id, categoryId: category.id, picks: picks.map((p) => p.id), considered: ranked.considered, rejected: ranked.rejected }, { channelId: mission.channelId });
      const best = chosen[0]!;
      return {
        ok: true,
        output: { pickId: picks[0]!.id, oddsSource: resolved.source },
        summary: `${stats}, ${chosen.length} retenu${chosen.length > 1 ? "s" : ""} (meilleur score ${(best.score * 100).toFixed(1)} %)`,
      };
    } catch (err) {
      if (err instanceof OddsQuotaError) return noPick(err.message, { quotaReached: true });
      throw err;
    }
  },
};

async function createPick(ctx: Parameters<AgentDefinition["run"]>[1], mission: Mission, categoryId: string, c: Candidate) {
  return ctx.prisma.bettingPick.create({
    data: {
      missionId: mission.id,
      categoryId,
      eventId: c.event.eventId,
      homeTeam: c.event.homeTeam,
      awayTeam: c.event.awayTeam,
      league: c.event.leagueId,
      kickoffAt: c.event.startsAt,
      marketId: c.selection.marketId,
      marketLabel: c.selection.marketLabel,
      selectionLabel: c.selection.selectionLabel,
      line: c.selection.line,
      bookmaker: c.bookmaker,
      odds: c.odds,
      consensusOdds: c.reasoning.consensusOdds,
      interestScore: c.score,
      reasoning: json({ ...c.reasoning, eventUrl: c.event.bookmakerLinks?.[c.bookmaker] ?? null }) as never,
      status: "PROPOSED",
    },
  });
}
