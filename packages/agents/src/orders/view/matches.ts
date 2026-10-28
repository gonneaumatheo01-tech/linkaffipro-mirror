/**
 * Phase 33, chantier C — « quels matchs sont chez <bookmaker> ? ». Aucune liste de bookmakers écrite à la main :
 * - un fournisseur de cotes du registre qui COUVRE ce bookmaker (couverture lue par `listBookmakers()` du fournisseur,
 *   une fois par processus et par jour) → matchs de la date, groupés par ligue, avec le nombre de marchés chez ce
 *   bookmaker ;
 * - sinon → Kevin le dit, sans deviner de cotes (les sites des bookmakers ne sont jamais lus, 28 octobre 2026).
 * Un fournisseur n'est jamais interrogé pour un bookmaker qu'il ne couvre pas (`deps.oddsProviders`, ou le registre).
 */
import { nowOf } from "../../admin/journal";
import { marketsForEvents } from "../../providers/odds-batch";
import type { OddsEvent, OddsProvider } from "../../providers/odds";
import { OddsQuotaError, oddsCallsThisMonth } from "../../providers/odds-quota";
import { hasOddsKey, resolveOddsProvider, type OddsResolveDeps } from "../../providers/odds-registry";
import { parisDay } from "../../rules/time";
import { bookmakerLabel, leagueLabel } from "../../sports/labels";
import { parseSportsSettings } from "../../sports/settings";
import type { AgentsDeps } from "../../types";
import { dayLabel, hourLabel, readTeamState, slotRange, type DaySlot, type ViewResult } from "./common";

/** Fournisseurs supplémentaires, en plus de celui du registre. */
export type MatchesDeps = OddsResolveDeps & { oddsProviders?: OddsProvider[] | null };

export type BookmakerMatch = { eventId: string; leagueId: string; homeTeam: string; awayTeam: string; startsAt: Date; markets: number };

/** Clé de comparaison d'un bookmaker (« 5Gringos » → « 5gringos », « William Hill » → « williamhill »). */
export function bookKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const SPORTS: Record<string, string> = {
  foot: "SOCCER",
  football: "SOCCER",
  soccer: "SOCCER",
  basket: "BASKETBALL",
  basketball: "BASKETBALL",
  nba: "BASKETBALL",
  tennis: "TENNIS",
  hockey: "HOCKEY",
  nhl: "HOCKEY",
  rugby: "RUGBY",
  nfl: "FOOTBALL",
  footballamericain: "FOOTBALL",
  baseball: "BASEBALL",
  mlb: "BASEBALL",
};
const SPORT_LABELS: Record<string, string> = { SOCCER: "foot", BASKETBALL: "basket", TENNIS: "tennis", HOCKEY: "hockey", RUGBY: "rugby", FOOTBALL: "foot américain", BASEBALL: "baseball" };

/** Sport en français → identifiant du fournisseur (pur) ; null si inconnu. Absent = foot. */
export function sportIdOf(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return "SOCCER";
  const k = bookKey(raw);
  if (SPORTS[k]) return SPORTS[k]!;
  const up = raw.trim().toUpperCase();
  return Object.values(SPORTS).includes(up) ? up : null;
}

/** Couverture des fournisseurs : `listBookmakers()` lu une fois par jour et par fournisseur (au premier usage). */
const COVERAGE_TTL_MS = 24 * 3_600_000;
const coverage = new WeakMap<OddsProvider, { at: number; books: Set<string> }>();

export function resetMatchCoverage(provider?: OddsProvider): void {
  if (provider) coverage.delete(provider);
}

async function coveredBooks(provider: OddsProvider, now: Date, logger?: AgentsDeps["logger"]): Promise<Set<string>> {
  const hit = coverage.get(provider);
  if (hit && now.getTime() - hit.at < COVERAGE_TTL_MS) return hit.books;
  try {
    const books = new Set((await provider.listBookmakers()).map(bookKey).filter(Boolean));
    coverage.set(provider, { at: now.getTime(), books });
    return books;
  } catch (err) {
    logger?.warn({ err: (err as Error).message, provider: provider.name }, "[vues] couverture des bookmakers illisible");
    return new Set();
  }
}

/** Fournisseurs de cotes disponibles (le registre, plus ceux injectés), jamais le faux fournisseur hors tests. */
async function matchSources(deps: MatchesDeps): Promise<Array<{ provider: OddsProvider; source: "fake" | "live" }>> {
  const out: Array<{ provider: OddsProvider; source: "fake" | "live" }> = [];
  for (const p of deps.oddsProviders ?? []) out.push({ provider: p, source: p.name === "fake" ? "fake" : "live" });
  const forced = deps.providers?.odds as OddsProvider | null | undefined;
  if (forced || (await hasOddsKey(deps.prisma))) {
    const s = parseSportsSettings((await readTeamState(deps, "sports")).settings.settings);
    const r = await resolveOddsProvider(deps, { source: null, maxCalls: s.maxApiCallsPerMonth });
    if (r && !out.some((x) => x.provider === r.provider)) out.push(r);
  }
  return out;
}

export type ViewMatchesInput = { bookmaker: string; day?: string | null; slot?: DaySlot | null; sport?: string | null };

export type MatchesResult = ViewResult & {
  /** Comment la liste a été obtenue (ou pourquoi elle ne l'a pas été). */
  via: "provider" | "site" | "site_not_validated" | "not_covered" | "no_provider" | "unknown_sport" | "quota";
  matches: BookmakerMatch[];
};

