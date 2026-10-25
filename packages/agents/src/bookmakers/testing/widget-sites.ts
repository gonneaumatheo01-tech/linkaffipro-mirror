/**
 * Phase 35 (suite) — trois faux sites « à widget » pour les tests, à l'image de ce qui a été observé le 25 octobre 2026
 * chez les vrais bookmakers du client (aucun vrai site n'est joignable depuis les tests) :
 * - « altenaria » (comme Sportaza / moteur Altenar) : widget rendu par script dans un shadow DOM ouvert, sans lien
 *   HTML, routeur « mémoire » recopié dans l'adresse (`?page=sport&sportId=66`, `?page=coupon…&couponType=1`,
 *   `?page=event&eventId=N`), onglet « Par Heure », identifiant du match dans de fausses « fibres » React ;
 * - « betbia » (comme Bet Portal / moteur Betby) : widget en shadow DOM avec repères `data-editor-id`, liens de
 *   fiches `/fr/sports/football/<slug>-<id>`, flux JSON par manifeste (`/api/v4/prematch/brand/<marque>/fr/0`), marché
 *   « Total » en grille (en-têtes « plus de » / « moins de », cases « 2.5 ») ;
 * - « celsia » (comme Celsius) : page du casino avec le site de paris dans une iframe (second serveur), pages classiques
 *   avec `data-test-id`, API `/api/v2/matches` et `/api/v2/matches/<id>/markets` (cotes en millièmes).
 * Un clic sur une cote marque `window.betClicked = true` et envoie `POST /bet` (les tests vérifient que ça n'arrive jamais).
 * 127.0.0.1 seulement.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { FIXTURE_MATCHES, parisHHMM, worldOdds, type FixtureMatch, type WorldMarketOdds } from "./world";

export type WidgetSiteKey = "altenaria" | "betbia" | "celsia";
export type WidgetSite = { key: WidgetSiteKey; origin: string; baseUrl: string; host: string; port: number; sportsbookOrigin?: string };
export type WidgetRequest = { site: WidgetSiteKey; method: string; path: string; at: number };
export type WidgetSites = { sites: Record<WidgetSiteKey, WidgetSite>; requests: WidgetRequest[]; stop(): Promise<void> };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const html = (res: ServerResponse, body: string, status = 200) => res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(body);
const json = (res: ServerResponse, body: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
const js = (res: ServerResponse, body: string) => res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" }).end(body);

/** « 25/10 • 21:00 » (Altenar). */
const altenarTime = (m: FixtureMatch) => `${m.day.slice(8, 10)}/${m.day.slice(5, 7)} • ${parisHHMM(m.kickoff)}`;
/** « Aujourd’hui, 21:00 » / « Demain, 19:00 » (Betby). */
const betbyTime = (m: FixtureMatch) => `${m.day === "2026-10-25" ? "Aujourd’hui" : "Demain"}, ${parisHHMM(m.kickoff)}`;
/** « 25 OCT. 14:00 » (Celsius). */
const celsiaTime = (m: FixtureMatch) => `${m.day.slice(8, 10)} OCT. ${parisHHMM(m.kickoff)}`;

const MARKET_NAMES: Record<WidgetSiteKey, Record<WorldMarketOdds["market"], string>> = {
  altenaria: { result: "1x2", goals: "Total", corners: "Total corners", cards: "Total cartons", shots: "Tirs cadrés", double: "Double chance" },
  betbia: { result: "1x2", goals: "Total", corners: "Total de corners", cards: "Total de cartons", shots: "Tirs cadrés", double: "Double chance" },
  celsia: { result: "Résultat du match", goals: "Total de buts", corners: "Total de corners", cards: "Total de cartons", shots: "Tirs cadrés", double: "Double chance" },
};

function selectionLabel(m: FixtureMatch, mk: WorldMarketOdds, key: string, style: "fr" | "grid"): string {
  if (key === "home") return style === "grid" ? "1" : m.home;
  if (key === "away") return style === "grid" ? "2" : m.away;
  if (key === "draw") return style === "grid" ? "match nul" : "X";
  if (key === "over") return `Plus de ${mk.line}`;
  if (key === "under") return `Moins de ${mk.line}`;
  return key;
}

// --- données communes -----------------------------------------------------------------------------------------------

const altenarId = (m: FixtureMatch) => String(18080000 + m.index);
const betbyId = (m: FixtureMatch) => `272105422306319${String(1000 + m.index)}`;
const celsiaId = (m: FixtureMatch) => String(184400000 + m.index);

// --- altenaria ------------------------------------------------------------------------------------------------------

