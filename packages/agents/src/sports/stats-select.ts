/**
 * Sélection des paris « tirs cadrés » sur statistiques (28 octobre 2026, règle PURE) : quand les sites des bookmakers ne
 * se lisent pas, l'équipe choisit le pari d'après les derniers matchs des deux équipes (API-Football), et l'équipe
 * humaine donne ensuite la cote exacte et la capture (`human-odds.ts`).
 *
 * Pour chaque match à venir :
 * - moyennes sur les 5 derniers matchs joués de chaque équipe : tirs cadrés pour et contre ;
 * - attendu par équipe = (tirs cadrés de l'équipe + tirs cadrés concédés par l'adversaire) / 2 ; total = somme ;
 * - pour chaque ligne « Plus de X,5 » d'un marché de la catégorie (match, domicile, extérieur) : probabilité =
 *   moyenne de la fréquence observée (lissée : (passés + 1) / (matchs + 2)) et d'un modèle de Poisson sur l'attendu ;
 * - cote estimée = 1 / probabilité × (1 − 7 % de marge du bookmaker) : la ligne doit tomber dans la fourchette de cote
 *   de la catégorie (une ligne trop sûre aurait une cote trop basse) ; on garde la plus probable ;
 * - au moins 3 matchs connus par équipe, un seul pari par match, doublons 48 h écartés, délai minimal avant le coup
 *   d'envoi, puis les N meilleurs (probabilité). Le raisonnement chiffré est gardé tel quel (`BettingPick.reasoning`).
 * La cote affichée n'est JAMAIS celle estimée ici : c'est celle que l'équipe lit sur le site du bookmaker.
 */
import { isDuplicatePick, kickoffCheck, type PickKey } from "../rules/bets";

/** Un match passé vu depuis une équipe : tirs cadrés pour et contre. */
export type TeamSample = { fixtureId: number; at: Date; for: number; against: number };

export type StatsMatch = {
  eventId: string;
  leagueId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  home: readonly TeamSample[];
  away: readonly TeamSample[];
};

export type StatsEntity = "all" | "home" | "away";

export type StatsReasoning = {
  source: "stats";
  provider: "apifootball";
  targetBookmaker: string;
  entity: StatsEntity;
  line: number;
  expected: { home: number; away: number; total: number };
  averages: {
    home: { for: number; against: number; matches: number };
    away: { for: number; against: number; matches: number };
  };
  hitRate: { hits: number; n: number };
  observedProbability: number;
  modelProbability: number;
  probability: number;
  estimatedOdds: number;
  score: number;
};

export type StatsCandidate = {
  match: StatsMatch;
  marketId: string;
  marketLabel: string;
  selectionLabel: string;
  line: number;
  reasoning: StatsReasoning;
};

export const STATS_SAMPLE_MATCHES = 5;
export const STATS_MIN_SAMPLES = 3;
/** Marge prise par le bookmaker pour estimer sa cote (7 %). */
export const STATS_BOOKMAKER_MARGIN = 0.07;
/** Lignes essayées (« Plus de X,5 ») par entité. */
const LINES: Record<StatsEntity, readonly number[]> = {
  all: [2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5],
  home: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5],
  away: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5],
};

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const avg = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Marché « tirs cadrés, plus de » d'une entité (identifiant au format des catégories). */
export function statsMarketId(entity: StatsEntity): string {
  return `shots_onGoal-${entity}-game-ou-over`;
}

/** Entités « tirs cadrés, plus de » demandées par les marchés d'une catégorie (pur). Vide : catégorie hors portée. */
export function statsEntitiesOf(marketTypes: readonly string[]): StatsEntity[] {
  const out: StatsEntity[] = [];
  for (const m of marketTypes) {
    const p = m.split("-");
    if (p.length !== 5 || p[0] !== "shots_onGoal" || p[3] !== "ou" || p[4] !== "over") continue;
    const e = p[1] as StatsEntity;
    if ((e === "all" || e === "home" || e === "away") && !out.includes(e)) out.push(e);
  }
  return out;
}

/** P(X > line) pour X ~ Poisson(λ), ligne en demi (pur). */
export function poissonOver(lambda: number, line: number): number {
  if (!(lambda > 0)) return 0;
  const k = Math.floor(line);
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.min(1, Math.max(0, 1 - cdf));
}

/** Ligne « Plus de 7,5 » à la française. */
export function overLabel(line: number): string {
  return `Plus de ${String(line).replace(".", ",")}`;
}

function marketLabelOf(entity: StatsEntity, m: StatsMatch): string {
  if (entity === "home") return `Tirs cadrés de ${m.homeTeam}`;
  if (entity === "away") return `Tirs cadrés de ${m.awayTeam}`;
  return "Tirs cadrés (match)";
}

