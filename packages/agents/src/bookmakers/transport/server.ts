/**
 * Phase 35, chantier A : transport « serveur » des bookmakers (Playwright / Chromium du processus : worker, ou Mac quand
 * le runner l'exécute en local). Remplit `BookmakerTransport` :
 * - `fetchApi` : appel d'API interne avec la session du site (cookies et jeton du stockage), même agent utilisateur,
 *   proxy s'il est réglé ; 401 / 403 → `{ authExpired: true }` ; redirections vérifiées une à une par la garde ;
 * - `page` : ouvre une page (garde « jamais de mise » étendue à la lecture), suit des étapes `DomStep` (candidats css /
 *   texte / rôle, le premier visible gagne), lit HTML et texte, capture une zone si demandé ;
 * - `record` : parcours guidé du chantier B (`recordSite` de `learn/record.ts`, ou celui branché par `setRecordSite`)
 *   avec la page GARDÉE et l'écoute du réseau ; `recordSite: null` : `{ obstacle: "apprentissage indisponible" }` ;
 * - `visible` (en plus, Mac seulement) : navigateur affiché pour qu'un humain règle un captcha ou un code (10 min au plus).
 * Rien n'est écrit sur disque : la session arrive de l'environnement et y repart (chiffrée en base, ou rendue au site).
 * Aucun navigateur dans les tests unitaires : lanceur et contexte d'API injectés.
 */
import type { Browser, BrowserContext, Page, Request as PwRequest, Route } from "playwright-core";
import { request as pwRequest } from "playwright-core";
import type { AgentsPrisma, Logger } from "../../types";
import type { BookmakerCredentials } from "../../providers/screenshot/adapter";
import { adapterFor } from "../../providers/screenshot/adapters";
import { CaptureError } from "../../providers/screenshot/errors";
import { GuardedPage, type ReadonlyLocator } from "../../providers/screenshot/guard";
import type { BrowserStorageState, ProxyConfig } from "../../providers/screenshot/session";
import type { BookmakerTransport, DomStep, ReadTarget, SiteRecording } from "../contract";
import { forbiddenApiCallReason, forbiddenFrameUrlReason, forbiddenReadUrlReason, READ_GUARD_CHECKS } from "../guard";
import { dbTransportEnv, type SiteAccess, type TransportEnv } from "./env";
import { registeredBrowserLauncher, registeredRecordSite, type BookmakerBrowserLauncher, type ObservedFrame, type ObservedResponse, type RecordIo, type RecordSiteFn } from "./hooks";
import { recordSite as learnRecordSite } from "../learn/record";
import { detectReadObstacle } from "./obstacles";
import { paceSite, type PaceKind } from "./pace";

/** Agent utilisateur unique (navigateur et appels d'API) : un Chrome de bureau ordinaire. */
export const BOOKMAKER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const VIEWPORT = { width: 1366, height: 900 };
export const API_BODY_MAX_BYTES = 5_000_000;
export const PAGE_TIMEOUT_MS = 150_000;
export const RECORD_TIMEOUT_MS = 6 * 60_000;
export const VISIBLE_MAX_WAIT_MS = 10 * 60_000;

// ---------- appels d'API (contexte de requêtes Playwright : cookies, agent utilisateur, proxy) ----------

export type ApiResponseLike = { status(): number; headers(): Record<string, string>; text(): Promise<string> };
export type ApiRequestLike = {
  fetch(url: string, o: { method: string; headers: Record<string, string>; data?: string; maxRedirects: number; timeout: number; failOnStatusCode: boolean }): Promise<ApiResponseLike>;
  storageState(): Promise<unknown>;
  dispose(): Promise<void>;
};
export type RequestContextFactory = (o: { storageState: BrowserStorageState | null; userAgent: string; proxy: ProxyConfig | null }) => Promise<ApiRequestLike>;

export const playwrightRequestContext: RequestContextFactory = async (o) =>
  (await pwRequest.newContext({
    userAgent: o.userAgent,
    ...(o.storageState ? { storageState: o.storageState as never } : {}),
    ...(o.proxy ? { proxy: o.proxy } : {}),
  })) as unknown as ApiRequestLike;

const TOKEN_NAME = /^(access[_-]?token|accesstoken|token|jwt|auth[_-]?token|authtoken|id[_-]?token|bearer|session[_-]?token|x-auth-token)$/i;

