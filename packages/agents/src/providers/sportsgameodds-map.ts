/**
 * Lecture des réponses SportsGameOdds v2 (documentation officielle relue le 23 octobre 2026), fonctions PURES :
 * événement → `OddsEvent`, cotes → `OddsSelection` (cotes américaines converties en décimal, une sélection par ligne
 * quand les bookmakers n'ont pas tous la même), résultats → `OddsResult`. Tout champ absent ou inconnu est toléré.
 */
import type { OddsEvent, OddsResult, OddsSelection } from "./odds";
import { marketLabelOf, selectionLabelOf } from "../sports/labels";
import { marketMatches } from "../rules/bets";

export type SgoBookmakerOdds = { odds?: unknown; available?: unknown; overUnder?: unknown; spread?: unknown; lastUpdatedAt?: unknown; deeplink?: unknown };

export type SgoOdd = {
  oddID?: string;
  marketName?: string;
  statID?: string;
  statEntityID?: string;
  periodID?: string;
  betTypeID?: string;
  sideID?: string;
  playerID?: string;
  fairOdds?: unknown;
  bookOdds?: unknown;
  bookOverUnder?: unknown;
  fairOverUnder?: unknown;
  bookSpread?: unknown;
  fairSpread?: unknown;
  score?: unknown;
  byBookmaker?: Record<string, SgoBookmakerOdds>;
};

type Names = { long?: string; medium?: string; short?: string };

export type SgoEvent = {
  eventID: string;
  sportID?: string;
  leagueID?: string;
  teams?: { home?: { names?: Names }; away?: { names?: Names } };
  status?: { startsAt?: string; finalized?: boolean; cancelled?: boolean; ended?: boolean; completed?: boolean };
  links?: { bookmakers?: Record<string, string> };
  players?: Record<string, { name?: string; firstName?: string; lastName?: string }>;
  odds?: Record<string, SgoOdd>;
  results?: Record<string, Record<string, Record<string, unknown>>>;
};

export type SgoResponse<T> = { success?: boolean; data?: T; error?: string; nextCursor?: string | null };

/** Cote américaine (« -110 », « +150 », 150) → décimale (1,909 ; 2,5) ; null si illisible. */
export function americanToDecimal(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim().replace(/^\+/, "")) : NaN;
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  const d = n > 0 ? 1 + n / 100 : 1 + 100 / -n;
  return Math.round(d * 1000) / 1000;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function teamName(n: Names | undefined, fallback: string): string {
  return n?.long || n?.medium || n?.short || fallback;
}

/**
 * Match du fournisseur → `OddsEvent`. Sans les noms des deux équipes : `null` (un pari « Domicile – Extérieur » ne se
 * retrouve pas chez le bookmaker et ne se publie pas).
 */
export function mapEvent(e: SgoEvent): OddsEvent | null {
  const startsAt = e.status?.startsAt ? new Date(e.status.startsAt) : null;
  if (!e.eventID || !startsAt || Number.isNaN(startsAt.getTime())) return null;
  const homeTeam = teamName(e.teams?.home?.names, "").trim();
  const awayTeam = teamName(e.teams?.away?.names, "").trim();
  if (!homeTeam || !awayTeam) return null;
  return {
    eventId: e.eventID,
    leagueId: e.leagueID ?? "",
    homeTeam,
    awayTeam,
    startsAt,
    ...(e.links?.bookmakers ? { bookmakerLinks: { ...e.links.bookmakers } } : {}),
  };
}

function oddIdOf(key: string, o: SgoOdd): string {
  if (o.oddID) return o.oddID;
  if (o.statID && o.statEntityID && o.periodID && o.betTypeID && o.sideID) return `${o.statID}-${o.statEntityID}-${o.periodID}-${o.betTypeID}-${o.sideID}`;
  return key;
}

function playerName(e: SgoEvent, id: string): string | null {
  const p = e.players?.[id];
  if (!p) return null;
  return p.name || [p.firstName, p.lastName].filter(Boolean).join(" ") || null;
}

/**
 * Sélections d'un événement pour les types de marchés demandés (liste vide = tous). Ligne propre à chaque bookmaker
 * (`overUnder` / `spread`) : une sélection par ligne, la cote « juste » ne vaut que pour la ligne principale.
 */
export function mapSelections(e: SgoEvent, marketTypes: readonly string[]): OddsSelection[] {
  const teams = { homeTeam: teamName(e.teams?.home?.names, "Domicile"), awayTeam: teamName(e.teams?.away?.names, "Extérieur") };
  const out: OddsSelection[] = [];
  for (const [key, o] of Object.entries(e.odds ?? {})) {
    const marketId = oddIdOf(key, o);
    if (marketTypes.length && !marketTypes.some((m) => marketMatches(marketId, m))) continue;
    const isSpread = o.betTypeID === "sp" || /-sp-/.test(marketId);
    const mainLine = isSpread ? num(o.bookSpread ?? o.fairSpread) : num(o.bookOverUnder ?? o.fairOverUnder);
    const byLine = new Map<string, { line: number | null; books: Record<string, number> }>();
    for (const [bk, b] of Object.entries(o.byBookmaker ?? {})) {
      if (b?.available === false) continue;
      const dec = americanToDecimal(b?.odds);
      if (dec === null) continue;
      const line = num(isSpread ? b?.spread : b?.overUnder) ?? mainLine;
      const k = String(line);
      const g = byLine.get(k) ?? { line, books: {} };
      g.books[bk] = dec;
      byLine.set(k, g);
    }
    const name = o.playerID ? playerName(e, o.playerID) : o.statEntityID ? playerName(e, o.statEntityID) : null;
    for (const g of byLine.values()) {
      out.push({
        marketId,
        marketLabel: marketLabelOf(marketId, { ...teams, playerName: name }),
        selectionLabel: selectionLabelOf(marketId, g.line, { ...teams, playerName: name }),
        line: g.line,
        byBookmaker: g.books,
        fairOdds: g.line === mainLine ? americanToDecimal(o.fairOdds) : null,
      });
    }
  }
  return out;
}

/** Résultats : statistiques à plat (`<période>.<entité>.<stat>`), score final, valeur finale de chaque marché. */
export function mapResult(e: SgoEvent): OddsResult {
  const stats: Record<string, number> = {};
  for (const [period, byEntity] of Object.entries(e.results ?? {})) {
    if (!byEntity || typeof byEntity !== "object") continue;
    for (const [entity, values] of Object.entries(byEntity)) {
      if (!values || typeof values !== "object") continue;
      for (const [stat, v] of Object.entries(values)) {
        const n = num(v);
        if (n !== null) stats[`${period}.${entity}.${stat}`] = n;
      }
    }
  }
  const marketScores: Record<string, number> = {};
  for (const [key, o] of Object.entries(e.odds ?? {})) {
    const s = num(o.score);
    if (s !== null) marketScores[oddIdOf(key, o)] = s;
  }
  const score = (side: "home" | "away") => stats[`game.${side}.points`] ?? stats[`reg.${side}.points`] ?? null;
  const finalized = e.status?.finalized === true || e.status?.completed === true;
  return {
    eventId: e.eventID,
    finalized,
    cancelled: e.status?.cancelled === true,
    homeScore: score("home"),
    awayScore: score("away"),
    marketScores,
    stats,
  };
}
