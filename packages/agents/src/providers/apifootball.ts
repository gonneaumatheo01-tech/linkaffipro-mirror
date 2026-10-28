/**
 * API-Football (api-sports.io, offre gratuite), 28 octobre 2026 : statistiques des matchs pour l'équipe Paris sportifs
 * quand les sites des bookmakers ne se lisent pas (contrôle anti-robot, jamais contourné). L'équipe y voit les matchs du
 * jour et les tirs cadrés des derniers matchs de chaque équipe ; la cote exacte et la capture viennent ensuite de
 * l'équipe humaine (`sports/human-odds.ts`).
 *
 * Base `https://v3.football.api-sports.io`, clé dans l'en-tête `x-apisports-key` (`fetch` injectable : aucun réseau en
 * test, réponses enregistrées dans `fixtures/apifootball`). Réponses `{ errors, response }` : `errors` est un tableau
 * vide, ou un objet (`token` = clé refusée, `plan` = saison ou date hors offre, `requests` / `rateLimit` = limite).
 * Garde-fous : 90 appels au plus par jour de Paris (offre gratuite : 100), compteur `Setting`
 * `agents.apifootball.calls` ; statistiques d'un match terminé gardées pour toujours (`agents.apifootball.shots`, 3 000
 * matchs au plus) ; matchs du jour et derniers matchs d'une équipe gardés le jour même. La clé n'apparaît jamais dans
 * un message.
 */
import { readSetting, writeSetting } from "../admin/journal";
import { parisDay } from "../rules/time";
import type { AgentsDeps } from "../types";
import { ProviderError, redact } from "./http";

export const APIFOOTBALL_SECRET_KEY = "providers.apifootball.apiKey";
export const APIFOOTBALL_BASE = "https://v3.football.api-sports.io";
export const APIFOOTBALL_LABEL = "API-Football";
/** Appels au plus par jour de Paris (l'offre gratuite en donne 100 : marge pour la vérification et les erreurs). */
export const APIFOOTBALL_DAILY_MAX = 90;
export const APIFOOTBALL_CALLS_SETTING = "agents.apifootball.calls";
export const APIFOOTBALL_SHOTS_SETTING = "agents.apifootball.shots";
export const APIFOOTBALL_DAY_SETTING = "agents.apifootball.day";
/** Matchs gardés au plus dans le cache des statistiques (les plus anciens partent d'abord). */
export const APIFOOTBALL_SHOTS_CACHE_MAX = 3000;
/** Préfixe des identifiants de match des paris choisis sur ces statistiques (`BettingPick.eventId`). */
export const APIFOOTBALL_EVENT_PREFIX = "apifootball:";

/** Ligues de nos catégories (identifiants SportsGameOdds gardés dans `BetCategory.leagues`) → ligue API-Football. */
export const APIFOOTBALL_LEAGUES: Readonly<Record<string, number>> = {
  EPL: 39,
  FR_LIGUE_1: 61,
  LA_LIGA: 140,
  BUNDESLIGA: 78,
  IT_SERIE_A: 135,
  UEFA_CHAMPIONS_LEAGUE: 2,
  UEFA_EUROPA_LEAGUE: 3,
};

/** Statuts d'un match terminé (statistiques définitives). */
export const FINISHED_STATUSES: ReadonlySet<string> = new Set(["FT", "AET", "PEN"]);
/** Statuts d'un match pas encore commencé. */
export const NOT_STARTED_STATUSES: ReadonlySet<string> = new Set(["NS", "TBD"]);

export type ApiFootballErrorCode = "auth" | "plan" | "quota" | "limit" | "http";

/** Erreur claire (en français, jamais la clé) ; `code` permet au Chef d'en parler à l'admin. */
export class ApiFootballError extends Error {
  constructor(
    message: string,
    readonly code: ApiFootballErrorCode,
  ) {
    super(message);
    this.name = "ApiFootballError";
  }
}

export type AfTeam = { id: number; name: string };
export type AfFixture = {
  fixtureId: number;
  leagueId: number;
  season: number | null;
  kickoffAt: Date;
  status: string;
  home: AfTeam;
  away: AfTeam;
};
/** Tirs cadrés d'un match terminé, par équipe (`teamId → tirs cadrés`). */
export type AfShots = { fixtureId: number; byTeam: Record<string, number> };

