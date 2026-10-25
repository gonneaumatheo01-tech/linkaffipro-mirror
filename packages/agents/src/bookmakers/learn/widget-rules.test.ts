/**
 * Phase 35 (suite) — règles PURES de la lecture des widgets de paris : miroirs de domaine, adresses et clics de
 * navigation par moteur, grilles de marchés (« plus de / moins de »), formes JSON (clé d'objet, rang fixe, jointure,
 * filtre, manifeste), cotes en millièmes écrites en décimal, fiches fournisseur (reconnaissance, adresses, ordre).
 * Aucun réseau, aucun navigateur.
 */
import { describe, expect, it } from "vitest";
import { allowedBaseOf, brandLabel, brandMirrorOf, forbiddenClickReason, forbiddenUrlReason, registrableDomain } from "../../providers/screenshot/guard";
import type { SiteRecording } from "../contract";
import { eventIdFromUrl, readEventsFromHtml, readMarketsFromHtml } from "../read/dom-read";
import { extractRows, keepRows, manifestVersions, parsePath } from "../read/json-shape";
import { toDecimalOdds } from "../read/odds-format";
import { pageOddsFromHtml } from "./page-odds";
import { altenarRecipe, betbyFeedOf, betbyRecipe, builtinRecipes, marketMapFor, matchesApiOf, matchesApiRecipe, recipeAddressesAllowed } from "./profiles";
import { isEventUrl } from "./record";
import { navSelectorsFor, providerClicksAfter, providerUrlsFor } from "./widget-nav";

const recording = (o: Partial<SiteRecording> = {}): SiteRecording => ({
  siteKey: "x",
  baseUrl: "https://www.sportaza.com/fr/sports",
  startedAt: "2026-10-25T09:00:00.000Z",
  endedAt: "2026-10-25T09:03:00.000Z",
  responses: [],
  pages: [],
  domains: ["www.sportaza.com", "sportaza-5178.com"],
  providerHint: "altenar",
  pageOdds: [],
  ...o,
});

describe("miroirs de domaine (les bookmakers changent d'adresse et y renvoient eux-mêmes)", () => {
  it("étiquette de marque et domaine enregistrable", () => {
    expect(brandLabel("www.sportaza-5178.com")).toBe("sportaza-5178");
    expect(brandLabel("celsiuscasino.com")).toBe("celsiuscasino");
    expect(brandLabel("sportaza.co.uk")).toBe("sportaza");
    expect(registrableDomain("www.sportaza-5178.com")).toBe("sportaza-5178.com");
    expect(registrableDomain("a.b.sportaza.co.uk")).toBe("sportaza.co.uk");
  });
  it("miroir numéroté, marque longue, sous-domaine : reconnus ; marque différente ou trop courte : refusée", () => {
    expect(brandMirrorOf("sportaza-5178.com", ["sportaza.com"])).toBe("sportaza-5178.com");
    expect(brandMirrorOf("www.sportaza-5178.com", ["www.sportaza.com"])).toBe("sportaza-5178.com");
    expect(brandMirrorOf("celsiuscasino.com", ["celsius.games"])).toBe("celsiuscasino.com");
    expect(brandMirrorOf("sports.celsiuscasino.com", ["celsius.games"])).toBe("celsiuscasino.com");
    expect(brandMirrorOf("betportal.com", ["betportal.com"])).toBe("betportal.com");
    expect(brandMirrorOf("sportazax.com", ["sportaza.com"])).toBeNull();
    expect(brandMirrorOf("sportaza-phishing.com", ["sportaza.com"])).toBeNull();
    expect(brandMirrorOf("bet-5178.com", ["bet.com"])).toBeNull();
    expect(brandMirrorOf("evil.com", ["sportaza.com"])).toBeNull();
    expect(allowedBaseOf("sports.celsiuscasino.com", ["celsius.games"])).toBe("celsiuscasino.com");
    expect(allowedBaseOf("evil.com", ["celsius.games"])).toBeNull();
  });
  it("la garde des adresses suit un miroir mais jamais une page d'argent, même sur le miroir", () => {
    expect(forbiddenUrlReason("https://sportaza-5178.com/fr/sports?page=event&eventId=1", ["sportaza.com"])).toBeNull();
    expect(forbiddenUrlReason("https://sportaza-5178.com/fr/cashier/deposit", ["sportaza.com"])).not.toBeNull();
    expect(forbiddenUrlReason("https://sportaza-evil.com/fr/sports", ["sportaza.com"])).not.toBeNull();
  });
  it("un bouton qui affiche une cote n'est jamais cliqué, même pour naviguer", () => {
    const d = { tag: "button", text: "FC Pacific6.00", ownText: "FC Pacific6.00", attributes: ["class=OddBoxButton-sc-1"], href: null, type: null, role: null, visible: true } as never;
    expect(forbiddenClickReason(d, "navigate")).toMatch(/cote/);
    const plain = { tag: "button", text: "Par Heure", ownText: "Par Heure", attributes: ["class=MatchOddsTab-sc-1"], href: null, type: null, role: null, visible: true } as never;
    expect(forbiddenClickReason(plain, "navigate")).toBeNull();
  });
});