function altenariaPage(): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Paris sportifs | Altenaria</title>
<script src="/sb2wsdk-altenar2/altenarWSDK.js"></script></head>
<body><header><a href="/">Altenaria</a> <a href="/fr/casino">Casino</a> <a href="/fr/sports">Sports</a> <a href="/fr/cashier/deposit">Dépôt</a></header>
<stb-altenar-widget-sportsbook dir="ltr"><div id="altenar-host"></div></stb-altenar-widget-sportsbook>
<script src="/sb2wsdk-altenar2/widget.js"></script></body></html>`;
}

/** Widget côté navigateur : tout est rendu dans un shadow DOM ouvert, sans aucun lien. */
const ALTENARIA_WIDGET = `
(() => {
  const host = document.getElementById("altenar-host");
  const root = host.attachShadow({ mode: "open" });
  const fiberKey = "__reactFiber$test";
  const api = (p) => fetch("/widget-api" + p).then((r) => r.json());
  const q = () => new URLSearchParams(location.search);
  const go = (params) => { history.pushState({}, "", location.pathname + "?" + new URLSearchParams(params).toString()); render(); };
  const nav = (label, params) => { const b = document.createElement("span"); b.className = "SportMenuItemName-sc-19952724-10 SportMenuSportName-sc-19952724-11"; b.textContent = label; b.addEventListener("click", () => go(params)); return b; };
  const oddButton = (label, odds) => { const b = document.createElement("button"); b.className = "OddBoxButton-sc-d3061474-2 isjIZQ"; b.innerHTML = '<div class="OddBoxContent-sc-d3061474-3"><div class="OddLabelContent-sc-f5adcc3a-0"><span class="OddLabel-sc-f5adcc3a-1">' + label + '</span></div><div class="OddValue-sc-d3061474-4">' + odds.toFixed(2) + '</div></div>'; b.addEventListener("click", () => { window.betClicked = true; fetch("/bet", { method: "POST", body: "{}" }); }); return b; };
  async function render() {
    const p = q();
    root.innerHTML = "";
    const menu = document.createElement("div"); menu.className = "SportMenu-sc-1";
    menu.append(nav("En direct", { page: "live" }), nav("Football", { page: "sport", sportId: "66" }), nav("Tennis", { page: "sport", sportId: "68" }));
    root.append(menu);
    const page = p.get("page");
    if (page === "sport") {
      const box = document.createElement("div"); box.className = "SportPage-sc-2";
      const t = document.createElement("div"); t.textContent = "Football"; box.append(t);
      for (const [label, type] of [["Les matches du jour", "1"], ["Les matches de demain", "2"]]) { const c = document.createElement("span"); c.className = "CouponName-sc-bba57ded-3"; c.textContent = label; c.addEventListener("click", () => go({ page: "coupon", sportId: "66", couponType: type })); box.append(c); }
      root.append(box);
      return;
    }
    if (page === "coupon") {
      const data = await api("/coupon?type=" + (p.get("couponType") || "1"));
      const tabs = document.createElement("div"); tabs.className = "MatchOddsTabsContainer-sc-f2597a85-1";
      let byTime = root.__byTime === true;
      for (const label of ["Par Ligue", "Par Heure"]) { const b = document.createElement("button"); b.className = "MatchOddsTab-sc-f2597a85-0"; b.textContent = label; b.addEventListener("click", () => { root.__byTime = label === "Par Heure"; render(); }); tabs.append(b); }
      root.append(tabs);
      if (!byTime) { for (const l of data.leagues) { const h = document.createElement("div"); h.className = "ChampionshipContainer-sc-3"; h.innerHTML = '<div class="ChampionshipHeader-sc-4"><div class="ChampionshipName-sc-5">' + l + '</div></div>'; root.append(h); } return; }
      const list = document.createElement("div"); list.className = "EventsListContainer-sc-e2b98bf6-0";
      for (const e of data.events) {
        const row = document.createElement("div"); row.className = "EventBoxRoot-sc-8477650d-0";
        row.innerHTML = '<div class="EventBoxWrapper-sc-8477650d-1"><div class="EventBoxContainerBase-sc-8477650d-34"><div class="EventBoxInfoBase-sc-8477650d-23"><div class="TimeWrapper-sc-8477650d-12"><div class="StartTime-sc-8477650d-9">' + e.time + '</div></div></div><div class="EventBoxChampionshipWrapperBase-sc-8477650d-18"><div class="CategoryChampionship-sc-8477650d-6">' + e.league + '</div></div><div class="CompetitorsWrapper-sc-cc6a346d-8"><div class="CompetitorContainer-sc-cc6a346d-6"><div class="CompetitorNameBase-sc-e8629365-0 CompetitorName-sc-cc6a346d-7">' + e.home + '</div></div><div class="CompetitorContainer-sc-cc6a346d-6"><div class="CompetitorNameBase-sc-e8629365-0 CompetitorName-sc-cc6a346d-7">' + e.away + '</div></div></div><div class="MarketBoxWrapper-sc-8477650d-15"></div></div></div>';
        const mk = row.querySelector('[class*="MarketBoxWrapper"]');
        for (const s of e.main) mk.append(oddButton(s.label, s.odds));
        row[fiberKey] = { memoizedProps: { className: "x" }, return: { memoizedProps: { event: { id: Number(e.id), name: e.home } }, return: null } };
        for (const c of row.querySelectorAll("*")) c[fiberKey] = { memoizedProps: {}, return: row[fiberKey] };
        row.querySelector('[class*="CompetitorsWrapper"]').addEventListener("click", () => go({ page: "event", eventId: e.id, sportId: "66" }));
        list.append(row);
      }
      root.append(list);
      return;
    }
    if (page === "event") {
      const e = await api("/event?id=" + p.get("eventId"));
      const head = document.createElement("div"); head.className = "EventDetailsHeader-sc-1"; head.innerHTML = '<div class="EventDetailsCompetitors-sc-2">' + e.home + ' vs. ' + e.away + '</div>';
      head[fiberKey] = { memoizedProps: { eventId: Number(e.id) }, return: null };
      root.append(head);
      const tabs = document.createElement("div"); tabs.className = "TabsContainer-sc-ed2541f7-0";
      for (const label of ["Tout", "Main", "Extra", "1re demie"]) { const t = document.createElement("div"); t.className = "TabWrapper-sc-ed2541f7-2"; t.textContent = label; t.addEventListener("click", () => { root.__tab = label; }); tabs.append(t); }
      root.append(tabs);
      const markets = document.createElement("div"); markets.className = "EventDetailsMarketsContainer-sc-8337effd-0";
      for (const m of e.markets) {
        const box = document.createElement("div"); box.className = "EventDetailsMarketBoxRoot-sc-84df8f74-24";
        box.innerHTML = '<div class="EventDetailsMarketHeader-sc-84df8f74-1"><div class="EventDetailsMarketNameWrapper-sc-84df8f74-27"><div class="EventDetailsMarketNameContainer-sc-84df8f74-3"><div class="EventDetailsMarketName-sc-84df8f74-4">' + m.name + '</div></div></div></div><div class="MarketContainer-sc-13debd79-0"></div>';
        const c = box.querySelector('[class*="MarketContainer"]');
        for (const s of m.selections) c.append(oddButton(s.label, s.odds));
        markets.append(box);
      }
      root.append(markets);
      return;
    }
    const home = document.createElement("div"); home.className = "Overview-sc-1"; home.textContent = "Paris populaires";
    root.append(home);
  }
  window.addEventListener("popstate", render);
  render();
})();
`;

function altenariaData(kind: "coupon" | "event", query: URLSearchParams): unknown {
  const matches = FIXTURE_MATCHES.map((m) => ({ m, odds: worldOdds("sportaza", m) }));
  if (kind === "coupon") {
    const day = query.get("type") === "2" ? "2026-10-26" : "2026-10-25";
    const events = matches
      .filter(({ m }) => m.day === day)
      .map(({ m, odds }) => ({ id: altenarId(m), time: altenarTime(m), league: `${m.league} • Monde`, home: m.home, away: m.away, main: odds[0]!.selections.map((s) => ({ label: selectionLabel(m, odds[0]!, s.key, "fr"), odds: s.decimal })) }));
    return { leagues: [...new Set(events.map((e) => e.league))], events };
  }
  const found = matches.find(({ m }) => altenarId(m) === query.get("id"));
  if (!found) return { error: "inconnu" };
  const { m, odds } = found;
  return { id: altenarId(m), home: m.home, away: m.away, markets: odds.map((mk) => ({ name: MARKET_NAMES.altenaria[mk.market], selections: mk.selections.map((s) => ({ label: selectionLabel(m, mk, s.key, "fr"), odds: s.decimal })) })) };
}

function altenariaHandler(req: IncomingMessage, res: ServerResponse): void {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  if (u.pathname === "/sb2wsdk-altenar2/altenarWSDK.js") return js(res, "window.altenarWSDK = { init() {}, set() {} };");
  if (u.pathname === "/sb2wsdk-altenar2/widget.js") return js(res, ALTENARIA_WIDGET);
  if (u.pathname === "/widget-api/coupon") return json(res, altenariaData("coupon", u.searchParams));
  if (u.pathname === "/widget-api/event") return json(res, altenariaData("event", u.searchParams));
  if (u.pathname === "/fr/cashier/deposit") return html(res, "<html><body><h1>Dépôt</h1><form><input name=amount></form></body></html>");
  if (u.pathname === "/" || u.pathname === "/fr/sports" || u.pathname === "/fr/casino") return html(res, altenariaPage());
  return html(res, "<html><body>introuvable</body></html>", 404);
}

// --- betbia ---------------------------------------------------------------------------------------------------------

const BETBIA_BRAND = "2632876342999396354";

function betbiaPage(): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Paris sportifs | Betbia</title></head>
<body><header><a href="/fr/">Betbia</a> <a href="/fr/casino">Casino</a> <a href="/fr/sports">Paris sportifs</a> <a href="/fr/wallet">Caisse</a></header>
<main><div id="betby" class="betby-pending"></div></main>
<script src="/bt-renderer.min.js"></script></body></html>`;
}

