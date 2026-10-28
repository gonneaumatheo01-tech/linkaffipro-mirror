/**
 * Phase 35 : fournisseur de cotes `bookmaker-direct` — le contrat `OddsProvider` rempli par le lecteur des bookmakers du
 * client (Celsius, Sportaza, Bet Portal…), sites `READY` seulement :
 * - `listEvents` : matchs de chaque site (cache 20 min, sinon lecture) ; identifiant `bm:<site>:<match du site>` ;
 *   correspondance avec le match de SportsGameOdds (équipes normalisées + coup d'envoi ± 15 min, `match.ts`) écrite
 *   dans `BookmakerEvent.oddsEventId` au moment de la lecture (résultats, ligue, comparaison) ;
 * - `getMarkets` : cotes du site (cache 3 min, sinon lecture) ; `byBookmaker = { <site>: cote }` (la SEULE cote
 *   jouable) ; noms du marché et de la sélection = ceux du site ; `fairOdds` et cotes des autres bookmakers
 *   (`referenceBookmakers`, comparaison seulement, jamais une cible) depuis SportsGameOdds si disponible ;
 * - `getResult` : délégué à SportsGameOdds par la correspondance ; sans correspondance : null (le règlement attend) ;
 * - `listBookmakers` : sites READY.
 * Aucune cote inventée : une sélection que la recette ne sait pas traduire n'existe pas pour l'équipe.
 */
import { BOOKMAKER_LIMITS } from "../bookmakers/contract";
import { readEventsStored, readMarketsStored, storedEvent, storedEvents, type StoredEvent } from "../bookmakers/read";
import type { BookmakerReadDeps } from "../bookmakers/read/deps";
import { leagueLabel } from "../sports/labels";
import { textMentionsTeam } from "./screenshot/match";
import { fold } from "./screenshot/errors";
import type { OddsEvent, OddsProvider, OddsResult, OddsSelection } from "./odds";
import type { BatchOddsProvider } from "./odds-batch";

export const BOOKMAKER_DIRECT = "bookmaker-direct" as const;
export const DIRECT_EVENT_PREFIX = "bm:";

export type BookmakerDirectDeps = BookmakerReadDeps & {
  /** SportsGameOdds (résultats, consensus, ligues) ; null = sans comparaison. */
  sgo?: OddsProvider | null;
  /** Sites à lire (sinon tous les sites READY actifs). */
  sites?: string[];
};

export type BookmakerDirectProvider = BatchOddsProvider & { name: typeof BOOKMAKER_DIRECT; sites(): Promise<string[]> };

export function directEventId(siteKey: string, siteEventId: string): string {
  return `${DIRECT_EVENT_PREFIX}${siteKey}:${siteEventId}`;
}

/** `bm:<site>:<id>` → parties ; null si ce n'est pas un match lu directement. Pur. */
export function parseDirectEventId(eventId: string): { siteKey: string; siteEventId: string } | null {
  if (!eventId.startsWith(DIRECT_EVENT_PREFIX)) return null;
  const rest = eventId.slice(DIRECT_EVENT_PREFIX.length);
  const i = rest.indexOf(":");
  if (i <= 0 || i === rest.length - 1) return null;
  return { siteKey: rest.slice(0, i), siteEventId: rest.slice(i + 1) };
}

export async function readySites(deps: Pick<BookmakerReadDeps, "prisma">, among?: readonly string[] | null): Promise<string[]> {
  const rows = (await deps.prisma.bookmakerSite.findMany({ where: { status: "READY", isActive: true, readTarget: { not: "human" }, ...(among?.length ? { key: { in: [...among] } } : {}) } })) as Array<{ key: string }>;
  return rows.map((r) => r.key).sort();
}

const sameTeam = (a: string, b: string) => textMentionsTeam(a, b) || textMentionsTeam(b, a);

/** Match du fournisseur de résultats qui correspond (deux équipes + coup d'envoi ± 15 min, un seul candidat). Pur. */
export function matchOddsEvent(e: Pick<StoredEvent, "homeTeam" | "awayTeam" | "startsAt">, candidates: readonly OddsEvent[]): OddsEvent | null {
  const hits = candidates.filter(
    (c) => Math.abs(c.startsAt.getTime() - e.startsAt.getTime()) <= BOOKMAKER_LIMITS.kickoffMatchToleranceMs && sameTeam(e.homeTeam, c.homeTeam) && sameTeam(e.awayTeam, c.awayTeam),
  );
  return hits.length === 1 ? hits[0]! : null;
}

