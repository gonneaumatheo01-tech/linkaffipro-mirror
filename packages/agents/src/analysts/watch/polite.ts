/**
 * Phase 29, chantier A : lecture web « polie » de l'équipe Analystes (règle 4).
 *
 * - Agent utilisateur honnête (`LinkAffiProBot/1.0 (+https://app.linkaffipro.com)`), aucune connexion à un compte, aucun
 *   cookie, aucun contournement d'anti-robot.
 * - `robots.txt` lu et respecté (cache 24 h par origine ; groupe `LinkAffiProBot` sinon `*` ; `Allow` / `Disallow` au
 *   plus long préfixe, `*` et `$` ; `Crawl-delay` respecté s'il est plus long que notre débit). Un `robots.txt`
 *   absent (4xx) = tout permis ; injoignable (5xx, réseau) = rien pour l'instant (cache 1 h).
 * - Débit par hôte : une requête toutes les `rateMs` (réglage de la source, sinon 10 s pour les sites, 3 s pour t.me),
 *   tenu entre toutes les lectures du processus.
 * - Délai 20 s, corps lu en flux et coupé à 2 Mo.
 * - 403 / 429 / page anti-robot → repli par l'outil `web_fetch` de l'API (Sonnet), qui lit la page de son côté.
 */
import { readBodyCapped } from "../../inspiration/sources/web-preview";
import { ANALYSTS_LIMITS, type AnalystsWeb } from "../contract";
import { nowOf, type WatchDeps } from "./ai";
import { serverWebFetch, serverWebSearch } from "./server-tools";

export const ANALYSTS_USER_AGENT = "LinkAffiProBot/1.0 (+https://app.linkaffipro.com)";
export const ROBOTS_AGENT_TOKEN = "linkaffiprobot";
export const ROBOTS_CACHE_MS = 24 * 3600_000;
export const ROBOTS_ERROR_CACHE_MS = 3600_000;
export const WEB_TIMEOUT_MS = 20_000;
export const WEB_MAX_BYTES = 2_000_000;

/** Lecture refusée de notre côté (robots.txt, adresse) : jamais contournée. */
export class PoliteFetchError extends Error {
  readonly code: "robots" | "url" | "network" | "timeout";
  constructor(code: PoliteFetchError["code"], message: string) {
    super(message);
    this.name = "PoliteFetchError";
    this.code = code;
  }
}

// ---------------------------------------------------------------- robots.txt

type RobotsRule = { allow: boolean; pattern: string };
export type RobotsPolicy = { rules: RobotsRule[]; crawlDelayMs: number | null; disallowAll?: boolean };

/** Analyse un `robots.txt` pour notre agent (groupe nommé, sinon `*`). Fonction pure. */
export function parseRobots(text: string, agentToken = ROBOTS_AGENT_TOKEN): RobotsPolicy {
  type Group = { agents: string[]; rules: RobotsRule[]; delay: number | null };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], delay: null };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === "allow" || field === "disallow") {
      if (field === "disallow" && !value) continue; // « Disallow: » vide = tout permis
      cur.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number(value.replace(",", "."));
      if (Number.isFinite(n) && n >= 0) cur.delay = Math.round(n * 1000);
    }
  }
  const named = groups.filter((g) => g.agents.some((a) => a !== "*" && agentToken.includes(a.replace(/\/.*$/, ""))));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelayMs: chosen.reduce<number | null>((m, g) => (g.delay === null ? m : Math.max(m ?? 0, g.delay)), null),
  };
}

