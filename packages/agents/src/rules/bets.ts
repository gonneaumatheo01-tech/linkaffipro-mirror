/**
 * Sélection des paris (phase 23), règles PURES et transparentes : probabilité implicite, cote de référence (consensus),
 * probabilité corrigée de la marge, score d'intérêt, critères d'une catégorie, doublons, délai avant le coup d'envoi,
 * vérification de la cote juste avant l'envoi. Aucune prédiction : on compare des cotes entre elles.
 */
import { parseMarketId, TEAM_ENTITIES } from "../sports/labels";
import type { OddsSelection } from "../providers/odds";

/** Probabilité implicite d'une cote décimale (1 ÷ cote) ; null si la cote est invalide. */
export function impliedProbability(odds: number): number | null {
  return Number.isFinite(odds) && odds > 1 ? 1 / odds : null;
}

export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Clé du « marché complet » d'une sélection (les issues qui se partagent 100 %) : plus / moins sur la même ligne,
 * oui / non, ou les 2-3 issues d'un résultat (dont l'entité change d'une issue à l'autre).
 */
export function marketGroupKey(sel: Pick<OddsSelection, "marketId" | "line">): string {
  const p = parseMarketId(sel.marketId);
  if (!p) return sel.marketId;
  if (p.betType === "ml" || p.betType === "ml3way") return `${p.statId}|${p.period}|${p.betType}`;
  return `${p.statId}|${p.entity}|${p.period}|${p.betType}|${sel.line ?? ""}`;
}

/** Nombre d'issues d'un marché complet. */
function sidesExpected(betType: string): number {
  return betType === "ml3way" ? 3 : 2;
}

export type ConsensusMethod = "fairOdds" | "median-demargined" | "median-raw";

export type Consensus = {
  /** Cote de référence affichée : médiane des autres bookmakers (ou de tous s'ils sont moins de 2). */
  consensusOdds: number | null;
  /** Probabilité de référence, corrigée de la marge quand c'est possible. */
  probability: number | null;
  method: ConsensusMethod | null;
  /** Bookmakers comptés dans la référence. */
  bookmakers: number;
  /** Marge moyenne des bookmakers sur ce marché (en %), si calculable. */
  marginPct: number | null;
};

/**
 * Référence d'une sélection. `group` = toutes les sélections du même match (pour retrouver les issues opposées et
 * retirer la marge). Le bookmaker visé est exclu de la référence quand au moins 2 autres cotent la sélection.
 * Ordre : cote « juste » du fournisseur, sinon médiane des probabilités sans marge, sinon médiane brute.
 */
export function consensusOf(sel: OddsSelection, group: readonly OddsSelection[], excludeBookmaker?: string | null): Consensus {
  const all = Object.keys(sel.byBookmaker);
  const others = excludeBookmaker ? all.filter((b) => b !== excludeBookmaker) : all;
  const books = others.length >= 2 ? others : all;
  const odds = books.map((b) => sel.byBookmaker[b]!).filter((o) => o > 1);
  const consensusOdds = median(odds);
  const p = parseMarketId(sel.marketId);
  const key = marketGroupKey(sel);
  const sides = group.filter((g) => marketGroupKey(g) === key);
  const margins: number[] = [];
  const fairProbs: number[] = [];
  if (p && sides.length === sidesExpected(p.betType)) {
    for (const b of books) {
      const inv = sides.map((s) => s.byBookmaker[b]).filter((o): o is number => typeof o === "number" && o > 1).map((o) => 1 / o);
      if (inv.length !== sides.length) continue;
      const total = inv.reduce((a, x) => a + x, 0);
      margins.push((total - 1) * 100);
      fairProbs.push(1 / sel.byBookmaker[b]! / total);
    }
  }
  const marginPct = margins.length ? round(median(margins)!, 2) : null;
  if (sel.fairOdds && sel.fairOdds > 1)
    return { consensusOdds: consensusOdds ? round(consensusOdds, 3) : null, probability: round(1 / sel.fairOdds), method: "fairOdds", bookmakers: odds.length, marginPct };
  if (fairProbs.length)
    return { consensusOdds: consensusOdds ? round(consensusOdds, 3) : null, probability: round(median(fairProbs)!), method: "median-demargined", bookmakers: odds.length, marginPct };
  const raw = median(odds.map((o) => 1 / o));
  return { consensusOdds: consensusOdds ? round(consensusOdds, 3) : null, probability: raw === null ? null : round(raw), method: raw === null ? null : "median-raw", bookmakers: odds.length, marginPct };
}

