/**
 * Phase 35 (chantier B, règle 5) — VALIDATION d'une recette sur l'enregistrement, SANS RÉSEAU : la recette est
 * rejouée sur les réponses et les pages enregistrées.
 * - matchs : ≥ 95 % des matchs visibles sur les pages de liste (liens de match, référence indépendante de la recette)
 *   doivent être retrouvés par la recette (API : réponses du point d'entrée « events » ; page : `readEventsFromHtml`) ;
 * - cotes : 100 % des cotes lues sur les pages de marchés ouvertes (`SiteRecording.pageOdds`) doivent être retrouvées,
 *   IDENTIQUES (tolérance 0), même marché, même sélection, même ligne, après conversion du format de la recette
 *   (décimal, fractionnaire, américain).
 * Un enregistrement sans match visible ou sans cote lue ne valide rien. Les lecteurs du chantier C
 * (`read/{json-shape,dom-read,odds-format}.ts`) sont réutilisés tels quels : c'est la même lecture qu'en vrai.
 * Règles pures.
 */
import {
  BOOKMAKER_LIMITS,
  type RecipeData,
  type RecipeEndpoint,
  type RecipeValidation,
  type SiteEvent,
  type SiteRecording,
} from "../contract";
import { eventIdFromUrl, readEventsFromHtml, readMarketsFromHtml, splitTeams } from "../read/dom-read";
import { parseSiteDate } from "../read/dates";
import { descendants, frameBaseOf, parseHtml, textOf } from "../read/html";
import { asText, extractRows, keepRows } from "../read/json-shape";
import { sameLine, sameOddsExact, toDecimalOdds } from "../read/odds-format";
import {
  isHiddenNode,
  labelHasTeams,
  lineInText,
  marketKey,
  selectionKey,
  type PageOdd,
} from "./page-odds";
import { EVENT_HREF, eventRowsOf, isEventUrl, isListStep, isMarketStep } from "./record";

/** Lien de match sur une page de liste (même règle que le parcours guidé). */
export const EVENT_LINK = EVENT_HREF;

export type ReferenceEvent = { id: string; label: string; url: string };

/**
 * Matchs visibles sur les pages de liste de l'enregistrement (référence indépendante de la recette) : liens de match
 * (dossier « match », fin « slug-identifiant », paramètre `eventId`), et lignes d'un widget sans lien repérées par
 * le transport (`data-lap-event-id`). L'identifiant est celui de l'adresse (même règle que la lecture). Pur.
 */
export function referenceEvents(rec: Pick<SiteRecording, "pages">): ReferenceEvent[] {
  const out = new Map<string, ReferenceEvent>();
  for (const p of rec.pages) {
    if (!isListStep(p.step)) continue;
    for (const n of descendants(parseHtml(p.html))) {
      if (n.tag !== "a" || !n.attrs.href || isHiddenNode(n)) continue;
      let u: URL;
      try {
        u = new URL(n.attrs.href, frameBaseOf(n, p.url) ?? p.url);
      } catch {
        continue;
      }
      const label = textOf(n);
      if (!isEventUrl(u.toString()) || !/\p{L}/u.test(label)) continue;
      const id = eventIdFromUrl(u.toString()) ?? decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
      if (id && !out.has(id)) out.set(id, { id, label, url: u.toString() });
    }
    for (const row of eventRowsOf(p.html)) if (!out.has(row.id)) out.set(row.id, { id: row.id, label: row.label, url: "" });
  }
  return [...out.values()];
}

/** Modèle d'adresse → expression (origine + chemin ; les paramètres de requête ne comptent pas). Pur. */
export function templatePathRegex(tpl: string): RegExp | null {
  const placeholder = "__LAP_VAR__";
  let u: URL;
  try {
    u = new URL(tpl.replace(/\{[a-zA-Z]+\}/g, placeholder));
  } catch {
    return null;
  }
  const http = u.protocol.replace(/^ws/, "http").replace(/:$/, "");
  const base = `${http}://${u.host}${u.pathname}`
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .split(placeholder)
    .join("[^/?#]+");
  return new RegExp(`^${base.replace(/^https?/, "https?")}/?$`, "i");
}