/** Widget Betby imité : un seul shadow DOM, repères `data-editor-id`, liens de fiches, flux JSON par manifeste. */
const BETBIA_WIDGET = `
(() => {
  const container = document.getElementById("betby");
  const inner = document.createElement("div"); inner.className = "sc-kr14wy-0";
  container.append(inner);
  const root = inner.attachShadow({ mode: "open" });
  const BRAND = "${BETBIA_BRAND}";
  const feed = async () => {
    const m = await (await fetch("/api/v4/prematch/brand/" + BRAND + "/fr/0")).json();
    const chunks = [];
    for (const v of [...m.top_events_versions, ...m.rest_events_versions]) chunks.push(await (await fetch("/api/v4/prematch/brand/" + BRAND + "/fr/" + v)).json());
    return chunks;
  };
  const plate = (name, odds) => { const d = document.createElement("div"); d.setAttribute("data-editor-id", "outcomePlate"); d.setAttribute("data-active", "false"); d.className = "sc-7elhv3-0"; d.innerHTML = '<div class="jss349"></div><div data-editor-id="marketCardOutcomeName" class="sc-7elhv3-2"><span class="sc-7elhv3-3">' + name + '</span></div><div class="sc-1oeg2ad-0"><span class="sc-1oeg2ad-1">' + odds.toFixed(2) + '</span></div>'; d.addEventListener("click", () => { window.betClicked = true; fetch("/bet", { method: "POST", body: "{}" }); }); return d; };
  async function render() {
    const chunks = await feed();
    const events = []; const tournaments = {}; const categories = {};
    for (const c of chunks) { Object.assign(tournaments, c.tournaments); Object.assign(categories, c.categories); for (const [id, e] of Object.entries(c.events)) events.push({ id, ...e }); }
    const path = location.pathname;
    root.innerHTML = "";
    const side = document.createElement("div"); side.setAttribute("data-editor-id", "sidebarSportsList");
    for (const [label, count] of [["Football", events.length], ["Tennis", 3]]) { const item = document.createElement("div"); item.innerHTML = '<span data-editor-id="verticalNavbarSportItemLabel">' + label + '<span data-editor-id="verticalNavbarSportCount"><span>' + count + '</span></span></span>'; if (label === "Football") item.addEventListener("click", () => { location.assign("/fr/sports/football-1"); }); side.append(item); }
    root.append(side);
    // Carte comme en vrai : aucun repère sur les noms d'équipes (en-tête, puis bloc des équipes > ligne > (logo, nom) ×2 + score).
    const card = (e) => {
      const t = tournaments[e.desc.tournament]; const cat = categories[e.desc.category] || { slug: "monde", name: "Monde" };
      const a = document.createElement("a"); a.setAttribute("data-editor-id", "eventCardContent"); a.className = "sc-1lcyybx-0 ldHlRC"; a.href = "/fr/sports/football/" + cat.slug + "/" + t.slug + "/" + e.desc.slug + "-" + e.id;
      const teamHtml = (name) => '<div class="sc-ujf0l1-2 jwwkcl"><div class="jss60 sc-ujf0l1-3"><div class="sc-tu0l0b-0 jaLcWa"></div><div class="jss61">' + name + '</div></div><div class="jss63 sc-ujf0l1-4"></div></div>';
      a.innerHTML = '<div class="sc-1lcyybx-1 cCpXGj"><div class="sc-1lcyybx-2 cTLdJx"><div class="sc-1lcyybx-3 dFLizX"><div data-editor-id="eventCardStatusLabel" class="sc-16ixfl8-0">' + e.desc.when + '</div></div><div data-editor-id="eventCardCategory"><span>' + cat.name + '</span><span>' + t.name + '</span></div></div></div>'
        + '<div class="sc-ujf0l1-0 fpLhQC"><div class="sc-ujf0l1-1 qUAYR">' + teamHtml(e.desc.competitors[0].name) + teamHtml(e.desc.competitors[1].name) + '</div><div data-editor-id="eventPlateScore" class="sc-7l8my2-0"></div></div>';
      const o = document.createElement("div"); o.setAttribute("data-editor-id", "eventCardOdds");
      for (const [k, v] of Object.entries(e.markets["1"][""])) o.append(plate(k === "1" ? "1" : k === "2" ? "match nul" : "2", Number(v.k)));
      const wrap = document.createElement("div"); wrap.setAttribute("data-editor-id", "eventCard"); wrap.append(a, o);
      return wrap;
    };
    if (/^\\/fr\\/sports\\/football-1$/.test(path)) {
      const tabs = document.createElement("div");
      for (const label of ["Populaire", "Direct", "À venir", "Paris long terme"]) { const t = document.createElement("div"); t.setAttribute("data-editor-id", "sportPageMatchesTab"); t.textContent = label; t.addEventListener("click", () => { root.__tab = label; draw(); }); tabs.append(t); }
      root.append(tabs);
      const list = document.createElement("div"); list.setAttribute("data-editor-id", "eventList"); root.append(list);
      const draw = () => { list.innerHTML = ""; const tab = root.__tab || "Populaire"; const rows = tab === "À venir" ? events.filter((e) => e.desc.type === "match") : events.filter((e) => e.desc.type === "match").slice(0, 3); for (const e of rows) list.append(card(e)); };
      draw();
      return;
    }
    const ev = /^\\/fr\\/sports\\/football\\/[^/]+\\/[^/]+\\/[^/]+-(\\d{6,})$/.exec(path);
    if (ev) {
      const e = events.find((x) => x.id === ev[1]);
      if (!e) { root.append(Object.assign(document.createElement("div"), { textContent: "introuvable" })); return; }
      const d = await (await fetch("/api/v3/descriptions/brand/" + BRAND + "/event/" + e.id + "/fr")).json();
      const board = document.createElement("div"); board.setAttribute("data-editor-id", "scoreBoardCard"); board.innerHTML = '<div data-editor-id="scoreBoardCategory">' + tournaments[e.desc.tournament].name + '</div><div>' + e.desc.competitors[0].name + '</div><div data-editor-id="prematchStartedAt">' + e.desc.when + '</div><div>' + e.desc.competitors[1].name + '</div>';
      root.append(board);
      const tabs = document.createElement("div");
      for (const label of ["Principal", "Statistique", "Totaux", "Extras"]) { const t = document.createElement("div"); t.setAttribute("data-editor-id", "eventMarketTab"); t.textContent = label + d.markets.length; t.addEventListener("click", () => {}); tabs.append(t); }
      root.append(tabs);
      for (const m of d.markets) {
        const c = document.createElement("div"); c.setAttribute("data-editor-id", "marketCard"); c.innerHTML = '<div data-editor-id="marketCardHeader"><div><div><div>' + m.name + '</div></div></div></div>';
        const body = document.createElement("div");
        if (m.grid) {
          for (const h of m.grid.headers) { const hd = document.createElement("div"); hd.setAttribute("data-editor-id", "marketCardOutcomeCellHeader"); hd.textContent = h; body.append(hd); }
          for (const cell of m.grid.cells) { const w = document.createElement("div"); w.append(plate(cell.name, cell.odds)); body.append(w); }
        } else for (const s of m.selections) body.append(plate(s.name, s.odds));
        c.append(body);
        root.append(c);
      }
      return;
    }
    const pop = document.createElement("div"); pop.setAttribute("data-editor-id", "popularEvents");
    for (const e of events.filter((x) => x.desc.type === "match").slice(0, 3)) pop.append(card(e));
    root.append(pop);
  }
  render();
})();
`;