const LEAGUE_ALIASES: Record<string, string[]> = {
  EPL: ["premier league", "angleterre premier league", "england premier league"],
  LA_LIGA: ["liga", "la liga", "laliga", "primera division", "espagne liga"],
  BUNDESLIGA: ["bundesliga", "allemagne bundesliga"],
  IT_SERIE_A: ["serie a", "italie serie a"],
  FR_LIGUE_1: ["ligue 1", "france ligue 1", "ligue 1 mcdonald s", "ligue 1 uber eats"],
  UEFA_CHAMPIONS_LEAGUE: ["ligue des champions", "champions league", "uefa champions league"],
  UEFA_EUROPA_LEAGUE: ["ligue europa", "europa league", "uefa europa league"],
};

const lf = (s: string) => fold(s).replace(/[^a-z0-9]+/g, " ").trim();

/** Ligue du site → identifiant de ligue du fournisseur (nom exact ou alias connu) ; null si inconnue. Pur. */
export function leagueKeyOf(league: string): string | null {
  const n = lf(league);
  if (!n) return null;
  for (const [id, names] of Object.entries(LEAGUE_ALIASES)) if ([lf(leagueLabel(id)), ...names].some((x) => n === x || n.endsWith(` ${x}`))) return id;
  return null;
}

/** Le match est-il dans les ligues demandées (identifiants du fournisseur ou noms du site) ? Liste vide = toutes. */
export function inLeagues(e: Pick<StoredEvent, "league" | "leagueKey">, leagues: readonly string[]): boolean {
  if (!leagues.length) return true;
  return leagues.some((l) => l === e.leagueKey || (lf(l) !== "" && lf(l) === lf(e.league)));
}