function cookieFor(state: BrowserStorageState | null, name: string): string | null {
  const c = state?.cookies.find((x) => String(x.name).toLowerCase() === name.toLowerCase());
  return c && typeof c.value === "string" ? c.value : null;
}

function storageFor(state: BrowserStorageState | null, origin: string, test: (name: string) => boolean): string | null {
  const origins = state?.origins ?? [];
  const sorted = [...origins.filter((o) => o.origin === origin), ...origins.filter((o) => o.origin !== origin)];
  for (const o of sorted)
    for (const item of o.localStorage) {
      if (!test(item.name)) continue;
      // Valeur JSON `{ token: … }` ou `"…"` : on garde la chaîne utile.
      try {
        const parsed = JSON.parse(item.value) as unknown;
        if (typeof parsed === "string") return parsed;
        const t = (parsed as Record<string, unknown> | null)?.token ?? (parsed as Record<string, unknown> | null)?.accessToken ?? (parsed as Record<string, unknown> | null)?.access_token;
        if (typeof t === "string") return t;
      } catch {
        /* valeur simple */
      }
      return item.value;
    }
  return null;
}

/**
 * Pur : valeurs des en-têtes demandés par la recette (NOMS seulement dans la recette, valeurs prises dans la session) ;
 * un en-tête introuvable n'est pas envoyé. Les cookies sont joints par le contexte de requêtes.
 */
export function sessionHeaders(names: readonly string[], state: BrowserStorageState | null, url: string, site: SiteAccess, hasBody: boolean): Record<string, string> {
  const out: Record<string, string> = { accept: "application/json, text/plain, */*", "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" };
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    /* adresse déjà refusée par la garde */
  }
  const siteOrigin = (() => {
    try {
      return new URL(site.baseUrl).origin;
    } catch {
      return origin;
    }
  })();
  for (const raw of names) {
    const name = raw.toLowerCase().trim();
    if (!/^[a-z0-9-]{1,60}$/.test(name) || name === "cookie" || name === "host" || name === "content-length") continue;
    if (name === "accept" || name === "accept-language") continue;
    if (name === "content-type") {
      if (hasBody) out[name] = "application/json";
      continue;
    }
    if (name === "origin") {
      out[name] = siteOrigin;
      continue;
    }
    if (name === "referer") {
      out[name] = `${siteOrigin}/`;
      continue;
    }
    if (name === "x-requested-with") {
      out[name] = "XMLHttpRequest";
      continue;
    }
    if (name === "authorization") {
      const t = storageFor(state, origin, (n) => TOKEN_NAME.test(n)) ?? storageFor(state, origin, (n) => /token|jwt/i.test(n)) ?? cookieFor(state, "token");
      if (t) out[name] = /^bearer\s/i.test(t) ? t : `Bearer ${t}`;
      continue;
    }
    // Jeton anti-falsification ou en-tête propre au site : même nom dans les cookies ou le stockage.
    const alt = name.replace(/^x-/, "");
    const v = cookieFor(state, name) ?? cookieFor(state, alt) ?? cookieFor(state, alt.replace(/-/g, "_")) ?? storageFor(state, origin, (n) => n.toLowerCase() === name || n.toLowerCase() === alt);
    if (v) out[name] = v;
  }
  if (hasBody && !out["content-type"]) out["content-type"] = "application/json";
  return out;
}

// ---------- page ----------

/** Pur : un candidat d'étape → sélecteur Playwright (css, texte, rôle ; combinés). */
export function candidateSelector(c: { css?: string; text?: string; role?: string }): string | null {
  const text = c.text?.trim();
  if (c.role) {
    const role = c.role.replace(/[^a-z]/gi, "").toLowerCase();
    if (!role) return null;
    return text ? `role=${role}[name=${JSON.stringify(text)}]` : `role=${role}`;
  }
  if (c.css && text) return `${c.css}:has-text(${JSON.stringify(text)})`;
  if (c.css) return c.css;
  if (text) return `text=${JSON.stringify(text).slice(1, -1)}`;
  return null;
}

