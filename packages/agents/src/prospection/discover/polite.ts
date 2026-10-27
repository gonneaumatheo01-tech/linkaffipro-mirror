/**
 * Phase 31, chantier A (Sourceur) : lecture « polie » des pages publiques (règle 4 du prompt).
 *
 * - Accès réseau uniquement par `deps.web.fetchText` (injecté : faux en test, aucun réseau).
 * - Débit par hôte : t.me 1 requête / `prospection.tme_rate_limit_ms` (3 s) ; annuaires, pages liées et résultats de
 *   recherche 1 requête / `prospection.directory_rate_limit_ms` (10 s) ; `Crawl-delay` respecté s'il est plus long.
 *   Attente par `deps.sleep`, heure par `deps.clock` (testables : horodatages vérifiés).
 * - `robots.txt` lu et respecté pour les annuaires, pages liées et résultats (cache 24 h par origine, analyse partagée
 *   avec les Analystes `analysts/watch/polite.ts`) ; absent (4xx) = tout permis ; injoignable = rien pour 1 h.
 * - 403 / 429 / page anti-robot (captcha, « cf-challenge », « Just a moment ») → `pauseSource` 24 h
 *   (`Setting prospection.source_pauses`) et erreur `blocked` ; jamais de contournement, jamais de repli.
 * - Source en pause → erreur `paused` sans aucune requête. Lien d'invitation privé → erreur `invite` : jamais ouvert.
 */
import { readSetting, writeSetting } from "../../admin/journal";
import { looksLikeBotWall, parseRobots, processHostThrottle, robotsAllows, type HostThrottle, type RobotsPolicy } from "../../analysts/watch/polite";
import { PROSPECTION_LIMITS, PROSPECTION_SETTINGS, type ProspectionDeps } from "../contract";

export type ProspectFetchKind = "tme" | "directory" | "linked" | "search";

export type ProspectFetchErrorCode = "paused" | "blocked" | "robots" | "invite" | "url" | "network" | "no_web";

/** Lecture refusée ou impossible (message en français courant, jamais le contenu de la page). */
export class ProspectFetchError extends Error {
  readonly code: ProspectFetchErrorCode;
  readonly source: string | null;
  constructor(code: ProspectFetchErrorCode, message: string, source: string | null = null) {
    super(message);
    this.name = "ProspectFetchError";
    this.code = code;
    this.source = source;
  }
}

/** Dépendances de la lecture polie (débit et cache de robots.txt injectables pour les tests). */
export type PoliteProspectDeps = ProspectionDeps & {
  throttle?: HostThrottle;
  robotsCache?: Map<string, { policy: RobotsPolicy; until: number }>;
};

export const ROBOTS_CACHE_MS = 24 * 3600_000;
export const ROBOTS_ERROR_CACHE_MS = 3600_000;
const FETCH_TIMEOUT_MS = 20_000;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const processRobotsCache = new Map<string, { policy: RobotsPolicy; until: number }>();
const HOST_LOCKS = new WeakMap<HostThrottle, Map<string, Promise<void>>>();

export function prospectionClockOf(deps: ProspectionDeps): number {
  return deps.clock ? deps.clock() : (deps.now?.() ?? new Date()).getTime();
}

// ---------------------------------------------------------------- pauses des sources

export type SourcePauses = Record<string, { until: string; reason: string }>;

/** Clé de pause d'une lecture : « tme », « directory:<hôte> », « linked:<hôte> ». */
export function sourcePauseKey(kind: ProspectFetchKind, host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (kind === "tme") return "tme";
  if (kind === "directory") return `directory:${h}`;
  return `linked:${h}`;
}

async function readPauses(deps: ProspectionDeps): Promise<SourcePauses> {
  const v = await readSetting(deps, PROSPECTION_SETTINGS.sourcePauses.key);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as SourcePauses) : {};
}

