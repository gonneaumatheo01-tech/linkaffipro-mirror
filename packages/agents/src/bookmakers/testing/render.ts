/**
 * Phase 35 (chantier B) — rendu des trois sites locaux INVENTÉS (fichiers de `fixtures/bookmakers/<site>/`) :
 * - Celsius : pages coquilles + API JSON interne (jeton « Bearer » demandé à `/api/v2/auth/token`), noms anglais,
 *   cotes décimales « 1.85 » ;
 * - Sportaza : pages rendues par le serveur, noms français, cotes « 1,85 » ;
 * - Bet Portal : WebSocket simulé (`ws-messages.jsonl`), abréviations anglaises, cotes fractionnaires « 5/4 ».
 * Variantes (sous-dossiers) : `changed`, `captcha`, `geo`, `expired`, `odds-moved`, `market-missing`.
 * Jamais importé en production.
 */
import {
  CELSIUS_TEST_ACCOUNT,
  FIXTURE_MATCHES,
  FIXTURE_TODAY,
  FIXTURE_TOMORROW,
  parisHHMM,
  siteEventId,
  worldOdds,
  type FixtureMatch,
  type FixtureSiteKey,
  type WorldMarket,
  type WorldMarketOdds,
} from "./world";

export type FixtureFiles = Record<string, string>;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fr = (n: number) => n.toFixed(2).replace(".", ",");
const day = (m: FixtureMatch) => m.day;
const leaguesOf = (ms: readonly FixtureMatch[]) => [...new Set(ms.map((m) => m.league))];

/** Bannière de cookies commune (un clic la ferme et pose `consent=1`). */
function cookieBanner(label: string, cls: string): string {
  return `<div id="cookie-banner" class="${cls}">Ce site utilise des cookies. <button id="cookie-ok" type="button">${label}</button></div>`;
}
const COOKIE_JS = `(function(){var b=document.getElementById('cookie-banner');if(!b)return;if(document.cookie.indexOf('consent=1')>=0){b.remove();return;}var o=document.getElementById('cookie-ok');if(o)o.addEventListener('click',function(){document.cookie='consent=1; path=/';b.remove();});})();`;