type BetbiaChunk = { epoch: number; version: number; sports: Record<string, { name: string; slug: string }>; categories: Record<string, { name: string; slug: string }>; tournaments: Record<string, { category_id: string; name: string; slug: string }>; events: Record<string, unknown> };

function betbiaChunks(): [BetbiaChunk, BetbiaChunk] {
  const tournamentId = (league: string) => `166981${String(10000 + [...league].reduce((a, c) => a + c.charCodeAt(0), 0)).padStart(8, "0")}`;
  const tournaments: BetbiaChunk["tournaments"] = {};
  for (const m of FIXTURE_MATCHES) tournaments[tournamentId(m.league)] = { category_id: "1669818812180074496", name: m.league, slug: slug(m.league) };
  const mk = (sub: readonly FixtureMatch[], version: number): BetbiaChunk => {
    const events: Record<string, unknown> = {};
    for (const m of sub) {
      const odds = worldOdds("betportal", m);
      const result = odds.find((o) => o.market === "result")!;
      events[betbyId(m)] = {
        desc: { scheduled: Math.floor(Date.parse(m.kickoff) / 1000), type: "match", slug: `${slug(m.home)}-${slug(m.away)}`, sport: "1", category: "1669818812180074496", tournament: tournamentId(m.league), competitors: [{ id: "1", sport_id: "1", name: m.home }, { id: "2", sport_id: "1", name: m.away }], when: betbyTime(m) },
        markets: { "1": { "": { "1": { k: String(result.selections[0]!.decimal) }, "2": { k: String(result.selections[1]!.decimal) }, "3": { k: String(result.selections[2]!.decimal) } } } },
        state: { status: 0 },
      };
    }
    // Un match de tennis (autre sport) : jamais lu comme un match de football.
    events["2721054223063199999"] = { desc: { scheduled: Math.floor(Date.parse("2026-10-25T12:00:00Z") / 1000), type: "match", slug: "x-y", sport: "5", category: "c", tournament: "t", competitors: [{ id: "a", name: "Joueur A" }, { id: "b", name: "Joueur B" }], when: "Aujourd’hui, 13:00" }, markets: { "1": { "": { "1": { k: "1.5" }, "2": { k: "2.5" } } } }, state: { status: 0 } };
    return { epoch: 1792668550763, version, sports: { "1": { name: "Football", slug: "football" }, "5": { name: "Tennis", slug: "tennis" } }, categories: { "1669818812180074496": { name: "Monde", slug: "monde" } }, tournaments, events };
  };
  return [mk(FIXTURE_MATCHES.slice(0, 4), 1792948972888), mk(FIXTURE_MATCHES.slice(4), 1792948972889)];
}

