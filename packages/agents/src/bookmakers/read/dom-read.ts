/**
 * Phase 35, niveau 2 (page affichée) : la recette `dom` donne, pour chaque étape, plusieurs candidats (sélecteur CSS,
 * texte, rôle) ; le PREMIER qui marche est retenu et son rang est mémorisé (`lastGood`) pour la fois suivante (essayé
 * en premier). Lecture du texte visible seulement : le code ne clique ici sur rien (les onglets à ouvrir sont passés au
 * transport, qui applique la garde « jamais de mise »). Règles pures, sur le HTML rendu.
 */
import type { DomStep, RecipeData, SiteEvent } from "../contract";
import { foldText, parseHtml, querySelectorAll, descendants, roleOf, textOf, type HtmlNode } from "./html";
import { parseSiteDate } from "./dates";

export type DomRecipe = NonNullable<RecipeData["dom"]>;
export type Candidate = DomStep["candidates"][number];

/** Éléments d'un candidat sous `scope`. Texte seul : les éléments les plus profonds qui contiennent ce texte. */
export function candidateNodes(scope: HtmlNode, c: Candidate): HtmlNode[] {
  let nodes = c.css ? querySelectorAll(scope, c.css) : descendants(scope);
  if (c.role) nodes = nodes.filter((n) => roleOf(n) === c.role);
  if (c.text) {
    const want = foldText(c.text);
    const hits = nodes.filter((n) => foldText(textOf(n)).includes(want));
    nodes = c.css ? hits : hits.filter((n) => !hits.some((o) => o !== n && isAncestor(n, o)));
  }
  if (!c.css && !c.role && !c.text) return [];
  return nodes;
}

function isAncestor(a: HtmlNode, b: HtmlNode): boolean {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

/** Ordre d'essai : le dernier bon d'abord, puis les autres dans l'ordre de la recette. */
export function candidateOrder(step: DomStep): number[] {
  const n = step.candidates.length;
  const idx = [...Array(n).keys()];
  const g = step.lastGood;
  return typeof g === "number" && g >= 0 && g < n ? [g, ...idx.filter((i) => i !== g)] : idx;
}

/** Premier candidat qui trouve au moins un élément sous chacune des `scopes` testées (la première suffit). */
export function pickCandidate(scopes: HtmlNode[], step: DomStep | undefined): { index: number; nodes: (s: HtmlNode) => HtmlNode[] } | null {
  if (!step || !step.candidates?.length || !scopes.length) return null;
  for (const i of candidateOrder(step)) {
    const c = step.candidates[i]!;
    if (candidateNodes(scopes[0]!, c).length) return { index: i, nodes: (s) => candidateNodes(s, c) };
  }
  return null;
}

export type LastGood = Record<string, number>;

function attrValue(n: HtmlNode, names: string[]): string | null {
  for (const a of names) if (n.attrs[a]) return n.attrs[a]!;
  return null;
}

function hrefOf(n: HtmlNode): string | null {
  if (n.attrs.href) return n.attrs.href;
  for (const d of [n, ...descendants(n)]) if (d.tag === "a" && d.attrs.href) return d.attrs.href;
  for (let p = n.parent; p; p = p.parent) if (p.tag === "a" && p.attrs.href) return p.attrs.href;
  return null;
}

function absolute(href: string | null, base: string | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, base ?? undefined).toString();
  } catch {
    return null;
  }
}

/** Identifiant stable d'un match lu sur la page : attribut du site, sinon fin de l'adresse du match. */
export function eventIdOf(row: HtmlNode, url: string | null): string | null {
  const own = attrValue(row, ["data-event-id", "data-eventid", "data-match-id", "data-match", "data-id", "data-event"]);
  if (own) return own;
  for (const d of descendants(row)) {
    const v = attrValue(d, ["data-event-id", "data-eventid", "data-match-id"]);
    if (v) return v;
  }
  if (!url) return null;
  try {
    const u = new URL(url);
    const id = u.searchParams.get("eventId") ?? u.searchParams.get("event") ?? u.searchParams.get("id");
    if (id) return id;
    const seg = u.pathname.split("/").filter(Boolean);
    const numeric = [...seg].reverse().find((s) => /\d{3,}/.test(s));
    return numeric ?? seg[seg.length - 1] ?? null;
  } catch {
    return null;
  }
}

/** « PSG - OM », « PSG vs OM » → deux équipes (quand la recette ne sépare pas les noms). */
export function splitTeams(s: string): { home: string; away: string } | null {
  const m = /^(.+?)\s+(?:-|–|—|vs\.?|v\.?|contre)\s+(.+)$/i.exec(s.replace(/\s+/g, " ").trim());
  return m ? { home: m[1]!.trim(), away: m[2]!.trim() } : null;
}

export type DomEventsResult = { events: SiteEvent[]; lastGood: LastGood; rows: number };

