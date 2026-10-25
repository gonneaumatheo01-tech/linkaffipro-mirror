/**
 * Phase 35 (chantier B) — recettes CORRECTES des trois sites locaux INVENTÉS (origines canoniques de `FIXTURE_ORIGINS`,
 * à rebaser sur le serveur local par `rebaseRecipe`). Elles servent de réponses « Opus » simulées et de recettes de
 * départ aux tests de lecture. `changed` : recette correcte de la variante « structure modifiée ».
 * Formes de réponse (`responseShape`, chemins complets depuis la racine, voir `read/json-shape.ts`) :
 * - matchs : `id`, `home`, `away`, `startsAt`, `league`, `marketsCount`, `hasMore` (facultatif) ;
 * - cotes : `eventId` / `home` / `away` (facultatifs), `market`, `selection`, `line`, `odds` (une ligne par issue).
 * Jamais importé en production.
 */
import type { RecipeData } from "../contract";
import { FIXTURE_ORIGINS, type FixtureSiteKey } from "./world";

const C = FIXTURE_ORIGINS.celsius;

const celsiusBase: RecipeData = {
  level: "api",
  api: {
    tokenSource: `GET ${C}/api/v2/auth/token → champ « token » (aussi rangé dans le stockage local « token »), envoyé en « Authorization: Bearer »`,
    endpoints: [
      {
        purpose: "events",
        method: "GET",
        urlTemplate: `${C}/api/v2/events?sport={sport}&date={date}&page={page}`,
        params: { sport: "football" },
        headers: ["authorization", "accept"],
        auth: "bearer",
        pagination: { param: "page", start: 1, step: 1, max: 20 },
        responseShape: {
          id: "data.events[].id",
          home: "data.events[].participants.home",
          away: "data.events[].participants.away",
          startsAt: "data.events[].kickoff",
          league: "data.events[].league.name",
          marketsCount: "data.events[].marketCount",
          hasMore: "meta.hasMore",
        },
      },
      {
        purpose: "markets",
        method: "GET",
        urlTemplate: `${C}/api/v2/event/{eventId}/markets`,
        headers: ["authorization", "accept"],
        auth: "bearer",
        pagination: null,
        responseShape: {
          eventId: "event.id",
          home: "event.home",
          away: "event.away",
          market: "markets[].name",
          line: "markets[].line",
          selection: "markets[].outcomes[].label",
          odds: "markets[].outcomes[].price",
        },
      },
    ],
  },
  dom: {
    football: {
      candidates: [{ text: "Football", role: "link" }, { css: "a[href*='/sports/football']" }],
    },
    dayToday: { candidates: [{ text: "Aujourd'hui" }, { css: "a.cs-day" }] },
    eventList: { candidates: [{ css: "a.cs-event" }, { css: "section.cs-league a" }] },
    eventRow: {
      home: { candidates: [{ css: ".cs-home" }] },
      away: { candidates: [{ css: ".cs-away" }] },
      startsAt: { candidates: [{ css: "time" }, { css: ".cs-time" }] },
    },
    marketTab: { candidates: [{ role: "tab" }, { css: ".cs-tabs button" }] },
    market: {
      name: { candidates: [{ css: ".cs-market-name" }, { css: "section h3" }] },
      selection: { candidates: [{ css: ".cs-sel" }] },
      odds: { candidates: [{ css: ".cs-price" }, { css: "button" }] },
    },
  },
  mapping: {
    marketMap: {
      "Match Result": "resultat",
      "Total Goals": "buts",
      "Corners O/U": "corners",
      "Shots on Target": "tirs-cadres",
    },
    oddsFormat: "decimal",
    timezone: "Europe/Paris",
  },
};

const celsiusChanged: RecipeData = {
  ...celsiusBase,
  api: {
    tokenSource: celsiusBase.api!.tokenSource ?? null,
    endpoints: [
      {
        ...celsiusBase.api!.endpoints[0]!,
        responseShape: {
          id: "result.items[].eventId",
          home: "result.items[].homeTeam.name",
          away: "result.items[].awayTeam.name",
          startsAt: "result.items[].startTime",
          league: "result.items[].competition.title",
          marketsCount: "result.items[].marketsTotal",
          hasMore: "paging.next",
        },
      },
      {
        ...celsiusBase.api!.endpoints[1]!,
        responseShape: {
          eventId: "ev.eventId",
          home: "ev.homeTeam.name",
          away: "ev.awayTeam.name",
          market: "groups[].title",
          line: "groups[].handicap",
          selection: "groups[].choices[].name",
          odds: "groups[].choices[].decimal",
        },
      },
    ],
  },
  dom: {
    football: celsiusBase.dom!.football!,
    eventList: { candidates: [{ css: "a.ev-line" }] },
    eventRow: {
      home: { candidates: [{ css: ".ev-line__p1" }] },
      away: { candidates: [{ css: ".ev-line__p2" }] },
      startsAt: { candidates: [{ css: "time" }] },
    },
    marketTab: { candidates: [{ role: "tab" }] },
    market: {
      name: { candidates: [{ css: ".ev-group__label" }] },
      selection: { candidates: [{ css: ".ev-choice" }] },
      odds: { candidates: [{ css: ".ev-choice__value" }] },
    },
  },
};