function betbiaEventDescription(id: string): unknown {
  const m = FIXTURE_MATCHES.find((x) => betbyId(x) === id);
  if (!m) return { players: [], markets: [] };
  const odds = worldOdds("betportal", m);
  const markets = odds.map((mk) => {
    const name = MARKET_NAMES.betbia[mk.market];
    if (mk.line !== null && mk.selections.length === 2) {
      // Grille : en-têtes de colonne « plus de » / « moins de », cases avec la ligne seule, deux lignes (2.5 et 3.5).
      const [over, under] = mk.selections;
      return { name, grid: { headers: ["plus de", "moins de"], cells: [{ name: String(mk.line), odds: over!.decimal }, { name: String(mk.line), odds: under!.decimal }, { name: String(mk.line + 1), odds: Math.round((over!.decimal + 0.5) * 100) / 100 }, { name: String(mk.line + 1), odds: Math.max(1.2, Math.round((under!.decimal - 0.3) * 100) / 100) }] } };
    }
    return { name, selections: mk.selections.map((s) => ({ name: selectionLabel(m, mk, s.key, "grid"), odds: s.decimal })) };
  });
  return { players: [], markets };
}

function betbiaHandler(req: IncomingMessage, res: ServerResponse): void {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  if (u.pathname === "/bt-renderer.min.js") return js(res, BETBIA_WIDGET);
  const manifest = new RegExp(`^/api/v4/prematch/brand/${BETBIA_BRAND}/fr/(\\d+)$`).exec(u.pathname);
  if (manifest) {
    const [a, b] = betbiaChunks();
    if (manifest[1] === "0") return json(res, { epoch: a.epoch, version: 1792948972890, top_events_versions: [a.version], rest_events_versions: [b.version], generated: 1792948989035, status: {} });
    if (manifest[1] === String(a.version)) return json(res, a);
    if (manifest[1] === String(b.version)) return json(res, b);
    return json(res, { error: "version inconnue" }, 404);
  }
  const desc = new RegExp(`^/api/v3/descriptions/brand/${BETBIA_BRAND}/event/(\\d+)/fr$`).exec(u.pathname);
  if (desc) return json(res, betbiaEventDescription(desc[1]!));
  if (u.pathname === "/fr/wallet") return html(res, "<html><body><h1>Caisse</h1></body></html>");
  if (/^\/(fr\/?)?$|^\/fr\/sports(\/|$)|^\/fr\/casino$/.test(u.pathname)) return html(res, betbiaPage());
  return html(res, "<html><body>introuvable</body></html>", 404);
}