export type ApiFootballClient = {
  /** Matchs d'un jour (AAAA-MM-JJ, heure de Paris), toutes ligues ; un appel, gardé le jour même. */
  fixturesOn(day: string): Promise<AfFixture[]>;
  /** Derniers matchs JOUÉS d'une équipe (au plus `n`), gardés le jour même. */
  lastFixtures(teamId: number, n: number): Promise<AfFixture[]>;
  /** Tirs cadrés d'un match terminé (null si le fournisseur ne les donne pas) ; gardés pour toujours. */
  shotsOnGoal(fixtureId: number): Promise<AfShots | null>;
  /** État d'un match (terminé, reporté…) pour le règlement des paris ; jamais gardé. */
  fixture(fixtureId: number): Promise<AfFixture | null>;
};

/** Rangement des caches et du compteur (Setting en production, mémoire en test). */
export type ApiFootballStore = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};

export function settingStore(deps: Pick<AgentsDeps, "prisma">): ApiFootballStore {
  return { get: (key) => readSetting(deps, key), set: (key, value) => writeSetting(deps, key, value) };
}

export function memoryStore(init: Record<string, unknown> = {}): ApiFootballStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...init };
  return {
    data,
    get: async (key) => data[key],
    set: async (key, value) => {
      data[key] = JSON.parse(JSON.stringify(value));
    },
  };
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Erreurs d'une réponse API-Football (`errors` objet non vide) → erreur claire ; null si tout va bien. Pur. */
export function apiFootballErrorOf(body: unknown, secret = ""): ApiFootballError | null {
  const errors = obj(body).errors;
  if (!errors || Array.isArray(errors)) return null;
  const e = errors as Raw;
  const keys = Object.keys(e);
  if (!keys.length) return null;
  const text = (k: string) => redact(String(e[k] ?? ""), secret).replace(/\s+/g, " ").trim().slice(0, 160);
  if ("token" in e) return new ApiFootballError(`${APIFOOTBALL_LABEL} : clé refusée. Vérifie la clé dans Agents → Réglages.`, "auth");
  if ("plan" in e)
    return new ApiFootballError(`${APIFOOTBALL_LABEL} : l'offre gratuite ne couvre pas cette demande (${text("plan")}). Il faudrait une offre payante pour ces matchs.`, "plan");
  if ("requests" in e) return new ApiFootballError(`${APIFOOTBALL_LABEL} : limite de demandes du jour atteinte (${text("requests")}).`, "limit");
  if ("rateLimit" in e) return new ApiFootballError(`${APIFOOTBALL_LABEL} : trop de demandes d'un coup, réessai au prochain passage.`, "limit");
  return new ApiFootballError(`${APIFOOTBALL_LABEL} : demande refusée (${keys.map(text).join(" ; ")}).`, "http");
}

/** Match d'une réponse `/fixtures` (pur) ; null si incomplet. */
export function mapFixture(item: unknown): AfFixture | null {
  const it = obj(item);
  const f = obj(it.fixture);
  const league = obj(it.league);
  const teams = obj(it.teams);
  const home = obj(teams.home);
  const away = obj(teams.away);
  const id = num(f.id);
  const leagueId = num(league.id);
  const hid = num(home.id);
  const aid = num(away.id);
  const date = typeof f.date === "string" ? new Date(f.date) : null;
  if (id === null || leagueId === null || hid === null || aid === null || !date || Number.isNaN(date.getTime())) return null;
  return {
    fixtureId: id,
    leagueId,
    season: num(league.season),
    kickoffAt: date,
    status: String(obj(f.status).short ?? ""),
    home: { id: hid, name: String(home.name ?? `Équipe ${hid}`) },
    away: { id: aid, name: String(away.name ?? `Équipe ${aid}`) },
  };
}

/** Tirs cadrés d'une réponse `/fixtures/statistics` (pur) ; null si aucune équipe n'a la statistique. */
export function mapShots(fixtureId: number, response: unknown): AfShots | null {
  if (!Array.isArray(response)) return null;
  const byTeam: Record<string, number> = {};
  for (const row of response) {
    const r = obj(row);
    const teamId = num(obj(r.team).id);
    const stats = Array.isArray(r.statistics) ? r.statistics : [];
    const sog = stats.map(obj).find((s) => String(s.type ?? "").toLowerCase() === "shots on goal");
    if (teamId === null || !sog) continue;
    // `null` chez API-Football = aucun tir cadré enregistré pour l'équipe (0), pas une donnée absente.
    byTeam[String(teamId)] = num(sog.value) ?? 0;
  }
  return Object.keys(byTeam).length === 2 ? { fixtureId, byTeam } : null;
}

