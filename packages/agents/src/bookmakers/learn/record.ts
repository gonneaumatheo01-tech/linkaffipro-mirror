/**
 * Phase 35 (chantier B) — ENREGISTREMENT GUIDÉ d'un site (étape 1 de l'apprentissage). Branché sur le transport du
 * chantier A (`setRecordSite(recordSite)`) : il reçoit la page GARDÉE (`GuardedPage` : jamais la page brute), l'écoute
 * du réseau et le rythme. Parcours : section paris → cookies → (connexion si le site la demande) → football →
 * aujourd'hui → liste → un match → 3 onglets de marchés → demain → recherche d'une équipe.
 * Pendant ce temps : TOUTES les réponses JSON / GraphQL / WebSocket (corps tronqués à 200 Ko, en-têtes utiles avec les
 * valeurs secrètes remplacées), les instantanés de page (HTML nettoyé, texte visible), les cotes lues sur les pages de
 * marchés (`pageOdds`) et le moteur de paris (domaines des cadres, scripts, réponses).
 * Garde « jamais de mise » : on n'y clique QUE l'acceptation des cookies et des onglets de marchés (la garde refuse
 * toute cote, tout bouton de mise, de dépôt, de retrait, de coupon) ; les liens se suivent par leur adresse, vérifiée
 * par la garde. Une page refusée est sautée, jamais forcée. Le contenu des pages est une DONNÉE.
 */
import { detectPageObstacle } from "../../providers/screenshot/errors";
import type { ReadonlyLocator } from "../../providers/screenshot/guard";
import { BOOKMAKER_LIMITS, type RecordedPage, type RecordedResponse, type SiteRecording } from "../contract";
import { descendants, foldText, parseHtml, roleOf, textOf, type HtmlNode } from "../read/html";
import type { ObservedResponse, RecordIo } from "../transport/hooks";
import { isHiddenNode, ODDS_ONLY, pageOddsFromHtml, type PageOdd } from "./page-odds";
import { detectProviderHint } from "./provider";

export type RecordOptions = {
  /** Réponses gardées au plus (trames WebSocket comprises). */
  maxResponses?: number;
  /** Attente après chargement (rendu par script, WebSocket). */
  afterLoadMs?: number;
  /** HTML gardé par page (caractères). */
  maxPageHtml?: number;
  now?: () => Date;
};

/** Étapes nommées de l'enregistrement (la validation s'y repère). */
export const RECORD_STEPS = ["home", "football", "list-today", "event", "market-1", "market-2", "market-3", "list-tomorrow", "search"] as const;
export const isListStep = (s: string) => s.startsWith("list-");
export const isMarketStep = (s: string) => s === "event" || s.startsWith("market-");

const USEFUL_HEADER = /^(authorization|cookie|content-type|accept|accept-language|origin|x-[a-z0-9-]+)$/i;
const SECRET_HEADER = /^(authorization|cookie|proxy-authorization)$|token|auth|session|csrf|xsrf|secret|key|sign|jwt|sid/i;
const NOISE_HOST = /google-analytics|googletagmanager|doubleclick|facebook\.(com|net)|hotjar|segment\.(io|com)|sentry|datadog|newrelic|clarity\.ms|tiktok|criteo|optimizely|intercom|zendesk|livechat|onesignal|cookiebot|onetrust/i;