describe("navigation par moteur (adresses connues, clics après)", () => {
  it("Altenar : routeur mémoire recopié dans l'adresse ; Betby : chemin du sport ; inconnu : rien", () => {
    const at = "https://sportaza-5178.com/fr/sports?page=overview";
    expect(providerUrlsFor("altenar", at, "football")).toEqual(["https://sportaza-5178.com/fr/sports?page=sport&sportId=66"]);
    expect(providerUrlsFor("altenar", at, "today")).toEqual(["https://sportaza-5178.com/fr/sports?page=coupon&sportId=66&couponType=1"]);
    expect(providerUrlsFor("altenar", at, "tomorrow")).toEqual(["https://sportaza-5178.com/fr/sports?page=coupon&sportId=66&couponType=2"]);
    expect(providerClicksAfter("altenar", "today")).toEqual(["list_by_time"]);
    expect(providerUrlsFor("betby", "https://betportal.com/fr/sports", "football")).toEqual(["https://betportal.com/fr/sports/football-1"]);
    expect(providerUrlsFor("betby", "https://betportal.com/fr/sports/tennis-5", "football")).toEqual(["https://betportal.com/fr/sports/football-1"]);
    expect(providerUrlsFor("betby", "https://betportal.com/fr/sports", "today")).toEqual([]);
    expect(providerUrlsFor("inconnu", at, "football")).toEqual([]);
    expect(providerUrlsFor("altenar", "pas une adresse", "football")).toEqual([]);
  });
  it("sélecteurs de navigation : texte exact d'abord, éléments qu'un humain clique seulement", () => {
    const sels = navSelectorsFor("Par Heure");
    expect(sels[0]).toContain(':text-is("Par Heure")');
    expect(sels.join(" ")).not.toMatch(/input|form/);
  });
  it("adresses de fiches de match : avec identifiant long ou mot-clé, pas les pages de compte", () => {
    expect(isEventUrl("https://betportal.com/fr/sports/football/spain/laliga/fc-barcelona-real-madrid-2721054223063191561")).toBe(true);
    expect(isEventUrl("https://sports.celsiuscasino.com/fr/soccer/as-mirabelle-fc-lavande-m-184400000")).toBe(true);
    expect(isEventUrl("https://sportaza-5178.com/fr/sports?page=event&eventId=18080871&sportId=66")).toBe(true);
    expect(isEventUrl("https://betportal.com/fr/sports/football-1")).toBe(false);
    expect(isEventUrl("https://betportal.com/fr/wallet")).toBe(false);
    expect(eventIdFromUrl("https://betportal.com/fr/sports/football/spain/laliga/fc-barcelona-real-madrid-2721054223063191561")).toBe("2721054223063191561");
    expect(eventIdFromUrl("https://sports.celsiuscasino.com/fr/soccer/as-mirabelle-fc-lavande-m-184400000")).toBe("184400000");
    expect(eventIdFromUrl("https://sportaza-5178.com/fr/sports?page=event&eventId=18080871&sportId=66")).toBe("18080871");
  });
});