/** Compteur du jour de Paris : refuse au-delà de `max`, sinon compte l'appel. */
export async function takeApiFootballCall(store: ApiFootballStore, now: Date, max = APIFOOTBALL_DAILY_MAX): Promise<number> {
  const day = parisDay(now);
  const cur = obj(await store.get(APIFOOTBALL_CALLS_SETTING));
  const count = cur.day === day ? Number(cur.count ?? 0) : 0;
  if (count >= max)
    throw new ApiFootballError(`${APIFOOTBALL_LABEL} : ${count} demandes aujourd'hui, plafond du jour atteint (${max}). L'équipe reprend demain.`, "quota");
  await store.set(APIFOOTBALL_CALLS_SETTING, { day, count: count + 1 });
  return count + 1;
}

/** Appels déjà faits aujourd'hui (affichage). */
export async function apiFootballCallsToday(store: ApiFootballStore, now: Date): Promise<number> {
  const cur = obj(await store.get(APIFOOTBALL_CALLS_SETTING));
  return cur.day === parisDay(now) ? Number(cur.count ?? 0) : 0;
}

export type ApiFootballOptions = {
  apiKey: string;
  store: ApiFootballStore;
  now?: () => Date;
  fetch?: typeof fetch;
  baseUrl?: string;
  maxCallsPerDay?: number;
};

type DayCache = { day: string; byDay?: Record<string, unknown[]>; teams?: Record<string, unknown[]> };

const fixtureToJson = (f: AfFixture) => ({ ...f, kickoffAt: f.kickoffAt.toISOString() });
const fixtureFromJson = (v: unknown): AfFixture | null => {
  const o = obj(v);
  const at = typeof o.kickoffAt === "string" ? new Date(o.kickoffAt) : null;
  if (!at || Number.isNaN(at.getTime()) || typeof o.fixtureId !== "number") return null;
  return { ...(o as unknown as AfFixture), kickoffAt: at };
};

