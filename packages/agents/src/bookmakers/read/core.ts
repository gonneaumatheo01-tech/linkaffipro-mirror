/**
 * Phase 35, chantier C : lecteur à trois niveaux d'un bookmaker du client.
 * - `readEvents` : matchs (cache `BookmakerEvent` 20 min) ; niveau 1 API interne de la recette (pagination, jeton :
 *   refus → session rafraîchie UNE fois par le transport puis reprise), sinon niveau 2 page affichée ;
 * - `readMarkets` : cotes d'un match (cache 3 min) ; une ligne `BookmakerOdds` par cote lue, avec son niveau ; noms du
 *   site gardés tels quels, traduits par la recette ; marché absent du site = n'existe pas ;
 * - `readOddsTwice` : DEUX chemins indépendants (API + page, ou page + image), à moins de 3 min, IDENTIQUES ;
 * Tout sous le verrou du site et au rythme humain ; aucune lecture la nuit sauf ordre ; échec → diagnostic de la page
 * et action (bascule sur le Mac, ré-apprentissage au plus une fois par 24 h, demande à l'humain), puis erreur claire.
 * Le lecteur ne clique jamais une cote ni un bouton de mise : il lit du texte, et ne passe au transport que des
 * onglets de la recette contrôlés par la garde de lecture.
 */
import { BOOKMAKER_LIMITS, type BookmakerTransport, type DomStep, type ReadLevel, type RecipeEndpoint, type SiteEvent, type SiteOdds } from "../contract";
import { forbiddenApiCallReason, forbiddenReadClickReason, forbiddenReadUrlReason } from "../guard";
import { SiteLockBusy } from "../transport/lock";
import { agentEvent } from "../../admin/journal";
import { eventUrlFromTemplate, readEventsFromHtml, readMarketsFromHtml, splitTeams, type DomOddsRow, type LastGood } from "./dom-read";
import { parseSiteDate, tzOffsetMinutes } from "./dates";
import {
  assertDaytime,
  BookmakerReadError,
  emitHook,
  loadSite,
  lockOf,
  nowOfDeps,
  paceOf,
  transportOf,
  type BookmakerReadDeps,
  type ReadSite,
} from "./deps";
import { diagnoseByRules, diagnosePage, gestureOf, type DiagnosedPage, type PageInput } from "./diagnose";
import { readOddsOnImage, selectionZone } from "./image";
import { asText, extractRows, keepRows, manifestVersions } from "./json-shape";
import { expandMarketKeys, translateRow, wantedSelection } from "./mapping";
import { sameLine, sameOddsExact, toDecimalOdds } from "./odds-format";
import { endpointFor, loadActiveRecipe, rememberLastGood, type ActiveRecipe } from "./recipe";

/** Une cote lue avec l'identifiant de sa ligne `BookmakerOdds`. */
export type StoredOdds = SiteOdds & { id: string };

type Ctx = {
  deps: BookmakerReadDeps;
  site: ReadSite;
  recipe: ActiveRecipe;
  transport: BookmakerTransport;
  hosts: string[];
  refreshed: boolean;
  /** Page qui a servi au rafraîchissement (diagnostic si le jeton est encore refusé). */
  refreshPage: PageInput | null;
};

/** Échec d'un niveau (le niveau suivant est essayé ; au bout, diagnostic et action). */
class LevelFailure extends Error {
  constructor(
    readonly level: ReadLevel,
    message: string,
    readonly page: PageInput | null = null,
    readonly forced: DiagnosedPage["diagnosis"] | null = null,
  ) {
    super(message);
  }
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.replace(/\{[a-zA-Z]+\}/g, "x")).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Domaine « de marque » (deux derniers libellés ; une adresse IP reste entière). Pur. */
function brandOf(host: string): string {
  return /^\d+(\.\d+){3}$/.test(host) ? host : host.split(".").slice(-2).join(".");
}

/**
 * Domaines permis : celui du site, ceux vus dans l'enregistrement qui a validé la recette (`validation.domains`).
 * Un point d'entrée de la recette n'ajoute son domaine que s'il est de la même marque que le site (`api.x.com` pour
 * `x.com`) : une recette qui viserait un domaine étranger est refusée par la garde, même enregistrée en base.
 */
export function allowedHostsOf(site: Pick<ReadSite, "baseUrl">, recipe: ActiveRecipe | null): string[] {
  const out = new Set<string>();
  const base = hostOf(site.baseUrl);
  if (base) out.add(base);
  for (const d of recipe?.domains ?? []) {
    const h = hostOf(d.includes("://") ? d : `https://${d}`);
    if (h) out.add(h);
  }
  for (const e of recipe?.api?.endpoints ?? []) {
    const h = hostOf(e.urlTemplate);
    if (h && base && brandOf(h) === brandOf(base)) out.add(h);
  }
  return [...out];
}

async function context(deps: BookmakerReadDeps, siteKey: string): Promise<Omit<Ctx, "transport">> {
  const site = await loadSite(deps, siteKey);
  if (!site) throw new BookmakerReadError("unknown_site", `je ne connais pas le bookmaker « ${siteKey} »`);
  if (!site.isActive) throw new BookmakerReadError("inactive", `${site.label} est désactivé`);
  const recipe = await loadActiveRecipe(deps, siteKey);
  if (!recipe) throw new BookmakerReadError("no_recipe", `${site.label} n'est pas encore appris (aucune méthode de lecture validée)`);
  return { deps, site, recipe, hosts: allowedHostsOf(site, recipe), refreshed: false, refreshPage: null };
}

// --- Niveau 1 : API interne -------------------------------------------------------------------------------------

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-zA-Z]+)\}/g, (m, k: string) => (k in vars ? encodeURIComponent(vars[k]!) : m));
}

