/**
 * Phase 35 (chantier B, règles 5 et 6) — APPRENDRE UN SITE, de bout en bout :
 *   LEARNING → enregistrement guidé (`pickTransport` + `transport.record` : serveur, ou Mac si le serveur est refusé)
 *   → masquage (`maskRecording`, aucun secret ne survit) → recette d'un site du même moteur de paris
 *   (`reuseRecipeByProvider`, essayée AVANT l'IA) → Opus (`analyzeRecording`) → validation sur l'enregistrement
 *   (`validateRecipe`) → deuxième passe d'Opus avec les écarts → repli « page seule » (`dom`) → sinon BLOCKED avec la
 *   raison. Recette validée → contrôle RÉEL (une lecture des matchs et d'un match, comparée à la page) → READY, recette
 *   version + 1 active, l'ancienne gardée inactive (consultable).
 * Au plus une tentative par 24 h (`Setting bookmakers.learn.<site>`), sauf demande de l'admin (`manual`, permise aussi
 * la nuit : c'est un ordre). Un seul lecteur à la fois par site (verrou du chantier A, réentrant). Jamais de mise :
 * le parcours et le contrôle ne passent que par la page gardée et les appels contrôlés par `guard.ts`.
 */
import { agentEvent } from "../../admin/journal";
import { loadLlmProvider } from "../../providers/llm";
import type { AgentsDeps, LlmProvider } from "../../types";
import {
  BOOKMAKER_LIMITS,
  type BookmakerTransport,
  type DomStep,
  type RecipeData,
  type RecipeEndpoint,
  type RecipeValidation,
  type SiteEvent,
  type SiteRecording,
  type SiteStatus,
} from "../contract";
import { readBookmakerCredentialsFor } from "../credentials";
import { forbiddenApiCallReason, forbiddenReadUrlReason } from "../guard";
import { daysOf } from "../read/core";
import { loadSite, lockOf, paceOf, type BookmakerReadDeps, type ReadSite } from "../read/deps";
import { gestureOf } from "../read/diagnose";
import { eventUrlFromTemplate, readEventsFromHtml } from "../read/dom-read";
import { extractRows, manifestVersions } from "../read/json-shape";
import { loadActiveRecipe, type ActiveRecipe } from "../read/recipe";
import { pickTransport } from "../transport/pick";
import { analyzeRecording, type AnalyzeResult } from "./analyze";
import { maskRecording } from "./mask";
import { pageOddsFromHtml } from "./page-odds";
import { UNKNOWN_PROVIDER } from "./provider";
import { rebaseRecipe, recipeOrigins } from "./rebase";
import {
  compareEvents,
  compareOdds,
  domOddsOf,
  eventsFromApiBody,
  oddsFromApiBody,
  ratiosPass,
  recordedEventId,
  referenceEvents,
  validateRecipe,
  validationSummary,
  type RecipeOdd,
  type ReferenceEvent,
} from "./validate";

export type LearnReason = "first" | "repair" | "manual";
export type LearnResult = { ok: boolean; status: SiteStatus; message: string };

/** Dépendances : celles du lecteur (transport, verrou, rythme, IA injectables) ; tout est facultatif sauf `prisma`. */
export type LearnDeps = BookmakerReadDeps & { learnLlm?: LlmProvider | null };

export const LEARN_STATE_PREFIX = "bookmakers.learn.";
export type LearnState = {
  lastAttemptAt: string;
  reason: LearnReason;
  ok: boolean | null;
  message: string;
};

/** Obstacles qui ne sont pas une visite du site (rien n'a été lu) : la tentative ne compte pas dans les 24 h. */
const NO_VISIT = new Set([
  "night",
  "no_browser",
  "apprentissage indisponible",
  "no_runner",
  "mac_offline",
  "mac_timeout",
]);

const nowOf = (d: Pick<AgentsDeps, "now">) => (d.now ? d.now() : new Date());
const isObstacle = (v: unknown): v is { obstacle: string } =>
  !!v && typeof v === "object" && typeof (v as { obstacle?: unknown }).obstacle === "string";