function page(title: string, head: string, body: string, scripts: string[] = []): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>${head}
<style>body{font-family:sans-serif;margin:0;padding:12px}a{color:#036}[hidden]{display:none!important}section,article{margin:8px 0}</style></head>
<body>
${body}
${scripts.map((s) => `<script>${s}</script>`).join("\n")}
<script>${COOKIE_JS}</script>
</body></html>
`;
}

// ---------------------------------------------------------------------------------------------------------------
// Pages d'obstacle communes
// ---------------------------------------------------------------------------------------------------------------

function captchaPage(site: string): string {
  return page(
    `${site} — vérification`,
    "",
    `<h1>Vérification de sécurité</h1><p>Vérifiez que vous êtes humain pour continuer.</p><div class="g-recaptcha" data-sitekey="test-sitekey"></div>`,
  );
}
function geoPage(site: string): string {
  return page(
    `${site} — indisponible`,
    "",
    `<h1>Accès restreint</h1><p>Ce site n'est pas disponible dans votre pays.</p>`,
  );
}
function loginPage(site: string, action: string, lang: "fr" | "en"): string {
  const t =
    lang === "fr"
      ? {
          h: "Votre session a expiré",
          p: "Connectez-vous pour continuer.",
          l: "Email",
          pw: "Mot de passe",
          b: "Se connecter",
        }
      : {
          h: "Your session has expired",
          p: "Please log in to continue.",
          l: "Email",
          pw: "Password",
          b: "Log in",
        };
  return page(
    `${site} — ${t.b}`,
    "",
    `<h1>${t.h}</h1><p>${t.p}</p><form method="post" action="${action}" class="login"><label>${t.l} <input type="email" name="email" autocomplete="username"></label><label>${t.pw} <input type="password" name="password" autocomplete="current-password"></label><button type="submit" id="login-submit">${t.b}</button></form>`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Celsius : API JSON interne
// ---------------------------------------------------------------------------------------------------------------

const CELSIUS_NAMES: Record<WorldMarket, string> = {
  result: "Match Result",
  goals: "Total Goals",
  corners: "Corners O/U",
  shots: "Shots on Target",
  cards: "Cards O/U",
  double: "Double Chance",
};
const CELSIUS_GROUP: Record<WorldMarket, string> = {
  result: "main",
  goals: "goals",
  corners: "corners",
  shots: "specials",
  cards: "specials",
  double: "main",
};

function celsiusSelLabel(m: FixtureMatch, key: string): string {
  return key === "home"
    ? m.home
    : key === "away"
      ? m.away
      : key === "draw"
        ? "Draw"
        : key === "over"
          ? "Over"
          : key === "under"
            ? "Under"
            : key;
}

function celsiusMarketsJson(m: FixtureMatch, mk: WorldMarketOdds[], changed: boolean): unknown {
  const id = siteEventId("celsius", m);
  if (changed)
    return {
      ev: {
        eventId: id,
        homeTeam: { name: m.home },
        awayTeam: { name: m.away },
        startTime: m.kickoff,
        competition: { title: m.league },
      },
      groups: mk.map((x) => ({
        title: CELSIUS_NAMES[x.market],
        tab: CELSIUS_GROUP[x.market],
        handicap: x.line,
        choices: x.selections.map((s) => ({ name: celsiusSelLabel(m, s.key), decimal: s.decimal })),
      })),
    };
  return {
    event: { id, home: m.home, away: m.away, kickoff: m.kickoff, league: m.league },
    markets: mk.map((x, i) => ({
      id: `${id}-${i + 1}`,
      name: CELSIUS_NAMES[x.market],
      group: CELSIUS_GROUP[x.market],
      line: x.line,
      outcomes: x.selections.map((s, j) => ({
        id: `${id}-${i + 1}-${j + 1}`,
        label: celsiusSelLabel(m, s.key),
        price: s.decimal,
      })),
    })),
  };
}

/** Base de données des matchs de Celsius (le serveur filtre par date et pagine par 5). */
function celsiusEventsJson(changed: boolean): unknown {
  if (changed)
    return {
      result: {
        items: FIXTURE_MATCHES.map((m) => ({
          eventId: siteEventId("celsius", m),
          competition: { title: m.league },
          homeTeam: { name: m.home },
          awayTeam: { name: m.away },
          startTime: m.kickoff,
          marketsTotal: 40 + m.index,
        })),
      },
    };
  return {
    data: {
      events: FIXTURE_MATCHES.map((m) => ({
        id: siteEventId("celsius", m),
        sport: "football",
        league: { id: `lg-${leaguesOf(FIXTURE_MATCHES).indexOf(m.league) + 1}`, name: m.league },
        participants: { home: m.home, away: m.away },
        kickoff: m.kickoff,
        marketCount: 40 + m.index,
      })),
    },
  };
}

const CELSIUS_HEAD = `<script src="https://sb2frontend-altenar2.biahosted.com/altenarWSDK.js" async></script>`;
const CELSIUS_TOP = `<header class="cs-top"><a href="/" class="cs-logo">Celsius</a> <span id="cs-balance"></span> <a href="/cashier/deposit" class="cs-deposit">Dépôt</a></header>
${cookieBanner("Tout accepter", "cs-cookies")}`;
// Jeton puis solde (affiché : à masquer), puis `__ready(jeton)` de la page.
const CELSIUS_BOOT = `(async function(){try{var r=await fetch('/api/v2/auth/token',{headers:{accept:'application/json'}});if(r.status===401){document.body.setAttribute('data-expired','1');return;}var t=(await r.json()).token;try{localStorage.setItem('token',t);}catch(e){}var b=await (await fetch('/api/v2/account/balance',{headers:{authorization:'Bearer '+t,accept:'application/json'}})).json();document.getElementById('cs-balance').textContent='Solde : '+b.balance.toFixed(2).replace('.',',')+' € · Compte '+b.accountNumber;if(window.__ready)await window.__ready(t);}catch(e){document.body.setAttribute('data-error',String(e));}})();`;

function celsiusFiles(variant: "base" | "changed"): FixtureFiles {
  const changed = variant === "changed";
  const c = changed
    ? {
        league: "ev-comp",
        leagueName: "ev-comp__label",
        row: "ev-line",
        home: "ev-line__p1",
        away: "ev-line__p2",
        time: "ev-line__start",
        title: "ev-head__name",
        tabs: "ev-nav",
        market: "ev-group",
        mname: "ev-group__label",
        sel: "ev-choice",
        sname: "ev-choice__name",
        price: "ev-choice__value",
      }
    : {
        league: "cs-league",
        leagueName: "cs-league-name",
        row: "cs-event",
        home: "cs-home",
        away: "cs-away",
        time: "cs-time",
        title: "cs-title",
        tabs: "cs-tabs",
        market: "cs-market",
        mname: "cs-market-name",
        sel: "cs-sel",
        sname: "cs-sel-name",
        price: "cs-price",
      };
  const listShape = changed
    ? `var j=await r.json();var items=j.result.items.map(function(e){return {id:e.eventId,league:e.competition.title,home:e.homeTeam.name,away:e.awayTeam.name,kickoff:e.startTime,n:e.marketsTotal};});all=all.concat(items);if(!j.paging||!j.paging.next)break;`
    : `var j=await r.json();var items=j.data.events.map(function(e){return {id:e.id,league:e.league.name,home:e.participants.home,away:e.participants.away,kickoff:e.kickoff,n:e.marketCount};});all=all.concat(items);if(!j.meta.hasMore)break;`;
  const renderRows = `function hhmm(iso){var d=new Date(Date.parse(iso)+3600000);return String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
function renderList(all){var by={};all.forEach(function(e){(by[e.league]=by[e.league]||[]).push(e);});var h='';Object.keys(by).forEach(function(l){h+='<section class="${c.league}"><h2 class="${c.leagueName}">'+esc(l)+'</h2>';by[l].forEach(function(e){h+='<a class="${c.row}" href="/sports/football/event/'+e.id+'"><span class="${c.home}">'+esc(e.home)+'</span> - <span class="${c.away}">'+esc(e.away)+'</span> <time class="${c.time}" datetime="'+e.kickoff+'">'+hhmm(e.kickoff)+'</time> <span class="cs-more">+'+e.n+'</span></a>';});h+='</section>';});document.getElementById('events').innerHTML=h||'<p>Aucun match.</p>';}`;
  const football = page(
    "Celsius — Football",
    CELSIUS_HEAD,
    `${CELSIUS_TOP}
<nav class="cs-days"><a class="cs-day" href="/sports/football?date=${FIXTURE_TODAY}">Aujourd'hui</a> <a class="cs-day" href="/sports/football?date=${FIXTURE_TOMORROW}">Demain</a></nav>
<form action="/sports/search" method="get" class="cs-search"><input type="search" name="q" placeholder="Rechercher une équipe"></form>
<h1>Football</h1>
<div id="events">Chargement…</div>`,
    [
      `${renderRows}
window.__ready=async function(t){var date=new URLSearchParams(location.search).get('date')||'${FIXTURE_TODAY}';var page=1,all=[];for(;;){var r=await fetch('/api/v2/events?sport=football&date='+date+'&page='+page,{headers:{authorization:'Bearer '+t,accept:'application/json'}});${listShape}page++;if(page>20)break;}renderList(all);};`,
      CELSIUS_BOOT,
    ],
  );
  const marketsShape = changed
    ? `var ev={home:j.ev.homeTeam.name,away:j.ev.awayTeam.name,league:j.ev.competition.title,kickoff:j.ev.startTime};var mk=j.groups.map(function(g){return {name:g.title,group:g.tab,line:g.handicap,sel:g.choices.map(function(o){return {label:o.name,price:o.decimal};})};});`
    : `var ev=j.event;var mk=j.markets.map(function(m){return {name:m.name,group:m.group,line:m.line,sel:m.outcomes.map(function(o){return {label:o.label,price:o.price};})};});`;
  const event = page(
    "Celsius — Match",
    CELSIUS_HEAD,
    `${CELSIUS_TOP}
<div id="event">Chargement…</div>`,
    [
      `${renderRows}
window.__ready=async function(t){var id=location.pathname.split('/').pop();var r=await fetch('/api/v2/event/'+id+'/markets',{headers:{authorization:'Bearer '+t,accept:'application/json'}});var j=await r.json();${marketsShape}
var h='<h1 class="${c.title}">'+esc(ev.home)+' - '+esc(ev.away)+'</h1><p class="cs-meta">'+esc(ev.league)+' · '+hhmm(ev.kickoff)+'</p>';
h+='<div class="${c.tabs}" role="tablist"><button type="button" role="tab" data-g="main" aria-selected="true">Principal</button><button type="button" role="tab" data-g="goals">Buts</button><button type="button" role="tab" data-g="corners">Corners</button><button type="button" role="tab" data-g="specials">Spéciaux</button></div><div id="markets">';
mk.forEach(function(m){h+='<section class="${c.market}" data-g="'+m.group+'"'+(m.group==='main'?'':' hidden')+'><h3 class="${c.mname}">'+esc(m.name)+'</h3>';m.sel.forEach(function(s){var lab=s.label+(m.line!=null?' '+m.line.toFixed(1):'');h+='<div class="${c.sel}"><span class="${c.sname}">'+esc(lab)+'</span> <button type="button" class="${c.price}">'+s.price.toFixed(2)+'</button></div>';});h+='</section>';});
h+='</div>';document.getElementById('event').innerHTML=h;
document.querySelectorAll('[role=tab]').forEach(function(b){b.addEventListener('click',function(){var g=b.getAttribute('data-g');document.querySelectorAll('[role=tab]').forEach(function(x){x.setAttribute('aria-selected',x===b?'true':'false');});document.querySelectorAll('section[data-g]').forEach(function(s){if(s.getAttribute('data-g')===g)s.removeAttribute('hidden');else s.setAttribute('hidden','');});});});
document.querySelectorAll('.${c.price}').forEach(function(b){b.addEventListener('click',function(){window.betClicked=true;});});};
window.betClicked=false;`,
      CELSIUS_BOOT,
    ],
  );
  const search = page(
    "Celsius — Recherche",
    CELSIUS_HEAD,
    `${CELSIUS_TOP}
<form action="/sports/search" method="get" class="cs-search"><input type="search" name="q" placeholder="Rechercher une équipe"></form>
<h1>Recherche</h1><div id="events">Chargement…</div>`,
    [
      `${renderRows}
window.__ready=async function(t){var q=new URLSearchParams(location.search).get('q')||'';var r=await fetch('/api/v2/search?q='+encodeURIComponent(q),{headers:{authorization:'Bearer '+t,accept:'application/json'}});var j=await r.json();renderList(j.results);};`,
      CELSIUS_BOOT,
    ],
  );
  const files: FixtureFiles = {
    "football.html": football,
    "event.html": event,
    "search.html": search,
    "events.json": JSON.stringify(celsiusEventsJson(changed), null, 2),
  };
  for (const m of FIXTURE_MATCHES)
    files[`event-${siteEventId("celsius", m)}.json`] = JSON.stringify(
      celsiusMarketsJson(m, worldOdds("celsius", m), changed),
      null,
      2,
    );
  if (!changed) {
    files["home.html"] = page(
      "Celsius — Paris sportifs (site de test)",
      CELSIUS_HEAD,
      `${CELSIUS_TOP}
<nav class="cs-sports"><a href="/sports/football">Football</a> <a href="/sports/tennis">Tennis</a> <a href="/sports/basketball">Basket</a></nav>
<main><h1>Paris sportifs</h1><p>Site de test inventé (aucun vrai bookmaker).</p></main>`,
      [CELSIUS_BOOT],
    );
    files["login.html"] = loginPage("Celsius", "/login", "fr");
    files["account.json"] = JSON.stringify(
      { ...CELSIUS_TEST_ACCOUNT, currency: "EUR", bonusBalance: 10 },
      null,
      2,
    );
  }
  return files;
}

// ---------------------------------------------------------------------------------------------------------------
// Sportaza : pages rendues par le serveur
// ---------------------------------------------------------------------------------------------------------------

const SPORTAZA_NAMES: Record<WorldMarket, string> = {
  result: "Résultat du match",
  goals: "Plus/Moins de buts",
  corners: "Corners - total",
  cards: "Cartons - total",
  shots: "Tirs cadrés - total",
  double: "Double chance",
};
const SPORTAZA_TAB: Record<WorldMarket, string> = {
  result: "principaux",
  goals: "buts",
  corners: "corners",
  cards: "cartons",
  shots: "cartons",
  double: "principaux",
};

function sportazaSel(m: FixtureMatch, key: string, line: number | null): string {
  if (key === "home") return m.home;
  if (key === "away") return m.away;
  if (key === "draw") return "Match nul";
  const l = line != null ? fr(line).replace(/0$/, "") : "";
  return key === "over" ? `Plus de ${l}` : key === "under" ? `Moins de ${l}` : key;
}

const SPORTAZA_HEAD = `<script src="https://ui.invisiblesport.com/bt-renderer.min.js" async></script>`;
const SPORTAZA_TOP = `<header class="sz-header"><a href="/fr/sports" class="sz-logo">Sportaza</a> <a href="/fr/cashier" class="sz-cashier">Caisse</a></header>
${cookieBanner("J'accepte", "sz-cookies")}`;

function sportazaFiles(
  variant: "base" | "changed" | "odds-moved" | "market-missing",
): FixtureFiles {
  const changed = variant === "changed";
  const c = changed
    ? {
        comp: "event-group",
        compTitle: "event-group__heading",
        row: "event-card",
        link: "event-card__teams",
        home: "participant--1",
        away: "participant--2",
        time: "event-card__kickoff",
        title: "match-header__teams",
        tab: "market-nav__item",
        market: "market-block",
        mname: "market-block__title",
        out: "market-block__choice",
        olabel: "market-block__choice-name",
        oval: "market-block__choice-coef",
      }
    : {
        comp: "sz-competition",
        compTitle: "sz-competition__title",
        row: "sz-match",
        link: "sz-match__link",
        home: "sz-team--home",
        away: "sz-team--away",
        time: "sz-match__time",
        title: "sz-event-title",
        tab: "sz-tab",
        market: "sz-market",
        mname: "sz-market__name",
        out: "sz-outcome",
        olabel: "sz-outcome__label",
        oval: "sz-outcome__odd",
      };
  const files: FixtureFiles = {};
  const dayLinks = (d: string) =>
    `<div class="sz-dayswitch"><a href="/fr/sports/football?jour=${FIXTURE_TODAY}" class="sz-day${d === FIXTURE_TODAY ? " sz-day--on" : ""}">Aujourd'hui</a> <a href="/fr/sports/football?jour=${FIXTURE_TOMORROW}" class="sz-day${d === FIXTURE_TOMORROW ? " sz-day--on" : ""}">Demain</a></div>
<form action="/fr/sports/recherche" method="get" class="sz-search"><input type="text" name="q" placeholder="Rechercher un match"></form>`;
  const rowsHtml = (ms: readonly FixtureMatch[]) =>
    leaguesOf(ms)
      .map((l) => {
        const rows = ms
          .filter((m) => m.league === l)
          .map((m) => {
            const id = siteEventId("sportaza", m);
            const res = worldOdds("sportaza", m).find((x) => x.market === "result")!;
            return `<article class="${c.row}" data-match="${id}"><a class="${c.link}" href="/fr/sports/match/${id}"><span class="sz-team ${c.home}">${esc(m.home)}</span> <span class="sz-team ${c.away}">${esc(m.away)}</span></a> <span class="${c.time}" data-start="${m.kickoff}">${parisHHMM(m.kickoff)}</span> <div class="sz-quick">${res.selections.map((s) => `<button type="button" class="sz-odd">${fr(s.decimal)}</button>`).join("")}</div></article>`;
          })
          .join("\n");
        return `<div class="${c.comp}"><div class="${c.compTitle}">${esc(l)}</div>\n${rows}\n</div>`;
      })
      .join("\n");
  if (variant === "base" || changed) {
    for (const d of [FIXTURE_TODAY, FIXTURE_TOMORROW]) {
      const ms = FIXTURE_MATCHES.filter((m) => day(m) === d);
      files[`football-${d}.html`] = page(
        "Sportaza — Football",
        SPORTAZA_HEAD,
        `${SPORTAZA_TOP}\n<h1>Football</h1>\n${dayLinks(d)}\n${rowsHtml(ms)}`,
      );
    }
  }
  for (const m of FIXTURE_MATCHES) {
    if (variant === "odds-moved" && m.index !== 0) continue;
    const mk = worldOdds("sportaza", m, {
      moved: variant === "odds-moved",
      withoutCorners: variant === "market-missing",
    });
    const tabs = [...new Set(mk.map((x) => SPORTAZA_TAB[x.market]))];
    const tabLabel: Record<string, string> = {
      principaux: "Principaux",
      buts: "Buts",
      corners: "Corners",
      cartons: "Cartons",
    };
    const sections = mk
      .map((x) => {
        const tab = SPORTAZA_TAB[x.market];
        const outs = x.selections
          .map(
            (s) =>
              `<div class="${c.out}"><span class="${c.olabel}">${esc(sportazaSel(m, s.key, x.line))}</span> <span class="${c.oval}">${fr(s.decimal)}</span></div>`,
          )
          .join("");
        return `<section class="${c.market}" data-tab="${tab}"${tab === "principaux" ? "" : ' style="display:none"'}><h4 class="${c.mname}">${esc(SPORTAZA_NAMES[x.market])}</h4>${outs}</section>`;
      })
      .join("\n");
    files[`match-${siteEventId("sportaza", m)}.html`] = page(
      `${m.home} - ${m.away} | Sportaza`,
      SPORTAZA_HEAD,
      `${SPORTAZA_TOP}
<h1 class="${c.title}">${esc(m.home)} - ${esc(m.away)}</h1>
<div class="sz-event-info">${esc(m.league)} — ${m.day.slice(8, 10)}/${m.day.slice(5, 7)} ${parisHHMM(m.kickoff)}</div>
<ul class="sz-tabs">${tabs.map((t) => `<li><button type="button" class="${c.tab}" data-tab="${t}">${tabLabel[t]}</button></li>`).join("")}</ul>
${sections}`,
      [
        `document.querySelectorAll('.${c.tab}').forEach(function(b){b.addEventListener('click',function(){var t=b.getAttribute('data-tab');document.querySelectorAll('section[data-tab]').forEach(function(s){s.style.display=s.getAttribute('data-tab')===t?'':'none';});});});`,
      ],
    );
  }
  if (variant === "base") {
    files["home.html"] = page(
      "Sportaza — Paris sportifs (site de test)",
      SPORTAZA_HEAD,
      `${SPORTAZA_TOP}
<nav class="sz-sports"><a href="/fr/sports/football">Football</a> <a href="/fr/sports/tennis">Tennis</a> <a href="/fr/sports/hockey">Hockey</a></nav>
<main><h1>Paris sportifs</h1><p>Site de test inventé (aucun vrai bookmaker).</p></main>`,
    );
    files["login.html"] = loginPage("Sportaza", "/fr/login", "fr");
  }
  if (variant === "base" || changed)
    files["search-index.json"] = JSON.stringify(
      FIXTURE_MATCHES.map((m) => ({
        id: siteEventId("sportaza", m),
        league: m.league,
        home: m.home,
        away: m.away,
        kickoff: m.kickoff,
        url: `/fr/sports/match/${siteEventId("sportaza", m)}`,
      })),
      null,
      2,
    );
  return files;
}

// ---------------------------------------------------------------------------------------------------------------
// Bet Portal : WebSocket simulé
// ---------------------------------------------------------------------------------------------------------------

const BETPORTAL_NAMES: Record<WorldMarket, string> = {
  result: "1X2",
  goals: "O/U Goals",
  corners: "TOT Corners",
  cards: "Bookings",
  shots: "SOT",
  double: "DC",
};
const BETPORTAL_TAB: Record<WorldMarket, string> = {
  result: "main",
  double: "main",
  goals: "goals",
  corners: "crn",
  cards: "bkg",
  shots: "bkg",
};
const bpSel = (key: string) =>
  key === "home"
    ? "1"
    : key === "draw"
      ? "X"
      : key === "away"
        ? "2"
        : key === "over"
          ? "Over"
          : key === "under"
            ? "Under"
            : key;
const bpName = (x: WorldMarketOdds) => BETPORTAL_NAMES[x.market];

function betportalMessages(opts: {
  changed?: boolean;
  moved?: boolean;
  withoutCorners?: boolean;
}): string {
  const lines: string[] = [];
  for (const d of [FIXTURE_TODAY, FIXTURE_TOMORROW]) {
    const ms = FIXTURE_MATCHES.filter((m) => day(m) === d);
    if (opts.changed)
      lines.push(
        JSON.stringify({
          type: "feed.events",
          payload: {
            day: d,
            events: ms.map((m) => ({
              eventId: siteEventId("betportal", m),
              competitionName: m.league,
              participants: { first: m.home, second: m.away },
              startsAt: m.kickoff,
            })),
          },
        }),
      );
    else
      lines.push(
        JSON.stringify({
          t: "events",
          day: d,
          items: ms.map((m) => ({
            id: siteEventId("betportal", m),
            c: m.league,
            h: m.home,
            a: m.away,
            ko: m.kickoff,
            n: 30 + m.index,
          })),
        }),
      );
  }
  for (const m of FIXTURE_MATCHES) {
    const mk = worldOdds("betportal", m, {
      moved: opts.moved,
      withoutCorners: opts.withoutCorners,
    });
    const id = siteEventId("betportal", m);
    if (opts.changed)
      lines.push(
        JSON.stringify({
          type: "feed.markets",
          payload: {
            eventId: id,
            event: { first: m.home, second: m.away, startsAt: m.kickoff },
            markets: mk.map((x) => ({
              label: bpName(x),
              tab: BETPORTAL_TAB[x.market],
              line: x.line,
              outcomes: x.selections.map((s) => ({ label: bpSel(s.key), fractional: s.fraction })),
            })),
          },
        }),
      );
    else
      lines.push(
        JSON.stringify({
          t: "markets",
          eid: id,
          ev: { h: m.home, a: m.away, ko: m.kickoff, c: m.league },
          mk: mk.map((x) => ({
            n: bpName(x),
            k: BETPORTAL_TAB[x.market],
            ln: x.line,
            sel: x.selections.map((s) => ({ n: bpSel(s.key), p: s.fraction })),
          })),
        }),
      );
  }
  return lines.join("\n") + "\n";
}

const BETPORTAL_TOP = `<header class="bp-top"><a href="/" class="bp-brand">Bet Portal</a> <a href="/wallet" class="bp-wallet">Wallet</a></header>
${cookieBanner("Accept all", "bp-cookies")}`;

function betportalFiles(
  variant: "base" | "changed" | "odds-moved" | "market-missing",
): FixtureFiles {
  const changed = variant === "changed";
  const files: FixtureFiles = {
    "ws-messages.jsonl": betportalMessages({
      changed,
      moved: variant === "odds-moved",
      withoutCorners: variant === "market-missing",
    }),
  };
  if (variant === "odds-moved" || variant === "market-missing") return files;
  const c = changed
    ? {
        comp: "feed-comp",
        row: "feed-item",
        home: "feed-item__first",
        away: "feed-item__second",
        ko: "feed-item__time",
        title: "feed-title",
        tab: "feed-tab",
        mkt: "feed-market",
        mh: "feed-market__name",
        r: "feed-outcome",
        s: "feed-outcome__label",
        ln: "feed-outcome__line",
        p: "feed-outcome__price",
      }
    : {
        comp: "bp-comp",
        row: "bp-ev",
        home: "bp-h",
        away: "bp-a",
        ko: "bp-ko",
        title: "bp-title",
        tab: "bp-tab",
        mkt: "bp-mkt",
        mh: "bp-mkt-h",
        r: "bp-row",
        s: "bp-sel",
        ln: "bp-ln",
        p: "bp-pr",
      };
  const evShape = changed
    ? `var items=j.payload.events.map(function(e){return {id:e.eventId,c:e.competitionName,h:e.participants.first,a:e.participants.second,ko:e.startsAt};});`
    : `var items=j.items;`;
  const mkShape = changed
    ? `var ev={h:j.payload.event.first,a:j.payload.event.second};var mk=j.payload.markets.map(function(m){return {n:m.label,k:m.tab,ln:m.line,sel:m.outcomes.map(function(o){return {n:o.label,p:o.fractional};})};});`
    : `var ev=j.ev;var mk=j.mk;`;
  const isEvents = changed ? `j.type==='feed.events'` : `j.t==='events'`;
  const isMarkets = changed ? `j.type==='feed.markets'` : `j.t==='markets'`;
  const ws = `function sock(sub,onMsg){var s=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws/feed');s.onopen=function(){s.send(JSON.stringify(sub));};s.onmessage=function(e){onMsg(JSON.parse(e.data));};}
function hhmm(iso){var d=new Date(Date.parse(iso)+3600000);return String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}`;
  files["football.html"] = page(
    "Bet Portal — Football",
    "",
    `${BETPORTAL_TOP}
<nav class="bp-days"><a href="/football?day=${FIXTURE_TODAY}">Today</a> <a href="/football?day=${FIXTURE_TOMORROW}">Tomorrow</a></nav>
<form action="/search" method="get"><input type="search" name="q" placeholder="Search team"></form>
<h1>Football</h1><div id="list">Loading…</div>`,
    [
      `${ws}
var day=new URLSearchParams(location.search).get('day')||'${FIXTURE_TODAY}';
sock({op:'sub',topic:'events',day:day},function(j){if(j.t==='error'||j.type==='error'){document.getElementById('list').textContent='Session expired';return;}if(!(${isEvents}))return;${evShape}var by={};items.forEach(function(e){(by[e.c]=by[e.c]||[]).push(e);});var h='';Object.keys(by).forEach(function(c){h+='<h3 class="${c.comp}">'+esc(c)+'</h3><ul>';by[c].forEach(function(e){h+='<li class="${c.row}"><a href="/football/match/'+e.id+'"><b class="${c.home}">'+esc(e.h)+'</b> v <b class="${c.away}">'+esc(e.a)+'</b></a> <em class="${c.ko}" data-time="'+e.ko+'">'+hhmm(e.ko)+'</em></li>';});h+='</ul>';});document.getElementById('list').innerHTML=h;});`,
    ],
  );
  files["match.html"] = page(
    "Bet Portal — Match",
    "",
    `${BETPORTAL_TOP}
<div id="match">Loading…</div>`,
    [
      `${ws}
var id=location.pathname.split('/').pop();window.betClicked=false;
sock({op:'sub',topic:'markets',eventId:id},function(j){if(!(${isMarkets}))return;${mkShape}
var h='<h1 class="${c.title}">'+esc(ev.h)+' v '+esc(ev.a)+'</h1><div class="bp-tabs"><button type="button" class="${c.tab}" data-k="main">MAIN</button><button type="button" class="${c.tab}" data-k="goals">GOALS</button><button type="button" class="${c.tab}" data-k="crn">CRN</button><button type="button" class="${c.tab}" data-k="bkg">BKG</button></div>';
mk.forEach(function(m){h+='<div class="${c.mkt}" data-k="'+m.k+'"'+(m.k==='main'?'':' hidden')+'><div class="${c.mh}">'+esc(m.n)+'</div>';m.sel.forEach(function(s){h+='<div class="${c.r}"><span class="${c.s}">'+esc(s.n)+'</span>'+(m.ln!=null?' <i class="${c.ln}">'+m.ln.toFixed(1)+'</i>':'')+' <span class="${c.p}">'+esc(s.p)+'</span></div>';});h+='</div>';});
document.getElementById('match').innerHTML=h;
document.querySelectorAll('.${c.tab}').forEach(function(b){b.addEventListener('click',function(){var k=b.getAttribute('data-k');document.querySelectorAll('div[data-k]').forEach(function(d){if(d.getAttribute('data-k')===k)d.removeAttribute('hidden');else d.setAttribute('hidden','');});});});
document.querySelectorAll('.${c.p}').forEach(function(b){b.addEventListener('click',function(){window.betClicked=true;});});});`,
    ],
  );
  if (!changed) {
    files["home.html"] = page(
      "Bet Portal — Sports (test site)",
      "",
      `${BETPORTAL_TOP}
<nav class="bp-sports"><a href="/football">Football</a> <a href="/tennis">Tennis</a></nav>
<main><h1>Sports</h1><p>Invented test site (no real bookmaker).</p></main>`,
    );
    files["login.html"] = loginPage("Bet Portal", "/login", "en");
    files["search-index.json"] = JSON.stringify(
      FIXTURE_MATCHES.map((m) => ({
        id: siteEventId("betportal", m),
        league: m.league,
        home: m.home,
        away: m.away,
        kickoff: m.kickoff,
        url: `/football/match/${siteEventId("betportal", m)}`,
      })),
      null,
      2,
    );
  }
  return files;
}

/** Tous les fichiers d'un site, variantes comprises (chemins relatifs au dossier du site). */
export function renderSiteFixtures(site: FixtureSiteKey): FixtureFiles {
  const out: FixtureFiles = {};
  const add = (prefix: string, files: FixtureFiles) => {
    for (const [k, v] of Object.entries(files)) out[prefix ? `${prefix}/${k}` : k] = v;
  };
  const label = site === "celsius" ? "Celsius" : site === "sportaza" ? "Sportaza" : "Bet Portal";
  if (site === "celsius") {
    add("", celsiusFiles("base"));
    add("changed", celsiusFiles("changed"));
    const m0 = FIXTURE_MATCHES[0]!;
    add("odds-moved", {
      [`event-${siteEventId("celsius", m0)}.json`]: JSON.stringify(
        celsiusMarketsJson(m0, worldOdds("celsius", m0, { moved: true }), false),
        null,
        2,
      ),
    });
    const missing: FixtureFiles = {};
    for (const m of FIXTURE_MATCHES)
      missing[`event-${siteEventId("celsius", m)}.json`] = JSON.stringify(
        celsiusMarketsJson(m, worldOdds("celsius", m, { withoutCorners: true }), false),
        null,
        2,
      );
    add("market-missing", missing);
  } else if (site === "sportaza") {
    add("", sportazaFiles("base"));
    add("changed", sportazaFiles("changed"));
    add("odds-moved", sportazaFiles("odds-moved"));
    add("market-missing", sportazaFiles("market-missing"));
  } else {
    add("", betportalFiles("base"));
    add("changed", betportalFiles("changed"));
    add("odds-moved", betportalFiles("odds-moved"));
    add("market-missing", betportalFiles("market-missing"));
  }
  add("captcha", { "index.html": captchaPage(label) });
  add("geo", { "index.html": geoPage(label) });
  add("expired", {
    "index.html": loginPage(
      label,
      site === "sportaza" ? "/fr/login" : "/login",
      site === "betportal" ? "en" : "fr",
    ),
  });
  return out;
}