describe("marchés en grille (Betby : en-têtes « plus de / moins de », cases avec la ligne seule)", () => {
  const html = `<html><body><div id="betby"><div data-lap-shadow="1">
<div data-editor-id="marketCard"><div data-editor-id="marketCardHeader"><div><div><div>Total</div></div></div></div>
 <div><div data-editor-id="marketCardOutcomeCellHeader">plus de</div><div data-editor-id="marketCardOutcomeCellHeader">moins de</div>
 <div><div data-editor-id="outcomePlate"><div data-editor-id="marketCardOutcomeName"><span>2.5</span></div><div><span>1.85</span></div></div></div>
 <div><div data-editor-id="outcomePlate"><div data-editor-id="marketCardOutcomeName"><span>2.5</span></div><div><span>1.85</span></div></div></div>
 <div><div data-editor-id="outcomePlate"><div data-editor-id="marketCardOutcomeName"><span>3.5</span></div><div><span>2.35</span></div></div></div>
 <div><div data-editor-id="outcomePlate"><div data-editor-id="marketCardOutcomeName"><span>3.5</span></div><div><span>1.55</span></div></div></div></div></div>
</div></div></body></html>`;
  const dom = betbyRecipe(recording({ baseUrl: "https://betportal.com/fr/sports", domains: ["betportal.com"], providerHint: "betby", pages: [{ step: "home", url: "https://betportal.com/fr/sports", html: "", text: "" }] }))!.dom!;
  it("la recette lit « plus de 2.5 » / « moins de 3.5 », pas « 2.5 » quatre fois", () => {
    const rows = readMarketsFromHtml(html, dom).rows.map((r) => `${r.marketSite}|${r.selectionSite}|${r.oddsRaw}`);
    expect(rows).toEqual(["Total|plus de 2.5|1.85", "Total|moins de 2.5|1.85", "Total|plus de 3.5|2.35", "Total|moins de 3.5|1.55"]);
  });
  it("la référence (cotes visibles, sans recette) lit la même chose", () => {
    const ref = pageOddsFromHtml(html).map((o) => `${o.market}|${o.selection}|${o.line}|${o.odds}`);
    expect(ref).toEqual(["Total|plus de 2.5|2.5|1.85", "Total|moins de 2.5|2.5|1.85", "Total|plus de 3.5|3.5|2.35", "Total|moins de 3.5|3.5|1.55"]);
  });
});

describe("formes JSON étendues", () => {
  const body = {
    tournaments: { t1: { name: "Serie A", slug: "serie-a" } },
    categories: { c1: { name: "Italie", slug: "italy" } },
    events: {
      "2721146852048252971": { desc: { scheduled: 1792957500, type: "match", sport: "1", slug: "udinese-calcio-ac-milan", category: "c1", tournament: "t1", competitors: [{ name: "Udinese Calcio" }, { name: "Milan AC" }] } },
      "2721054223063199999": { desc: { scheduled: 1792957500, type: "match", sport: "5", slug: "a-b", category: "c1", tournament: "t1", competitors: [{ name: "A" }, { name: "B" }] } },
      "2721054223063199998": { desc: { scheduled: 1792957500, type: "outright", sport: "1", slug: "vainqueur", category: "c1", tournament: "t1", competitors: [] } },
    },
  };
  const shape = { id: "events{}.$key", home: "events{}.desc.competitors[0].name", away: "events{}.desc.competitors[1].name", startsAt: "events{}.desc.scheduled", league: "tournaments[@events{}.desc.tournament].name", categorySlug: "categories[@events{}.desc.category].slug", sport: "events{}.desc.sport", type: "events{}.desc.type" };
  it("clé d'objet, rang fixe, jointure par identifiant", () => {
    expect(parsePath("events{}.$key").map((s) => s.key)).toEqual(["events", null, "$key"]);
    const rows = extractRows(body, shape, ["id", "home", "away", "startsAt"]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: "2721146852048252971", home: "Udinese Calcio", away: "Milan AC", startsAt: 1792957500, league: "Serie A", categorySlug: "italy", sport: "1", type: "match" });
    expect(rows[2]).toMatchObject({ id: "2721054223063199998", home: undefined, away: undefined });
  });
  it("filtre : football et matchs seulement (texte comparé)", () => {
    const rows = keepRows(extractRows(body, shape, ["id", "home", "away", "startsAt"]), { sport: "1", type: "match" });
    expect(rows.map((r) => r.id)).toEqual(["2721146852048252971"]);
    expect(keepRows(rows, null)).toBe(rows);
  });
  it("manifeste : versions dans l'ordre, sans doublon", () => {
    expect(manifestVersions({ top_events_versions: [10, 11], rest_events_versions: [11, 12] }, ["top_events_versions[]", "rest_events_versions[]"])).toEqual(["10", "11", "12"]);
    expect(manifestVersions({ nothing: 1 }, ["top_events_versions[]"])).toEqual([]);
  });
});