/**
 * Pur : sélecteurs à essayer pour un candidat, du plus précis au plus large. Un texte seul est d'abord cherché à
 * l'identique (`text="Football"`), puis comme sous-chaîne (sinon un paragraphe qui cite « football » passerait avant
 * l'onglet, et la garde refuserait un bloc entier).
 */
export function candidateSelectors(c: { css?: string; text?: string; role?: string }): string[] {
  const loose = candidateSelector(c);
  if (!loose) return [];
  const text = c.text?.trim();
  if (text && !c.css && !c.role) return [`text=${JSON.stringify(text)}`, loose];
  return [loose];
}

/** Ordre d'essai des candidats : le dernier qui a marché d'abord. */
export function candidateOrder(step: DomStep): number[] {
  const idx = step.candidates.map((_, i) => i);
  const g = step.lastGood;
  if (typeof g === "number" && g >= 0 && g < idx.length) return [g, ...idx.filter((i) => i !== g)];
  return idx;
}

/** Premier élément visible du premier candidat qui en a un ; attend jusqu'à `timeoutMs`. */
export async function resolveStep(gp: GuardedPage, step: DomStep, timeoutMs: number, pause = 250): Promise<{ el: ReadonlyLocator; index: number } | null> {
  const order = candidateOrder(step);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const i of order) {
      for (const sel of candidateSelectors(step.candidates[i]!)) {
        const loc = gp.find(sel);
        const n = Math.min(await loc.count().catch(() => 0), 10);
        for (let k = 0; k < n; k++) if (await loc.nth(k).isVisible().catch(() => false)) return { el: loc.nth(k), index: i };
      }
    }
    if (Date.now() >= deadline) return null;
    await gp.pause(pause);
  }
}

export type LoginFn = (gp: GuardedPage, creds: BookmakerCredentials, siteKey: string) => Promise<"already" | "logged_in" | "skipped" | { obstacle: string }>;

/** Connexion par l'adaptateur de la phase 23 quand le site en a un (Sportaza) ; sinon rien. */
export const adapterLogin: LoginFn = async (gp, creds, siteKey) => {
  const adapter = adapterFor(siteKey);
  if (!adapter) return "skipped";
  try {
    return await adapter.login({ page: gp, credentials: creds });
  } catch (err) {
    const kind = (err as CaptureError).kind;
    if (kind === "login_failed") return { obstacle: "password_refused" };
    if (kind === "captcha" || kind === "two_factor" || kind === "geo_blocked" || kind === "forbidden_action") return { obstacle: kind };
    return { obstacle: "timeout" };
  }
};

export type PageOk = { url: string; html: string; text: string; image?: string | null; stepsUsed: number[] };
type Obstacle = { obstacle: string; message?: string };

export type ServerTransport = BookmakerTransport & {
  page(siteKey: string, req: { url: string; steps?: Array<{ click?: DomStep; waitFor?: DomStep }>; captureOf?: DomStep | null }): Promise<PageOk | Obstacle>;
  /** Navigateur affiché (Mac) jusqu'à ce que la page soit débloquée par un humain. */
  visible(siteKey: string, req: { url?: string; maxWaitMs?: number }): Promise<{ ok: true; url: string } | Obstacle>;
};

export type ServerTransportDeps = { prisma?: AgentsPrisma | null; logger?: Logger; now?: () => Date };

export type ServerTransportOptions = {
  launch?: BookmakerBrowserLauncher;
  env?: TransportEnv;
  newRequestContext?: RequestContextFactory;
  /** Rythme (par défaut `paceSite` en base, ou en mémoire sans base). */
  pace?: (siteKey: string, kind: PaceKind) => Promise<void>;
  recordSite?: RecordSiteFn | null;
  login?: LoginFn | null;
  userAgent?: string;
  headless?: boolean;
  stepTimeoutMs?: number;
  pageTimeoutMs?: number;
  recordTimeoutMs?: number;
  /** Attente entre deux contrôles d'une page affichée (`visible`). */
  visiblePollMs?: number;
  target?: ReadTarget;
};

function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new CaptureError("timeout", `lecture interrompue après ${Math.round(ms / 1000)} s`));
    }, ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