function patternMatch(pattern: string, path: string): number {
  // Longueur du motif si la règle s'applique, sinon -1.
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(`^${body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return re.test(path) ? pattern.length : -1;
}

/** La politique permet-elle ce chemin (avec la requête) ? Plus long motif gagnant, `Allow` à égalité. */
export function robotsAllows(policy: RobotsPolicy, pathWithQuery: string): boolean {
  if (policy.disallowAll) return false;
  let best = -1;
  let allow = true;
  for (const r of policy.rules) {
    const len = patternMatch(r.pattern, pathWithQuery);
    if (len < 0) continue;
    if (len > best || (len === best && r.allow)) {
      best = len;
      allow = r.allow;
    }
  }
  return allow;
}

// ---------------------------------------------------------------- débit

/** Heure de la dernière requête par hôte (mémoire du processus par défaut). */
export type HostThrottle = {
  lastRequestAt(host: string): Promise<number | null>;
  markRequest(host: string, atMs: number): Promise<void>;
};

export function memoryHostThrottle(): HostThrottle {
  const last = new Map<string, number>();
  return {
    async lastRequestAt(host) {
      return last.get(host) ?? null;
    },
    async markRequest(host, at) {
      last.set(host, at);
    },
  };
}

/** Débit partagé par défaut du processus (worker : file `agents-analystes`, concurrence 2). */
export const processHostThrottle: HostThrottle = memoryHostThrottle();

/** Cache des robots.txt du processus (24 h par origine). */
const processRobotsCache = new Map<string, { policy: RobotsPolicy; until: number }>();

/** Débit par défaut d'un hôte : 3 s pour t.me, 10 s pour les autres sites (les forums passent 15 s par leur source). */
export function defaultRateMs(host: string): number {
  return /(^|\.)t\.me$/i.test(host) ? ANALYSTS_LIMITS.telegramRateMs : ANALYSTS_LIMITS.webRateMs;
}

// ---------------------------------------------------------------- lecture

export type PoliteWebDeps = WatchDeps & {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Horloge en millisecondes (débit) ; défaut : `deps.now`, sinon `Date.now`. */
  clock?: () => number;
  throttle?: HostThrottle;
  /** Cache des robots.txt (partagé entre les vues d'une même instance). */
  robotsCache?: Map<string, { policy: RobotsPolicy; until: number }>;
};

/** Accès web de l'équipe, avec débit réglable par source (`forSource`). */
export type PoliteWeb = AnalystsWeb & {
  /** Vue qui tient au moins `rateMs` entre deux requêtes vers un même hôte (réglage de la source). */
  withRate(rateMs: number | null | undefined): AnalystsWeb;
  /** Le chemin est-il permis par le robots.txt de son site ? */
  allowedByRobots(url: string): Promise<boolean>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Page anti-robot (défi, captcha) reconnue à son contenu : on ne la contourne jamais. */
export function looksLikeBotWall(status: number, body: string): boolean {
  if (status === 403 || status === 429) return true;
  if (status === 503 && /cloudflare|captcha|challenge/i.test(body)) return true;
  if (status !== 200) return false;
  return /cf-browser-verification|challenge-platform|cf_chl_|<title>\s*(just a moment|attention required|access denied)|g-recaptcha|h-captcha|px-captcha|are you a robot|verify you are human/i.test(
    body.slice(0, 20_000),
  );
}

export function createAnalystsWeb(deps: PoliteWebDeps): PoliteWeb {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const clock = deps.clock ?? (() => nowOf(deps).getTime());
  const throttle = deps.throttle ?? processHostThrottle;
  const robotsCache = deps.robotsCache ?? processRobotsCache;

  const waitTurn = async (host: string, rateMs: number) => {
    const last = await throttle.lastRequestAt(host).catch(() => null);
    if (last !== null) {
      const wait = last + rateMs - clock();
      if (wait > 0) await sleep(wait);
    }
    await throttle.markRequest(host, clock()).catch(() => undefined);
  };

  const rawGet = async (url: string, accept: string, timeoutMs: number) => {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": ANALYSTS_USER_AGENT, accept, "accept-language": "fr,en;q=0.8,*;q=0.5" },
      });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new PoliteFetchError("timeout", `Le site ne répond pas (plus de ${Math.round(timeoutMs / 1000)} s).`);
      throw new PoliteFetchError("network", `Site injoignable (${String((err as Error)?.message ?? err).slice(0, 80)}).`);
    }
    const body = await readBodyCapped(res, WEB_MAX_BYTES);
    return { status: res.status, body, finalUrl: res.url || url };
  };

  const policyFor = async (u: URL, rateMs: number): Promise<RobotsPolicy> => {
    const origin = u.origin;
    const hit = robotsCache.get(origin);
    if (hit && hit.until > clock()) return hit.policy;
    let policy: RobotsPolicy;
    let ttl = ROBOTS_CACHE_MS;
    try {
      await waitTurn(u.host, rateMs);
      const res = await rawGet(`${origin}/robots.txt`, "text/plain", WEB_TIMEOUT_MS);
      if (res.status >= 200 && res.status < 300) policy = parseRobots(res.body);
      else if (res.status >= 400 && res.status < 500) policy = { rules: [], crawlDelayMs: null };
      else {
        policy = { rules: [], crawlDelayMs: null, disallowAll: true };
        ttl = ROBOTS_ERROR_CACHE_MS;
      }
    } catch {
      policy = { rules: [], crawlDelayMs: null, disallowAll: true };
      ttl = ROBOTS_ERROR_CACHE_MS;
    }
    robotsCache.set(origin, { policy, until: clock() + ttl });
    return policy;
  };

  const parse = (url: string): URL => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new PoliteFetchError("url", "Adresse illisible.");
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new PoliteFetchError("url", "Seules les adresses web (http, https) sont lues.");
    if (u.username || u.password) throw new PoliteFetchError("url", "Adresse avec identifiants refusée : aucune connexion à un compte.");
    return u;
  };

  const view = (sourceRateMs: number | null | undefined): AnalystsWeb => ({
    async fetchText(url, opts = {}) {
      const u = parse(url);
      const baseRate = Math.max(sourceRateMs ?? 0, defaultRateMs(u.hostname));
      const policy = await policyFor(u, baseRate);
      if (!robotsAllows(policy, `${u.pathname}${u.search}`))
        throw new PoliteFetchError("robots", `Le site ${u.hostname} demande aux robots de ne pas lire ${u.pathname} (robots.txt) : je respecte.`);
      const rate = Math.max(baseRate, policy.crawlDelayMs ?? 0);
      await waitTurn(u.host, rate);
      const res = await rawGet(u.toString(), opts.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5", opts.timeoutMs ?? WEB_TIMEOUT_MS);
      if (looksLikeBotWall(res.status, res.body) && deps.serverTools) {
        // Repli honnête : l'outil web_fetch de l'API lit la page de son côté (jamais de contournement ici).
        return serverWebFetch(deps, u.toString());
      }
      return res;
    },
    search(req) {
      return serverWebSearch(deps, req);
    },
  });

  const base = view(null);
  return {
    ...base,
    withRate: (rateMs) => view(rateMs),
    async allowedByRobots(url) {
      const u = parse(url);
      return robotsAllows(await policyFor(u, defaultRateMs(u.hostname)), `${u.pathname}${u.search}`);
    },
  };
}

/** Raccourci : une lecture polie isolée (débit et robots partagés par le processus). */
export function politeFetch(deps: PoliteWebDeps, url: string, opts?: { accept?: string; timeoutMs?: number; rateMs?: number }) {
  return createAnalystsWeb(deps).withRate(opts?.rateMs).fetchText(url, opts);
}
