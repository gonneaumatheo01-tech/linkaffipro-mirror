/**
 * Phase 35 — contrat FIGÉ des bookmakers lus directement (`docs/prompts/37-phase-35-cotes-bookmakers.md`). Types, noms et
 * limites partagés par plusieurs chantiers ; ne pas les renommer.
 *
 * Qui fournit quoi :
 * - Chantier A, TRANSPORT ET MAC (`bookmakers/transport/*`, `bookmakers/jobs.ts`, `apps/worker/scripts/bookmaker-runner.ts`,
 *   `apps/worker/scripts/runner-install.ts`, route `/api/integrations/capture-runner` étendue, file `agents-bookmakers`,
 *   `apps/worker/src/bookmakers/*`) : `createServerTransport`, `createMacTransport`, `pickTransport`, `enqueueReadJob`,
 *   `withSiteLock`, rythme et garde « jamais de mise » étendue à la lecture.
 * - Chantier B, APPRENDRE UN SITE (`bookmakers/learn/*`, fixtures `packages/agents/fixtures/bookmakers/<site>/`) :
 *   `recordSite`, `maskRecording`, `analyzeRecording` (Opus), `validateRecipe`, `learnSite`, `reuseRecipeByProvider`.
 * - Chantier C, LIRE ET PARIER (`bookmakers/read/*`, `providers/bookmaker-direct.ts`, `odds-registry.ts`, agents Cotes /
 *   Contrôle qualité / Capture, `sports/settle.ts`, script de migration des catégories) : `readEvents`, `readMarkets`,
 *   `readOddsTwice`, `diagnosePage`, `createBookmakerDirectProvider`.
 * - Chantier D, KEVIN, SANTÉ, SITE ET DOCS (`orders/capabilities/bookmakers.ts`, `boss/catalog-bookmakers.ts`,
 *   `bookmakers/health.ts`, `bookmakers/credentials.ts`, page Agents → Bookmakers, docs).
 */
import type { AgentsDeps } from "../types";

/** Sites du client (adresses confirmées le 25 octobre). Ajout possible par Kevin (« ajoute le bookmaker X, c'est x.com »). */
export const DEFAULT_BOOKMAKER_SITES = [
  { key: "celsius", label: "Celsius", baseUrl: "https://celsius.games" },
  { key: "sportaza", label: "Sportaza", baseUrl: "https://sportaza.com/fr/sports" },
  { key: "betportal", label: "Bet Portal", baseUrl: "https://betportal.com/" },
] as const;

/** Secret commun (mêmes email et mot de passe sur tous les bookmakers ; un site peut garder les siens). */
export const BOOKMAKER_DEFAULT_CREDENTIALS_KEY = "providers.bookmakers.default.credentials";

export type SiteStatus = "NEW" | "LEARNING" | "READY" | "DEGRADED" | "BLOCKED";
export type ReadTarget = "server" | "mac";
export type ReadLevel = "api" | "dom" | "image";
export type ReadJobKind = "learn" | "events" | "markets" | "verify" | "capture" | "test" | "visible";

/** Limites (règles 2, 3 et 6). */
export const BOOKMAKER_LIMITS = {
  /** Rythme humain : une page toutes les 2 à 5 secondes. */
  minPageDelayMs: 2000,
  maxPageDelayMs: 5000,
  /** Jamais plus de 60 requêtes par minute vers un site. */
  maxRequestsPerMinute: 60,
  /** Cache : liste des matchs 20 min, cotes d'un match 3 min. */
  eventsTtlMs: 20 * 60_000,
  oddsTtlMs: 3 * 60_000,
  /** Double lecture : deux chemins indépendants à moins de 3 minutes, identiques (tolérance 0). */
  doubleReadWindowMs: 3 * 60_000,
  /** Corps de réponse gardé dans un enregistrement : 200 Ko au plus. */
  recordBodyMaxBytes: 200_000,
  /** Validation d'une recette : ≥ 95 % des matchs visibles, 100 % des cotes lues. */
  recipeEventsMatchRatio: 0.95,
  recipeOddsMatchRatio: 1,
  /** Ré-apprentissage automatique au plus une fois par 24 h. */
  relearnMinIntervalMs: 24 * 3600_000,
  /** Santé : DEGRADED sous 90 % de réussite sur 24 h, BLOCKED après 3 échecs de suite. */
  degradedBelowRatio: 0.9,
  blockedAfterFailures: 3,
  /** Écart site ↔ consensus au-delà duquel une cote est signalée « inhabituelle » (pas bloquée). */
  unusualOddsGapPct: 15,
  /** Correspondance d'un match avec le fournisseur de résultats : coup d'envoi ± 15 min. */
  kickoffMatchToleranceMs: 15 * 60_000,
  /** Aucune lecture la nuit (Paris) sauf ordre : 1 h - 7 h. */
  nightStartHour: 1,
  nightEndHour: 7,
} as const;