/** Erreur pendant une lecture → obstacle classé (jamais de secret dans le message). */
export function obstacleOf(err: unknown): Obstacle {
  if (err instanceof CaptureError) {
    if (err.kind === "forbidden_action") return { obstacle: "forbidden_action", message: err.message.slice(0, 200) };
    if (err.kind === "login_failed") return { obstacle: "password_refused" };
    return { obstacle: err.kind === "unknown" ? "unknown" : err.kind, message: err.message.slice(0, 200) };
  }
  const e = err as { name?: string; message?: string } | null;
  const msg = String(e?.message ?? err ?? "");
  if (e?.name === "TimeoutError" || /timeout|timed out/i.test(msg)) return { obstacle: "timeout" };
  if (/net::ERR_|ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN|socket hang up/i.test(msg)) return { obstacle: "unreachable", message: /net::ERR_[A-Z_]+|E[A-Z]+/.exec(msg)?.[0] };
  return { obstacle: "unknown", message: msg.slice(0, 200) };
}

/**
 * Garde des navigations du navigateur (exportée pour les tests) : refuse avant l'envoi ; pour la page principale, la
 * réponse est d'abord lue SANS suivre les redirections, et une redirection vers une adresse interdite est coupée.
 * En cas de doute (requête illisible, lecture impossible), la navigation est coupée.
 */
export async function guardNavigation(route: Route, req: PwRequest, site: SiteAccess, onBlocked: (why: string) => void): Promise<void> {
  if (!req.isNavigationRequest()) return route.continue();
  const url = req.url();
  if (/^(about|data|blob):/i.test(url)) return route.continue();
  let main = true;
  try {
    main = req.frame().parentFrame() === null;
  } catch {
    main = true; // cadre inconnu : règles les plus strictes
  }
  const why = main ? forbiddenReadUrlReason(url, site.allowedHosts) : forbiddenFrameUrlReason(url);
  if (why) {
    onBlocked(why);
    return route.abort("blockedbyclient");
  }
  if (!main) return route.continue();
  let res: Awaited<ReturnType<Route["fetch"]>>;
  try {
    res = await route.fetch({ maxRedirects: 0 });
  } catch {
    return route.abort("failed");
  }
  const status = res.status();
  const loc = status >= 300 && status < 400 ? res.headers()["location"] : undefined;
  if (loc) {
    let next: string;
    try {
      next = new URL(loc, url).toString();
    } catch {
      onBlocked("redirection illisible");
      return route.abort("blockedbyclient");
    }
    const bad = forbiddenReadUrlReason(next, site.allowedHosts);
    if (bad) {
      onBlocked(`redirection : ${bad}`);
      return route.abort("blockedbyclient");
    }
  }
  return route.fulfill({ response: res });
}