const EVENT_HREF = /\/(events?|match(es)?|games?|evenements?|fixtures?|rencontres?)\/[^/?#]+\/?$/i;
const FOOTBALL_TEXT = /^(football|foot|soccer|fussball|futbol|calcio|futebol)$/;
const TODAY_TEXT = /^(aujourd'?hui|today|heute|hoy|oggi|hoje)$/;
const TOMORROW_TEXT = /^(demain|tomorrow|morgen|manana|domani|amanha)$/;
const COOKIE_SELECTOR =
  'button:text-matches("^\\\\s*(tout accepter|accepter( tout| les cookies)?|j\'accepte|accept( all)?( cookies)?|i agree|agree|ok|allow all|autoriser)\\\\s*$", "i")';
const SEARCH_SELECTOR = 'input[type=search], input[name=q], input[name=query], input[name=search], input[placeholder*="echerch" i], input[placeholder*="earch" i]';
const TAB_PRIORITY: RegExp[] = [/\b(buts?|goals?|total)\b/, /\bcorners?\b|\bcrn\b/, /\b(cartons?|cards?|bookings?|bkg|tirs?|shots?|speciaux|specials?|joueurs?|players?)\b/];

function truncateBytes(s: string, max: number): string {
  const b = Buffer.from(s, "utf8");
  return b.length <= max ? s : b.subarray(0, max).toString("utf8");
}

function hostOf(u: string): string | null {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:" || x.protocol === "ws:" || x.protocol === "wss:" ? x.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function queryOf(u: string): Record<string, string> | undefined {
  try {
    const q: Record<string, string> = {};
    for (const [k, v] of new URL(u).searchParams) q[k] = v;
    return Object.keys(q).length ? q : undefined;
  } catch {
    return undefined;
  }
}

/** En-têtes utiles, valeurs secrètes déjà remplacées (le masquage complet suit). Pur. */
export function usefulHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    const name = k.toLowerCase();
    if (!USEFUL_HEADER.test(name)) continue;
    out[name] = SECRET_HEADER.test(name) ? "[secret]" : v;
  }
  return out;
}