export async function readLearnState(
  deps: Pick<AgentsDeps, "prisma">,
  siteKey: string,
): Promise<LearnState | null> {
  const row = await deps.prisma.setting.findUnique({
    where: { key: `${LEARN_STATE_PREFIX}${siteKey}` },
  });
  const v = row?.value as LearnState | undefined;
  return v && typeof v.lastAttemptAt === "string" ? v : null;
}

async function writeLearnState(
  deps: Pick<AgentsDeps, "prisma">,
  siteKey: string,
  v: LearnState,
): Promise<void> {
  const key = `${LEARN_STATE_PREFIX}${siteKey}`;
  await deps.prisma.setting.upsert({
    where: { key },
    create: { key, value: v as never },
    update: { value: v as never },
  });
}

/** Pur : une tentative est-elle permise maintenant ? (`manual` toujours ; sinon une par 24 h.) */
export function learnAllowed(
  state: LearnState | null,
  reason: LearnReason,
  now: Date,
): { allowed: boolean; nextAt: Date | null } {
  if (reason === "manual" || !state) return { allowed: true, nextAt: null };
  const next = new Date(
    new Date(state.lastAttemptAt).getTime() + BOOKMAKER_LIMITS.relearnMinIntervalMs,
  );
  return next.getTime() <= now.getTime()
    ? { allowed: true, nextAt: null }
    : { allowed: false, nextAt: next };
}

const parisHM = (d: Date) =>
  d.toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Raison lisible d'un obstacle pendant l'enregistrement (geste à faire). */
export function obstacleText(obstacle: string): string {
  const known: Record<string, string> = {
    captcha: gestureOf("captcha"),
    geo_blocked: gestureOf("geo_blocked"),
    logged_out: gestureOf("logged_out"),
    two_factor: gestureOf("two_factor"),
    password_refused: gestureOf("password_refused"),
    maintenance: gestureOf("maintenance"),
    night: "aucune lecture la nuit (1 h - 7 h) sauf ordre",
    no_browser: "aucun navigateur pour lire ce site ici",
    "apprentissage indisponible": "apprentissage indisponible dans ce processus",
    forbidden_action: "adresse refusée par la garde « jamais de mise »",
  };
  return known[obstacle] ?? `le site a bloqué la lecture (${obstacle.slice(0, 80)})`;
}

// --- Réutilisation par moteur de paris --------------------------------------------------------------------------

export type ReusedRecipe = {
  recipe: RecipeData;
  validation: RecipeValidation;
  fromSiteKey: string;
  fromVersion: number;
};

function plainRecipe(r: ActiveRecipe): RecipeData {
  return JSON.parse(
    JSON.stringify({ level: r.level, api: r.api, dom: r.dom, mapping: r.mapping }),
  ) as RecipeData;
}

/**
 * Recette d'un autre site du même moteur (`providerHint` identique, recette active), rebasée sur l'origine de ce site,
 * validée sur CET enregistrement (niveau de la recette, puis page seule). Rien de connu : null.
 */
export async function reuseRecipeByProvider(
  deps: Pick<AgentsDeps, "prisma">,
  siteKey: string,
  recording: SiteRecording,
): Promise<ReusedRecipe | null> {
  const hint = recording.providerHint;
  if (!hint || hint === UNKNOWN_PROVIDER) return null;
  const others = (await deps.prisma.bookmakerSite.findMany({
    where: { providerHint: hint, key: { not: siteKey } },
  })) as Array<{ key: string; baseUrl?: string | null }>;
  let toOrigin: string;
  try {
    toOrigin = new URL(recording.baseUrl).origin;
  } catch {
    return null;
  }
  for (const o of others) {
    const active = await loadActiveRecipe(deps, o.key);
    if (!active) continue;
    let fromOrigin: string | null = null;
    try {
      fromOrigin = o.baseUrl ? new URL(o.baseUrl).origin : (recipeOrigins(active)[0] ?? null);
    } catch {
      fromOrigin = recipeOrigins(active)[0] ?? null;
    }
    const base = plainRecipe(active);
    const candidate = fromOrigin ? rebaseRecipe(base, fromOrigin, toOrigin) : base;
    const v = validateRecipe(candidate, recording);
    if (v.passed)
      return { recipe: candidate, validation: v, fromSiteKey: o.key, fromVersion: active.version };
    if (candidate.level === "api" && candidate.dom) {
      const dom: RecipeData = { ...candidate, level: "dom", api: null };
      const dv = validateRecipe(dom, recording);
      if (dv.passed)
        return { recipe: dom, validation: dv, fromSiteKey: o.key, fromVersion: active.version };
    }
  }
  return null;
}

