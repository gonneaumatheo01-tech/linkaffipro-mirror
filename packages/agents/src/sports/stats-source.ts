/**
 * Paris par capture (28 octobre 2026) : branchements de la source « statistiques » (API-Football) pour l'équipe Paris
 * sportifs.
 * - `humanOddsTarget` : le bookmaker de la catégorie dont l'équipe enverra la capture et la cote : le premier de la
 *   catégorie (les sites des bookmakers ne sont plus jamais lus, décision du client du 28 octobre 2026). Catégorie
 *   sans bookmaker → null.
 * - `apiFootballClientFor` : client avec la clé `providers.apifootball.apiKey` (null sans clé).
 * - `statsMatches` : matchs à venir des ligues de la catégorie avec les 5 derniers matchs de chaque équipe (tirs
 *   cadrés), 4 matchs au plus par passage pour tenir l'offre gratuite (100 demandes par jour).
 * - `apiFootballResult` : résultat d'un match pour le règlement des paris (tirs cadrés de chaque équipe).
 * - `tellApiFootballProblem` : une phrase à l'admin par Kevin, une fois par jour et par problème (offre, clé, plafond).
 */
import { readSetting, writeSetting } from "../admin/journal";
import { readSecret } from "../human/secrets";
import { parisDay } from "../rules/time";
import type { AgentsDeps } from "../types";
import type { OddsResult } from "../providers/odds";
import {
  APIFOOTBALL_EVENT_PREFIX,
  APIFOOTBALL_LEAGUES,
  APIFOOTBALL_SECRET_KEY,
  FINISHED_STATUSES,
  NOT_STARTED_STATUSES,
  createApiFootballClient,
  settingStore,
  type AfFixture,
  type ApiFootballError,
  type ApiFootballClient,
  type ApiFootballStore,
} from "../providers/apifootball";
import { STATS_SAMPLE_MATCHES, teamSamples, type StatsMatch } from "./stats-select";
import type { BetCategoryInfo } from "./data";

/** Matchs examinés au plus par passage (une équipe inconnue coûte 6 demandes). */
export const STATS_MAX_MATCHES = 4;
export const APIFOOTBALL_ALERT_SETTING = "agents.apifootball.alerted";
/** Clé de la question « clé API-Football » posée une seule fois. */
export const APIFOOTBALL_KEY_ASKED_SETTING = "agents.sports.apifootballKeyAsked";

const BOOKMAKER_NAMES: Record<string, string> = { celsius: "Celsius", sportaza: "Sportaza", betportal: "Bet Portal", "5gringos": "5Gringos" };

export function siteLabelOf(key: string, label?: string | null): string {
  return label?.trim() || BOOKMAKER_NAMES[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

export type HumanTarget = { key: string; label: string };

export type ApiFootballDeps = Pick<AgentsDeps, "prisma"> & { fetch?: typeof fetch; now?: () => Date; providers?: unknown };

/** Bookmaker de la catégorie dont l'équipe envoie la capture et la cote (le premier) ; null sans bookmaker. Pur. */
export function humanOddsTarget(category: Pick<BetCategoryInfo, "bookmakers">): HumanTarget | null {
  const first = category.bookmakers.map((b) => b.toLowerCase().replace(/\s+/g, "")).find((b) => b !== "");
  return first ? { key: first, label: siteLabelOf(first) } : null;
}

/** Client API-Football (clé enregistrée) ; null sans clé. Un client imposé (`providers.apifootball`) sert aux tests. */
export async function apiFootballClientFor(deps: ApiFootballDeps, store?: ApiFootballStore): Promise<ApiFootballClient | null> {
  const forced = (deps.providers as { apifootball?: unknown } | undefined)?.apifootball as ApiFootballClient | null | undefined;
  if (forced) return forced;
  const apiKey = await readSecret(deps.prisma, APIFOOTBALL_SECRET_KEY);
  if (!apiKey) return null;
  return createApiFootballClient({ apiKey, store: store ?? settingStore(deps), now: deps.now, fetch: deps.fetch });
}

/** Ligues API-Football d'une catégorie (identifiants inconnus ignorés). Pur. */
export function apiFootballLeagues(leagues: readonly string[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const l of leagues) {
    const id = APIFOOTBALL_LEAGUES[l];
    if (id !== undefined && !out.has(id)) out.set(id, l);
  }
  return out;
}

/** Jours de Paris couverts par la fenêtre (aujourd'hui, et demain si la fenêtre y va). Pur. */
export function daysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 6 * 3_600_000) {
    const d = parisDay(new Date(t));
    if (!out.includes(d)) out.push(d);
  }
  const last = parisDay(to);
  if (!out.includes(last)) out.push(last);
  return out.slice(0, 3);
}