export async function viewMatches(deps: MatchesDeps, input: ViewMatchesInput): Promise<MatchesResult> {
  const now = nowOf(deps);
  const key = bookKey(input.bookmaker);
  const label = bookmakerLabel(key);
  const day = input.day ?? parisDay(now);
  const when = `${dayLabel(day, now)}${input.slot ? ` (${input.slot === "apres-midi" ? "après-midi" : input.slot})` : ""}`;
  const sport = sportIdOf(input.sport);
  if (!sport) return { via: "unknown_sport", matches: [], facts: { bookmaker: label, sport: input.sport }, lines: [`Je ne connais pas le sport « ${input.sport} ». Je sais lire le foot, le basket, le tennis, le hockey et le rugby.`] };
  const range = slotRange(day, input.slot ?? null);
  const from = new Date(Math.max(range.from.getTime(), now.getTime()));
  const to = range.to;
  const sources = await matchSources(deps);
  const coveredBy: Array<{ provider: OddsProvider; source: "fake" | "live" }> = [];
  const known = new Set<string>();
  for (const s of sources) {
    const books = await coveredBooks(s.provider, now, deps.logger);
    for (const b of books) known.add(b);
    if (books.has(key)) coveredBy.push(s);
  }
  const base = { bookmaker: label, jour: day, moment: input.slot ?? null, sport: SPORT_LABELS[sport] ?? sport };

  if (coveredBy.length) {
    const src = coveredBy[0]!;
    const before = src.source === "live" ? await oddsCallsThisMonth(deps.prisma, now) : 0;
    let matches: BookmakerMatch[];
    try {
      const events = from < to ? (await src.provider.listEvents({ sport, leagues: [], from, to })).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, 40) : [];
      const markets = events.length ? await marketsForEvents(src.provider, events.map((e) => e.eventId), []) : new Map();
      matches = events
        .map((e: OddsEvent) => ({
          eventId: e.eventId,
          leagueId: e.leagueId,
          homeTeam: e.homeTeam,
          awayTeam: e.awayTeam,
          startsAt: e.startsAt,
          markets: new Set((markets.get(e.eventId) ?? []).filter((s: { byBookmaker: Record<string, number> }) => Object.keys(s.byBookmaker).some((b) => bookKey(b) === key)).map((s: { marketId: string }) => s.marketId)).size,
        }))
        .filter((m) => m.markets > 0);
    } catch (err) {
      if (err instanceof OddsQuotaError) return { via: "quota", matches: [], facts: base, lines: ["Plafond d'appels aux cotes atteint ce mois-ci : je ne peux plus lire les matchs."] };
      throw err;
    }
    const calls = src.source === "live" ? Math.max(0, (await oddsCallsThisMonth(deps.prisma, now)) - before) : 0;
    return { via: "provider", matches, facts: { ...base, couvert: true, appels: calls, matchs: matches.map(matchFact) }, lines: matchLines(matches, label, when, calls) };
  }

  if (!sources.length)
    return { via: "no_provider", matches: [], facts: { ...base, couvert: false, fournisseur: false }, lines: ["Je n'ai pas encore de fournisseur de cotes branché, donc pas de liste de matchs.", "Envoie-moi la clé des cotes quand tu l'as ?"] };
  const alternatives = [...known].filter((b) => b !== key).slice(0, 40);
  const suggestion = ["bet365", "unibet", "betclic", "winamax", "williamhill", "pinnacle"].find((b) => alternatives.includes(b)) ?? alternatives[0] ?? null;
  return {
    via: "not_covered",
    matches: [],
    facts: { ...base, couvert: false, site: false, autres: alternatives.slice(0, 8).map(bookmakerLabel) },
    lines: [
      `${label} n'est pas chez mon fournisseur de cotes et je n'ai pas accès à son site : je préfère ne rien deviner.`,
      suggestion ? `Tu veux les matchs ${when} chez ${bookmakerLabel(suggestion)} à la place ?` : "Dis-moi un autre bookmaker et je regarde.",
    ],
  };
}

function matchFact(m: BookmakerMatch) {
  return { match: `${m.homeTeam} - ${m.awayTeam}`, ligue: leagueLabel(m.leagueId), coupDEnvoi: m.startsAt.toISOString(), marches: m.markets };
}

/** Lignes (pures) : une par ligue, trois matchs au plus par ligne. */
export function matchLines(matches: readonly BookmakerMatch[], label: string, when: string, calls: number): string[] {
  if (!matches.length) return [`Aucun match chez ${label} ${when} pour le moment.`];
  const byLeague = new Map<string, BookmakerMatch[]>();
  for (const m of matches) byLeague.set(m.leagueId, [...(byLeague.get(m.leagueId) ?? []), m]);
  const lines = [`${matches.length} ${matches.length > 1 ? "matchs" : "match"} chez ${label} ${when} :`];
  for (const [league, list] of byLeague) {
    const shown = list.slice(0, 3).map((m) => `${m.homeTeam} - ${m.awayTeam} (${hourLabel(m.startsAt)}, ${m.markets} ${m.markets > 1 ? "marchés" : "marché"})`);
    lines.push(`${leagueLabel(league)} : ${shown.join(", ")}${list.length > 3 ? ` et ${list.length - 3} autres` : ""}`);
  }
  if (calls > 0) lines.push(`Ça a compté ${calls} ${calls > 1 ? "appels" : "appel"} de cotes sur le forfait du mois.`);
  return lines;
}