/** Une réponse réseau enregistrée (secrets masqués avant tout stockage ou envoi à l'IA). */
export type RecordedResponse = {
  url: string;
  method: string;
  /** Paramètres de requête et corps (masqués). */
  query?: Record<string, string>;
  requestBody?: string | null;
  /** Noms des en-têtes de requête utiles ; valeurs secrètes remplacées par « [secret] ». */
  requestHeaders?: Record<string, string>;
  status: number;
  contentType: string | null;
  /** json | graphql | websocket | html | other */
  kind: "json" | "graphql" | "websocket" | "html" | "other";
  /** Corps tronqué à `recordBodyMaxBytes`. */
  body: string;
  at: string;
};

/** Instantané d'une page pendant l'enregistrement. */
export type RecordedPage = {
  step: string;
  url: string;
  /** HTML nettoyé (scripts, styles et champs de saisie retirés). */
  html: string;
  /** Texte visible. */
  text: string;
  /** Capture (base64 webp), facultative. */
  screenshot?: string | null;
};

/** Enregistrement guidé d'un site (parcours 2 à 4 minutes). */
export type SiteRecording = {
  siteKey: string;
  baseUrl: string;
  startedAt: string;
  endedAt: string;
  responses: RecordedResponse[];
  pages: RecordedPage[];
  /** Domaines vus (aucune URL de recette hors de ces domaines). */
  domains: string[];
  providerHint: string;
  /** Cotes lues sur les pages de marchés ouvertes (référence de la validation API ↔ page). */
  pageOdds: Array<{ eventLabel: string; market: string; selection: string; line: number | null; odds: number }>;
};

/**
 * Pagination par manifeste (phase 35, suite ; moteur Betby) : une première réponse (`urlTemplate` du manifeste) donne
 * la liste des « versions » à lire (`versionsPaths`, chemins vers des tableaux) ; chaque version remplit `{version}`
 * dans l'adresse du point d'entrée.
 */
export type ManifestPagination = { urlTemplate: string; versionsPaths: string[] };

/** Point d'entrée d'une API interne du site. */
export type RecipeEndpoint = {
  purpose: "events" | "markets" | "odds";
  method: "GET" | "POST";
  /** Modèle d'URL : `{date}`, `{sport}`, `{league}`, `{eventId}`, `{page}`, `{version}` ; domaine parmi ceux de l'enregistrement. */
  urlTemplate: string;
  params?: Record<string, string>;
  /** Noms des en-têtes à envoyer (valeurs prises dans la session, jamais stockées). */
  headers?: string[];
  auth: "cookie" | "bearer" | "none";
  pagination?: { param: string; start: number; step: number; max: number; manifest?: ManifestPagination | null } | null;
  /** Chemins vers les champs dans la réponse (notation pointée, `[]` pour les tableaux, `{}` pour les valeurs d'un objet). */
  responseShape: Record<string, string>;
};

/** Sélecteurs d'une étape de page (plusieurs candidats : le premier qui marche est retenu). */
export type DomStep = { candidates: Array<{ css?: string; text?: string; role?: string }>; lastGood?: number };