/** Une réponse enregistrée vient-elle de ce point d'entrée ? (même méthode, même chemin) Pur. */
export function responseMatchesEndpoint(
  r: Pick<SiteRecording["responses"][number], "url" | "method">,
  ep: Pick<RecipeEndpoint, "urlTemplate" | "method">,
): boolean {
  if (r.method.toUpperCase() !== ep.method) return false;
  const re = templatePathRegex(ep.urlTemplate);
  if (!re) return false;
  try {
    const u = new URL(r.url);
    return re.test(`${u.protocol}//${u.host}${u.pathname}`);
  } catch {
    return false;
  }
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** Matchs d'une réponse du point d'entrée « events » (lecture identique à celle du chantier C). Pur. */
export function eventsFromApiBody(
  body: unknown,
  ep: RecipeEndpoint,
  tz: string,
  now: Date,
): SiteEvent[] {
  const out: SiteEvent[] = [];
  for (const row of keepRows(extractRows(body, ep.responseShape, ["id", "home", "away", "startsAt", "name"]), ep.filter)) {
    const id = asText(row.id);
    let home = asText(row.home);
    let away = asText(row.away);
    if ((!home || !away) && asText(row.name)) {
      const s = splitTeams(asText(row.name));
      if (s) ({ home, away } = s);
    }
    const startsAt = parseSiteDate(asText(row.startsAt), tz, now);
    if (!id || !home || !away || !startsAt) continue;
    out.push({
      siteEventId: id,
      league: asText(row.league),
      homeTeam: home,
      awayTeam: away,
      startsAt,
      url: asText(row.url) || null,
      marketsCount: null,
    });
  }
  return out;
}

/** Matchs lus par la recette (API) dans les réponses enregistrées. Pur. */
export function apiEventsOf(recipe: RecipeData, rec: SiteRecording): SiteEvent[] {
  const ep = recipe.api?.endpoints.find((e) => e.purpose === "events");
  if (!ep) return [];
  const now = new Date(rec.startedAt);
  const out = new Map<string, SiteEvent>();
  for (const r of rec.responses) {
    if (r.status >= 400 || !responseMatchesEndpoint(r, ep)) continue;
    const body = parseBody(r.body);
    if (body === undefined) continue;
    for (const e of eventsFromApiBody(body, ep, recipe.mapping.timezone, now))
      if (!out.has(e.siteEventId)) out.set(e.siteEventId, e);
  }
  return [...out.values()];
}

/** Matchs lus par la recette (page) sur les pages de liste enregistrées. Pur. */
export function domEventsOf(recipe: RecipeData, rec: SiteRecording): SiteEvent[] {
  if (!recipe.dom) return [];
  const now = new Date(rec.startedAt);
  const out = new Map<string, SiteEvent>();
  for (const p of rec.pages) {
    if (!isListStep(p.step)) continue;
    for (const e of readEventsFromHtml(p.html, recipe.dom, {
      pageUrl: p.url,
      timezone: recipe.mapping.timezone,
      now,
    }).events)
      if (!out.has(e.siteEventId)) out.set(e.siteEventId, e);
  }
  return [...out.values()];
}

export type RecipeOdd = {
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  raw: string;
};

function rowLine(lineRaw: unknown, selection: string, market: string): number | null {
  if (typeof lineRaw === "number" && Number.isFinite(lineRaw)) return lineRaw;
  const t = asText(lineRaw);
  if (t) {
    const n = Number(t.replace(",", ".").replace(/^\+/, ""));
    if (Number.isFinite(n)) return n;
  }
  return lineInText(selection) ?? lineInText(market);
}

/**
 * Identifiant du match ouvert pendant l'enregistrement : d'après l'adresse de la fiche (paramètre `eventId`, fin
 * « slug-identifiant », dernier segment), sinon le repère du widget sur la fiche (`data-lap-event-id`, le premier).
 */
export function recordedEventId(rec: Pick<SiteRecording, "pages">): string | null {
  const p = rec.pages.find((x) => x.step === "event");
  if (!p) return null;
  const fromUrl = eventIdFromUrl(p.url);
  if (fromUrl && isEventUrl(p.url)) return fromUrl;
  const row = eventRowsOf(p.html)[0];
  if (row) return row.id;
  return fromUrl;
}

/** Cotes d'une réponse du point d'entrée « markets » / « odds » (lignes d'un autre match écartées). Pur. */
export function oddsFromApiBody(
  body: unknown,
  ep: RecipeEndpoint,
  format: RecipeData["mapping"]["oddsFormat"],
  eventId: string | null,
): RecipeOdd[] {
  const out: RecipeOdd[] = [];
  for (const row of keepRows(extractRows(body, ep.responseShape, ["market", "selection", "odds"]), ep.filter)) {
    if (
      eventId &&
      row.eventId !== undefined &&
      row.eventId !== null &&
      asText(row.eventId) !== eventId
    )
      continue;
    const market = asText(row.market);
    const selection = asText(row.selection);
    const raw = typeof row.odds === "number" ? String(row.odds) : asText(row.odds);
    if (!market || !selection || !raw) continue;
    out.push({
      market,
      selection,
      line: rowLine(row.line, selection, market),
      odds: toDecimalOdds(typeof row.odds === "number" ? row.odds : raw, format),
      raw,
    });
  }
  return out;
}

/** Cotes lues par la recette (API) dans les réponses du match ouvert. Pur. */
export function apiOddsOf(recipe: RecipeData, rec: SiteRecording): RecipeOdd[] {
  const eps = (recipe.api?.endpoints ?? []).filter(
    (e) => e.purpose === "markets" || e.purpose === "odds",
  );
  if (!eps.length) return [];
  const eventId = recordedEventId(rec);
  const out: RecipeOdd[] = [];
  for (const ep of eps) {
    let responses = rec.responses.filter((r) => r.status < 400 && responseMatchesEndpoint(r, ep));
    if (eventId && responses.some((r) => r.url.includes(eventId)))
      responses = responses.filter((r) => r.url.includes(eventId));
    for (const r of responses) {
      const body = parseBody(r.body);
      if (body === undefined) continue;
      out.push(...oddsFromApiBody(body, ep, recipe.mapping.oddsFormat, eventId));
    }
  }
  return out;
}

/** Cotes lues par la recette (page) sur les pages de marchés enregistrées. Pur. */
export function domOddsOf(recipe: RecipeData, rec: Pick<SiteRecording, "pages">): RecipeOdd[] {
  if (!recipe.dom) return [];
  const out: RecipeOdd[] = [];
  for (const p of rec.pages) {
    if (!isMarketStep(p.step)) continue;
    for (const r of readMarketsFromHtml(p.html, recipe.dom).rows) {
      out.push({
        market: r.marketSite,
        selection: r.selectionSite,
        line: rowLine(r.lineRaw, r.selectionSite, r.marketSite),
        odds: toDecimalOdds(r.oddsRaw, recipe.mapping.oddsFormat),
        raw: r.oddsRaw,
      });
    }
  }
  return out;
}

const sameSelection = (o: RecipeOdd, p: PageOdd) =>
  marketKey(o.market) === marketKey(p.market) &&
  selectionKey(o.selection, o.line) === selectionKey(p.selection, p.line) &&
  sameLine(o.line, p.line);

type AddMismatch = (m: RecipeValidation["mismatches"][number]) => void;

/** Matchs de référence retrouvés (même identifiant, ou mêmes deux équipes dans le libellé). Pur. */
export function compareEvents(
  ref: readonly ReferenceEvent[],
  got: readonly SiteEvent[],
  add: AddMismatch = () => undefined,
): { matched: number; seen: number } {
  let matched = 0;
  for (const e of ref) {
    if (got.some((g) => g.siteEventId === e.id || labelHasTeams(e.label, g.homeTeam, g.awayTeam)))
      matched++;
    else add({ what: "match absent", expected: e.label.slice(0, 120), got: "" });
  }
  if (!ref.length)
    add({ what: "aucun match visible sur les pages de liste", expected: "≥ 1", got: "0" });
  return { matched, seen: ref.length };
}

/** Cotes de la page retrouvées IDENTIQUES (tolérance 0) dans la lecture de la recette. Pur. */
export function compareOdds(
  pageOdds: readonly PageOdd[],
  odds: readonly RecipeOdd[],
  add: AddMismatch = () => undefined,
): { matched: number; seen: number } {
  let matched = 0;
  for (const p of pageOdds) {
    const same = odds.filter((o) => sameSelection(o, p));
    if (same.some((o) => o.odds !== null && sameOddsExact(o.odds, p.odds))) {
      matched++;
      continue;
    }
    const label = `${p.market} / ${p.selection}${p.line !== null ? ` (${p.line})` : ""}`.slice(
      0,
      160,
    );
    if (same.length)
      add({
        what: `cote différente : ${label}`,
        expected: String(p.odds),
        got: same
          .map((o) => (o.odds === null ? `illisible « ${o.raw} »` : String(o.odds)))
          .join(", ")
          .slice(0, 80),
      });
    else add({ what: `cote absente : ${label}`, expected: String(p.odds), got: "" });
  }
  if (!pageOdds.length)
    add({ what: "aucune cote lue sur les pages de marchés", expected: "≥ 1", got: "0" });
  return { matched, seen: pageOdds.length };
}

/** Seuils de la règle 5 (≥ 95 % des matchs, 100 % des cotes ; rien de vu = refus). Pur. */
export function ratiosPass(
  ev: { matched: number; seen: number },
  od: { matched: number; seen: number },
): boolean {
  return (
    ev.seen > 0 &&
    ev.matched / ev.seen >= BOOKMAKER_LIMITS.recipeEventsMatchRatio &&
    od.seen > 0 &&
    od.matched / od.seen >= BOOKMAKER_LIMITS.recipeOddsMatchRatio
  );
}

export type ValidateOptions = {
  /** Niveau à rejouer (défaut : celui de la recette). `dom` : repli « page seule ». */
  level?: "api" | "dom";
};

/** Rejoue la recette sur l'enregistrement. Pur. */
export function validateRecipe(
  recipe: RecipeData,
  rec: SiteRecording,
  opts: ValidateOptions = {},
): RecipeValidation {
  const level = opts.level ?? recipe.level;
  const mismatches: RecipeValidation["mismatches"] = [];
  const add = (m: RecipeValidation["mismatches"][number]) =>
    void (mismatches.length < 40 && mismatches.push(m));

  const ref = referenceEvents(rec);
  const ev = compareEvents(
    ref,
    level === "api" ? apiEventsOf(recipe, rec) : domEventsOf(recipe, rec),
    add,
  );
  const od = compareOdds(
    rec.pageOdds,
    level === "api" ? apiOddsOf(recipe, rec) : domOddsOf(recipe, rec),
    add,
  );
  const eventsMatched = ev.matched;
  const oddsMatched = od.matched;
  return {
    recordedAt: rec.endedAt || rec.startedAt,
    eventsSeen: ref.length,
    eventsMatched,
    oddsSeen: rec.pageOdds.length,
    oddsMatched,
    mismatches,
    passed: ratiosPass(ev, od),
  };
}

/** Résumé lisible d'une validation (journal, deuxième passe d'Opus). Pur. */
export function validationSummary(v: RecipeValidation): string {
  return `matchs ${v.eventsMatched}/${v.eventsSeen}, cotes ${v.oddsMatched}/${v.oddsSeen}${v.passed ? " : validée" : " : refusée"}`;
}
