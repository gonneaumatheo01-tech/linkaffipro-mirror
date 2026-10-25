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
import { parseSportsSettings, withTeamBounds } from "../../sports/settings";
import { rankCandidates, type Candidate } from "./select";
import { reasoningSentences } from "../../sports/format";
import { BOOKMAKER_DIRECT, parseDirectEventId } from "../../providers/bookmaker-direct";

/** Matchs examinés au plus par passage (un appel groupé couvre 25 matchs). */
const MAX_EVENTS = 40;
/** Phase 35 : matchs examinés au plus quand les cotes sont lues sur le site du client (une page par match). */
export const MAX_DIRECT_EVENTS = 15;

const noPick = (summary: string, extra: Record<string, unknown> = {}): AgentResult => ({ ok: true, output: { noPick: true, noPickReason: summary, ...extra }, summary });

export const agent: AgentDefinition = {
  key: "cotes",
  async run(mission, ctx) {
    if (typeof mission.payload.pickId === "string") return { ok: true, skipped: true, summary: "pari déjà choisi" };
    const raw = await loadCategory(ctx.prisma, mission.payload.categoryId as string | undefined);
    if (!raw) return { ok: false, error: "Catégorie de paris introuvable.", retryable: false };
    const s = parseSportsSettings(ctx.settings.settings);
    const category = withTeamBounds(raw, s);
    const now = ctx.now();
    // Phase 33 : une sélection d'un ordre de Kevin cherche les paris manquants du jour de l'ordre (`picksWanted`).
    const orderId = typeof mission.payload.orderId === "string" ? mission.payload.orderId : null;
    const wanted = orderId && typeof mission.payload.picksWanted === "number" ? Math.max(1, Math.round(mission.payload.picksWanted)) : null;
    const remaining = wanted ?? (mission.isTest ? 1 : category.picksPerDay - (await picksToday(ctx.prisma, category.id, now)));
    if (remaining <= 0) return noPick(`quota du jour atteint (${category.picksPerDay} paris)`);

    // Pari de test : faux fournisseur ; un ordre sur le canal Test lit les vraies cotes si la clé existe (`oddsSource: live`).
    const source = mission.payload.oddsSource === "fake" || (mission.isTest && !(orderId && mission.payload.oddsSource === "live")) ? "fake" : "live";
    // Phase 35 : bookmaker du client appris (site READY) parmi ceux de la catégorie → ses propres cotes.
    const resolved = await resolveOddsProvider(ctx, { source, maxCalls: s.maxApiCallsPerMonth, bookmakers: category.bookmakers });
    if (!resolved) return noPick("aucune clé de cotes : rien à chercher");
    // Faux fournisseur : décalage des fixtures gardé dans le pari (mêmes heures de match aux étapes suivantes).
    const shift = (resolved.provider as { shiftMs?: unknown }).shiftMs;
    const fakeShiftMs = typeof shift === "number" ? shift : null;
    try {
      const from = new Date(now.getTime() + category.minMinutesBeforeKickoff * 60_000);
      const to = new Date(now.getTime() + s.lookaheadHours * 3_600_000);
      const events = (await resolved.provider.listEvents({ sport: category.sport, leagues: category.leagues, from, to }))
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        // Lecture directe d'un site : une fiche de match par lecture, au rythme humain (moins de matchs examinés).
        .slice(0, resolved.provider.name === BOOKMAKER_DIRECT ? MAX_DIRECT_EVENTS : MAX_EVENTS);
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
      if (!mission.isTest && !orderId)
        await addKickoffTriggers(ctx, category.id, ranked.candidates.slice(remaining, remaining + 5).map((c) => c.event.startsAt), s.kickoffTriggerHours);
      const stats = `${events.length} matchs, ${ranked.considered} sélections`;
      if (!chosen.length) return noPick(`${stats}, aucun pari intéressant`, { rejected: ranked.rejected });

      const picks = [];
      for (const c of chosen) picks.push(await createPick(ctx, mission, category.id, c, fakeShiftMs));
      // Paris suivants : une mission sœur chacun (même catégorie, même source).
      for (const pick of picks.slice(1)) {
        const targets = Array.isArray(mission.payload.targetChannelIds) ? (mission.payload.targetChannelIds as string[]) : null;
        const r = await createBetMission(ctx, {
          category,
          createdBy: mission.isTest || orderId ? "HUMAN" : "GRAND_CHEF",
          isTest: mission.isTest,
          pickId: pick.id,
          oddsSource: resolved.source,
          ...(orderId ? { orderId, channelIds: targets, createdById: await missionCreator(ctx, mission.id), planDay: await missionPlanDay(ctx, mission.id) } : {}),
        });
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

async function missionCreator(ctx: Parameters<AgentDefinition["run"]>[1], missionId: string): Promise<string | null> {
  return ((await ctx.prisma.agentMission.findUnique({ where: { id: missionId }, select: { createdById: true } })) as { createdById: string | null } | null)?.createdById ?? null;
}

async function missionPlanDay(ctx: Parameters<AgentDefinition["run"]>[1], missionId: string): Promise<string | null> {
  return ((await ctx.prisma.agentMission.findUnique({ where: { id: missionId }, select: { planDay: true } })) as { planDay: string | null } | null)?.planDay ?? null;
}

async function createPick(ctx: Parameters<AgentDefinition["run"]>[1], mission: Mission, categoryId: string, c: Candidate, fakeShiftMs: number | null) {
  // Phase 35 : pari choisi sur les cotes du site du client (match du site, bookmaker = le site).
  const direct = parseDirectEventId(c.event.eventId);
  return ctx.prisma.bettingPick.create({
    data: {
      ...(direct ? { siteKey: direct.siteKey, siteEventId: direct.siteEventId } : {}),
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
      reasoning: json({
        ...c.reasoning,
        // Noms lus par la fiche du site (chantier C).
        edge: c.reasoning.valueEdge,
        consensusProb: c.reasoning.consensusProbability,
        bookmakerCount: c.reasoning.bookmakers,
        averages: c.reasoning.recentAverage !== null ? { home: null, away: null, total: c.reasoning.recentAverage, matches: c.reasoning.recentSamples, stat: c.selection.marketId.split("-")[0] } : null,
        lines: reasoningSentences({ bookmaker: c.bookmaker, odds: c.odds, marketId: c.selection.marketId, reasoning: c.reasoning }),
        summary: reasoningSentences({ bookmaker: c.bookmaker, odds: c.odds, marketId: c.selection.marketId, reasoning: c.reasoning }).join(" "),
        fakeShiftMs,
        eventUrl: c.event.bookmakerLinks?.[c.bookmaker] ?? null,
        ...(direct ? { oddsProvider: BOOKMAKER_DIRECT, siteKey: direct.siteKey, flags: c.reasoning.unusualOdds ? ["cote inhabituelle"] : [] } : {}),
      }) as never,
      status: "PROPOSED",
    },
  });
}
