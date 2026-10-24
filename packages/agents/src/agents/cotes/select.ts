/**
 * Classement des paris candidats (agent Cotes et sélection, règle PURE) : pour chaque match et chaque sélection, chez
 * chaque bookmaker visé par la catégorie : critères, référence des autres bookmakers, score d'intérêt (ajusté par les
 * moyennes récentes connues), doublons 48 h écartés, un seul pari par match, puis les N meilleurs. Le raisonnement
 * chiffré de chaque candidat est gardé tel quel (`BettingPick.reasoning`).
 */
import type { OddsEvent, OddsSelection } from "../../providers/odds";
import {
  checkCriteria,
  consensusOf,
  impliedProbability,
  interestScore,
  isDuplicatePick,
  isQuarterLine,
  kickoffCheck,
  recentAverageFor,
  type CategoryCriteria,
  type ConsensusMethod,
  type PickKey,
  type TeamStatSample,
} from "../../rules/bets";
import { parseMarketId } from "../../sports/labels";

export type PickReasoning = {
  source: "fake" | "live";
  targetBookmaker: string;
  targetOdds: number;
  consensusOdds: number | null;
  consensusProbability: number;
  impliedProbability: number;
  method: ConsensusMethod;
  bookmakers: number;
  marginPct: number | null;
  valueEdge: number;
  adjustment: number;
  score: number;
  recentAverage: number | null;
  recentSamples: number;
  line: number | null;
  /** Faux fournisseur : décalage des fixtures, pour relire les mêmes heures de match ensuite. */
  fakeShiftMs?: number | null;
};

export type Candidate = {
  event: OddsEvent;
  selection: OddsSelection;
  bookmaker: string;
  odds: number;
  score: number;
  reasoning: PickReasoning;
};

export type RankInput = {
  events: readonly OddsEvent[];
  markets: ReadonlyMap<string, readonly OddsSelection[]>;
  criteria: CategoryCriteria;
  minMinutesBeforeKickoff: number;
  minInterestScore: number;
  minBookmakers: number;
  recent: ReadonlyArray<PickKey & { at: Date }>;
  samples?: readonly TeamStatSample[];
  now: Date;
  source: "fake" | "live";
};

export type RankResult = { candidates: Candidate[]; considered: number; rejected: Record<string, number> };

export function rankCandidates(i: RankInput): RankResult {
  const rejected: Record<string, number> = {};
  const reject = (why: string) => (rejected[why] = (rejected[why] ?? 0) + 1);
  const best = new Map<string, Candidate>();
  let considered = 0;
  for (const event of i.events) {
    if (!kickoffCheck(event.startsAt, i.now, i.minMinutesBeforeKickoff).ok) {
      reject("coup d'envoi trop proche");
      continue;
    }
    const group = i.markets.get(event.eventId) ?? [];
    for (const sel of group) {
      considered++;
      const key: PickKey = { eventId: event.eventId, marketId: sel.marketId, selectionLabel: sel.selectionLabel, line: sel.line };
      if (isQuarterLine(sel.line)) {
        reject("ligne asiatique en quart");
        continue;
      }
      if (isDuplicatePick(key, i.recent, i.now)) {
        reject("déjà publié dans les 48 h");
        continue;
      }
      const targets = i.criteria.bookmakers.length ? i.criteria.bookmakers : Object.keys(sel.byBookmaker);
      for (const bookmaker of targets) {
        const odds = sel.byBookmaker[bookmaker];
        const ok = checkCriteria(i.criteria, { leagueId: event.leagueId, marketId: sel.marketId, bookmaker, odds });
        if (!ok.ok) {
          reject(ok.reason.startsWith("cote ") ? "cote hors fourchette" : ok.reason.startsWith("pas de cote") ? "bookmaker sans cote" : ok.reason);
          continue;
        }
        if (Object.keys(sel.byBookmaker).length < i.minBookmakers) {
          reject("trop peu de bookmakers");
          continue;
        }
        const c = consensusOf(sel, group, bookmaker);
        if (c.probability === null || c.method === null) {
          reject("aucune référence");
          continue;
        }
        const p = parseMarketId(sel.marketId);
        const avg =
          p && i.samples?.length
            ? recentAverageFor(i.samples, { homeTeam: event.homeTeam, awayTeam: event.awayTeam, statId: p.statId, entity: p.entity, period: p.period })
            : null;
        const s = interestScore({ targetOdds: odds!, probability: c.probability, recentAverage: avg?.average ?? null, line: sel.line, side: p?.side ?? null });
        if (s.score < i.minInterestScore) {
          reject("score trop faible");
          continue;
        }
        const cand: Candidate = {
          event,
          selection: sel,
          bookmaker,
          odds: odds!,
          score: s.score,
          reasoning: {
            source: i.source,
            targetBookmaker: bookmaker,
            targetOdds: odds!,
            consensusOdds: c.consensusOdds,
            consensusProbability: c.probability,
            impliedProbability: Math.round(impliedProbability(odds!)! * 10_000) / 10_000,
            method: c.method,
            bookmakers: c.bookmakers,
            marginPct: c.marginPct,
            valueEdge: s.valueEdge,
            adjustment: s.adjustment,
            score: s.score,
            recentAverage: avg?.average ?? null,
            recentSamples: avg?.samples ?? 0,
            line: sel.line,
          },
        };
        // Un seul pari par match : le meilleur.
        const prev = best.get(event.eventId);
        if (!prev || cand.score > prev.score) best.set(event.eventId, cand);
      }
    }
  }
  const candidates = [...best.values()].sort((a, b) => b.score - a.score || a.event.startsAt.getTime() - b.event.startsAt.getTime());
  return { candidates, considered, rejected };
}