function buildRequest(ep: RecipeEndpoint, vars: Record<string, string>): { method: string; url: string; headers?: string[]; body: string | null } {
  const url = new URL(fill(ep.urlTemplate, vars));
  const params = Object.fromEntries(Object.entries(ep.params ?? {}).map(([k, v]) => [k, v.replace(/\{([a-zA-Z]+)\}/g, (m, x: string) => vars[x] ?? m)]));
  if (ep.method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { method: ep.method, url: url.toString(), headers: ep.headers ?? [], body: ep.method === "POST" ? JSON.stringify(params) : null };
}

async function refreshSession(c: Ctx): Promise<void> {
  c.refreshed = true;
  if (!c.site.baseUrl) throw new LevelFailure("api", "session à rafraîchir mais adresse du site inconnue", null, "logged_out");
  await paceOf(c.deps)(c.site.key, "page");
  const p = await c.transport.page(c.site.key, { url: c.site.baseUrl });
  c.refreshPage = "obstacle" in p ? p : { url: p.url, html: p.html, text: p.text };
  if ("obstacle" in p) throw new LevelFailure("api", `rafraîchissement de la session impossible (${p.obstacle})`, p);
}

/** Appel d'API gardé (jamais de mise ni d'argent), au rythme du site ; jeton refusé : une seule reprise. */
async function callApi(c: Ctx, req: { method: string; url: string; headers?: string[]; body: string | null }): Promise<unknown> {
  const why = forbiddenApiCallReason(req, c.hosts);
  if (why) throw new LevelFailure("api", `appel refusé par la garde : ${why}`);
  for (;;) {
    await paceOf(c.deps)(c.site.key, "api");
    const r = await c.transport.fetchApi(c.site.key, req);
    if ("authExpired" in r) {
      if (c.refreshed) {
        // Jeton refusé après rafraîchissement : la page dit pourquoi si elle montre un obstacle humain (captcha, code,
        // mot de passe refusé) ; sinon c'est une session que le site refuse (« déconnecté », à l'humain).
        const shown = c.refreshPage ? diagnoseByRules(c.refreshPage) : null;
        const human = shown === "captcha" || shown === "two_factor" || shown === "password_refused" || shown === "geo_blocked";
        throw new LevelFailure("api", "le site refuse encore la session après rafraîchissement", human ? c.refreshPage : null, human ? null : "logged_out");
      }
      await refreshSession(c);
      continue;
    }
    if ("obstacle" in r) throw new LevelFailure("api", `le site bloque l'appel (${r.obstacle})`, r);
    if (r.status >= 400) throw new LevelFailure("api", `réponse ${r.status} de l'API du site`, r.status === 503 ? { text: r.body.slice(0, 2000), status: 503 } : null);
    try {
      return JSON.parse(r.body) as unknown;
    } catch {
      throw new LevelFailure("api", "réponse de l'API illisible (pas du JSON)", { text: r.body.slice(0, 4000) }, "site_changed");
    }
  }
}

/** Jours (fuseau du site, AAAA-MM-JJ) couverts par une fenêtre ; 4 au plus. Pur. */
export function daysOf(from: Date, to: Date, tz: string): string[] {
  const wall = (d: Date) => new Date(d.getTime() + tzOffsetMinutes(d, tz) * 60_000).toISOString().slice(0, 10);
  const out: string[] = [];
  for (let t = from.getTime(); t <= to.getTime() + 86_400_000 && out.length < 4; t += 86_400_000) {
    const d = wall(new Date(Math.min(t, to.getTime())));
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/** Toutes les pages d'un point d'entrée (pagination de la recette, arrêt sur une page vide). */
async function callPaged(c: Ctx, ep: RecipeEndpoint, vars: Record<string, string>, rowFields: string[]): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  const pg = ep.pagination;
  // Pagination par manifeste (Betby) : la première réponse liste les versions à lire, une adresse par version.
  if (pg?.manifest) {
    const manifest = await callApi(c, buildRequest({ ...ep, urlTemplate: pg.manifest.urlTemplate, pagination: null }, vars));
    for (const version of manifestVersions(manifest, pg.manifest.versionsPaths).slice(0, Math.max(1, Math.min(20, pg.max))))
      out.push(...keepRows(extractRows(await callApi(c, buildRequest({ ...ep, pagination: null }, { ...vars, version })), ep.responseShape, rowFields), ep.filter));
    return out;
  }
  const pages = pg ? Math.max(1, Math.min(20, pg.max)) : 1;
  let prevSig = "";
  for (let i = 0; i < pages; i++) {
    const v = pg ? { ...vars, page: String(pg.start + i * pg.step), [pg.param]: String(pg.start + i * pg.step) } : vars;
    const req = buildRequest(ep, v);
    if (pg && !ep.urlTemplate.includes("{page}") && !ep.urlTemplate.includes(`{${pg.param}}`) && !(ep.params && Object.values(ep.params).some((x) => x.includes("{page}")))) {
      const u = new URL(req.url);
      if (ep.method === "GET") u.searchParams.set(pg.param, String(pg.start + i * pg.step));
      req.url = u.toString();
      if (ep.method === "POST") req.body = JSON.stringify({ ...(req.body ? (JSON.parse(req.body) as object) : {}), [pg.param]: pg.start + i * pg.step });
    }
    const rows = keepRows(extractRows(await callApi(c, req), ep.responseShape, rowFields), ep.filter);
    if (!rows.length) break;
    // Même page rendue deux fois (le site ignore la pagination) : arrêt.
    const sig = JSON.stringify(rows[0]);
    if (i > 0 && sig === prevSig) break;
    prevSig = sig;
    out.push(...rows);
    // Indicateur « encore des pages » de la forme (`hasMore`, `next`) : faux ou vide = fini.
    const more = rows[0]!.hasMore ?? rows[0]!.next;
    if ("hasMore" in ep.responseShape || "next" in ep.responseShape) if (more === false || more === null || more === undefined || more === 0) break;
  }
  return out;
}

async function apiEvents(c: Ctx, q: { from: Date; to: Date }): Promise<SiteEvent[]> {
  const ep = endpointFor(c.recipe, "events");
  if (!ep) throw new LevelFailure("api", "aucun point d'entrée des matchs dans la recette");
  const now = nowOfDeps(c.deps);
  const tz = c.recipe.mapping.timezone;
  const dated = /\{date\}/.test(ep.urlTemplate) || Object.values(ep.params ?? {}).some((v) => v.includes("{date}"));
  const days = dated ? daysOf(q.from, q.to, tz) : [""];
  const events = new Map<string, SiteEvent>();
  for (const date of days) {
    const rows = await callPaged(c, ep, { date, sport: "football", league: "" }, ["id", "home", "away", "startsAt", "name"]);
    for (const r of rows) {
      const id = asText(r.id);
      let home = asText(r.home);
      let away = asText(r.away);
      if ((!home || !away) && asText(r.name)) {
        const s = splitTeams(asText(r.name));
        if (s) ({ home, away } = s);
      }
      const startsAt = parseSiteDate(asText(r.startsAt), tz, now);
      if (!id || !home || !away || !startsAt) continue;
      let url: string | null = null;
      const rawUrl = asText(r.url);
      if (rawUrl)
        try {
          url = new URL(rawUrl, c.site.baseUrl ?? undefined).toString();
        } catch {
          url = null;
        }
      // Sans adresse dans la réponse : modèle de la recette (`{eventId}` et les autres champs de la ligne).
      if (!url && c.recipe.api?.eventUrlTemplate) {
        const vars: Record<string, string> = { eventId: id };
        for (const [k, v] of Object.entries(r)) if (typeof v === "string" || typeof v === "number") vars[k] = String(v);
        url = eventUrlFromTemplate(c.recipe.api.eventUrlTemplate, vars);
      }
      const mc = Number(r.marketsCount);
      events.set(id, { siteEventId: id, league: asText(r.league), homeTeam: home, awayTeam: away, startsAt, url, marketsCount: Number.isFinite(mc) && r.marketsCount !== undefined ? mc : null });
    }
  }
  return [...events.values()];
}

async function apiOddsRows(c: Ctx, event: StoredEvent): Promise<DomOddsRow[]> {
  const ep = endpointFor(c.recipe, ["markets", "odds"]);
  if (!ep) throw new LevelFailure("api", "aucun point d'entrée des cotes dans la recette");
  const rows = await callPaged(c, ep, { eventId: event.siteEventId, sport: "football", date: "", league: "" }, ["market", "selection", "odds"]);
  return rows
    .filter((r) => r.eventId === undefined || asText(r.eventId) === event.siteEventId)
    .map((r) => ({ marketSite: asText(r.market), selectionSite: asText(r.selection), lineRaw: r.line === undefined || r.line === null ? null : asText(r.line), oddsRaw: (typeof r.odds === "number" ? r.odds : asText(r.odds)) as unknown as string }))
    .filter((r) => r.marketSite && r.selectionSite && (r.oddsRaw as unknown) !== "");
}

// --- Niveau 2 : page affichée -----------------------------------------------------------------------------------

/** Onglets de la recette passés au transport : chaque candidat est contrôlé par la garde de lecture (jamais de mise). */
function guardedClick(step: DomStep | undefined): DomStep | null {
  if (!step?.candidates?.length) return null;
  const ok = step.candidates.filter((c) => !forbiddenReadClickReason({ text: c.text ?? "", ownText: c.text ?? "", attributes: [c.css ?? "", c.role ? `role=${c.role}` : ""] }));
  return ok.length ? { candidates: ok, ...(typeof step.lastGood === "number" && ok.includes(step.candidates[step.lastGood]!) ? { lastGood: ok.indexOf(step.candidates[step.lastGood]!) } : {}) } : null;
}

async function openPage(c: Ctx, url: string, steps: Array<{ click?: DomStep; waitFor?: DomStep }>, captureOf: DomStep | null = null) {
  const why = forbiddenReadUrlReason(url, c.hosts);
  if (why) throw new LevelFailure("dom", `adresse refusée par la garde : ${why}`);
  await paceOf(c.deps)(c.site.key, "page");
  const p = await c.transport.page(c.site.key, { url, steps, captureOf });
  if ("obstacle" in p) throw new LevelFailure("dom", `le site bloque la page (${p.obstacle})`, p);
  return p;
}

function pageUrlOf(site: ReadSite): string | null {
  return site.baseUrl;
}

async function domEvents(c: Ctx, q: { from: Date; to: Date }): Promise<SiteEvent[]> {
  const dom = c.recipe.dom;
  const base = pageUrlOf(c.site);
  if (!dom || (!base && !dom.listUrls?.length)) throw new LevelFailure("dom", "aucune méthode de lecture de la page dans la recette");
  const now = nowOfDeps(c.deps);
  // Widget sans lien (phase 35, suite) : pages de liste connues (aujourd'hui, demain), chacune ouverte directement ;
  // sinon l'adresse du site puis les clics « football » et « aujourd'hui » de la recette.
  const today = daysOf(now, now, c.recipe.mapping.timezone)[0] ?? now.toISOString().slice(0, 10);
  const targets: Array<{ url: string; clicks: DomStep[] }> = dom.listUrls?.length
    ? dom.listUrls.map((u) => ({ url: u.split("{date}").join(today), clicks: [guardedClick(dom.dayToday)].filter((x): x is DomStep => !!x) }))
    : [{ url: base!, clicks: [guardedClick(dom.football), guardedClick(dom.dayToday)].filter((x): x is DomStep => !!x) }];
  const events = new Map<string, SiteEvent>();
  let rows = 0;
  let last: { url: string; html: string; text: string } | null = null;
  const good: LastGood = {};
  for (const t of targets) {
    const steps: Array<{ click?: DomStep; waitFor?: DomStep }> = t.clicks.map((click) => ({ click }));
    steps.push({ waitFor: dom.eventList });
    const p = await openPage(c, t.url, steps);
    last = { url: p.url, html: p.html, text: p.text };
    const r = readEventsFromHtml(p.html, dom, { pageUrl: p.url, timezone: c.recipe.mapping.timezone, now });
    rows += r.rows;
    Object.assign(good, r.lastGood);
    for (const e of r.events) if (!events.has(e.siteEventId)) events.set(e.siteEventId, e);
  }
  if (!rows) throw new LevelFailure("dom", "aucune ligne de match trouvée sur la page", last);
  if (!events.size) throw new LevelFailure("dom", "lignes de match illisibles (structure changée ?)", last, "site_changed");
  await rememberLastGood(c.deps, c.recipe, good);
  void q;
  return [...events.values()];
}

async function domOddsRows(c: Ctx, event: StoredEvent): Promise<{ rows: DomOddsRow[]; good: LastGood }> {
  const dom = c.recipe.dom;
  if (!dom) throw new LevelFailure("dom", "aucune méthode de lecture de la page dans la recette");
  if (!event.url) throw new LevelFailure("dom", "adresse de la fiche du match inconnue");
  const steps: Array<{ click?: DomStep; waitFor?: DomStep }> = [];
  const tab = guardedClick(dom.marketTab);
  if (tab) steps.push({ click: tab });
  steps.push({ waitFor: dom.market.selection });
  const p = await openPage(c, event.url, steps);
  const r = readMarketsFromHtml(p.html, dom);
  if (!r.selections) throw new LevelFailure("dom", "aucune cote trouvée sur la fiche du match", { url: p.url, html: p.html, text: p.text });
  if (!r.rows.length) throw new LevelFailure("dom", "cotes illisibles sur la fiche du match (structure changée ?)", { url: p.url, html: p.html, text: p.text }, "site_changed");
  return { rows: r.rows, good: r.lastGood };
}

// --- Échecs : diagnostic et action ------------------------------------------------------------------------------

async function relearnOnce(c: Pick<Ctx, "deps" | "site">): Promise<boolean> {
  const deps = c.deps;
  const now = nowOfDeps(deps);
  const since = new Date(now.getTime() - BOOKMAKER_LIMITS.relearnMinIntervalMs);
  const recent = (await deps.prisma.bookmakerReadJob.findMany({ where: { siteKey: c.site.key, kind: "learn", createdAt: { gte: since } } })) as Array<{ params: unknown }>;
  const recipes = (await deps.prisma.bookmakerRecipe.findMany({ where: { siteKey: c.site.key, createdBy: "repair", createdAt: { gte: since } } })) as unknown[];
  if (recipes.length || recent.some((j) => (j.params as { reason?: unknown } | null)?.reason === "repair")) return false;
  const learn = deps.bookmakers?.learnSite;
  const job = await deps.prisma.bookmakerReadJob.create({
    data: { siteKey: c.site.key, kind: "learn", target: "server", status: learn ? "CLAIMED" : "FAILED", params: { reason: "repair", by: "lecture" } as never, claimedAt: now, createdAt: now } as never,
  });
  if (!learn) {
    await emitHook(deps, { type: "relearn", siteKey: c.site.key, ok: false, message: "ré-apprentissage non branché ici" });
    return false;
  }
  try {
    const r = await learn(deps, c.site.key, { reason: "repair" });
    await deps.prisma.bookmakerReadJob.update({ where: { id: (job as { id: string }).id }, data: { status: r.ok ? "DONE" : "FAILED", finishedAt: nowOfDeps(deps), result: { ok: r.ok, status: r.status } as never } });
    await emitHook(deps, { type: "relearn", siteKey: c.site.key, ok: r.ok, message: r.message });
    return r.ok;
  } catch (err) {
    await deps.prisma.bookmakerReadJob.update({ where: { id: (job as { id: string }).id }, data: { status: "FAILED", finishedAt: nowOfDeps(deps), result: { error: (err as Error).message.slice(0, 200) } as never } });
    await emitHook(deps, { type: "relearn", siteKey: c.site.key, ok: false, message: (err as Error).message.slice(0, 200) });
    return false;
  }
}

/** Diagnostic de l'échec et action ; rend vrai si un nouvel essai a un sens (ré-apprentissage réussi). */
async function handleFailure(c: Ctx, f: LevelFailure, what: "events" | "markets" | "odds"): Promise<{ retry: boolean; error: BookmakerReadError }> {
  const d = f.forced
    ? { diagnosis: f.forced, source: "rules" as const, action: f.forced === "site_changed" ? ("relearn" as const) : f.forced === "logged_out" ? ("ask_human" as const) : ("none" as const), gesture: gestureOf(f.forced), costCents: 0 }
    : f.page
      ? await diagnosePage(c.deps, f.page, { target: c.transport.target, siteKey: c.site.key })
      : null;
  let action = d?.action ?? "none";
  // Session déjà rafraîchie une fois : c'est à l'humain (mot de passe, code).
  if (action === "refresh_session" && c.refreshed) action = "ask_human";
  const gesture = d?.diagnosis === "logged_out" && c.refreshed ? "le site refuse la session même après reconnexion : redonne-moi le mot de passe du compte en privé" : (d?.gesture ?? f.message);
  let retry = false;
  if (d) {
    if (action === "switch_to_mac") {
      if (c.deps.bookmakers?.switchToMac) await c.deps.bookmakers.switchToMac(c.site.key, d.diagnosis);
      else if (c.site.readTarget !== "mac") await c.deps.prisma.bookmakerSite.update({ where: { key: c.site.key }, data: { readTarget: "mac", statusReason: `lecture depuis le Mac : ${gesture}`.slice(0, 300) } });
      await emitHook(c.deps, { type: "switched_to_mac", siteKey: c.site.key, diagnosis: d.diagnosis });
    } else if (action === "relearn") {
      retry = await relearnOnce(c);
      if (!retry) await emitHook(c.deps, { type: "needs_human", siteKey: c.site.key, diagnosis: d.diagnosis, gesture });
    } else if (action === "ask_human") await emitHook(c.deps, { type: "needs_human", siteKey: c.site.key, diagnosis: d.diagnosis, gesture });
  }
  await emitHook(c.deps, { type: "read_failed", siteKey: c.site.key, what, reason: f.message.slice(0, 200), level: f.level });
  await agentEvent(c.deps, "agents.bookmakers.read_failed", { siteKey: c.site.key, what, level: f.level, reason: f.message.slice(0, 200), diagnosis: d?.diagnosis ?? null, action });
  const msg = d && d.diagnosis !== "empty" ? `${c.site.label} : ${gesture}` : `${c.site.label} : ${f.message}`;
  return { retry, error: new BookmakerReadError(d?.diagnosis ?? "read_failed", msg, d?.diagnosis ?? null) };
}

/** Obstacles reconnus par les règles (blocage, captcha, code, mot de passe, maintenance) : ils priment. */
const OBSTACLE_DIAGNOSES: ReadonlySet<string> = new Set(["geo_blocked", "captcha", "two_factor", "password_refused", "maintenance"]);

/** Essaie les niveaux dans l'ordre ; tous en échec : diagnostic du dernier, action, une reprise après ré-apprentissage. */
async function withLevels<T>(c: Ctx, what: "events" | "markets" | "odds", levels: Array<{ level: ReadLevel; run: () => Promise<T> }>): Promise<{ value: T; level: ReadLevel }> {
  for (let round = 0; round < 2; round++) {
    const failures: LevelFailure[] = [];
    for (const l of levels) {
      try {
        return { value: await l.run(), level: l.level };
      } catch (err) {
        if (!(err instanceof LevelFailure)) throw err;
        failures.push(err);
      }
    }
    // L'échec le plus parlant décide : une cause déjà établie (session refusée, structure changée) passe avant la page
    // d'un niveau suivant (une page vide ne doit pas cacher une session refusée).
    const obstacle = failures.find((f) => f.page && !f.forced && OBSTACLE_DIAGNOSES.has(diagnoseByRules(f.page) ?? "ok"));
    const last = obstacle ?? failures.find((f) => f.forced) ?? failures[failures.length - 1] ?? null;
    if (!last) throw new BookmakerReadError("no_level", `${c.site.label} : aucune façon de lire ce site dans sa méthode apprise`);
    // Page vide (aucun match pour l'instant) : pas une panne.
    if (last.page && !last.forced) {
      const quick = await diagnosePage({ ...c.deps, bookmakers: { ...c.deps.bookmakers, llm: null } }, last.page, { target: c.transport.target });
      if (quick.diagnosis === "empty" && what === "events") return { value: [] as unknown as T, level: last.level };
    }
    const h = await handleFailure(c, last, what);
    if (!h.retry || round > 0) throw h.error;
    const recipe = await loadActiveRecipe(c.deps, c.site.key);
    if (!recipe) throw h.error;
    c.recipe = recipe;
    c.hosts = allowedHostsOf(c.site, recipe);
  }
  throw new BookmakerReadError("read_failed", `${c.site.label} : lecture impossible`);
}

function levelsFor<T>(c: Ctx, api: () => Promise<T>, dom: () => Promise<T>): Array<{ level: ReadLevel; run: () => Promise<T> }> {
  const out: Array<{ level: ReadLevel; run: () => Promise<T> }> = [];
  if (c.recipe.api) out.push({ level: "api", run: api });
  if (c.recipe.dom) out.push({ level: "dom", run: dom });
  return out;
}

// --- Cache et écritures -----------------------------------------------------------------------------------------

export type StoredEvent = SiteEvent & { oddsEventId: string | null; leagueKey: string | null; fetchedAt: Date };

function toStoredEvent(r: Record<string, unknown>): StoredEvent {
  return {
    siteEventId: String(r.siteEventId),
    league: String(r.league ?? ""),
    homeTeam: String(r.homeTeam),
    awayTeam: String(r.awayTeam),
    startsAt: new Date(r.startsAt as Date),
    url: typeof r.url === "string" ? r.url : null,
    marketsCount: typeof r.marketsCount === "number" ? r.marketsCount : null,
    oddsEventId: typeof r.oddsEventId === "string" ? r.oddsEventId : null,
    leagueKey: typeof r.leagueKey === "string" ? r.leagueKey : null,
    fetchedAt: new Date(r.fetchedAt as Date),
  };
}

export async function storedEvent(deps: Pick<BookmakerReadDeps, "prisma">, siteKey: string, siteEventId: string): Promise<StoredEvent | null> {
  const r = (await deps.prisma.bookmakerEvent.findUnique({ where: { siteKey_siteEventId: { siteKey, siteEventId } } })) as Record<string, unknown> | null;
  return r ? toStoredEvent(r) : null;
}

export async function storedEvents(deps: Pick<BookmakerReadDeps, "prisma">, siteKey: string, q: { from: Date; to: Date }): Promise<StoredEvent[]> {
  const rows = (await deps.prisma.bookmakerEvent.findMany({ where: { siteKey, startsAt: { gte: q.from, lte: q.to } }, orderBy: { startsAt: "asc" } })) as Array<Record<string, unknown>>;
  return rows.map(toStoredEvent);
}

function leagueMatches(e: Pick<SiteEvent, "league"> & { leagueKey?: string | null }, leagues: readonly string[] | undefined): boolean {
  if (!leagues?.length) return true;
  const f = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const name = f(e.league);
  return leagues.some((l) => l === e.leagueKey || (f(l) !== "" && (name === f(l) || name.endsWith(` ${f(l)}`) || name.includes(f(l)))));
}

async function recordJob(deps: BookmakerReadDeps, i: { siteKey: string; kind: "events" | "markets" | "verify"; target: string; params: Record<string, unknown>; result: Record<string, unknown>; at: Date; ok: boolean }): Promise<string> {
  const row = (await deps.prisma.bookmakerReadJob.create({
    data: { siteKey: i.siteKey, kind: i.kind, target: i.target, status: i.ok ? "DONE" : "FAILED", params: i.params as never, result: i.result as never, attempts: 1, claimedAt: i.at, finishedAt: i.at, createdAt: i.at } as never,
  })) as { id: string };
  return row.id;
}

type JobRow = { id: string; status: string; params: unknown; createdAt: Date; finishedAt: Date | null };

async function freshJobs(deps: BookmakerReadDeps, siteKey: string, kind: string, ttlMs: number): Promise<JobRow[]> {
  const since = new Date(nowOfDeps(deps).getTime() - ttlMs);
  return (await deps.prisma.bookmakerReadJob.findMany({ where: { siteKey, kind, status: "DONE", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 50 })) as JobRow[];
}

const paramsOf = (j: JobRow) => (j.params && typeof j.params === "object" ? (j.params as Record<string, unknown>) : {});

async function markRead(deps: BookmakerReadDeps, siteKey: string, ok: boolean): Promise<void> {
  const now = nowOfDeps(deps);
  try {
    await deps.prisma.bookmakerSite.update({ where: { key: siteKey }, data: ok ? { lastReadAt: now, lastOkAt: now } : { lastReadAt: now } });
  } catch {
    /* sans effet sur la lecture */
  }
}

// --- API publique -----------------------------------------------------------------------------------------------

export type ReadEventsQuery = { from: Date; to: Date; leagues?: string[]; force?: boolean; fresh?: boolean };

/** Matchs d'un site sur une fenêtre (cache 20 min). */
export async function readEvents(deps: BookmakerReadDeps, siteKey: string, q: ReadEventsQuery): Promise<SiteEvent[]> {
  return (await readEventsStored(deps, siteKey, q)).map(({ oddsEventId: _o, leagueKey: _l, fetchedAt: _f, ...e }) => e);
}

/** Comme `readEvents`, avec la correspondance chez le fournisseur de résultats et l'heure de lecture. */
export async function readEventsStored(deps: BookmakerReadDeps, siteKey: string, q: ReadEventsQuery): Promise<StoredEvent[]> {
  const cached = q.fresh ? null : await cachedEvents(deps, siteKey, q);
  if (cached) return cached.filter((e) => leagueMatches(e, q.leagues));
  assertDaytime(deps, q.force);
  const base = await context(deps, siteKey);
  return lockOf(deps)(siteKey, async () => {
    const c: Ctx = { ...base, transport: await transportOf(deps, base.site) };
    const at0 = nowOfDeps(deps);
    let got: { value: SiteEvent[]; level: ReadLevel };
    try {
      got = await withLevels(c, "events", levelsFor(c, () => apiEvents(c, q), () => domEvents(c, q)));
    } catch (err) {
      await markRead(deps, siteKey, false);
      await recordJob(deps, { siteKey, kind: "events", target: c.transport.target, params: { from: q.from.toISOString(), to: q.to.toISOString() }, result: { error: (err as Error).message.slice(0, 200) }, at: at0, ok: false });
      throw err;
    }
    const now = nowOfDeps(deps);
    for (const e of got.value) {
      const data = { league: e.league, homeTeam: e.homeTeam, awayTeam: e.awayTeam, startsAt: e.startsAt, url: e.url ?? null, marketsCount: e.marketsCount ?? null, fetchedAt: now };
      await deps.prisma.bookmakerEvent.upsert({ where: { siteKey_siteEventId: { siteKey, siteEventId: e.siteEventId } }, create: { siteKey, siteEventId: e.siteEventId, ...data }, update: data });
    }
    await recordJob(deps, { siteKey, kind: "events", target: c.transport.target, params: { from: q.from.toISOString(), to: q.to.toISOString() }, result: { count: got.value.length, level: got.level, durationMs: now.getTime() - at0.getTime() }, at: at0, ok: true });
    await markRead(deps, siteKey, true);
    const ids = new Set(got.value.map((e) => e.siteEventId));
    return (await storedEvents(deps, siteKey, q)).filter((e) => ids.has(e.siteEventId) && e.startsAt >= q.from && e.startsAt <= q.to && leagueMatches(e, q.leagues));
  });
}

async function cachedEvents(deps: BookmakerReadDeps, siteKey: string, q: { from: Date; to: Date }): Promise<StoredEvent[] | null> {
  const jobs = await freshJobs(deps, siteKey, "events", BOOKMAKER_LIMITS.eventsTtlMs);
  const job = jobs.find((j) => {
    const p = paramsOf(j);
    return typeof p.from === "string" && typeof p.to === "string" && new Date(p.from).getTime() <= q.from.getTime() + 60_000 && new Date(p.to).getTime() >= q.to.getTime() - 60_000;
  });
  if (!job) return null;
  return (await storedEvents(deps, siteKey, q)).filter((e) => e.fetchedAt.getTime() >= job.createdAt.getTime() - 1000);
}

function toStoredOdds(r: Record<string, unknown>): StoredOdds {
  return {
    id: String(r.id),
    siteEventId: String(r.siteEventId),
    marketSite: String(r.marketSite),
    marketKey: typeof r.marketKey === "string" ? r.marketKey : null,
    selectionSite: String(r.selectionSite),
    selectionKey: typeof r.selectionKey === "string" ? r.selectionKey : null,
    line: typeof r.line === "number" ? r.line : null,
    odds: Number(r.odds),
    level: (r.level === "api" || r.level === "dom" || r.level === "image" ? r.level : "dom") as ReadLevel,
    readAt: new Date(r.readAt as Date),
  };
}

/** Lignes du site → cotes traduites, converties, filtrées (aucune cote inventée : illisible = écartée). */
function translateAll(rows: DomOddsRow[], c: Ctx, event: StoredEvent, patterns: string[], level: ReadLevel, at: Date): SiteOdds[] {
  const out: SiteOdds[] = [];
  for (const r of rows) {
    const odds = toDecimalOdds(r.oddsRaw, c.recipe.mapping.oddsFormat);
    if (odds === null) continue;
    const t = translateRow({ marketSite: r.marketSite, selectionSite: r.selectionSite, lineRaw: r.lineRaw }, c.recipe.mapping, event);
    if (!wantedSelection(t.selectionKey, patterns)) continue;
    out.push({ siteEventId: event.siteEventId, marketSite: r.marketSite, marketKey: t.marketKey, selectionSite: r.selectionSite, selectionKey: t.selectionKey, line: t.line, odds, level, readAt: at });
  }
  return out;
}

async function storeOdds(deps: BookmakerReadDeps, siteKey: string, odds: SiteOdds[], jobId: string): Promise<StoredOdds[]> {
  const out: StoredOdds[] = [];
  for (const o of odds) {
    const row = (await deps.prisma.bookmakerOdds.create({ data: { siteKey, ...o, jobId } })) as Record<string, unknown>;
    out.push(toStoredOdds(row));
  }
  return out;
}

/** Lecture d'un niveau précis (api ou dom) des cotes d'un match, écrite en base. */
async function readOddsAt(c: Ctx, event: StoredEvent, patterns: string[], level: "api" | "dom", jobKind: "markets" | "verify", marketKeys: string[]): Promise<StoredOdds[]> {
  let rows: DomOddsRow[];
  let good: LastGood = {};
  if (level === "api") rows = await apiOddsRows(c, event);
  else ({ rows, good } = await domOddsRows(c, event));
  // Heure de lecture = quand la réponse est arrivée (fenêtre de 3 min de la double lecture).
  const at = nowOfDeps(c.deps);
  await rememberLastGood(c.deps, c.recipe, good);
  const odds = translateAll(rows, c, event, patterns, level, at);
  const jobId = await recordJob(c.deps, { siteKey: c.site.key, kind: jobKind, target: c.transport.target, params: { siteEventId: event.siteEventId, marketKeys, level }, result: { rows: rows.length, kept: odds.length, level }, at, ok: true });
  return storeOdds(c.deps, c.site.key, odds, jobId);
}

export type ReadMarketsOptions = { fresh?: boolean; force?: boolean };

/** Cotes d'un match pour des marchés (clés internes ou du fournisseur ; vide = tout ce que la recette traduit). */
export async function readMarkets(deps: BookmakerReadDeps, siteKey: string, siteEventId: string, marketKeys: string[], opts: ReadMarketsOptions = {}): Promise<SiteOdds[]> {
  return (await readMarketsStored(deps, siteKey, siteEventId, marketKeys, opts)).map(({ id: _id, ...o }) => o);
}

export async function readMarketsStored(deps: BookmakerReadDeps, siteKey: string, siteEventId: string, marketKeys: string[], opts: ReadMarketsOptions = {}): Promise<StoredOdds[]> {
  const patterns = expandMarketKeys(marketKeys);
  if (!opts.fresh) {
    const hit = await cachedOdds(deps, siteKey, siteEventId, marketKeys, patterns);
    if (hit) return hit;
  }
  assertDaytime(deps, opts.force);
  const base = await context(deps, siteKey);
  const event = await storedEvent(deps, siteKey, siteEventId);
  if (!event) throw new BookmakerReadError("unknown_event", `${base.site.label} : match ${siteEventId} inconnu (relire la liste des matchs)`);
  return lockOf(deps)(siteKey, async () => {
    const c: Ctx = { ...base, transport: await transportOf(deps, base.site) };
    try {
      const got = await withLevels(c, "markets", levelsFor(c, () => readOddsAt(c, event, patterns, "api", "markets", marketKeys), () => readOddsAt(c, event, patterns, "dom", "markets", marketKeys)));
      await markRead(deps, siteKey, true);
      return got.value;
    } catch (err) {
      await markRead(deps, siteKey, false);
      throw err;
    }
  });
}

async function cachedOdds(deps: BookmakerReadDeps, siteKey: string, siteEventId: string, marketKeys: string[], patterns: string[]): Promise<StoredOdds[] | null> {
  const jobs = await freshJobs(deps, siteKey, "markets", BOOKMAKER_LIMITS.oddsTtlMs);
  const job = jobs.find((j) => {
    const p = paramsOf(j);
    if (p.siteEventId !== siteEventId) return false;
    const had = Array.isArray(p.marketKeys) ? (p.marketKeys as string[]) : [];
    return had.length === 0 || (marketKeys.length > 0 && marketKeys.every((k) => had.includes(k)));
  });
  if (!job) return null;
  const rows = (await deps.prisma.bookmakerOdds.findMany({ where: { siteKey, siteEventId, jobId: job.id } })) as Array<Record<string, unknown>>;
  return rows.map(toStoredOdds).filter((o) => wantedSelection(o.selectionKey, patterns));
}

export type OddsTwiceQuery = { siteEventId: string; marketKey: string; selectionKey: string; line: number | null; force?: boolean };

export type OddsTwiceResult =
  | { ok: true; odds: number; readIds: [string, string]; levels: [ReadLevel, ReadLevel]; readAt: [Date, Date]; marketSite: string; selectionSite: string }
  | { ok: false; reason: string; reads: SiteOdds[]; code: "missing" | "single" | "mismatch" | "too_far" | "night" | "no_paths" | "busy" | "error" };

const matchOf = (list: readonly StoredOdds[], q: OddsTwiceQuery) => list.find((o) => o.selectionKey === q.selectionKey && sameLine(o.line, q.line)) ?? null;

/**
 * Double lecture d'une cote (règle 3) : deux chemins INDÉPENDANTS (API + page ; sinon page + image ; sinon API +
 * image), jamais servis par le cache, à moins de 3 min l'un de l'autre (sinon on relit une fois), IDENTIQUES.
 */
export async function readOddsTwice(deps: BookmakerReadDeps, siteKey: string, q: OddsTwiceQuery): Promise<OddsTwiceResult> {
  try {
    assertDaytime(deps, q.force);
  } catch (err) {
    return { ok: false, reason: (err as Error).message, reads: [], code: "night" };
  }
  let base: Omit<Ctx, "transport">;
  let event: StoredEvent | null;
  try {
    base = await context(deps, siteKey);
    event = await storedEvent(deps, siteKey, q.siteEventId);
  } catch (err) {
    return { ok: false, reason: (err as Error).message, reads: [], code: "error" };
  }
  if (!event) return { ok: false, reason: `match ${q.siteEventId} inconnu chez ${base.site.label}`, reads: [], code: "error" };
  const ev = event;
  const patterns = [q.selectionKey];
  try {
    return await readOddsTwiceLocked(deps, siteKey, q, base, ev, patterns);
  } catch (err) {
    // Un autre lecteur tient le site (verrou du chantier A) : on réessaiera, ce n'est ni une panne ni à l'humain.
    if (err instanceof SiteLockBusy) return { ok: false, reason: `${base.site.label} est en cours de lecture par un autre travail`, reads: [], code: "busy" };
    throw err;
  }
}

const teamKey = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Match lu par la lecture directe sans adresse de page : une lecture de la liste par la page retrouve son adresse
 * (même identifiant, ou mêmes équipes à ± 15 min), gardée sur `BookmakerEvent.url`. Sans elle, aucun second chemin
 * indépendant n'existerait pour la double lecture. Échec → match inchangé (la double lecture le dira).
 */
async function ensureEventUrl(c: Ctx, ev: StoredEvent): Promise<StoredEvent> {
  if (ev.url || !c.recipe.dom) return ev;
  let list: SiteEvent[];
  try {
    list = await domEvents(c, { from: new Date(ev.startsAt.getTime() - 12 * 3600_000), to: new Date(ev.startsAt.getTime() + 12 * 3600_000) });
  } catch (err) {
    if (err instanceof LevelFailure) return ev;
    throw err;
  }
  const home = teamKey(ev.homeTeam);
  const away = teamKey(ev.awayTeam);
  const found = list.find((e) => e.url && (e.siteEventId === ev.siteEventId || (teamKey(e.homeTeam) === home && teamKey(e.awayTeam) === away && Math.abs(e.startsAt.getTime() - ev.startsAt.getTime()) <= BOOKMAKER_LIMITS.kickoffMatchToleranceMs)));
  if (!found?.url) return ev;
  await c.deps.prisma.bookmakerEvent.updateMany({ where: { siteKey: c.site.key, siteEventId: ev.siteEventId }, data: { url: found.url } });
  return { ...ev, url: found.url };
}

async function readOddsTwiceLocked(deps: BookmakerReadDeps, siteKey: string, q: OddsTwiceQuery, base: Omit<Ctx, "transport">, ev: StoredEvent, patterns: string[]): Promise<OddsTwiceResult> {
  return lockOf(deps)(siteKey, async () => {
    let transport: BookmakerTransport;
    try {
      transport = await transportOf(deps, base.site);
    } catch (err) {
      return { ok: false, reason: (err as Error).message, reads: [], code: "error" } as const;
    }
    const c: Ctx = { ...base, transport };
    ev = await ensureEventUrl(c, ev);
    const reads: SiteOdds[] = [];
    const strip = (o: StoredOdds): SiteOdds => {
      const { id: _id, ...rest } = o;
      return rest;
    };
    const one = async (level: ReadLevel, ref: StoredOdds | null): Promise<StoredOdds | null | "failed"> => {
      try {
        if (level === "image") {
          const img = await imageRead(c, ev, q, ref);
          if (img !== "failed" && img) reads.push(strip(img));
          return img;
        }
        const list = await readOddsAt(c, ev, patterns, level, "verify", [q.marketKey]);
        const m = matchOf(list, q);
        if (m) reads.push(strip(m));
        return m;
      } catch (err) {
        if (err instanceof LevelFailure) {
          c.deps.logger?.warn({ siteKey, level, err: err.message }, "[bookmakers] chemin de vérification en échec");
          return "failed";
        }
        throw err;
      }
    };
    const hasApi = !!endpointFor(c.recipe, ["markets", "odds"]);
    const hasDom = !!c.recipe.dom && !!ev.url;
    const combos: Array<[ReadLevel, ReadLevel]> = [];
    if (hasApi && hasDom) combos.push(["api", "dom"]);
    if (hasDom) combos.push(["dom", "image"]);
    if (hasApi && hasDom) combos.push(["api", "image"]);
    if (!combos.length) return { ok: false, reason: `${c.site.label} : un seul chemin de lecture connu, la cote ne peut pas être vérifiée deux fois`, reads, code: "no_paths" };
    for (let attempt = 0; attempt < 2; attempt++) {
      let tooFar = false;
      for (const [l1, l2] of combos) {
        const a = await one(l1, null);
        if (a === "failed") continue;
        if (a === null) {
          // Le premier chemin ne voit pas la sélection : le second confirme-t-il son absence ?
          const b0 = l2 === "image" ? null : await one(l2, null);
          if (b0 === "failed") continue;
          if (b0 === null) return { ok: false, reason: `sélection absente chez ${c.site.label} (lue par ${l1}${l2 === "image" ? "" : ` et ${l2}`})`, reads, code: "missing" };
          return { ok: false, reason: `cote vue par un seul chemin (${l2}) chez ${c.site.label}`, reads, code: "single" };
        }
        const b = await one(l2, a);
        if (b === "failed") continue;
        if (b === null) return { ok: false, reason: `cote vue par un seul chemin (${l1}) chez ${c.site.label}`, reads, code: "single" };
        if (Math.abs(a.readAt.getTime() - b.readAt.getTime()) > BOOKMAKER_LIMITS.doubleReadWindowMs) {
          tooFar = true;
          break;
        }
        if (!sameOddsExact(a.odds, b.odds) || !sameLine(a.line, b.line))
          return { ok: false, reason: `les deux lectures diffèrent chez ${c.site.label} : ${a.odds} (${l1}) et ${b.odds} (${l2})`, reads, code: "mismatch" };
        return { ok: true, odds: a.odds, readIds: [a.id, b.id], levels: [l1, l2], readAt: [a.readAt, b.readAt], marketSite: a.marketSite, selectionSite: a.selectionSite };
      }
      if (!tooFar) return { ok: false, reason: `${c.site.label} : lecture impossible par deux chemins`, reads, code: "error" };
    }
    return { ok: false, reason: `${c.site.label} : les deux lectures sont à plus de 3 minutes d'écart, même relues`, reads, code: "too_far" };
  });
}

/** Niveau 3 : capture de la zone de LA sélection (déjà vue par un autre chemin) puis lecture par Opus vision. */
async function imageRead(c: Ctx, event: StoredEvent, q: OddsTwiceQuery, ref: StoredOdds | null): Promise<StoredOdds | null | "failed"> {
  const dom = c.recipe.dom;
  if (!ref || !dom || !event.url) return "failed";
  const p = await openPage(c, event.url, [{ waitFor: dom.market.selection }], selectionZone(dom.market.selection, ref.selectionSite));
  if (!p.image) return "failed";
  const at = nowOfDeps(c.deps);
  const r = await readOddsOnImage(c.deps, { image: p.image, marketSite: ref.marketSite, selectionSite: ref.selectionSite, line: ref.line, format: c.recipe.mapping.oddsFormat });
  if (r.odds === null) return "failed";
  const jobId = await recordJob(c.deps, { siteKey: c.site.key, kind: "verify", target: c.transport.target, params: { siteEventId: event.siteEventId, marketKeys: [q.marketKey], level: "image" }, result: { level: "image", costCents: r.costCents }, at, ok: true });
  const [row] = await storeOdds(c.deps, c.site.key, [{ ...ref, odds: r.odds, level: "image", readAt: at }].map(({ id: _i, ...o }) => o as SiteOdds), jobId);
  return row ?? "failed";
}

export { diagnosePage };