// --- celsia ---------------------------------------------------------------------------------------------------------

function celsiaHostPage(sportsbook: string, path: string): string {
  const frame = /^\/fr\/sports\/soccer$/.test(path) ? `<iframe src="${sportsbook}/fr/soccer" style="width:100%;height:85vh;border:0"></iframe>` : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Celsia Casino</title></head>
<body><nav><a href="/fr">Accueil</a> <a href="/fr/sports">Sports</a> <a href="/fr/sports/soccer">Football</a> <a href="/fr/sports/tennis">Tennis</a> <a href="/fr/cashier">Caisse</a></nav>
<main><h1>Celsia — crypto casino et paris sportifs</h1>${frame}<p>Plus de 30 sports, des centaines de marchés.</p></main></body></html>`;
}

const CELSIA_SPORTSBOOK_SCRIPT = `
(async () => {
  const path = location.pathname;
  const main = document.getElementById("sb");
  const odd = (label, odds) => '<button class="sb-MarketTable-outcome sb-Odd" data-test-id="odd" type="button" onclick="window.betClicked=true;fetch(&quot;/bet&quot;,{method:&quot;POST&quot;,body:&quot;{}&quot;})"><span class="sb-Odd-label" data-test-id="odd-label">' + label + '</span><div class="sb-AnimatedOdd sb-Odd-value" data-test-id="animated-odd">' + (odds / 1000).toFixed(2) + '</div></button>';
  if (path === "/fr/soccer" || path === "/fr/schedule") {
    const r = await (await fetch("/api/v2/matches?bettable=true&limit=500&match_status=0&sort_by=start_time%3Aasc&sport_key=soccer&type=match&start_from=2026-10-25T00%3A00%3A00Z&start_to=2026-10-26T23%3A59%3A59Z")).json();
    let out = '<div class="sb-SportPage"><h2>Football</h2><a href="/fr/schedule?sport=soccer">Tout afficher</a><div class="sb-BettingTable">';
    for (const m of r.data) out += '<div class="sb-BettingTable-row"><a class="sb-BettingTable-link" data-test-id="game-link" href="/fr/soccer/' + m.slug + '-m-' + m.id + '"><div class="sb-GameRowDesktop-status"><span class="sb-GameRowDesktop-time" data-test-id="game-row-time">' + m.when + '</span></div><div class="sb-GameCompetitors" data-test-id="game-competitors"><div class="sb-TeamColumn"><span class="sb-TeamColumn-name" data-test-id="team-column-name">' + m.competitors.home.name + '</span></div><div class="sb-TeamColumn"><span class="sb-TeamColumn-name" data-test-id="team-column-name">' + m.competitors.away.name + '</span></div></div></a><div class="sb-OddsContainer" data-test-id="odds-container">' + m.main.map((o) => '<button class="sb-BettingTable-cell sb-Odd" data-test-id="odds-cell" type="button" onclick="window.betClicked=true;fetch(&quot;/bet&quot;,{method:&quot;POST&quot;,body:&quot;{}&quot;})"><div class="sb-AnimatedOdd sb-Odd-value" data-test-id="animated-odd">' + (o / 1000).toFixed(2) + '</div></button>').join("") + '</div></div>';
    main.innerHTML = out + "</div></div>";
    return;
  }
  const ev = /-m-(\\d+)$/.exec(path);
  if (ev) {
    const r = await (await fetch("/api/v2/matches/" + ev[1] + "/markets?limit=500")).json();
    const m = r.match;
    let out = '<h1>' + m.home + ' - ' + m.away + '</h1><div class="sb-TabsList">' + ["top", "all", "total", "handicap"].map((k) => '<button role="tab" class="sb-TabsTrigger sb-GameOddsTab" data-test-id="game-odds-tab-' + k + '">' + ({ top: "Le Top", all: "Tous", total: "Total", handicap: "Handicap" })[k] + '</button>').join("") + '</div>';
    for (const mk of r.data) out += '<div class="sb-MarketTable" data-test-id="market-table"><div class="sb-MarketTable-header"><span class="sb-MarketTable-name" data-test-id="market-table-name">' + mk.name + '</span></div><div class="sb-MarketTable-baseGrid">' + mk.outcomes.map((o) => odd(o.name, o.odds)).join("") + '</div></div>';
    main.innerHTML = out;
  }
})();
`;

function celsiaSportsbookPage(): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Celsia Sports</title></head><body><nav><a href="/fr/live">En cours</a> <a href="/fr/soccer">Football</a> <a href="/fr/tennis">Tennis</a></nav><div id="sb"></div><script src="/fe-api/app.js"></script></body></html>`;
}