export type RecipeData = {
  level: "api" | "dom";
  api?: {
    endpoints: RecipeEndpoint[];
    tokenSource?: string | null;
    /** Adresse de la fiche d'un match lu par l'API (`{eventId}` ; autres champs de la ligne : `{slug}`…), pour la page. */
    eventUrlTemplate?: string | null;
  } | null;
  dom?: {
    football?: DomStep;
    dayToday?: DomStep;
    eventList: DomStep;
    eventRow: { home: DomStep; away: DomStep; startsAt: DomStep; league?: DomStep; link?: DomStep };
    marketTab?: DomStep;
    market: { name: DomStep; selection: DomStep; odds: DomStep; line?: DomStep };
    /**
     * Phase 35, suite (widgets sans lien) : pages de liste à ouvrir directement (aujourd'hui, demain…) au lieu de
     * l'adresse du site puis des clics `football` / `dayToday` ; `{date}` permis.
     */
    listUrls?: string[] | null;
    /** Adresse de la fiche d'un match dont la ligne n'a pas de lien (`{eventId}` = identifiant lu sur la ligne). */
    eventUrlTemplate?: string | null;
  } | null;
  mapping: {
    /** Nom du marché sur le site → clé interne de `sports/themes.json` (null = pas de correspondance). */
    marketMap: Record<string, string | null>;
    selectionMap?: Record<string, string>;
    /** `milli` : cote donnée en millièmes (1530 = 1,53). */
    oddsFormat: "decimal" | "fractional" | "american" | "milli";
    timezone: string;
  };
};

/** Résultat de validation d'une recette sur l'enregistrement (sans réseau). */
export type RecipeValidation = {
  recordedAt: string;
  eventsSeen: number;
  eventsMatched: number;
  oddsSeen: number;
  oddsMatched: number;
  mismatches: Array<{ what: string; expected: string; got: string }>;
  passed: boolean;
};

/** Un match lu sur un site. */
export type SiteEvent = {
  siteEventId: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
  url?: string | null;
  marketsCount?: number | null;
};

/** Une cote lue sur un site (une ligne `BookmakerOdds`). */
export type SiteOdds = {
  siteEventId: string;
  marketSite: string;
  marketKey: string | null;
  selectionSite: string;
  selectionKey: string | null;
  line: number | null;
  odds: number;
  level: ReadLevel;
  readAt: Date;
};

/**
 * Transport : exécute une lecture depuis le serveur (Playwright du worker) ou depuis le Mac du client (runner, par la
 * file `BookmakerReadJob`). Jamais deux sessions en parallèle pour un même site.
 */
export type BookmakerTransport = {
  target: ReadTarget;
  /** Appel d'API interne avec la session (cookies / jeton). Refus 401 / 403 → `{ authExpired: true }`. */
  fetchApi(siteKey: string, req: { method: string; url: string; headers?: string[]; body?: string | null }): Promise<
    { status: number; body: string } | { authExpired: true } | { obstacle: string }
  >;
  /** Ouvre une page et suit des étapes ; rend le HTML / texte visibles et, si demandé, une capture de zone. */
  page(siteKey: string, req: { url: string; steps?: Array<{ click?: DomStep; waitFor?: DomStep }>; captureOf?: DomStep | null }): Promise<
    { url: string; html: string; text: string; image?: string | null } | { obstacle: string }
  >;
  /** Enregistrement guidé complet (apprentissage). */
  record(siteKey: string, baseUrl: string): Promise<SiteRecording | { obstacle: string }>;
};

/** Diagnostic d'une page inattendue (règles du code, puis IA). */
export type PageDiagnosis =
  | "geo_blocked"
  | "captcha"
  | "maintenance"
  | "logged_out"
  | "two_factor"
  | "password_refused"
  | "site_changed"
  | "empty"
  | "ok";

/** Fonctions attendues (signatures de référence). */
export type BookmakersApi = {
  learnSite(deps: AgentsDeps, siteKey: string, opts?: { reason?: "first" | "repair" | "manual" }): Promise<{ ok: boolean; status: SiteStatus; message: string }>;
  readEvents(deps: AgentsDeps, siteKey: string, q: { from: Date; to: Date; leagues?: string[] }): Promise<SiteEvent[]>;
  readMarkets(deps: AgentsDeps, siteKey: string, siteEventId: string, marketKeys: string[]): Promise<SiteOdds[]>;
  /** Double lecture d'une cote (deux chemins indépendants, identiques, à moins de 3 min) ; sinon `{ ok: false }`. */
  readOddsTwice(deps: AgentsDeps, siteKey: string, q: { siteEventId: string; marketKey: string; selectionKey: string; line: number | null }): Promise<
    { ok: true; odds: number; readIds: [string, string]; levels: [ReadLevel, ReadLevel] } | { ok: false; reason: string; reads: SiteOdds[] }
  >;
};