/** Met une source en pause 24 h (ou `ms`) avec la raison ; la page Sources et Kevin la lisent. */
export async function pauseSource(deps: ProspectionDeps, source: string, reason: string, ms: number = PROSPECTION_LIMITS.sourcePauseMs): Promise<{ until: string }> {
  const pauses = await readPauses(deps);
  const until = new Date(prospectionClockOf(deps) + ms).toISOString();
  pauses[source] = { until, reason: reason.slice(0, 200) };
  await writeSetting(deps, PROSPECTION_SETTINGS.sourcePauses.key, pauses);
  deps.logger?.warn({ source, until, reason: reason.slice(0, 80) }, "prospection : source en pause 24 h");
  return { until };
}

/** Pause en cours d'une source (null si aucune ou échue). */
export async function sourcePause(deps: ProspectionDeps, source: string): Promise<{ until: string; reason: string } | null> {
  const p = (await readPauses(deps))[source];
  if (!p) return null;
  return Date.parse(p.until) > prospectionClockOf(deps) ? p : null;
}

/** Toutes les pauses en cours (page Sources, rapport hebdo). */
export async function activeSourcePauses(deps: ProspectionDeps): Promise<SourcePauses> {
  const now = prospectionClockOf(deps);
  return Object.fromEntries(Object.entries(await readPauses(deps)).filter(([, p]) => Date.parse(p.until) > now));
}

/** Lève la pause d'une source (bouton « Reprendre » du site, Kevin). */
export async function clearSourcePause(deps: ProspectionDeps, source: string): Promise<void> {
  const pauses = await readPauses(deps);
  if (!(source in pauses)) return;
  delete pauses[source];
  await writeSetting(deps, PROSPECTION_SETTINGS.sourcePauses.key, pauses);
}

// ---------------------------------------------------------------- reconnaissance des murs anti-robots

/**
 * Page anti-robot : 403 / 429, défi Cloudflare (« cf-challenge », « Just a moment »), captcha. Le mot « captcha » seul
 * ne suffit que sur une page courte : le vrai catalogue de telega.io (2 Mo) le contient dans un script.
 */
export function isBotWall(status: number, body: string): boolean {
  if (looksLikeBotWall(status, body)) return true;
  const head = body.slice(0, 20_000);
  if (/cf-challenge|cf-chl|<title>[^<]{0,80}(captcha|just a moment)/i.test(head)) return true;
  return body.length < 15_000 && /captcha/i.test(head);
}

// ---------------------------------------------------------------- lecture

async function rateFor(deps: ProspectionDeps, kind: ProspectFetchKind): Promise<number> {
  const s = kind === "tme" ? PROSPECTION_SETTINGS.tmeRateLimitMs : PROSPECTION_SETTINGS.directoryRateLimitMs;
  const v = Number(await readSetting(deps, s.key));
  const floor = kind === "tme" ? PROSPECTION_LIMITS.tmeRateMs : PROSPECTION_LIMITS.directoryRateMs;
  // Un réglage plus court que la règle du prompt est ignoré : on ne va jamais plus vite que 3 s / 10 s.
  return Number.isFinite(v) && v > floor ? v : floor;
}

function parseUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ProspectFetchError("url", "Adresse illisible.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ProspectFetchError("url", "Seules les adresses web (http, https) sont lues.");
  if (u.username || u.password) throw new ProspectFetchError("url", "Adresse avec identifiants refusée : aucune connexion à un compte.");
  return u;
}

/** Lien d'invitation privé : jamais ouvert (règle 2). */
export function isPrivateInviteUrl(u: URL): boolean {
  return /(^|\.)(t\.me|telegram\.me|telegram\.dog)$/i.test(u.hostname) && /^\/(\+|joinchat\/)/i.test(u.pathname);
}

export type PoliteResponse = { status: number; body: string; finalUrl: string };

/**
 * Lit une page publique en respectant le débit, `robots.txt` et les pauses. Erreur `ProspectFetchError` si la lecture
 * est refusée (pause, robots, mur anti-robot → pause 24 h, invitation) ; un 404 ou un 500 est rendu tel quel.
 */