function celsiaMatches(query: URLSearchParams): unknown {
  const from = query.get("start_from") ?? "2026-10-25T00:00:00Z";
  const to = query.get("start_to") ?? "2026-10-26T23:59:59Z";
  const rows = FIXTURE_MATCHES.filter((m) => m.kickoff >= from && m.kickoff <= to).map((m) => {
    const result = worldOdds("celsius", m)[0]!;
    return { id: Number(celsiaId(m)), urn_id: `bc:match:${celsiaId(m)}`, start_time: m.kickoff, status: 0, type: "match", slug: `${slug(m.home)}-${slug(m.away)}`, when: celsiaTime(m), competitors: { home: { name: m.home }, away: { name: m.away } }, tournament: { id: 7000 + m.index, name: m.league, sport: { key: "soccer", name: "Football" } }, main: result.selections.map((s) => Math.round(s.decimal * 1000)) };
  });
  const page = Number(query.get("page") ?? "1");
  const limit = Number(query.get("limit") ?? "500");
  return { data: rows.slice((page - 1) * limit, page * limit), pagination: { total: rows.length, page, limit, last_page: Math.max(1, Math.ceil(rows.length / limit)) } };
}

function celsiaMarkets(id: string, query: URLSearchParams): unknown {
  const m = FIXTURE_MATCHES.find((x) => celsiaId(x) === id);
  if (!m) return { data: [], pagination: { total: 0, page: 1, limit: 500, last_page: 1 } };
  const all = worldOdds("celsius", m).map((mk, i) => ({ id: 239 + i, match_id: Number(id), name: MARKET_NAMES.celsia[mk.market], status: 1, outcomes: mk.selections.map((s, j) => ({ id: 2444 + j, active: true, name: selectionLabel(m, mk, s.key, "fr"), odds: Math.round(s.decimal * 1000) })) }));
  const page = Number(query.get("page") ?? "1");
  return { match: { home: m.home, away: m.away }, data: page === 1 ? all : [], pagination: { total: all.length, page, limit: 500, last_page: 1 } };
}