/** Bornes du score d'intérêt et de l'ajustement par les moyennes récentes. */
export const SCORE_BOUNDS = { min: -1, max: 1 } as const;
export const AVERAGE_ADJUSTMENT_MAX = 0.1;

export type InterestInput = {
  targetOdds: number;
  probability: number;
  /** Moyenne récente de la statistique (tirs cadrés par match sur les derniers matchs…), si connue. */
  recentAverage?: number | null;
  line?: number | null;
  /** over / under / yes / no / home… (seuls over et under sont ajustés par la moyenne). */
  side?: string | null;
};

export type InterestScore = { score: number; valueEdge: number; adjustment: number };

/**
 * Score d'intérêt = cote du bookmaker visé × probabilité de référence − 1 (écart de valeur), ajusté par les moyennes
 * récentes (moyenne au-dessus de la ligne : un « plus de » gagne au plus 0,1, un « moins de » perd autant), borné.
 */
export function interestScore(i: InterestInput): InterestScore {
  const valueEdge = i.targetOdds * i.probability - 1;
  let adjustment = 0;
  if (typeof i.recentAverage === "number" && Number.isFinite(i.recentAverage) && typeof i.line === "number" && (i.side === "over" || i.side === "under")) {
    const gap = (i.recentAverage - i.line) / Math.max(1, Math.abs(i.line));
    adjustment = clamp(gap * 0.5, -AVERAGE_ADJUSTMENT_MAX, AVERAGE_ADJUSTMENT_MAX) * (i.side === "over" ? 1 : -1);
  }
  return {
    score: round(clamp(valueEdge + adjustment, SCORE_BOUNDS.min, SCORE_BOUNDS.max)),
    valueEdge: round(valueEdge),
    adjustment: round(adjustment),
  };
}

/** Critères d'une catégorie (`BetCategory`) utilisés par la sélection. */
export type CategoryCriteria = {
  marketTypes: string[];
  leagues: string[];
  bookmakers: string[];
  minOdds: number;
  maxOdds: number;
};

/**
 * Un identifiant de marché correspond-il à un type de la catégorie ? `PLAYER_ID` (ou `PLAYER`) à la place de l'entité
 * accepte n'importe quel joueur (jamais une équipe ni le total).
 */
export function marketMatches(marketId: string, pattern: string): boolean {
  if (marketId === pattern) return true;
  const a = parseMarketId(marketId);
  const b = parseMarketId(pattern);
  if (!a || !b) return false;
  const anyPlayer = b.entity === "PLAYER_ID" || b.entity === "PLAYER";
  if (anyPlayer ? TEAM_ENTITIES.has(a.entity) : a.entity !== b.entity) return false;
  return a.statId === b.statId && a.period === b.period && a.betType === b.betType && a.side === b.side;
}

export type CriteriaVerdict = { ok: true } | { ok: false; reason: string };

/** Critères appliqués à une sélection chez un bookmaker visé (ligue vide = toutes les ligues). */
export function checkCriteria(
  c: CategoryCriteria,
  x: { leagueId: string; marketId: string; bookmaker: string; odds: number | undefined },
): CriteriaVerdict {
  if (c.leagues.length && !c.leagues.includes(x.leagueId)) return { ok: false, reason: `ligue ${x.leagueId} hors catégorie` };
  if (!c.marketTypes.some((m) => marketMatches(x.marketId, m))) return { ok: false, reason: "marché hors catégorie" };
  if (c.bookmakers.length && !c.bookmakers.includes(x.bookmaker)) return { ok: false, reason: `bookmaker ${x.bookmaker} non visé` };
  if (typeof x.odds !== "number" || !(x.odds > 1)) return { ok: false, reason: `pas de cote chez ${x.bookmaker}` };
  if (!oddsInRange(x.odds, c)) return { ok: false, reason: `cote ${x.odds} hors fourchette ${c.minOdds}-${c.maxOdds}` };
  return { ok: true };
}

export function oddsInRange(odds: number, c: Pick<CategoryCriteria, "minOdds" | "maxOdds">): boolean {
  return odds >= c.minOdds && odds <= c.maxOdds;
}

/** Fenêtre des doublons : même match, même marché, même sélection (et même ligne) publiés dans les 48 h. */
export const DUPLICATE_WINDOW_MS = 48 * 3_600_000;

export type PickKey = { eventId: string; marketId: string; selectionLabel: string; line: number | null };

export function pickKey(p: PickKey): string {
  return `${p.eventId}|${p.marketId}|${p.selectionLabel}|${p.line ?? ""}`;
}