export function createApiFootballClient(opts: ApiFootballOptions): ApiFootballClient {
  const fetchImpl = opts.fetch ?? fetch;
  const base = (opts.baseUrl ?? APIFOOTBALL_BASE).replace(/\/$/, "");
  const now = opts.now ?? (() => new Date());
  const store = opts.store;
  const secret = opts.apiKey;

  async function get(path: string, params: Record<string, string>): Promise<unknown[]> {
    await takeApiFootballCall(store, now(), opts.maxCallsPerDay);
    const qs = new URLSearchParams(params);
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}?${qs}`, { method: "GET", headers: { "x-apisports-key": secret, accept: "application/json" } });
    } catch (err) {
      throw new ProviderError(`${APIFOOTBALL_LABEL} injoignable (${redact((err as Error).message || "réseau", secret).slice(0, 120)})`, true);
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.status === 401 || res.status === 403) throw new ApiFootballError(`${APIFOOTBALL_LABEL} : clé refusée (${res.status}).`, "auth");
    if (res.status === 429) throw new ApiFootballError(`${APIFOOTBALL_LABEL} limite le débit pour le moment (429).`, "limit");
    if (!res.ok) throw new ProviderError(`${APIFOOTBALL_LABEL} indisponible (${res.status})`, res.status >= 500, res.status);
    const err = apiFootballErrorOf(body, secret);
    if (err) throw err;
    const response = obj(body).response;
    return Array.isArray(response) ? response : [];
  }

  async function dayCache(): Promise<DayCache> {
    const day = parisDay(now());
    const c = obj(await store.get(APIFOOTBALL_DAY_SETTING)) as DayCache;
    return c.day === day ? c : { day };
  }

  return {
    async fixturesOn(day) {
      const c = await dayCache();
      const cached = c.byDay?.[day];
      if (Array.isArray(cached)) return cached.map(fixtureFromJson).filter((f): f is AfFixture => !!f);
      const rows = await get("/fixtures", { date: day, timezone: "Europe/Paris" });
      const fixtures = rows.map(mapFixture).filter((f): f is AfFixture => !!f);
      // Gardés le jour même : les matchs à venir seulement (la liste d'un jour compte souvent plus de 500 matchs).
      const keep = fixtures.filter((f) => NOT_STARTED_STATUSES.has(f.status));
      const fresh = await dayCache();
      await store.set(APIFOOTBALL_DAY_SETTING, { ...fresh, byDay: { ...(fresh.byDay ?? {}), [day]: keep.map(fixtureToJson) } });
      return fixtures;
    },
    async lastFixtures(teamId, n) {
      const c = await dayCache();
      const cached = c.teams?.[String(teamId)];
      if (Array.isArray(cached)) return cached.map(fixtureFromJson).filter((f): f is AfFixture => !!f).slice(0, n);
      const rows = await get("/fixtures", { team: String(teamId), last: String(n), timezone: "Europe/Paris" });
      const played = rows
        .map(mapFixture)
        .filter((f): f is AfFixture => !!f && FINISHED_STATUSES.has(f.status))
        .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime());
      const fresh = await dayCache();
      await store.set(APIFOOTBALL_DAY_SETTING, { ...fresh, teams: { ...(fresh.teams ?? {}), [String(teamId)]: played.map(fixtureToJson) } });
      return played.slice(0, n);
    },
    async fixture(fixtureId) {
      const rows = await get("/fixtures", { id: String(fixtureId), timezone: "Europe/Paris" });
      return rows.map(mapFixture).find((f): f is AfFixture => !!f && f.fixtureId === fixtureId) ?? null;
    },
    async shotsOnGoal(fixtureId) {
      const cache = obj(await store.get(APIFOOTBALL_SHOTS_SETTING));
      const entries = obj(cache.entries);
      const hit = obj(entries[String(fixtureId)]);
      if (hit.byTeam) return { fixtureId, byTeam: obj(hit.byTeam) as Record<string, number> };
      const rows = await get("/fixtures/statistics", { fixture: String(fixtureId) });
      const shots = mapShots(fixtureId, rows);
      if (shots) {
        const fresh = obj(obj(await store.get(APIFOOTBALL_SHOTS_SETTING)).entries);
        fresh[String(fixtureId)] = { byTeam: shots.byTeam, at: now().toISOString() };
        const keys = Object.keys(fresh);
        if (keys.length > APIFOOTBALL_SHOTS_CACHE_MAX) {
          const sorted = keys.sort((a, b) => String(obj(fresh[a]).at ?? "").localeCompare(String(obj(fresh[b]).at ?? "")));
          for (const k of sorted.slice(0, keys.length - APIFOOTBALL_SHOTS_CACHE_MAX)) delete fresh[k];
        }
        await store.set(APIFOOTBALL_SHOTS_SETTING, { entries: fresh });
      }
      return shots;
    },
  };
}

/** Vérification gratuite d'une clé (`GET /status`, ne compte pas dans le quota du fournisseur). */
export async function verifyApiFootballKey(key: string, fetchImpl: typeof fetch = fetch, baseUrl = APIFOOTBALL_BASE): Promise<{ ok: boolean; message: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/status`, { method: "GET", headers: { "x-apisports-key": key.trim(), accept: "application/json" } });
  } catch {
    return { ok: false, message: `${APIFOOTBALL_LABEL} injoignable pour le moment : réessaie dans une minute` };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 401 || res.status === 403) return { ok: false, message: `clé refusée par ${APIFOOTBALL_LABEL}` };
  if (res.status === 429) return { ok: false, message: `${APIFOOTBALL_LABEL} limite le débit : réessaie dans une minute` };
  if (res.status >= 500) return { ok: false, message: `${APIFOOTBALL_LABEL} indisponible (${res.status}) : réessaie plus tard` };
  const err = apiFootballErrorOf(body, key.trim());
  if (err?.code === "auth") return { ok: false, message: `clé refusée par ${APIFOOTBALL_LABEL}` };
  if (!res.ok) return { ok: false, message: `${APIFOOTBALL_LABEL} a refusé la vérification (${res.status})` };
  const sub = obj(obj(obj(body).response).subscription);
  const plan = typeof sub.plan === "string" ? ` (offre ${sub.plan})` : "";
  return { ok: true, message: `clé acceptée par ${APIFOOTBALL_LABEL}${plan}` };
}