/** Meilleur pari d'un match (pur) : null si trop peu de matchs connus ou aucune ligne dans la fourchette de cote. */
export function bestStatsPick(
  m: StatsMatch,
  o: { entities: readonly StatsEntity[]; minOdds: number; maxOdds: number; targetBookmaker: string },
): StatsCandidate | null {
  const home = m.home.slice(0, STATS_SAMPLE_MATCHES);
  const away = m.away.slice(0, STATS_SAMPLE_MATCHES);
  if (home.length < STATS_MIN_SAMPLES || away.length < STATS_MIN_SAMPLES) return null;
  const hFor = avg(home.map((s) => s.for));
  const hAg = avg(home.map((s) => s.against));
  const aFor = avg(away.map((s) => s.for));
  const aAg = avg(away.map((s) => s.against));
  const expHome = (hFor + aAg) / 2;
  const expAway = (aFor + hAg) / 2;
  const expected = { home: round(expHome, 1), away: round(expAway, 1), total: round(expHome + expAway, 1) };
  // Échantillons observés par entité : total des matchs des deux équipes (un match commun compté une fois) ; pour une
  // équipe, ses tirs cadrés et ceux concédés par l'adversaire.
  const totals = new Map<number, number>();
  for (const s of [...home, ...away]) if (!totals.has(s.fixtureId)) totals.set(s.fixtureId, s.for + s.against);
  const observed: Record<StatsEntity, number[]> = {
    all: [...totals.values()],
    home: [...home.map((s) => s.for), ...away.map((s) => s.against)],
    away: [...away.map((s) => s.for), ...home.map((s) => s.against)],
  };
  const lambda: Record<StatsEntity, number> = { all: expHome + expAway, home: expHome, away: expAway };
  let best: StatsCandidate | null = null;
  for (const entity of o.entities) {
    for (const line of LINES[entity]) {
      const values = observed[entity];
      const hits = values.filter((v) => v > line).length;
      const pObs = (hits + 1) / (values.length + 2);
      const pModel = poissonOver(lambda[entity], line);
      const p = (pObs + pModel) / 2;
      if (p <= 0) continue;
      const estimatedOdds = round((1 / p) * (1 - STATS_BOOKMAKER_MARGIN));
      if (estimatedOdds < o.minOdds || estimatedOdds > o.maxOdds) continue;
      if (best && p <= best.reasoning.probability) continue;
      best = {
        match: m,
        marketId: statsMarketId(entity),
        marketLabel: marketLabelOf(entity, m),
        selectionLabel: overLabel(line),
        line,
        reasoning: {
          source: "stats",
          provider: "apifootball",
          targetBookmaker: o.targetBookmaker,
          entity,
          line,
          expected,
          averages: {
            home: { for: round(hFor, 1), against: round(hAg, 1), matches: home.length },
            away: { for: round(aFor, 1), against: round(aAg, 1), matches: away.length },
          },
          hitRate: { hits, n: values.length },
          observedProbability: round(pObs, 3),
          modelProbability: round(pModel, 3),
          probability: round(p, 3),
          estimatedOdds,
          score: round(p, 3),
        },
      };
    }
  }
  return best;
}

export type StatsRankInput = {
  matches: readonly StatsMatch[];
  entities: readonly StatsEntity[];
  minOdds: number;
  maxOdds: number;
  targetBookmaker: string;
  minMinutesBeforeKickoff: number;
  recent: ReadonlyArray<PickKey & { at: Date }>;
  now: Date;
};

/** Classement (pur) : un pari par match, doublons et matchs trop proches écartés, les plus probables d'abord. */
export function rankStatsPicks(i: StatsRankInput): { candidates: StatsCandidate[]; considered: number; rejected: Record<string, number> } {
  const rejected: Record<string, number> = {};
  const reject = (why: string) => {
    rejected[why] = (rejected[why] ?? 0) + 1;
  };
  const out: StatsCandidate[] = [];
  for (const m of i.matches) {
    if (!kickoffCheck(m.kickoffAt, i.now, i.minMinutesBeforeKickoff).ok) {
      reject("coup d'envoi trop proche");
      continue;
    }
    const c = bestStatsPick(m, i);
    if (!c) {
      reject(m.home.length < STATS_MIN_SAMPLES || m.away.length < STATS_MIN_SAMPLES ? "trop peu de matchs connus" : "aucune ligne dans la fourchette de cote");
      continue;
    }
    if (isDuplicatePick({ eventId: m.eventId, marketId: c.marketId, selectionLabel: c.selectionLabel, line: c.line }, i.recent, i.now)) {
      reject("pari identique dans les 48 h");
      continue;
    }
    out.push(c);
  }
  out.sort((a, b) => b.reasoning.score - a.reasoning.score || a.match.kickoffAt.getTime() - b.match.kickoffAt.getTime());
  return { candidates: out, considered: i.matches.length, rejected };
}

/** Échantillons d'une équipe (pur) : ses matchs joués avec les tirs cadrés connus, du plus récent au plus ancien. */
export function teamSamples(
  teamId: number,
  fixtures: ReadonlyArray<{ fixtureId: number; kickoffAt: Date; home: { id: number }; away: { id: number } }>,
  shots: ReadonlyMap<number, Record<string, number>>,
): TeamSample[] {
  const out: TeamSample[] = [];
  for (const f of [...fixtures].sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime())) {
    const s = shots.get(f.fixtureId);
    if (!s) continue;
    const opp = f.home.id === teamId ? f.away.id : f.home.id;
    const mine = s[String(teamId)];
    const theirs = s[String(opp)];
    if (typeof mine !== "number" || typeof theirs !== "number") continue;
    out.push({ fixtureId: f.fixtureId, at: f.kickoffAt, for: mine, against: theirs });
  }
  return out.slice(0, STATS_SAMPLE_MATCHES);
}
