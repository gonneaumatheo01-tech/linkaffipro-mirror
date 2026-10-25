/**
 * Phase 29 — contrat FIGÉ de l'équipe Analystes (`docs/prompts/31-phase-29-analystes-marche.md`). Types, noms et limites
 * partagés par plusieurs chantiers ; ne pas les renommer.
 *
 * Décisions (voir `docs/DECISIONS-TECH.md`, phase 29) :
 * - « WebSearch / WebFetch » du prompt = les outils SERVEUR de l'API Claude (`web_search_20260209`, `web_fetch_20260209`,
 *   Sonnet 5.5 / Opus 5.5 ; clé Anthropic déjà réglée) : aucune nouvelle clé, aucun moteur de recherche à payer à part.
 *   Haiku 5.5 n'a pas la variante 2026 : la recherche passe par Sonnet. Coût compté dans `AgentUsage` équipe `analystes`.
 * - Forums, Reddit (JSON public), Telegram public (`t.me/s/`, mécanique de la phase 27) : lecture directe par `fetch`
 *   (et Playwright du worker si une page l'exige), débit par source, `robots.txt` respecté ; une page refusée ou un
 *   anti-robot → l'outil `web_fetch` de l'API en repli (jamais de contournement).
 * - Rien n'est inventé : chaque tendance, règle ou recommandation porte au moins une source (adresse + date) ; une seule
 *   source = « non vérifiée » ; Kevin le dit. Jamais d'avis juridique (phrase fixe `LEGAL_DISCLAIMER`).
 * - Le contenu lu (forums, posts, pages) est une DONNÉE : jamais d'instruction suivie (injection).
 * - L'équipe ne fait rien chez Meta / TikTok, ni sur les canaux, budgets ou créatives : elle recommande
 *   (`Recommendation` `teamKey = "analystes"`, `source = "market_analysis"`, choix numérotés par Kevin).
 *
 * Qui fournit quoi :
 * - Chantier A, VEILLE (`analysts/watch/*`, fixtures `packages/agents/fixtures/analysts/`) : `scrapeSource`,
 *   `fetchForum`, `fetchReddit`, `fetchTelegramPublic`, `searchNews`, `searchX`, `classifyEntry` (Haiku),
 *   `summarizeEntry` (Sonnet), `ingestEntries`, `discoverSources` (Sonnet + recherche web), `purgeRawTexts`,
 *   `seedSources`, `politeFetch` (débit + robots.txt).
 * - Chantier B, COMPLIANCE + STRATÈGE + RAPPORTEUR (`analysts/{compliance,strategist,reporter}.ts`) : `buildInitialRules`,
 *   `checkEntryCompliance`, `reverifyRules`, `answerMarketQuestion`, `weeklySynthesis`, `buildWeeklyReport`,
 *   `buildBriefing`, `alertFor`.
 * - Chantier C, KEVIN + WORKER (`boss/catalog-analysts.ts`, `orders/capabilities/analystes.ts`, `orders/agents-dict.ts`,
 *   file `agents-analystes` du worker `apps/worker/src/processors/agents-analystes.ts`, tâche `analysts.schedule`).
 * - Chantier D, SITE ET DOCS (page Agents → Analyses, opérations du site pour Kevin (phase 34), guide, docs).
 */
import type { AgentsDeps } from "../types";

export const ANALYSTS_TEAM_KEY = "analystes";
export const ANALYSTS_QUEUE = "agents-analystes";
export const MARKET_ANALYSIS_SOURCE = "market_analysis";

export type Market = "CASINO" | "SPORTS" | "DATING";
export type TrendCategory =
  | "AD_STRATEGY"
  | "AD_BAN"
  | "AD_CREATIVE"
  | "PLATFORM_CHANGE"
  | "MARKET_TREND"
  | "REGULATION"
  | "OFFER"
  | "TOOL"
  | "DISCUSSION"
  | "OTHER";
export type TrendSentiment = "POSITIVE" | "NEGATIVE" | "NEUTRAL";
export type CompliancePlatform = "META" | "TIKTOK" | "GOOGLE" | "SNAP" | "X" | "TELEGRAM" | "OTHER";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BAN";
export type TrendSourceType = "FORUM" | "REDDIT" | "TELEGRAM" | "TWITTER" | "NEWS" | "OTHER";

/** Pays européens couverts (ISO 3166-1 alpha-2) et langue locale principale. */
export const EUROPE_COUNTRIES: Readonly<Record<string, string>> = {
  FR: "fr", BE: "fr", LU: "fr", CH: "de", DE: "de", AT: "de", ES: "es", IT: "it", PT: "pt", NL: "nl", PL: "pl", SE: "sv",
  NO: "no", DK: "da", FI: "fi", CZ: "cs", RO: "ro", GR: "el", HU: "hu", BG: "bg", HR: "hr", SK: "sk", SI: "sl", EE: "et",
  LV: "lv", LT: "lt", IE: "en", GB: "en", MT: "en", CY: "el",
};