const sportazaBase: RecipeData = {
  level: "dom",
  api: null,
  dom: {
    football: {
      candidates: [{ text: "Football", role: "link" }, { css: "a[href$='/fr/sports/football']" }],
    },
    dayToday: { candidates: [{ text: "Aujourd'hui" }, { css: "a.sz-day" }] },
    eventList: { candidates: [{ css: "article.sz-match" }, { css: "[data-match]" }] },
    eventRow: {
      home: { candidates: [{ css: ".sz-team--home" }] },
      away: { candidates: [{ css: ".sz-team--away" }] },
      startsAt: { candidates: [{ css: ".sz-match__time" }, { css: "[data-start]" }] },
      link: { candidates: [{ css: "a.sz-match__link" }, { css: "a" }] },
    },
    marketTab: { candidates: [{ css: "button.sz-tab" }, { css: ".sz-tabs button" }] },
    market: {
      name: { candidates: [{ css: ".sz-market__name" }, { css: "section h4" }] },
      selection: { candidates: [{ css: ".sz-outcome" }] },
      odds: { candidates: [{ css: ".sz-outcome__odd" }] },
    },
  },
  mapping: {
    marketMap: {
      "Résultat du match": "resultat",
      "Plus/Moins de buts": "buts",
      "Corners - total": "corners",
      "Cartons - total": "cartons",
    },
    oddsFormat: "decimal",
    timezone: "Europe/Paris",
  },
};

const sportazaChanged: RecipeData = {
  ...sportazaBase,
  dom: {
    eventList: { candidates: [{ css: "article.event-card" }] },
    eventRow: {
      home: { candidates: [{ css: ".participant--1" }] },
      away: { candidates: [{ css: ".participant--2" }] },
      startsAt: { candidates: [{ css: ".event-card__kickoff" }] },
      link: { candidates: [{ css: "a.event-card__teams" }] },
    },
    marketTab: { candidates: [{ css: "button.market-nav__item" }] },
    market: {
      name: { candidates: [{ css: ".market-block__title" }] },
      selection: { candidates: [{ css: ".market-block__choice" }] },
      odds: { candidates: [{ css: ".market-block__choice-coef" }] },
    },
  },
};

const betportalBase: RecipeData = {
  level: "dom",
  api: null,
  dom: {
    football: { candidates: [{ text: "Football", role: "link" }] },
    dayToday: { candidates: [{ text: "Today" }] },
    eventList: { candidates: [{ css: "li.bp-ev" }] },
    eventRow: {
      home: { candidates: [{ css: ".bp-h" }] },
      away: { candidates: [{ css: ".bp-a" }] },
      startsAt: { candidates: [{ css: ".bp-ko" }, { css: "[data-time]" }] },
      league: { candidates: [{ css: "h3.bp-comp" }] },
      link: { candidates: [{ css: "a" }] },
    },
    marketTab: { candidates: [{ css: "button.bp-tab" }] },
    market: {
      name: { candidates: [{ css: ".bp-mkt-h" }] },
      selection: { candidates: [{ css: ".bp-row" }] },
      odds: { candidates: [{ css: ".bp-pr" }] },
      line: { candidates: [{ css: ".bp-ln" }] },
    },
  },
  mapping: {
    marketMap: {
      "1X2": "resultat",
      "O/U Goals": "buts",
      "TOT Corners": "corners",
      Bookings: "cartons",
      DC: "double-chance",
    },
    oddsFormat: "fractional",
    timezone: "Europe/Paris",
  },
};

const betportalChanged: RecipeData = {
  ...betportalBase,
  dom: {
    eventList: { candidates: [{ css: "li.feed-item" }] },
    eventRow: {
      home: { candidates: [{ css: ".feed-item__first" }] },
      away: { candidates: [{ css: ".feed-item__second" }] },
      startsAt: { candidates: [{ css: ".feed-item__time" }] },
      link: { candidates: [{ css: "a" }] },
    },
    marketTab: { candidates: [{ css: "button.feed-tab" }] },
    market: {
      name: { candidates: [{ css: ".feed-market__name" }] },
      selection: { candidates: [{ css: ".feed-outcome" }] },
      odds: { candidates: [{ css: ".feed-outcome__price" }] },
      line: { candidates: [{ css: ".feed-outcome__line" }] },
    },
  },
};

export const FIXTURE_RECIPES: Record<FixtureSiteKey, { base: RecipeData; changed: RecipeData }> = {
  celsius: { base: celsiusBase, changed: celsiusChanged },
  sportaza: { base: sportazaBase, changed: sportazaChanged },
  betportal: { base: betportalBase, changed: betportalChanged },
};