describe("cotes en millièmes", () => {
  it("entier = millièmes (API), nombre à virgule = déjà décimal (page du même site)", () => {
    expect(toDecimalOdds("1600", "milli")).toBe(1.6);
    expect(toDecimalOdds(2250, "milli")).toBe(2.25);
    expect(toDecimalOdds("1.60", "milli")).toBe(1.6);
    expect(toDecimalOdds("2,25", "milli")).toBe(2.25);
    expect(toDecimalOdds(1.6, "milli")).toBe(1.6);
    expect(toDecimalOdds("2", "milli")).toBeNull();
    expect(toDecimalOdds("-", "milli")).toBeNull();
  });
});

describe("fiches fournisseur", () => {
  const altenarPages = [{ step: "home" as const, url: "https://sportaza-5178.com/fr/sports?page=overview", html: "", text: "" }];
  it("Altenar : adresses du programme et des fiches sur l'origine RÉELLE (après redirection), onglet « Par Heure »", () => {
    const r = altenarRecipe(recording({ pages: altenarPages, pageOdds: [{ eventLabel: "x", market: "1x2", selection: "X", line: null, odds: 3 }, { eventLabel: "x", market: "Total", selection: "Plus de 2.5", line: 2.5, odds: 1.9 }] }))!;
    expect(r.level).toBe("dom");
    expect(r.dom!.listUrls).toEqual(["https://sportaza-5178.com/fr/sports?page=coupon&sportId=66&couponType=1", "https://sportaza-5178.com/fr/sports?page=coupon&sportId=66&couponType=2"]);
    expect(r.dom!.eventUrlTemplate).toBe("https://sportaza-5178.com/fr/sports?page=event&eventId={eventId}&sportId=66");
    expect(r.dom!.dayToday!.candidates[0]).toEqual({ text: "Par Heure" });
    expect(r.mapping.marketMap).toMatchObject({ "1x2": "resultat", Total: "buts" });
    expect("Corners" in r.mapping.marketMap).toBe(false);
  });
  it("Altenar : la liste « Par Heure » enregistrée (identifiants React, sans lien) donne les matchs et leurs fiches", () => {
    const list = `<html><body><stb-altenar-widget-sportsbook><div data-lap-shadow="1"><div class="EventsListContainer-sc-1">
<div class="EventBoxRoot-sc-8477650d-0" data-lap-event-id="18080871"><div class="EventBoxWrapper-sc-1"><div class="TimeWrapper-sc-1"><div class="StartTime-sc-1">25/10 • 21:00</div></div><div class="CategoryChampionship-sc-6">Serie A • Italie</div>
<div class="CompetitorsWrapper-sc-8"><div class="CompetitorContainer-sc-6"><div class="CompetitorName-sc-7">Udinese</div></div><div class="CompetitorContainer-sc-6"><div class="CompetitorName-sc-7">AC Milan</div></div></div>
<div class="MarketBoxWrapper-sc-15"><button class="OddBoxButton-sc-2"><span class="OddLabel-sc-1">Udinese</span><div class="OddValue-sc-4">2.90</div></button></div></div></div>
</div></div></stb-altenar-widget-sportsbook></body></html>`;
    const r = altenarRecipe(recording({ pages: altenarPages }))!;
    const got = readEventsFromHtml(list, r.dom!, { pageUrl: "https://sportaza-5178.com/fr/sports?page=coupon&sportId=66&couponType=1", timezone: "Europe/Paris", now: new Date("2026-10-25T09:00:00Z") });
    expect(got.events).toHaveLength(1);
    expect(got.events[0]).toMatchObject({ siteEventId: "18080871", homeTeam: "Udinese", awayTeam: "AC Milan", league: "Serie A • Italie", url: "https://sportaza-5178.com/fr/sports?page=event&eventId=18080871&sportId=66" });
    expect(got.events[0]!.startsAt.toISOString()).toBe("2026-10-25T20:00:00.000Z"); // 21:00 à Paris, heure d’hiver depuis le matin
  });
  it("Betby : flux par manifeste reconnu à sa réponse (origine réelle, jamais devinée), fiches avec pays et tournoi", () => {
    const rec = recording({
      baseUrl: "https://betportal.com/fr/sports",
      domains: ["betportal.com", "api-h-c7818b61-608.sptpub.com"],
      providerHint: "betby",
      pages: [{ step: "home", url: "https://betportal.com/fr/sports", html: "", text: "" }],
      responses: [
        { url: "https://api-h-c7818b61-608.sptpub.com/api/v4/prematch/brand/2632876342999396354/fr/0", method: "GET", status: 200, contentType: "application/json", kind: "json", body: '{"top_events_versions":[1],"rest_events_versions":[2]}', at: "2026-10-25T09:00:01.000Z" },
      ],
    });
    expect(betbyFeedOf(rec)).toEqual({ apiOrigin: "https://api-h-c7818b61-608.sptpub.com", brand: "2632876342999396354", lang: "fr" });
    const r = betbyRecipe(rec)!;
    expect(r.level).toBe("dom");
    const ep = r.api!.endpoints[0]!;
    expect(ep.urlTemplate).toBe("https://api-h-c7818b61-608.sptpub.com/api/v4/prematch/brand/2632876342999396354/fr/{version}");
    expect(ep.pagination!.manifest!.urlTemplate).toBe("https://api-h-c7818b61-608.sptpub.com/api/v4/prematch/brand/2632876342999396354/fr/0");
    expect(ep.filter).toEqual({ sport: "1", type: "match" });
    expect(r.api!.eventUrlTemplate).toBe("https://betportal.com/fr/sports/football/{categorySlug}/{tournamentSlug}/{slug}-{eventId}");
    expect(r.dom!.listUrls).toEqual(["https://betportal.com/fr/sports/football-1"]);
    // Sans réponse du manifeste dans l'enregistrement : pas de flux, la page seule.
    const noFeed = betbyRecipe(recording({ ...rec, responses: [] }))!;
    expect(noFeed.api).toBeNull();
    expect(betbyFeedOf(recording({ ...rec, responses: [{ ...rec.responses[0]!, body: "<html>" , kind: "html" }] }))).toBeNull();
  });
  it("Betby : la carte réelle d'un match (sans repère sur les noms) se lit par sa structure", () => {
    const card = `<html><body><div id="betby"><div data-lap-shadow="1"><div data-editor-id="eventList">
<a data-editor-id="eventCardContent" class="sc-1lcyybx-0" href="/fr/sports/football/spain/laliga/fc-barcelona-real-madrid-2721054223063191561"><div class="sc-1lcyybx-1"><div class="sc-1lcyybx-2"><div class="sc-1lcyybx-3"><div data-editor-id="eventCardStatusLabel">Aujourd’hui, 21:00</div></div><div data-editor-id="eventCardCategory"><span>Espagne</span><span>La Liga</span></div></div></div>
<div class="sc-ujf0l1-0"><div class="sc-ujf0l1-1"><div class="sc-ujf0l1-2"><div class="jss60"><div class="sc-tu0l0b-0"></div><div class="jss61">FC Barcelone</div></div><div class="jss63"></div></div><div class="sc-ujf0l1-2"><div class="jss60"><div class="sc-tu0l0b-0"></div><div class="jss61">Real Madrid</div></div><div class="jss63"></div></div></div><div data-editor-id="eventPlateScore"></div></div></a>
</div></div></div></body></html>`;
    const r = betbyRecipe(recording({ baseUrl: "https://betportal.com/fr/sports", domains: ["betportal.com"], providerHint: "betby", pages: [{ step: "home", url: "https://betportal.com/fr/sports", html: "", text: "" }] }))!;
    const got = readEventsFromHtml(card, r.dom!, { pageUrl: "https://betportal.com/fr/sports/football-1", timezone: "Europe/Paris", now: new Date("2026-10-25T09:00:00Z") });
    expect(got.events).toHaveLength(1);
    expect(got.events[0]).toMatchObject({ siteEventId: "2721054223063191561", homeTeam: "FC Barcelone", awayTeam: "Real Madrid", url: "https://betportal.com/fr/sports/football/spain/laliga/fc-barcelona-real-madrid-2721054223063191561" });
    expect(got.events[0]!.startsAt.toISOString()).toBe("2026-10-25T20:00:00.000Z"); // 21:00 à Paris, heure d’hiver depuis le matin
  });
  it("API « matches » (Celsius) : reconnue à une réponse JSON de matchs, cotes en millièmes, fiches « -m-<id> »", () => {
    const rec = recording({
      baseUrl: "https://celsius.games/fr",
      domains: ["celsius.games", "celsiuscasino.com", "sports.celsiuscasino.com"],
      providerHint: "inconnu",
      pages: [
        { step: "home", url: "https://celsiuscasino.com/fr", html: "", text: "" },
        { step: "list-today", url: "https://celsiuscasino.com/fr/sports/soccer", html: "", text: "" },
      ],
      responses: [{ url: "https://sports.celsiuscasino.com/api/v2/matches?bettable=true&sport_key=soccer&limit=500", method: "GET", status: 200, contentType: "application/json", kind: "json", body: '{"data":[{"id":1,"start_time":"2026-10-25T13:00:00Z","competitors":{"home":{"name":"A"},"away":{"name":"B"}}}]}', at: "2026-10-25T09:00:01.000Z" }],
    });
    expect(matchesApiOf(rec)).toEqual({ origin: "https://sports.celsiuscasino.com", sportKey: "soccer" });
    const r = matchesApiRecipe(rec)!;
    expect(r.level).toBe("api");
    expect(r.mapping.oddsFormat).toBe("milli");
    expect(r.api!.endpoints.map((e) => e.urlTemplate)).toEqual(["https://sports.celsiuscasino.com/api/v2/matches", "https://sports.celsiuscasino.com/api/v2/matches/{eventId}/markets"]);
    expect(r.api!.eventUrlTemplate).toBe("https://sports.celsiuscasino.com/fr/soccer/{slug}-m-{eventId}");
    expect(matchesApiOf(recording({ responses: [{ ...rec.responses[0]!, body: '{"data":[]}' }] }))).toBeNull();
  });
  it("choix : le moteur reconnu d'abord, l'API « matches » si elle est là, rien pour un site inconnu sans API", () => {
    expect(builtinRecipes(recording({ pages: altenarPages })).map((b) => b.name)).toEqual(["altenar"]);
    expect(builtinRecipes(recording({ providerHint: "inconnu", pages: altenarPages }))).toEqual([]);
    const both = recording({
      baseUrl: "https://celsius.games/fr",
      domains: ["celsius.games", "sports.celsiuscasino.com"],
      providerHint: "betby",
      pages: [{ step: "home", url: "https://celsiuscasino.com/fr", html: "", text: "" }],
      responses: [{ url: "https://sports.celsiuscasino.com/api/v2/matches?sport_key=soccer", method: "GET", status: 200, contentType: "application/json", kind: "json", body: '{"data":[{"start_time":"x","competitors":{}}]}', at: "2026-10-25T09:00:01.000Z" }],
    });
    expect(builtinRecipes(both).map((b) => b.name)).toEqual(["betby", "matches-api"]);
  });
  it("une fiche dont une adresse sort des domaines de l'enregistrement est écartée", () => {
    const r = altenarRecipe(recording({ pages: altenarPages }))!;
    expect(recipeAddressesAllowed(r, recording({ pages: altenarPages }))).toBe(true);
    expect(recipeAddressesAllowed(r, recording({ pages: altenarPages, domains: ["autre-site.com"], baseUrl: "https://autre-site.com/fr" }))).toBe(false);
    expect(builtinRecipes(recording({ pages: altenarPages, domains: ["autre-site.com"], baseUrl: "https://autre-site.com/fr" }))).toEqual([]);
  });
  it("noms de marchés : seulement ceux vus dans l'enregistrement, plus les synonymes du code pour les cotes relevées", () => {
    const rec = recording({ pages: [{ step: "event", url: "https://sportaza-5178.com/fr/sports?page=event&eventId=1&sportId=66", html: "<div>1x2</div><div>Total corners</div>", text: "1x2 Total corners" }], pageOdds: [{ eventLabel: "x", market: "Nombre de buts", selection: "Plus de 2.5", line: 2.5, odds: 1.9 }] });
    const map = marketMapFor("altenar", rec);
    expect(map).toMatchObject({ "1x2": "resultat", "Total corners": "corners" });
    expect("Handicap" in map).toBe(false);
    expect("Nombre de buts" in map).toBe(true);
  });
});