export function createBookmakerDirectProvider(deps: BookmakerDirectDeps): BookmakerDirectProvider {
  const sites = async () => readySites(deps, deps.sites ?? null);

  async function linkToSgo(siteKey: string, events: StoredEvent[], q: { sport: string; from: Date; to: Date }): Promise<StoredEvent[]> {
    const todo = events.filter((e) => !e.oddsEventId);
    if (!deps.sgo || !todo.length) return events;
    let candidates: OddsEvent[] = [];
    try {
      candidates = await deps.sgo.listEvents({ sport: q.sport, leagues: [], from: new Date(q.from.getTime() - 3_600_000), to: new Date(q.to.getTime() + 3_600_000) });
    } catch (err) {
      deps.logger?.warn({ err: (err as Error).message }, "[bookmakers] correspondance avec le fournisseur de résultats impossible");
      return events;
    }
    const out: StoredEvent[] = [];
    for (const e of events) {
      if (e.oddsEventId) {
        out.push(e);
        continue;
      }
      const m = matchOddsEvent(e, candidates);
      if (!m) {
        out.push(e);
        continue;
      }
      const leagueKey = e.leagueKey ?? (m.leagueId || null);
      await deps.prisma.bookmakerEvent.update({ where: { siteKey_siteEventId: { siteKey, siteEventId: e.siteEventId } }, data: { oddsEventId: m.eventId, leagueKey } });
      out.push({ ...e, oddsEventId: m.eventId, leagueKey });
    }
    return out;
  }

  async function withLeagueKeys(siteKey: string, events: StoredEvent[]): Promise<StoredEvent[]> {
    const out: StoredEvent[] = [];
    for (const e of events) {
      if (e.leagueKey) {
        out.push(e);
        continue;
      }
      const k = leagueKeyOf(e.league);
      if (k) await deps.prisma.bookmakerEvent.update({ where: { siteKey_siteEventId: { siteKey, siteEventId: e.siteEventId } }, data: { leagueKey: k } });
      out.push({ ...e, leagueKey: k });
    }
    return out;
  }

  const toOddsEvent = (siteKey: string, e: StoredEvent): OddsEvent => ({
    eventId: directEventId(siteKey, e.siteEventId),
    leagueId: e.leagueKey ?? e.league,
    homeTeam: e.homeTeam,
    awayTeam: e.awayTeam,
    startsAt: e.startsAt,
    ...(e.url ? { bookmakerLinks: { [siteKey]: e.url } } : {}),
  });

  async function markets(eventId: string, marketTypes: string[], fresh: boolean): Promise<OddsSelection[]> {
    const id = parseDirectEventId(eventId);
    if (!id) return [];
    const rows = await readMarketsStored(deps, id.siteKey, id.siteEventId, marketTypes, { fresh });
    const ev = await storedEvent(deps, id.siteKey, id.siteEventId);
    // Consensus du fournisseur (même marché, même ligne), pour comparer : jamais une cote jouable.
    let reference: OddsSelection[] = [];
    if (deps.sgo && ev?.oddsEventId) {
      const types = [...new Set(rows.map((r) => r.selectionKey).filter((x): x is string => !!x))];
      try {
        reference = types.length ? await deps.sgo.getMarkets(ev.oddsEventId, types) : [];
      } catch (err) {
        deps.logger?.warn({ err: (err as Error).message }, "[bookmakers] consensus indisponible");
      }
    }
    const out = new Map<string, OddsSelection>();
    for (const r of rows) {
      if (!r.selectionKey) continue;
      const key = `${r.selectionKey}|${r.line ?? ""}`;
      if (out.has(key)) continue;
      const ref = reference.find((s) => s.marketId === r.selectionKey && (s.line ?? null) === (r.line ?? null));
      const others = ref ? Object.fromEntries(Object.entries(ref.byBookmaker).filter(([b]) => b !== id.siteKey)) : {};
      out.set(key, {
        marketId: r.selectionKey,
        marketLabel: r.marketSite,
        selectionLabel: r.selectionSite,
        line: r.line,
        byBookmaker: { [id.siteKey]: r.odds },
        fairOdds: ref?.fairOdds ?? null,
        ...(Object.keys(others).length ? { referenceBookmakers: others } : {}),
      });
    }
    return [...out.values()];
  }

  return {
    name: BOOKMAKER_DIRECT,
    sites,
    async listEvents(q) {
      const out: OddsEvent[] = [];
      for (const siteKey of await sites()) {
        let events: StoredEvent[];
        try {
          events = await readEventsStored(deps, siteKey, { from: q.from, to: q.to });
        } catch (err) {
          deps.logger?.warn({ err: (err as Error).message, siteKey }, "[bookmakers] matchs non lus");
          continue;
        }
        events = await withLeagueKeys(siteKey, await linkToSgo(siteKey, events, q));
        for (const e of events) if (e.startsAt >= q.from && e.startsAt <= q.to && inLeagues(e, q.leagues)) out.push(toOddsEvent(siteKey, e));
      }
      return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    },
    getMarkets: (eventId, marketTypes) => markets(eventId, marketTypes, false),
    getMarketsFresh: (eventId, marketTypes) => markets(eventId, marketTypes, true),
    async getMarketsMany(eventIds, marketTypes) {
      const out = new Map<string, OddsSelection[]>();
      for (const id of eventIds) {
        try {
          out.set(id, await markets(id, marketTypes, false));
        } catch (err) {
          deps.logger?.warn({ err: (err as Error).message, eventId: id }, "[bookmakers] cotes non lues");
          out.set(id, []);
        }
      }
      return out;
    },
    async getResult(eventId): Promise<OddsResult | null> {
      const id = parseDirectEventId(eventId);
      if (!id || !deps.sgo) return null;
      let ev = await storedEvent(deps, id.siteKey, id.siteEventId);
      if (!ev) return null;
      // Correspondance absente à la lecture : un nouvel essai autour du coup d'envoi.
      if (!ev.oddsEventId) {
        const [linked] = await linkToSgo(id.siteKey, [ev], { sport: "SOCCER", from: ev.startsAt, to: ev.startsAt });
        ev = linked ?? ev;
      }
      if (!ev.oddsEventId) return null;
      const r = await deps.sgo.getResult(ev.oddsEventId);
      return r ? { ...r, eventId } : null;
    },
    async listBookmakers() {
      return sites();
    },
  };
}

/** Matchs déjà lus d'un site (cache, sans lecture) au format commun (page Agents, Kevin). */
export async function cachedDirectEvents(deps: Pick<BookmakerReadDeps, "prisma">, siteKey: string, q: { from: Date; to: Date }): Promise<OddsEvent[]> {
  return (await storedEvents(deps, siteKey, q)).map((e) => ({ eventId: directEventId(siteKey, e.siteEventId), leagueId: e.leagueKey ?? e.league, homeTeam: e.homeTeam, awayTeam: e.awayTeam, startsAt: e.startsAt }));
}