export async function politeProspectFetch(deps: PoliteProspectDeps, url: string, opts: { kind: ProspectFetchKind; timeoutMs?: number }): Promise<PoliteResponse> {
  const web = deps.web;
  if (!web) throw new ProspectFetchError("no_web", "Accès web absent : rien n'est lu.");
  const u = parseUrl(url);
  if (isPrivateInviteUrl(u)) throw new ProspectFetchError("invite", "Lien d'invitation privé : jamais ouvert.");
  const source = sourcePauseKey(opts.kind, u.hostname);
  const paused = await sourcePause(deps, source);
  if (paused) throw new ProspectFetchError("paused", `Source ${source} en pause jusqu'au ${paused.until} (${paused.reason}).`, source);

  const sleep = deps.sleep ?? defaultSleep;
  const throttle = deps.throttle ?? processHostThrottle;
  const robotsCache = deps.robotsCache ?? processRobotsCache;
  let locks = HOST_LOCKS.get(throttle);
  if (!locks) {
    locks = new Map();
    HOST_LOCKS.set(throttle, locks);
  }
  const hostLocks = locks;
  // Tour de chaque hôte : deux lectures simultanées d'un même site passent l'une après l'autre.
  const waitTurn = async (host: string, rateMs: number) => {
    const prev = hostLocks.get(host) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => mine);
    hostLocks.set(host, tail);
    await prev;
    try {
      const last = await throttle.lastRequestAt(host).catch(() => null);
      if (last !== null) {
        const wait = last + rateMs - prospectionClockOf(deps);
        if (wait > 0) await sleep(wait);
      }
      await throttle.markRequest(host, prospectionClockOf(deps)).catch(() => undefined);
    } finally {
      release();
      if (hostLocks.get(host) === tail) hostLocks.delete(host);
    }
  };
  const get = async (target: string): Promise<PoliteResponse> => {
    try {
      return await web.fetchText(target, { timeoutMs: opts.timeoutMs ?? FETCH_TIMEOUT_MS });
    } catch (err) {
      throw new ProspectFetchError("network", `Site injoignable (${String((err as Error)?.message ?? err).slice(0, 80)}).`, source);
    }
  };

  const baseRate = await rateFor(deps, opts.kind);
  let rate = baseRate;
  if (opts.kind !== "tme") {
    let policy: RobotsPolicy;
    const hit = robotsCache.get(u.origin);
    if (hit && hit.until > prospectionClockOf(deps)) policy = hit.policy;
    else {
      let ttl = ROBOTS_CACHE_MS;
      try {
        await waitTurn(u.host, baseRate);
        const res = await get(`${u.origin}/robots.txt`);
        if (res.status >= 200 && res.status < 300) policy = parseRobots(res.body);
        else if (res.status >= 400 && res.status < 500 && res.status !== 403 && res.status !== 429) policy = { rules: [], crawlDelayMs: null };
        else {
          policy = { rules: [], crawlDelayMs: null, disallowAll: true };
          ttl = ROBOTS_ERROR_CACHE_MS;
        }
      } catch {
        policy = { rules: [], crawlDelayMs: null, disallowAll: true };
        ttl = ROBOTS_ERROR_CACHE_MS;
      }
      robotsCache.set(u.origin, { policy, until: prospectionClockOf(deps) + ttl });
    }
    if (!robotsAllows(policy, `${u.pathname}${u.search}`))
      throw new ProspectFetchError("robots", `Le site ${u.hostname} demande aux robots de ne pas lire ${u.pathname} (robots.txt) : je respecte.`, source);
    rate = Math.max(baseRate, policy.crawlDelayMs ?? 0);
  }

  await waitTurn(u.host, rate);
  const res = await get(u.toString());
  if (isBotWall(res.status, res.body)) {
    const reason = res.status === 403 || res.status === 429 ? `réponse ${res.status} de ${u.hostname}` : `page anti-robot sur ${u.hostname}`;
    const { until } = await pauseSource(deps, source, reason);
    throw new ProspectFetchError("blocked", `${u.hostname} bloque la lecture (${reason}) : source en pause jusqu'au ${until}, rien n'est contourné.`, source);
  }
  return res;
}