/** Vrai si un pari identique a été publié (ou est en cours) dans les 48 h précédant `now`. */
export function isDuplicatePick(candidate: PickKey, recent: ReadonlyArray<PickKey & { at: Date }>, now: Date): boolean {
  const key = pickKey(candidate);
  return recent.some((r) => pickKey(r) === key && now.getTime() - r.at.getTime() < DUPLICATE_WINDOW_MS);
}

export type KickoffVerdict = { ok: true; minutesLeft: number } | { ok: false; minutesLeft: number; reason: string };

/** Jamais de publication à moins de `minMinutes` du coup d'envoi, ni après. */
export function kickoffCheck(kickoffAt: Date, now: Date, minMinutes: number): KickoffVerdict {
  const minutesLeft = Math.floor((kickoffAt.getTime() - now.getTime()) / 60_000);
  if (minutesLeft <= 0) return { ok: false, minutesLeft, reason: "le match a commencé" };
  if (minutesLeft < minMinutes) return { ok: false, minutesLeft, reason: `coup d'envoi dans ${minutesLeft} min (minimum ${minMinutes} min)` };
  return { ok: true, minutesLeft };
}

export type OddsCheck =
  | { ok: true; current: number; driftPct: number }
  | { ok: false; code: "market_missing" | "drift"; current: number | null; driftPct: number | null; reason: string };

/**
 * Cote re-vérifiée juste avant l'envoi : écart relatif à la cote retenue (5 % toléré par défaut, dans les deux sens) ;
 * marché ou cote disparus = pari écarté.
 */
export function checkOddsDrift(expected: number, current: number | null | undefined, maxDriftPct: number): OddsCheck {
  if (typeof current !== "number" || !(current > 1)) return { ok: false, code: "market_missing", current: null, driftPct: null, reason: "marché ou cote disparus chez le bookmaker" };
  const driftPct = round(((current - expected) / expected) * 100, 2);
  if (Math.abs(driftPct) > maxDriftPct)
    return { ok: false, code: "drift", current, driftPct, reason: `cote passée de ${expected} à ${current} (${driftPct > 0 ? "+" : ""}${driftPct} %, ${maxDriftPct} % tolérés)` };
  return { ok: true, current, driftPct };
}

/** Sélection identique dans une nouvelle lecture du fournisseur (même marché, même ligne). */
export function findSelection(list: readonly OddsSelection[], marketId: string, line: number | null): OddsSelection | null {
  return list.find((s) => s.marketId === marketId && (s.line ?? null) === (line ?? null)) ?? null;
}

/** Statistique d'un match déjà réglé (pour les moyennes récentes). */
export type TeamStatSample = { homeTeam: string; awayTeam: string; at: Date; values: Record<string, number> };

/**
 * Moyenne récente d'une statistique pour un match à venir, tirée des matchs déjà réglés des deux équipes (5 derniers
 * par équipe au plus, 3 au minimum, sinon null). Entité `all` = total du match ; `home` / `away` = l'équipe concernée.
 */
export function recentAverageFor(
  samples: readonly TeamStatSample[],
  q: { homeTeam: string; awayTeam: string; statId: string; entity: string; period: string },
  opts: { perTeam?: number; minSamples?: number } = {},
): { average: number; samples: number } | null {
  const perTeam = opts.perTeam ?? 5;
  const minSamples = opts.minSamples ?? 3;
  const valueFor = (s: TeamStatSample, team: string): number | null => {
    const side = s.homeTeam === team ? "home" : s.awayTeam === team ? "away" : null;
    if (!side) return null;
    const get = (e: string) => s.values[`${q.period}.${e}.${q.statId}`] ?? (q.period === "reg" ? s.values[`game.${e}.${q.statId}`] : undefined);
    if (q.entity === "all") {
      const h = get("home");
      const a = get("away");
      return typeof h === "number" && typeof a === "number" ? h + a : (get("all") ?? null);
    }
    const v = get(side);
    return typeof v === "number" ? v : null;
  };
  const teams = q.entity === "home" ? [q.homeTeam] : q.entity === "away" ? [q.awayTeam] : q.entity === "all" ? [q.homeTeam, q.awayTeam] : [];
  const values: number[] = [];
  for (const team of teams) {
    const own = samples
      .filter((s) => s.homeTeam === team || s.awayTeam === team)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map((s) => valueFor(s, team))
      .filter((v): v is number => typeof v === "number")
      .slice(0, perTeam);
    values.push(...own);
  }
  if (values.length < minSamples) return null;
  return { average: round(values.reduce((a, b) => a + b, 0) / values.length, 2), samples: values.length };
}