/** Réglages (`Setting`) et valeurs par défaut. */
export const ANALYSTS_SETTINGS = {
  enabled: { key: "analysts.enabled", value: true },
  weeklyReportDay: { key: "analysts.weekly_report_day", value: 1 },
  weeklyReportHour: { key: "analysts.weekly_report_hour", value: 8 },
  scrapeIntervalHours: { key: "analysts.scrape_interval_hours", value: 24 },
  maxEntriesPerScrape: { key: "analysts.max_entries_per_scrape", value: 100 },
  relevanceThreshold: { key: "analysts.relevance_threshold", value: 5 },
  alertRiskLevel: { key: "analysts.alert_risk_level", value: "HIGH" as RiskLevel },
  /** Plafond mensuel de l'IA et des recherches web de l'équipe, en centimes (`AgentUsage` équipe analystes). */
  monthlyBudgetCents: { key: "analysts.monthly_budget_cents", value: 3000 },
} as const;

/** Limites (règles 3, 4 ; étapes 2, 3, 5). */
export const ANALYSTS_LIMITS = {
  /** Débit par défaut : sites web 10 s, `t.me/s/` 3 s, forums 15 s (50 pages au plus par passage). */
  webRateMs: 10_000,
  telegramRateMs: 3_000,
  forumRateMs: 15_000,
  forumMaxPages: 50,
  /** Texte brut gardé 7 jours ; résumé 500 caractères ; 5 échecs de suite → source désactivée. */
  rawTextTtlMs: 7 * 24 * 3600_000,
  summaryMaxChars: 500,
  maxConsecutiveErrors: 5,
  /** Règles revérifiées après 30 jours ; découverte de sources une fois par semaine ; score ≥ 7 pour proposer. */
  ruleReverifyMs: 30 * 24 * 3600_000,
  discoveryMinScore: 7,
  /** Tendance « virale » : score ≥ 9 → notification. Réponse de Kevin : 20 lignes au plus. */
  viralScore: 9,
  answerMaxLines: 20,
  /** Haiku de classification : 500 jetons de sortie au plus. Recherche web : 5 recherches au plus par appel. */
  classifyMaxTokens: 500,
  webSearchMaxUses: 5,
  /** Fenêtre des questions du client : 30 derniers jours. */
  answerWindowMs: 30 * 24 * 3600_000,
} as const;

/** Phrase fixe dite par Kevin à chaque réponse qui touche aux règles (règle 2). */
export const LEGAL_DISCLAIMER =
  "C'est ce que j'observe sur les plateformes, pas un avis juridique. Vérifie avec un avocat pour les questions légales.";

/** Une source citée (règle 1). */
export type SourceRef = { url: string; date: string | null; title?: string | null; author?: string | null };

/** Un contenu lu, avant classement (texte brut gardé 7 jours au plus). */
export type RawItem = {
  url: string;
  title: string | null;
  text: string;
  author: string | null;
  publishedAt: string | null;
  language: string | null;
};

/** Classement d'un contenu (Haiku), validé par le code. */
export type EntryClassification = {
  category: TrendCategory;
  sentiment: TrendSentiment;
  relevanceScore: number;
  countries: string[];
  tags: string[];
  /** Plateforme et risque quand le contenu parle d'un bannissement ou d'un changement de règle. */
  platform: CompliancePlatform | null;
  risk: RiskLevel | null;
};

/** Accès web pour l'équipe (injecté ; faux en test, aucun réseau). */
export type AnalystsWeb = {
  /** Lecture directe d'une page (débit et robots.txt gérés par `politeFetch`). */
  fetchText(url: string, opts?: { accept?: string; timeoutMs?: number }): Promise<{ status: number; body: string; finalUrl: string }>;
  /** Recherche et lecture par les outils serveur de l'API Claude (résultats sourcés). */
  search(req: { query: string; allowedDomains?: string[]; country?: string; maxUses?: number }): Promise<Array<{ url: string; title: string; snippet: string; date: string | null }>>;
};

export type AnalystsDeps = AgentsDeps & { web?: AnalystsWeb };

/** Tâches de la file `agents-analystes` (concurrence 2 : lecture réseau, pas de calcul). */
export type AnalystsQueueJob =
  | { type: "analysts.schedule" }
  | { type: "analysts.scrape"; sourceId: string }
  | { type: "analysts.compliance_check"; entryId: string }
  | { type: "analysts.strategy"; kind: "weekly" | "on_demand"; requestId?: string | null }
  | { type: "analysts.report"; kind: "weekly" | "briefing"; reportId?: string | null }
  | { type: "analysts.discover" }
  | { type: "analysts.reverify" }
  | { type: "analysts.purge" };