/** Matchs à venir de la catégorie, avec les tirs cadrés des 5 derniers matchs de chaque équipe. */
export async function statsMatches(
  client: ApiFootballClient,
  category: Pick<BetCategoryInfo, "leagues">,
  window: { from: Date; to: Date },
  max = STATS_MAX_MATCHES,
): Promise<StatsMatch[]> {
  const leagues = apiFootballLeagues(category.leagues);
  if (!leagues.size) return [];
  const fixtures: AfFixture[] = [];
  for (const day of daysBetween(window.from, window.to)) {
    for (const f of await client.fixturesOn(day))
      if (leagues.has(f.leagueId) && NOT_STARTED_STATUSES.has(f.status) && f.kickoffAt >= window.from && f.kickoffAt <= window.to) fixtures.push(f);
  }
  fixtures.sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
  const out: StatsMatch[] = [];
  for (const f of fixtures.slice(0, max)) {
    const sides = [];
    for (const team of [f.home, f.away]) {
      const last = await client.lastFixtures(team.id, STATS_SAMPLE_MATCHES);
      const shots = new Map<number, Record<string, number>>();
      for (const g of last) {
        const s = await client.shotsOnGoal(g.fixtureId);
        if (s) shots.set(g.fixtureId, s.byTeam);
      }
      sides.push(teamSamples(team.id, last, shots));
    }
    out.push({
      eventId: `${APIFOOTBALL_EVENT_PREFIX}${f.fixtureId}`,
      leagueId: leagues.get(f.leagueId)!,
      homeTeam: f.home.name,
      awayTeam: f.away.name,
      kickoffAt: f.kickoffAt,
      home: sides[0]!,
      away: sides[1]!,
    });
  }
  return out;
}

/** Identifiant API-Football d'un pari choisi sur statistiques (`apifootball:<id>`), sinon null. Pur. */
export function apiFootballFixtureId(eventId: string): number | null {
  if (!eventId.startsWith(APIFOOTBALL_EVENT_PREFIX)) return null;
  const n = Number(eventId.slice(APIFOOTBALL_EVENT_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

const CANCELLED = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);

/**
 * Résultat d'un match pour le règlement (`rules/bet-settle.ts`) : terminé → tirs cadrés de chaque équipe
 * (`game.home.shots_onGoal`, `game.away.shots_onGoal`) ; reporté ou annulé → remboursé ; sinon null (relu plus tard).
 */
export async function apiFootballResult(client: ApiFootballClient, eventId: string): Promise<OddsResult | null> {
  const id = apiFootballFixtureId(eventId);
  if (id === null) return null;
  const fixture = await client.fixture(id);
  if (!fixture) return null;
  if (CANCELLED.has(fixture.status)) return { eventId, finalized: false, cancelled: true, homeScore: null, awayScore: null, marketScores: {}, stats: {} };
  if (!FINISHED_STATUSES.has(fixture.status)) return null;
  const shots = await client.shotsOnGoal(id);
  if (!shots) return null;
  const home = shots.byTeam[String(fixture.home.id)];
  const away = shots.byTeam[String(fixture.away.id)];
  if (typeof home !== "number" || typeof away !== "number") return null;
  return {
    eventId,
    finalized: true,
    cancelled: false,
    homeScore: null,
    awayScore: null,
    marketScores: {},
    stats: { "game.home.shots_onGoal": home, "game.away.shots_onGoal": away },
  };
}

/**
 * Problème du fournisseur (offre gratuite qui ne couvre pas la saison, clé refusée, plafond du jour) : une phrase à
 * l'admin par Kevin, une fois par jour et par type. Ne lève jamais.
 */
export async function tellApiFootballProblem(deps: Pick<AgentsDeps, "prisma" | "admin" | "logger"> & { now?: () => Date }, err: ApiFootballError): Promise<void> {
  try {
    const day = parisDay((deps.now ?? (() => new Date()))());
    const seen = ((await readSetting(deps, APIFOOTBALL_ALERT_SETTING)) ?? {}) as Record<string, unknown>;
    if (seen[err.code] === day) return;
    await writeSetting(deps, APIFOOTBALL_ALERT_SETTING, { ...seen, [err.code]: day });
    const text =
      err.code === "plan"
        ? "Paris sportifs : l'offre gratuite d'API-Football refuse ces matchs pour l'instant, donc je ne propose pas de pari aujourd'hui. Il faudrait l'offre payante d'API-Football pour la saison en cours."
        : err.code === "auth"
          ? "Paris sportifs : API-Football refuse la clé enregistrée. Envoie-moi une nouvelle clé avec « clé football » suivi de la clé."
          : "Paris sportifs : j'ai atteint le plafond de demandes à API-Football pour aujourd'hui, je reprends demain.";
    await deps.admin?.send(text);
  } catch (e) {
    deps.logger?.warn({ err: (e as Error).message }, "[agents] alerte API-Football non envoyée");
  }
}