/** Liste des matchs d'une page rendue. Rien de lisible : `rows = 0` (le diagnostic dira pourquoi). */
export function readEventsFromHtml(html: string, dom: DomRecipe, o: { pageUrl: string | null; timezone: string; now: Date; league?: string | null }): DomEventsResult {
  const root = parseHtml(html);
  const lastGood: LastGood = {};
  const list = pickCandidate([root], dom.eventList);
  if (!list) return { events: [], lastGood, rows: 0 };
  lastGood.eventList = list.index;
  const rows = list.nodes(root);
  const fields = ["home", "away", "startsAt", "league", "link"] as const;
  const chosen: Partial<Record<(typeof fields)[number], (s: HtmlNode) => HtmlNode[]>> = {};
  for (const f of fields) {
    const step = dom.eventRow[f];
    if (!step) continue;
    const scope = rows.find((r) => pickCandidate([r], step)) ?? null;
    const pick = scope ? pickCandidate([scope], step) : null;
    if (pick) {
      chosen[f] = pick.nodes;
      lastGood[`eventRow.${f}`] = pick.index;
    }
  }
  const events: SiteEvent[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const first = (f: (typeof fields)[number]) => chosen[f]?.(row)[0] ?? null;
    let home = first("home") ? textOf(first("home")!) : "";
    let away = first("away") ? textOf(first("away")!) : "";
    if (home && (!away || away === home)) {
      const split = splitTeams(home);
      if (split) ({ home, away } = split);
    }
    if (!home || !away) continue;
    const startNode = first("startsAt");
    const startsAt = startNode ? parseSiteDate(attrValue(startNode, ["datetime", "data-start", "data-starts-at", "data-time", "data-timestamp"]) ?? textOf(startNode), o.timezone, o.now) : null;
    if (!startsAt) continue;
    const linkNode = first("link");
    const url = absolute(linkNode ? hrefOf(linkNode) : hrefOf(row), o.pageUrl);
    const siteEventId = eventIdOf(row, url) ?? `${home}|${away}|${startsAt.toISOString()}`;
    if (seen.has(siteEventId)) continue;
    seen.add(siteEventId);
    const leagueNode = first("league");
    events.push({ siteEventId, league: (leagueNode ? textOf(leagueNode) : (o.league ?? "")) || "", homeTeam: home, awayTeam: away, startsAt, url, marketsCount: null });
  }
  return { events, lastGood, rows: rows.length };
}

export type DomOddsRow = { marketSite: string; selectionSite: string; lineRaw: string | null; oddsRaw: string };
export type DomMarketsResult = { rows: DomOddsRow[]; lastGood: LastGood; selections: number };

/**
 * Cotes d'une fiche de match rendue : pour chaque sélection, son marché (le titre de marché qui la précède dans la
 * page), son libellé (texte de la sélection sans la cote), sa ligne (étape `line` ou dans le libellé) et sa cote.
 */
export function readMarketsFromHtml(html: string, dom: DomRecipe): DomMarketsResult {
  const root = parseHtml(html);
  const lastGood: LastGood = {};
  const selPick = pickCandidate([root], dom.market.selection);
  if (!selPick) return { rows: [], lastGood, selections: 0 };
  lastGood["market.selection"] = selPick.index;
  const sels = selPick.nodes(root);
  const namePick = pickCandidate([root], dom.market.name);
  if (namePick) lastGood["market.name"] = namePick.index;
  const names = namePick ? namePick.nodes(root) : [];
  const oddsScope = sels.find((s) => pickCandidate([s], dom.market.odds)) ?? null;
  const oddsPick = oddsScope ? pickCandidate([oddsScope], dom.market.odds) : null;
  if (oddsPick) lastGood["market.odds"] = oddsPick.index;
  const lineScope = dom.market.line ? (sels.find((s) => pickCandidate([s], dom.market.line)) ?? null) : null;
  const linePick = lineScope ? pickCandidate([lineScope], dom.market.line) : null;
  if (linePick) lastGood["market.line"] = linePick.index;
  const rows: DomOddsRow[] = [];
  for (const sel of sels) {
    const oddsNode = oddsPick?.nodes(sel)[0] ?? null;
    if (!oddsNode) continue;
    const oddsRaw = textOf(oddsNode);
    if (!oddsRaw) continue;
    const name = [...names].reverse().find((n) => n.order < sel.order && !isAncestor(sel, n));
    if (!name) continue;
    const lineNode = linePick?.nodes(sel)[0] ?? null;
    const full = textOf(sel);
    const idx = full.lastIndexOf(oddsRaw);
    const label = (idx >= 0 ? full.slice(0, idx) + full.slice(idx + oddsRaw.length) : full).replace(/\s+/g, " ").trim();
    if (!label) continue;
    rows.push({ marketSite: textOf(name), selectionSite: label, lineRaw: lineNode ? textOf(lineNode) : null, oddsRaw });
  }
  return { rows, lastGood, selections: sels.length };
}