/** Genre d'une réponse vue (null = pas gardée). Pur. */
export function responseKind(r: Pick<ObservedResponse, "url" | "contentType" | "resourceType" | "requestBody">): RecordedResponse["kind"] | null {
  const host = hostOf(r.url);
  if (!host || NOISE_HOST.test(host)) return null;
  const ct = (r.contentType ?? "").toLowerCase();
  if (/json|graphql/.test(ct)) return /graphql/i.test(r.url) || /^\s*\{\s*"(query|operationName)"/.test(r.requestBody ?? "") ? "graphql" : "json";
  if (r.resourceType === "document" && /html/.test(ct)) return "html";
  return null;
}

type Link = { text: string; href: string; node: HtmlNode };

function linksOf(html: string, base: string): Link[] {
  const out: Link[] = [];
  for (const n of descendants(parseHtml(html))) {
    if (n.tag !== "a" || !n.attrs.href || isHiddenNode(n)) continue;
    try {
      out.push({ text: textOf(n), href: new URL(n.attrs.href, base).toString(), node: n });
    } catch {
      /* adresse illisible */
    }
  }
  return out;
}

/** Selecteur Playwright d'un élément vu dans le HTML (id, sinon balise + texte exact). */
function selectorFor(n: HtmlNode): string {
  if (n.attrs.id && /^[A-Za-z][\w-]*$/.test(n.attrs.id)) return `#${n.attrs.id}`;
  return `${n.tag}:text-is(${JSON.stringify(textOf(n))})`;
}

/** Onglets de marchés d'une fiche de match, les plus utiles d'abord (buts, corners, cartons / tirs). Pur. */
export function marketTabsOf(html: string, max = 3): HtmlNode[] {
  const all = descendants(parseHtml(html)).filter((n) => !isHiddenNode(n));
  let tabs = all.filter((n) => n.attrs.role === "tab");
  if (!tabs.length) tabs = all.filter((n) => (n.tag === "button" || (n.tag === "a" && !n.attrs.href)) && /tab/i.test(n.attrs.class ?? ""));
  if (!tabs.length) {
    const bars = all.filter((n) => /tab/i.test(n.attrs.class ?? "") || roleOf(n) === "tablist");
    tabs = all.filter((n) => n.tag === "button" && bars.some((b) => isInside(n, b)));
  }
  const usable = tabs.filter((n) => {
    const t = textOf(n);
    return t && t.length <= 40 && !ODDS_ONLY.test(t) && n.attrs["aria-selected"] !== "true";
  });
  const seen = new Set<string>();
  const unique = usable.filter((n) => {
    const k = foldText(textOf(n));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const rank = (n: HtmlNode) => {
    const t = foldText(textOf(n));
    const i = TAB_PRIORITY.findIndex((r) => r.test(t));
    return i < 0 ? TAB_PRIORITY.length : i;
  };
  // Le premier onglet (déjà ouvert, « principal ») passe après les autres.
  const ordered = unique.map((n, i) => ({ n, r: i === 0 && rank(n) === TAB_PRIORITY.length ? TAB_PRIORITY.length + 1 : rank(n), i }));
  ordered.sort((a, b) => a.r - b.r || a.i - b.i);
  return ordered.slice(0, max).map((x) => x.n);
}

function isInside(x: HtmlNode, scope: HtmlNode): boolean {
  for (let p = x.parent; p; p = p.parent) if (p === scope) return true;
  return false;
}

/** « A - B », « A v B » → équipe à domicile (terme de recherche). */
function homeTeamOf(label: string): string | null {
  const m = /^(.+?)\s+(?:-|–|—|vs\.?|v|contre)\s+(.+)$/i.exec(label.replace(/\s+/g, " ").trim());
  return m ? m[1]!.trim() : null;
}

/** Parcours guidé complet. Obstacle (captcha, blocage géographique, déconnecté…) : `{ obstacle }`. */
export async function recordSite(io: RecordIo, opts: RecordOptions = {}): Promise<SiteRecording | { obstacle: string }> {
  const now = opts.now ?? (() => new Date());
  const gp = io.page;
  const maxResponses = opts.maxResponses ?? 600;
  const afterLoad = opts.afterLoadMs ?? 800;
  const maxHtml = opts.maxPageHtml ?? 300_000;
  const startedAt = now().toISOString();
  const responses: RecordedResponse[] = [];
  const pending: Promise<void>[] = [];
  const seenUrls: string[] = [io.baseUrl];
  let frames = 0;

  io.onResponse((r) => {
    seenUrls.push(r.url);
    const kind = responseKind(r);
    if (!kind || responses.length + pending.length >= maxResponses) return;
    const at = now().toISOString();
    pending.push(
      r
        .body()
        .then((body) => {
          responses.push({
            url: r.url,
            method: r.method,
            ...(queryOf(r.url) ? { query: queryOf(r.url)! } : {}),
            requestBody: r.requestBody ? truncateBytes(r.requestBody, 20_000) : null,
            requestHeaders: usefulHeaders(r.requestHeaders),
            status: r.status,
            contentType: r.contentType,
            kind,
            body: truncateBytes(body, BOOKMAKER_LIMITS.recordBodyMaxBytes),
            at,
          });
        })
        .catch(() => undefined),
    );
  });
  io.onWebSocketFrame((f) => {
    seenUrls.push(f.url);
    if (frames >= maxResponses || NOISE_HOST.test(hostOf(f.url) ?? "")) return;
    frames++;
    responses.push({
      url: f.url,
      method: f.direction === "sent" ? "WS_SEND" : "WS",
      requestHeaders: {},
      status: 101,
      contentType: null,
      kind: "websocket",
      body: truncateBytes(f.payload, BOOKMAKER_LIMITS.recordBodyMaxBytes),
      at: now().toISOString(),
    });
  });

  const pages: RecordedPage[] = [];
  const pageOdds: PageOdd[] = [];
  let loginTried = false;

  /** Obstacle de la page affichée (captcha, géo-blocage, connexion demandée). */
  const obstacle = async (): Promise<string | null> => {
    const s = await gp.signals();
    const kind = detectPageObstacle(s, { afterLogin: loginTried });
    if (kind) return kind;
    const pw = gp.find("input[type=password]");
    if ((await pw.count()) > 0 && (await pw.isVisible().catch(() => false))) {
      if (loginTried) return "logged_out";
      loginTried = true;
      const r = await io.login();
      if (typeof r === "object") return r.obstacle;
      if (r === "skipped") return "logged_out";
      return "relogged";
    }
    return null;
  };

  const visit = async (url: string): Promise<string | null> => {
    await io.pace("page");
    await gp.goto(url);
    await gp.settle(8_000);
    await gp.pause(afterLoad);
    let o = await obstacle();
    if (o === "relogged") {
      await io.pace("page");
      await gp.goto(url);
      await gp.settle(8_000);
      await gp.pause(afterLoad);
      o = await obstacle();
      if (o === "relogged") o = "logged_out";
    }
    return o;
  };

  const snapshot = async (step: string, withOdds: boolean): Promise<RecordedPage> => {
    const { html, text } = await gp.readContent();
    const p: RecordedPage = { step, url: gp.url(), html: html.slice(0, maxHtml), text: text.slice(0, 100_000), screenshot: null };
    pages.push(p);
    if (withOdds) for (const o of pageOddsFromHtml(html)) if (!pageOdds.some((x) => sameOdd(x, o))) pageOdds.push(o);
    return p;
  };

  const tryClick = async (loc: ReadonlyLocator, purpose: "cookie_accept" | "market_tab"): Promise<boolean> => {
    try {
      if ((await loc.count()) === 0 || !(await loc.isVisible().catch(() => false))) return false;
      await io.pace("page");
      await gp.click(loc, purpose);
      await gp.settle(4_000);
      await gp.pause(Math.min(afterLoad, 500));
      return true;
    } catch (err) {
      io.logger?.warn({ err: (err as Error).message, purpose }, "[bookmakers] clic refusé ou impossible pendant l'enregistrement");
      return false;
    }
  };

  const done = async (): Promise<SiteRecording> => {
    await Promise.allSettled(pending);
    const frameUrls = io.frameUrls();
    const domains = new Set<string>();
    for (const u of [io.baseUrl, ...responses.map((r) => r.url), ...frameUrls]) {
      const h = hostOf(u);
      if (h) domains.add(h);
    }
    responses.sort((a, b) => a.at.localeCompare(b.at));
    return {
      siteKey: io.siteKey,
      baseUrl: io.baseUrl,
      startedAt,
      endedAt: now().toISOString(),
      responses,
      pages,
      domains: [...domains],
      providerHint: detectProviderHint([...seenUrls, ...frameUrls]),
      pageOdds,
    };
  };

  // 1. Section paris, cookies.
  const first = await visit(io.baseUrl);
  if (first) return { obstacle: first };
  await tryClick(gp.find(COOKIE_SELECTOR), "cookie_accept");
  const home = await snapshot("home", false);

  // 2. Football (lien suivi par son adresse, jamais cliqué).
  let current = home;
  const football = linksOf(home.html, home.url).find((l) => FOOTBALL_TEXT.test(foldText(l.text)) || /\/(football|soccer)\/?$/i.test(new URL(l.href).pathname));
  if (football && football.href !== home.url) {
    const o = await visit(football.href);
    if (o) return { obstacle: o };
    current = await snapshot("football", false);
  }

  // 3. Aujourd'hui (si le site a un sélecteur de jour), puis la liste.
  const today = linksOf(current.html, current.url).find((l) => TODAY_TEXT.test(foldText(l.text)));
  if (today && today.href !== current.url) {
    const o = await visit(today.href);
    if (o) return { obstacle: o };
  }
  const list = await snapshot("list-today", false);
  const listLinks = linksOf(list.html, list.url);

  // 4. Un match, puis 3 onglets de marchés.
  const eventLink = listLinks.find((l) => EVENT_HREF.test(new URL(l.href).pathname) && /\p{L}/u.test(l.text));
  let searchTerm: string | null = null;
  if (eventLink) {
    const o = await visit(eventLink.href);
    if (o) return { obstacle: o };
    const ev = await snapshot("event", true);
    searchTerm = homeTeamOf(pageOddsFromHtml(ev.html)[0]?.eventLabel ?? "") ?? homeTeamOf(eventLink.text);
    let n = 0;
    for (const tab of marketTabsOf(ev.html, 3)) {
      if (await tryClick(gp.find(selectorFor(tab)), "market_tab")) await snapshot(`market-${++n}`, true);
    }
  }

  // 5. Demain.
  const tomorrow = listLinks.find((l) => TOMORROW_TEXT.test(foldText(l.text)));
  if (tomorrow) {
    const o = await visit(tomorrow.href);
    if (!o) await snapshot("list-tomorrow", false);
  }

  // 6. Recherche d'une équipe (champ de recherche seulement ; jamais un montant).
  if (searchTerm) {
    try {
      const input = gp.find(SEARCH_SELECTOR);
      if ((await input.count()) > 0 && (await input.isVisible().catch(() => false))) {
        await io.pace("page");
        await gp.fill(input, searchTerm.slice(0, 60), "search");
        await gp.pressEnter(input, "search");
        await gp.settle(8_000);
        await gp.pause(afterLoad);
        if (!(await obstacle())) await snapshot("search", false);
      }
    } catch (err) {
      io.logger?.warn({ err: (err as Error).message }, "[bookmakers] recherche impossible pendant l'enregistrement");
    }
  }
  return done();
}

function sameOdd(a: PageOdd, b: PageOdd): boolean {
  return a.eventLabel === b.eventLabel && a.market === b.market && a.selection === b.selection && a.line === b.line && a.odds === b.odds;
}