function celsiaSportsbookHandler(req: IncomingMessage, res: ServerResponse): void {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  if (u.pathname === "/fe-api/app.js") return js(res, CELSIA_SPORTSBOOK_SCRIPT);
  if (u.pathname === "/api/v2/matches") return json(res, celsiaMatches(u.searchParams));
  const mk = /^\/api\/v2\/matches\/(\d+)\/markets$/.exec(u.pathname);
  if (mk) return json(res, celsiaMarkets(mk[1]!, u.searchParams));
  if (u.pathname === "/fr/soccer" || u.pathname === "/fr/schedule" || u.pathname === "/fr/live" || u.pathname === "/fr/tennis" || /^\/fr\/soccer\/[^/]+-m-\d+$/.test(u.pathname)) return html(res, celsiaSportsbookPage());
  return html(res, "<html><body>introuvable</body></html>", 404);
}

// --- serveurs ---------------------------------------------------------------------------------------------------------

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; origin: string; port: number; sockets: Set<Socket> }> {
  const sockets = new Set<Socket>();
  const server = createServer(handler);
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { server, origin: `http://127.0.0.1:${port}`, port, sockets };
}

/** Démarre les trois faux sites à widget (et le site de paris de « celsia » sur un second port). */
export async function startWidgetSites(): Promise<WidgetSites> {
  const requests: WidgetRequest[] = [];
  const logged = (site: WidgetSiteKey, h: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => {
    requests.push({ site, method: req.method ?? "GET", path: req.url ?? "/", at: Date.now() });
    h(req, res);
  };
  const sportsbook = await listen(logged("celsia", celsiaSportsbookHandler));
  const a = await listen(logged("altenaria", altenariaHandler));
  const b = await listen(logged("betbia", betbiaHandler));
  const c = await listen(logged("celsia", (req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname === "/fr/cashier") return html(res, "<html><body><h1>Caisse</h1></body></html>");
    if (/^\/(fr\/?)?$|^\/fr\/sports(\/|$)/.test(u.pathname)) return html(res, celsiaHostPage(sportsbook.origin, u.pathname));
    return html(res, "<html><body>introuvable</body></html>", 404);
  }));
  const all = [sportsbook, a, b, c];
  return {
    sites: {
      altenaria: { key: "altenaria", origin: a.origin, baseUrl: `${a.origin}/fr/sports`, host: "127.0.0.1", port: a.port },
      betbia: { key: "betbia", origin: b.origin, baseUrl: `${b.origin}/fr/sports`, host: "127.0.0.1", port: b.port },
      celsia: { key: "celsia", origin: c.origin, baseUrl: `${c.origin}/fr`, host: "127.0.0.1", port: c.port, sportsbookOrigin: sportsbook.origin },
    },
    requests,
    stop: async () => {
      for (const s of all) {
        for (const sock of s.sockets) sock.destroy();
        await new Promise<void>((r) => s.server.close(() => r()));
      }
    },
  };
}

/** Identifiants des matchs du monde sur chaque faux site à widget (pour les tests). */
export const widgetEventId: Record<WidgetSiteKey, (m: FixtureMatch) => string> = { altenaria: altenarId, betbia: betbyId, celsia: celsiaId };
export { esc as escapeHtml };