// --- Contrôle réel (une lecture) ----------------------------------------------------------------------------------

export type LiveCheck = {
  ok: boolean;
  reason: string | null;
  obstacle: string | null;
  eventsSeen: number;
  eventsMatched: number;
  oddsSeen: number;
  oddsMatched: number;
  mismatches: RecipeValidation["mismatches"];
  eventId: string | null;
};

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-zA-Z]+)\}/g, (m, k: string) =>
    k in vars ? encodeURIComponent(vars[k]!) : m,
  );
}

function requestOf(
  ep: RecipeEndpoint,
  vars: Record<string, string>,
): { method: string; url: string; headers: string[]; body: string | null } {
  const url = new URL(fillTemplate(ep.urlTemplate, vars));
  const params = Object.fromEntries(
    Object.entries(ep.params ?? {}).map(([k, v]) => [
      k,
      v.replace(/\{([a-zA-Z]+)\}/g, (m, x: string) => vars[x] ?? m),
    ]),
  );
  if (
    ep.pagination &&
    !ep.urlTemplate.includes(`{${ep.pagination.param}}`) &&
    !ep.urlTemplate.includes("{page}")
  )
    params[ep.pagination.param] = String(ep.pagination.start);
  if (ep.method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return {
    method: ep.method,
    url: url.toString(),
    headers: ep.headers ?? [],
    body: ep.method === "POST" ? JSON.stringify(params) : null,
  };
}

/** Adresse d'une page enregistrée pour aujourd'hui (la date de l'enregistrement remplacée par celle du jour). Pur. */
export function urlForToday(url: string, recordedAt: string, today: string): string {
  const recorded = recordedAt.slice(0, 10);
  return recorded && recorded !== today ? url.split(recorded).join(today) : url;
}

/** Adresse de la fiche d'un match à partir de celle de l'enregistrement (identifiant remplacé). Pur. */
export function eventUrlFor(rec: Pick<SiteRecording, "pages">, siteEventId: string): string | null {
  const p = rec.pages.find((x) => x.step === "event");
  const id = recordedEventId(rec);
  if (!p || !id) return null;
  return p.url.includes(id) ? p.url.split(id).join(encodeURIComponent(siteEventId)) : null;
}

/**
 * Exécute la recette sur le site (matchs du jour + un match) et compare à une lecture de la page : ≥ 95 % des matchs
 * visibles, 100 % des cotes visibles identiques. Toutes les adresses passent par la garde ; rythme du site.
 */
export async function liveCheckRecipe(
  deps: LearnDeps,
  t: BookmakerTransport,
  site: ReadSite,
  recipe: RecipeData,
  rec: SiteRecording,
): Promise<LiveCheck> {
  const mismatches: RecipeValidation["mismatches"] = [];
  const add = (m: RecipeValidation["mismatches"][number]) =>
    void (mismatches.length < 30 && mismatches.push(m));
  const out = (o: Partial<LiveCheck>): LiveCheck => ({
    ok: false,
    reason: null,
    obstacle: null,
    eventsSeen: 0,
    eventsMatched: 0,
    oddsSeen: 0,
    oddsMatched: 0,
    mismatches,
    eventId: null,
    ...o,
  });
  const hosts = [
    ...new Set(
      [...rec.domains, ...(site.baseUrl ? [new URL(site.baseUrl).hostname] : [])].map((h) =>
        h.toLowerCase(),
      ),
    ),
  ];
  const pace = paceOf(deps);
  const now = nowOf(deps);
  const today = daysOf(now, now, recipe.mapping.timezone)[0] ?? now.toISOString().slice(0, 10);

  const page = async (url: string, steps: Array<{ click?: DomStep; waitFor?: DomStep }> = []) => {
    const why = forbiddenReadUrlReason(url, hosts);
    if (why) return { obstacle: "forbidden_action", why };
    await pace(site.key, "page");
    return t.page(site.key, { url, steps });
  };
  const api = async (
    ep: RecipeEndpoint,
    vars: Record<string, string>,
  ): Promise<unknown | { obstacle: string }> => {
    const req = requestOf(ep, vars);
    const why = forbiddenApiCallReason(req, hosts);
    if (why) return { obstacle: "forbidden_action" };
    await pace(site.key, "api");
    const r = await t.fetchApi(site.key, req);
    if ("authExpired" in r) return { obstacle: "logged_out" };
    if ("obstacle" in r) return r;
    if (r.status >= 400) return { obstacle: `http_${r.status}` };
    try {
      return JSON.parse(r.body) as unknown;
    } catch {
      return { obstacle: "site_changed" };
    }
  };

  // 1. Liste du jour : page (référence) et recette.
  const listPage =
    rec.pages.find((p) => p.step === "list-today") ?? rec.pages.find((p) => p.step === "football");
  // Widget sans lien : la page de liste de la recette (ouverte directement) et son onglet (« Par Heure »).
  const knownList = recipe.dom?.listUrls?.[0] ? recipe.dom.listUrls[0].split("{date}").join(today) : null;
  const listUrl = knownList ?? (listPage ? urlForToday(listPage.url, rec.startedAt, today) : site.baseUrl);
  if (!listUrl) return out({ reason: "adresse de la liste des matchs inconnue" });
  const listSteps: Array<{ click?: DomStep; waitFor?: DomStep }> = recipe.dom
    ? [...(knownList && recipe.dom.dayToday ? [{ click: recipe.dom.dayToday }] : []), { waitFor: recipe.dom.eventList }]
    : [];
  const lp = await page(listUrl, listSteps);
  if (isObstacle(lp)) return out({ obstacle: lp.obstacle, reason: obstacleText(lp.obstacle) });
  const ref: ReferenceEvent[] = referenceEvents({
    pages: [{ step: "list-today", url: lp.url, html: lp.html, text: lp.text }],
  });
  let events: SiteEvent[];
  const evEp =
    recipe.level === "api" ? recipe.api?.endpoints.find((e) => e.purpose === "events") : null;
  if (evEp?.pagination?.manifest) {
    // Pagination par manifeste (Betby) : versions listées par une première réponse, une lecture par version.
    const m = evEp.pagination.manifest;
    const manifest = await api({ ...evEp, urlTemplate: m.urlTemplate, pagination: null }, { date: today, sport: "football", league: "", page: "1" });
    if (isObstacle(manifest)) return out({ obstacle: manifest.obstacle, reason: obstacleText(manifest.obstacle) });
    const byId = new Map<string, SiteEvent>();
    for (const version of manifestVersions(manifest, m.versionsPaths).slice(0, Math.min(evEp.pagination.max, 8))) {
      const body = await api({ ...evEp, pagination: null }, { date: today, sport: "football", league: "", page: "1", version });
      if (isObstacle(body)) return out({ obstacle: body.obstacle, reason: obstacleText(body.obstacle) });
      for (const e of eventsFromApiBody(body, evEp, recipe.mapping.timezone, now)) if (!byId.has(e.siteEventId)) byId.set(e.siteEventId, e);
    }
    events = [...byId.values()];
  } else if (evEp) {
    const byId = new Map<string, SiteEvent>();
    const pg = evEp.pagination;
    let prevSig = "";
    for (let i = 0; i < (pg ? Math.min(pg.max, 5) : 1); i++) {
      const n = String((pg?.start ?? 1) + i * (pg?.step ?? 1));
      const body = await api(evEp, {
        date: today,
        sport: "football",
        league: "",
        page: n,
        ...(pg ? { [pg.param]: n } : {}),
      });
      if (isObstacle(body)) {
        if (i > 0 && /^http_4\d\d$/.test(body.obstacle)) break; // page au-delà de la dernière
        return out({ obstacle: body.obstacle, reason: obstacleText(body.obstacle) });
      }
      const got = eventsFromApiBody(body, evEp, recipe.mapping.timezone, now);
      const sig = got.map((e) => e.siteEventId).join(",");
      if (!got.length || sig === prevSig) break;
      prevSig = sig;
      for (const e of got) if (!byId.has(e.siteEventId)) byId.set(e.siteEventId, e);
      // Indicateur « encore des pages » de la forme (`hasMore`, `next`) : faux ou vide = fini.
      const moreKey = evEp.responseShape.hasMore
        ? "hasMore"
        : evEp.responseShape.next
          ? "next"
          : null;
      if (moreKey) {
        const more = extractRows(body, { more: evEp.responseShape[moreKey]! }, ["more"])[0]?.more;
        if (more === false || more === null || more === undefined || more === 0) break;
      }
    }
    events = [...byId.values()];
  } else if (recipe.dom) {
    events = readEventsFromHtml(lp.html, recipe.dom, {
      pageUrl: lp.url,
      timezone: recipe.mapping.timezone,
      now,
    }).events;
  } else return out({ reason: "recette sans méthode de lecture" });
  // Fiche d'un match lu par l'API sans adresse : modèle de la recette (`{eventId}`).
  const tpl = recipe.api?.eventUrlTemplate ?? recipe.dom?.eventUrlTemplate ?? null;
  if (tpl) events = events.map((e) => (e.url ? e : { ...e, url: eventUrlFromTemplate(tpl, { eventId: e.siteEventId }) }));
  const ev = compareEvents(ref, events, add);
  if (!events.length)
    return out({ reason: "aucun match lu par la méthode apprise", eventsSeen: ev.seen });
  if (ev.seen > 0 && ev.matched / ev.seen < BOOKMAKER_LIMITS.recipeEventsMatchRatio)
    return out({
      reason: `matchs : ${ev.matched}/${ev.seen} retrouvés`,
      eventsSeen: ev.seen,
      eventsMatched: ev.matched,
    });

  // 2. Un match : page (référence) et recette.
  const pickEvent = events.find((e) => ref.some((r) => r.id === e.siteEventId)) ?? events[0]!;
  const refLink = ref.find((r) => r.id === pickEvent.siteEventId);
  const eventUrl = pickEvent.url ?? refLink?.url ?? eventUrlFor(rec, pickEvent.siteEventId);
  if (!eventUrl)
    return out({
      reason: "adresse de la fiche du match inconnue",
      eventsSeen: ev.seen,
      eventsMatched: ev.matched,
    });
  const ep = await page(eventUrl, recipe.dom ? [{ waitFor: recipe.dom.market.selection }] : []);
  if (isObstacle(ep))
    return out({
      obstacle: ep.obstacle,
      reason: obstacleText(ep.obstacle),
      eventsSeen: ev.seen,
      eventsMatched: ev.matched,
    });
  const visible = pageOddsFromHtml(ep.html);
  let odds: RecipeOdd[];
  const oddsEp =
    recipe.level === "api"
      ? recipe.api?.endpoints.find((e) => e.purpose === "markets" || e.purpose === "odds")
      : null;
  if (oddsEp) {
    const body = await api(oddsEp, {
      eventId: pickEvent.siteEventId,
      sport: "football",
      date: "",
      league: "",
      page: String(oddsEp.pagination?.start ?? 1),
    });
    if (isObstacle(body))
      return out({
        obstacle: body.obstacle,
        reason: obstacleText(body.obstacle),
        eventsSeen: ev.seen,
        eventsMatched: ev.matched,
      });
    odds = oddsFromApiBody(body, oddsEp, recipe.mapping.oddsFormat, pickEvent.siteEventId);
  } else {
    odds = domOddsOf(recipe, {
      pages: [{ step: "event", url: ep.url, html: ep.html, text: ep.text }],
    });
  }
  if (!visible.length)
    return out({
      reason: "aucune cote visible sur la fiche du match",
      eventsSeen: ev.seen,
      eventsMatched: ev.matched,
      eventId: pickEvent.siteEventId,
    });
  const od = compareOdds(visible, odds, add);
  const ok = ratiosPass(ev.seen ? ev : { matched: 1, seen: 1 }, od);
  return out({
    ok,
    reason: ok ? null : `cotes : ${od.matched}/${od.seen} identiques`,
    eventsSeen: ev.seen,
    eventsMatched: ev.matched,
    oddsSeen: od.seen,
    oddsMatched: od.matched,
    eventId: pickEvent.siteEventId,
  });
}

// --- Apprentissage ------------------------------------------------------------------------------------------------

type Chosen = {
  recipe: RecipeData;
  validation: RecipeValidation;
  source: "provider" | "opus" | "opus-2" | "dom";
  costCents: number;
  fromSiteKey?: string;
};

async function transportFor(
  deps: LearnDeps,
  site: ReadSite,
  reason: LearnReason,
): Promise<BookmakerTransport | null> {
  const h = deps.bookmakers;
  if (h?.transport) return h.transport;
  if (h?.pickTransport) return (await h.pickTransport(deps, site)) ?? null;
  return pickTransport(
    deps,
    { key: site.key, readTarget: site.readTarget },
    { force: reason === "manual" || !!h?.force },
  );
}

async function llmFor(deps: LearnDeps): Promise<LlmProvider | null> {
  if (deps.learnLlm !== undefined) return deps.learnLlm;
  if (deps.bookmakers?.llm !== undefined) return deps.bookmakers.llm;
  try {
    return await loadLlmProvider(deps.prisma);
  } catch {
    return null;
  }
}

async function setStatus(
  deps: AgentsDeps,
  siteKey: string,
  status: SiteStatus,
  statusReason: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await deps.prisma.bookmakerSite.update({
    where: { key: siteKey },
    data: {
      status,
      statusReason: statusReason ? statusReason.slice(0, 300) : null,
      ...extra,
    } as never,
  });
}

function failureText(results: AnalyzeResult[], validations: RecipeValidation[]): string {
  const last = results[results.length - 1];
  if (last && !last.ok && last.reason === "no_ai")
    return "aucune IA réglée pour apprendre ce site (Réglages → IA)";
  if (last && !last.ok && last.reason === "budget")
    return `plafond d'IA de l'équipe Paris sportifs atteint : ${last.errors[0] ?? ""}`.trim();
  const v = validations[validations.length - 1];
  if (v) return `la méthode trouvée ne relit pas tout le site (${validationSummary(v)})`;
  if (last && !last.ok && last.reason === "foreign_domain")
    return "la méthode proposée visait un autre site : refusée";
  return "aucune méthode de lecture sûre trouvée pour ce site";
}

/**
 * Apprend (ou ré-apprend) un site. `reason` : `first` (nouveau site), `repair` (ré-apprentissage automatique), `manual`
 * (demande de l'admin : sans limite de 24 h, permise la nuit).
 */
export async function learnSite(
  deps: LearnDeps,
  siteKey: string,
  opts: { reason?: LearnReason } = {},
): Promise<LearnResult> {
  const reason: LearnReason = opts.reason ?? "first";
  const site = await loadSite(deps, siteKey);
  if (!site) return { ok: false, status: "NEW", message: `bookmaker inconnu : ${siteKey}` };
  const prev = (site.status as SiteStatus) ?? "NEW";
  if (!site.baseUrl)
    return {
      ok: false,
      status: prev,
      message: `adresse de ${site.label} inconnue : donne-la à Kevin`,
    };
  const gate = learnAllowed(await readLearnState(deps, siteKey), reason, nowOf(deps));
  if (!gate.allowed)
    return {
      ok: false,
      status: prev,
      message: `${site.label} a déjà été appris il y a moins de 24 h ; prochain essai automatique ${parisHM(gate.nextAt!)} (ou « ré-apprendre » à la main)`,
    };
  try {
    return await lockOf(deps)(siteKey, () => learnLocked(deps, site, reason, prev));
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    if ((err as Error).name === "SiteLockBusy")
      return { ok: false, status: prev, message: `lecture déjà en cours sur ${site.label}` };
    deps.logger?.warn({ site: siteKey, err: msg }, "[bookmakers] apprentissage en erreur");
    await setStatus(deps, siteKey, "BLOCKED", `apprentissage en erreur : ${msg}`).catch(
      () => undefined,
    );
    return {
      ok: false,
      status: "BLOCKED",
      message: `apprentissage de ${site.label} en erreur : ${msg}`,
    };
  }
}

async function learnLocked(
  deps: LearnDeps,
  site: ReadSite,
  reason: LearnReason,
  prev: SiteStatus,
): Promise<LearnResult> {
  const startedAt = nowOf(deps);
  await setStatus(deps, site.key, "LEARNING", "apprentissage en cours");
  const finish = async (
    ok: boolean,
    status: SiteStatus,
    message: string,
    statusReason: string | null = ok ? null : message,
    siteData: Record<string, unknown> = {},
    eventData: Record<string, unknown> = {},
  ): Promise<LearnResult> => {
    await setStatus(deps, site.key, status, statusReason, siteData);
    await agentEvent(deps, ok ? "bookmakers.learned" : "bookmakers.learn_failed", {
      siteKey: site.key,
      reason,
      status,
      message: message.slice(0, 300),
      ...eventData,
    });
    return { ok, status, message };
  };

  // 1. Enregistrement guidé.
  const transport = await transportFor(deps, site, reason);
  if (!transport)
    return finish(
      false,
      prev === "LEARNING" ? "NEW" : prev,
      `aucun moyen de lire ${site.label} ici (ni serveur ni Mac branché)`,
    );
  const raw = await transport.record(site.key, site.baseUrl!);
  if (isObstacle(raw)) {
    const text = obstacleText(raw.obstacle);
    if (NO_VISIT.has(raw.obstacle))
      return finish(
        false,
        prev === "LEARNING" ? "NEW" : prev,
        `${site.label} non appris : ${text}`,
        `apprentissage reporté : ${text}`,
      );
    await writeLearnState(deps, site.key, {
      lastAttemptAt: startedAt.toISOString(),
      reason,
      ok: false,
      message: text,
    });
    return finish(false, "BLOCKED", `${site.label} non appris : ${text}`, text, {
      lastReadAt: startedAt,
    });
  }
  await writeLearnState(deps, site.key, {
    lastAttemptAt: startedAt.toISOString(),
    reason,
    ok: null,
    message: "enregistrement fait",
  });

  // 2. Masquage (aucun secret ne va plus loin).
  let secrets: string[] = [];
  try {
    const c = await readBookmakerCredentialsFor(deps, site.key);
    if (c) secrets = [c.login, c.password].filter((x): x is string => typeof x === "string" && !!x);
  } catch {
    /* identifiants illisibles : masquage par motifs seulement */
  }
  const rec = maskRecording(raw, secrets);

  // 3. Recette : même moteur d'abord, puis Opus (deux passes), puis page seule.
  let chosen: Chosen | null = null;
  const results: AnalyzeResult[] = [];
  const validations: RecipeValidation[] = [];
  const candidates: RecipeData[] = [];
  let cost = 0;
  const reused = await reuseRecipeByProvider(deps, site.key, rec);
  if (reused)
    chosen = {
      recipe: reused.recipe,
      validation: reused.validation,
      source: "provider",
      costCents: 0,
      fromSiteKey: reused.fromSiteKey,
    };
  const llm = chosen ? null : await llmFor(deps);
  if (!chosen && llm) {
    let previous: {
      recipe: RecipeData | null;
      errors: string[];
      validation: RecipeValidation | null;
    } | null = null;
    for (let pass = 1; pass <= 2 && !chosen; pass++) {
      const r = await analyzeRecording({ ...deps, llm }, rec, { secrets, previous });
      results.push(r);
      cost += r.costCents;
      if (!r.ok) {
        if (r.reason === "budget" || r.reason === "no_ai" || r.reason === "error") break;
        previous = { recipe: r.candidate ?? null, errors: r.errors, validation: null };
        continue;
      }
      candidates.push(r.recipe);
      const v = validateRecipe(r.recipe, rec);
      validations.push(v);
      if (v.passed)
        chosen = {
          recipe: r.recipe,
          validation: v,
          source: pass === 1 ? "opus" : "opus-2",
          costCents: cost,
        };
      else previous = { recipe: r.recipe, errors: r.warnings, validation: v };
    }
  } else if (!chosen)
    results.push({ ok: false, reason: "no_ai", errors: ["aucune IA réglée"], costCents: 0 });
  if (!chosen) {
    for (const c of [...candidates].reverse()) {
      if (!c.dom) continue;
      const dom: RecipeData = { ...c, level: "dom", api: null };
      const v = validateRecipe(dom, rec, { level: "dom" });
      validations.push(v);
      if (v.passed) {
        chosen = { recipe: dom, validation: v, source: "dom", costCents: cost };
        break;
      }
    }
  }
  if (!chosen) {
    const text = failureText(results, validations);
    await writeLearnState(deps, site.key, {
      lastAttemptAt: startedAt.toISOString(),
      reason,
      ok: false,
      message: text,
    });
    return finish(false, "BLOCKED", `${site.label} non appris : ${text}`, text, {
      providerHint: rec.providerHint,
      lastReadAt: startedAt,
    });
  }

  // 4. Contrôle réel (une lecture) ; recette API refusée en vrai → repli page seule si elle passe.
  let live = await liveCheckRecipe(deps, transport, site, chosen.recipe, rec);
  if (!live.ok && !live.obstacle && chosen.recipe.level === "api" && chosen.recipe.dom) {
    const dom: RecipeData = { ...chosen.recipe, level: "dom", api: null };
    const v = validateRecipe(dom, rec, { level: "dom" });
    if (v.passed) {
      const l2 = await liveCheckRecipe(deps, transport, site, dom, rec);
      if (l2.ok) {
        chosen = { ...chosen, recipe: dom, validation: v, source: "dom" };
        live = l2;
      }
    }
  }
  if (!live.ok) {
    const text = `contrôle sur le site refusé : ${live.reason ?? "écart"}`;
    await writeLearnState(deps, site.key, {
      lastAttemptAt: startedAt.toISOString(),
      reason,
      ok: false,
      message: text,
    });
    return finish(
      false,
      "BLOCKED",
      `${site.label} non appris : ${text}`,
      live.obstacle ? obstacleText(live.obstacle) : text,
      { providerHint: rec.providerHint, lastReadAt: startedAt },
    );
  }

  // 5. Recette rangée : version + 1 active, les anciennes gardées inactives.
  const last = (await deps.prisma.bookmakerRecipe.findFirst({
    where: { siteKey: site.key },
    orderBy: { version: "desc" },
  })) as { version?: number } | null;
  const version = (last?.version ?? 0) + 1;
  const validation = {
    ...chosen.validation,
    domains: rec.domains,
    providerHint: rec.providerHint,
    source: chosen.source,
    ...(chosen.fromSiteKey ? { fromSiteKey: chosen.fromSiteKey } : {}),
    costCents: chosen.costCents,
    live: {
      at: nowOf(deps).toISOString(),
      eventsSeen: live.eventsSeen,
      eventsMatched: live.eventsMatched,
      oddsSeen: live.oddsSeen,
      oddsMatched: live.oddsMatched,
      eventId: live.eventId,
    },
  };
  const created = (await deps.prisma.bookmakerRecipe.create({
    data: {
      siteKey: site.key,
      version,
      level: chosen.recipe.level,
      api: (chosen.recipe.api ?? null) as never,
      dom: (chosen.recipe.dom ?? null) as never,
      mapping: chosen.recipe.mapping as never,
      validation: validation as never,
      isActive: true,
      createdBy: reason === "repair" ? "repair" : "learn",
      createdAt: nowOf(deps),
    } as never,
  })) as { id: string };
  await deps.prisma.bookmakerRecipe.updateMany({
    where: { siteKey: site.key, isActive: true, id: { not: created.id } },
    data: { isActive: false },
  });
  const how =
    chosen.recipe.level === "api" ? "lecture directe des données du site" : "lecture de la page";
  const message = `${site.label} appris (${how}, version ${version}) : ${chosen.validation.eventsMatched} matchs et ${chosen.validation.oddsMatched} cotes vérifiés, contrôle sur le site réussi`;
  await writeLearnState(deps, site.key, {
    lastAttemptAt: startedAt.toISOString(),
    reason,
    ok: true,
    message,
  });
  return finish(
    true,
    "READY",
    message,
    null,
    { providerHint: rec.providerHint, lastReadAt: nowOf(deps), lastOkAt: nowOf(deps) },
    { version, level: chosen.recipe.level, source: chosen.source, costCents: chosen.costCents },
  );
}