export function createServerTransport(deps: ServerTransportDeps | null, opts: ServerTransportOptions = {}): ServerTransport {
  const env = opts.env ?? (deps?.prisma ? dbTransportEnv({ prisma: deps.prisma }) : null);
  const logger = deps?.logger;
  const ua = opts.userAgent ?? BOOKMAKER_USER_AGENT;
  const stepTimeout = opts.stepTimeoutMs ?? 10_000;
  const newRequestContext = opts.newRequestContext ?? playwrightRequestContext;
  const pace = opts.pace ?? ((siteKey: string, kind: PaceKind) => paceSite({ prisma: deps?.prisma ?? null }, siteKey, { kind }).then(() => undefined));
  const loginFn = opts.login === undefined ? adapterLogin : opts.login;
  const log = (siteKey: string, action: string, detail: string) => logger?.info({ siteKey, action, detail }, "[bookmakers] lecture");

  async function siteOf(siteKey: string): Promise<SiteAccess | Obstacle> {
    if (!env) return { obstacle: "unknown_site", message: "aucun accès aux réglages des sites" };
    const site = await env.site(siteKey);
    return site ?? { obstacle: "unknown_site", message: `site « ${siteKey} » inconnu ou sans adresse` };
  }

  /** Ouvre un navigateur + contexte avec la session ; la navigation vers une page interdite est coupée à la source. */
  async function openBrowser(site: SiteAccess, headless: boolean): Promise<{ browser: Browser; context: BrowserContext; page: Page; gp: GuardedPage } | Obstacle> {
    const launch = opts.launch ?? registeredBrowserLauncher();
    if (!launch) return { obstacle: "no_browser", message: "pas de navigateur dans ce processus" };
    const [state, proxy] = await Promise.all([env!.loadSession(site.key), env!.proxy()]);
    let browser: Browser;
    try {
      browser = await launch({ proxy, headless });
    } catch (err) {
      return { obstacle: "no_browser", message: String((err as Error)?.message ?? err).slice(0, 160) };
    }
    try {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        locale: "fr-FR",
        timezoneId: "Europe/Paris",
        userAgent: ua,
        ...(state ? { storageState: state as never } : {}),
      });
      // Toute navigation vers une adresse interdite est coupée AVANT d'atteindre le site : page principale (domaines du
      // site + mots de lecture), cadres (mots interdits : un moteur de paris tiers reste permis, sa caisse non), et
      // chaque redirection de la page principale vérifiée avant d'être suivie (le navigateur ne suit pas seul).
      await context.route("**/*", (route: Route, req: PwRequest) => guardNavigation(route, req, site, (why) => log(site.key, "blocked", why)));
      const page = await context.newPage();
      // Aucune fenêtre surgissante : un clic imprévu n'ouvre rien d'autre.
      context.on("page", (p) => {
        if (p !== page) void p.close().catch(() => undefined);
      });
      const gp = new GuardedPage(page, site.allowedHosts, (a, d) => log(site.key, a, d), READ_GUARD_CHECKS);
      return { browser, context, page, gp };
    } catch (err) {
      await browser.close().catch(() => undefined);
      return obstacleOf(err);
    }
  }

  async function closeAll(b: { browser: Browser; context: BrowserContext } | null, site: SiteAccess, save: boolean): Promise<void> {
    if (!b) return;
    try {
      if (save) {
        const next = (await b.context.storageState()) as unknown as BrowserStorageState;
        await env!.saveSession(site.key, next).catch((err) => logger?.warn({ err: (err as Error).message }, "[bookmakers] session non rangée"));
      }
    } catch {
      /* contexte déjà fermé */
    }
    await b.context.close().catch(() => undefined);
    await b.browser.close().catch(() => undefined);
  }

  /** Obstacle de la page affichée (règles du code). */
  async function pageObstacle(gp: GuardedPage, requestedUrl: string, afterLogin = false): Promise<Obstacle | null> {
    const s = await gp.signals();
    const { html } = await gp.readContent(50_000, 10);
    const kind = detectReadObstacle({ ...s, status: gp.lastStatus, requestedUrl, htmlLength: html.length }, { afterLogin });
    return kind ? { obstacle: kind } : null;
  }

  async function gotoChecked(gp: GuardedPage, site: SiteAccess, url: string): Promise<Obstacle | null> {
    await pace(site.key, "page");
    await gp.goto(url);
    await gp.settle(8_000);
    return pageObstacle(gp, url);
  }

  const transport: ServerTransport = {
    target: opts.target ?? "server",

    async fetchApi(siteKey, req) {
      const site = await siteOf(siteKey);
      if ("obstacle" in site) return site;
      const method = (req.method || "GET").toUpperCase();
      const refused = forbiddenApiCallReason({ method, url: req.url, body: req.body ?? null }, site.allowedHosts);
      if (refused) {
        log(siteKey, "refused", refused);
        return { obstacle: "forbidden_action", message: refused } as { obstacle: string };
      }
      const state = await env!.loadSession(siteKey);
      const proxy = await env!.proxy();
      let ctx: ApiRequestLike | null = null;
      try {
        ctx = await newRequestContext({ storageState: state, userAgent: ua, proxy });
        let url = req.url;
        let res: ApiResponseLike | null = null;
        // Redirections suivies à la main : chaque adresse passe par la garde.
        for (let hop = 0; hop <= 3; hop++) {
          await pace(siteKey, "request");
          const headers = sessionHeaders(req.headers ?? [], state, url, site, !!req.body && method === "POST");
          res = await ctx.fetch(url, { method: hop ? "GET" : method, headers, ...(req.body && method === "POST" && !hop ? { data: req.body } : {}), maxRedirects: 0, timeout: 30_000, failOnStatusCode: false });
          const status = res.status();
          if (status < 300 || status >= 400) break;
          const loc = res.headers()["location"];
          if (!loc) break;
          const next = new URL(loc, url).toString();
          const why = forbiddenReadUrlReason(next, site.allowedHosts);
          if (why) return { obstacle: "forbidden_action", message: `redirection refusée : ${why}` } as { obstacle: string };
          url = next;
        }
        const status = res!.status();
        if (status === 401 || status === 403) return { authExpired: true };
        if (status === 451) return { obstacle: "geo_blocked" };
        if (status === 429) return { obstacle: "rate_limited" };
        const body = await res!.text();
        if (body.length > API_BODY_MAX_BYTES) return { obstacle: "too_large", message: `réponse de ${Math.round(body.length / 1000)} Ko` } as { obstacle: string };
        const type = res!.headers()["content-type"] ?? "";
        if (/html/i.test(type) || status >= 500) {
          const text = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").slice(0, 6000);
          const title = /<title>([^<]*)<\/title>/i.exec(body)?.[1] ?? "";
          const kind = detectReadObstacle({ text, title, url, status, htmlLength: body.length });
          if (kind && kind !== "empty") return kind === "logged_out" ? { authExpired: true } : { obstacle: kind };
        }
        // Cookies renouvelés par le site : session rangée de nouveau (chiffrée).
        const next = (await ctx.storageState().catch(() => null)) as BrowserStorageState | null;
        if (next && JSON.stringify(next.cookies) !== JSON.stringify(state?.cookies ?? [])) await env!.saveSession(siteKey, { cookies: next.cookies, origins: state?.origins ?? next.origins ?? [] }).catch(() => undefined);
        return { status, body };
      } catch (err) {
        return obstacleOf(err);
      } finally {
        await ctx?.dispose().catch(() => undefined);
      }
    },

    async page(siteKey, req) {
      const site = await siteOf(siteKey);
      if ("obstacle" in site) return site;
      // Garde AVANT tout : aucune adresse interdite n'ouvre même un navigateur.
      const why = forbiddenReadUrlReason(req.url, site.allowedHosts);
      if (why) {
        log(siteKey, "refused", why);
        return { obstacle: "forbidden_action", message: why };
      }
      const opened = await openBrowser(site, opts.headless ?? true);
      if ("obstacle" in opened) return opened;
      let ok = false;
      const run = async (): Promise<PageOk | Obstacle> => {
        const { gp } = opened;
        let obstacle = await gotoChecked(gp, site, req.url);
        if (obstacle?.obstacle === "logged_out" && loginFn) {
          const creds = await env!.credentials(siteKey);
          if (creds) {
            const r = await loginFn(gp, creds, siteKey);
            if (typeof r === "object") return r;
            obstacle = await gotoChecked(gp, site, req.url);
          }
        }
        if (obstacle) return obstacle;
        const stepsUsed: number[] = [];
        for (const [i, step] of (req.steps ?? []).entries()) {
          if (step.click) {
            const found = await resolveStep(gp, step.click, stepTimeout);
            if (!found) return { obstacle: "site_changed", message: `étape ${i + 1} introuvable` };
            await pace(siteKey, "page");
            await gp.click(found.el, "market_tab");
            await gp.settle(5_000);
            stepsUsed.push(found.index);
            const after = await pageObstacle(gp, req.url);
            if (after && after.obstacle !== "empty") return after;
          }
          if (step.waitFor) {
            const found = await resolveStep(gp, step.waitFor, stepTimeout);
            if (!found) return { obstacle: "site_changed", message: `étape ${i + 1} : élément attendu absent` };
            if (!step.click) stepsUsed.push(found.index);
          }
        }
        let image: string | null = null;
        if (req.captureOf) {
          const zone = await resolveStep(gp, req.captureOf, stepTimeout);
          if (!zone) return { obstacle: "site_changed", message: "zone à capturer introuvable" };
          gp.mark(zone.el, "zone");
          image = Buffer.from(await gp.capture("zone")).toString("base64");
        }
        const { html, text } = await gp.readContent();
        ok = true;
        return { url: gp.url(), html, text, image, stepsUsed };
      };
      try {
        return await withDeadline(run(), opts.pageTimeoutMs ?? PAGE_TIMEOUT_MS, () => void opened.browser.close().catch(() => undefined));
      } catch (err) {
        return obstacleOf(err);
      } finally {
        await closeAll(opened, site, ok);
      }
    },

    async record(siteKey, baseUrl) {
      const fn = opts.recordSite === undefined ? (registeredRecordSite() ?? ((io: RecordIo) => learnRecordSite(io))) : opts.recordSite;
      if (!fn) return { obstacle: "apprentissage indisponible" };
      const site = await siteOf(siteKey);
      if ("obstacle" in site) return site;
      const start = baseUrl || site.baseUrl;
      const why = forbiddenReadUrlReason(start, site.allowedHosts);
      if (why) return { obstacle: "forbidden_action", message: why } as { obstacle: string };
      const opened = await openBrowser(site, opts.headless ?? true);
      if ("obstacle" in opened) return opened;
      const creds = await env!.credentials(siteKey);
      const responseCbs: Array<(r: ObservedResponse) => void> = [];
      const frameCbs: Array<(f: ObservedFrame) => void> = [];
      opened.page.on("response", (res) => {
        if (!responseCbs.length) return;
        const rq = res.request();
        const observed: ObservedResponse = {
          url: res.url(),
          method: rq.method(),
          status: res.status(),
          resourceType: rq.resourceType(),
          contentType: res.headers()["content-type"] ?? null,
          requestHeaders: rq.headers(),
          requestBody: rq.postData(),
          body: () => res.text(),
        };
        for (const cb of responseCbs) cb(observed);
      });
      opened.page.on("websocket", (ws) => {
        const emit = (direction: ObservedFrame["direction"]) => (f: { payload: string | Buffer }) => {
          const payload = typeof f.payload === "string" ? f.payload : f.payload.toString("utf8");
          for (const cb of frameCbs) cb({ url: ws.url(), direction, payload });
        };
        ws.on("framesent", emit("sent"));
        ws.on("framereceived", emit("received"));
      });
      const io: RecordIo = {
        siteKey,
        baseUrl: start,
        page: opened.gp,
        credentials: creds,
        secrets: creds ? [creds.login, creds.password] : [],
        pace: (kind = "page") => pace(siteKey, kind),
        onResponse: (cb) => void responseCbs.push(cb),
        onWebSocketFrame: (cb) => void frameCbs.push(cb),
        frameUrls: () => opened.page.frames().map((f) => f.url()),
        screenshot: async () => Buffer.from(await opened.gp.capture()).toString("base64"),
        login: async () => (creds && loginFn ? loginFn(opened.gp, creds, siteKey) : "skipped"),
        ...(logger ? { logger } : {}),
      };
      let ok = false;
      try {
        const out = await withDeadline(fn(io), opts.recordTimeoutMs ?? RECORD_TIMEOUT_MS, () => void opened.browser.close().catch(() => undefined));
        ok = !("obstacle" in out);
        return out as SiteRecording | { obstacle: string };
      } catch (err) {
        return obstacleOf(err);
      } finally {
        await closeAll(opened, site, ok);
      }
    },

    async visible(siteKey, req) {
      const site = await siteOf(siteKey);
      if ("obstacle" in site) return site;
      const url = req.url ?? site.baseUrl;
      const why = forbiddenReadUrlReason(url, site.allowedHosts);
      if (why) return { obstacle: "forbidden_action", message: why };
      const opened = await openBrowser(site, false);
      if ("obstacle" in opened) return opened;
      const maxWait = Math.min(req.maxWaitMs ?? VISIBLE_MAX_WAIT_MS, VISIBLE_MAX_WAIT_MS);
      const poll = opts.visiblePollMs ?? 5_000;
      let ok = false;
      try {
        await opened.gp.goto(url).catch(() => undefined);
        const deadline = Date.now() + maxWait;
        // L'humain règle le captcha ou saisit le code dans la fenêtre ; on attend que la page soit débloquée.
        for (;;) {
          const s = await opened.gp.signals();
          const kind = detectReadObstacle({ ...s, status: null, htmlLength: 10_000 }, { afterLogin: true });
          if (!kind || kind === "empty") {
            ok = true;
            return { ok: true, url: opened.gp.url() };
          }
          if (Date.now() >= deadline) return { obstacle: "still_blocked", message: `toujours bloqué (${kind}) après ${Math.round(maxWait / 60_000)} min` };
          await opened.gp.pause(poll);
        }
      } catch (err) {
        return obstacleOf(err);
      } finally {
        await closeAll(opened, site, ok);
      }
    },
  };
  return transport;
}
