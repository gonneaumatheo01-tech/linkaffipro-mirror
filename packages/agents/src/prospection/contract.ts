/**
 * Phase 31 — contrat FIGÉ de l'équipe Prospection (`docs/prompts/33-phase-31-prospection-affilies.md`). Types, noms et
 * limites partagés par plusieurs chantiers ; ne pas les renommer.
 *
 * Décisions (voir `docs/DECISIONS-TECH.md`, phase 31) :
 * - AUCUN CONTACT : l'équipe n'envoie rien à personne d'autre que l'admin (par Kevin). Aucun module de `prospection/`
 *   n'importe `grammy`, `@linkaffipro/telegram`, `@linkaffipro/mtproto`, `@linkaffipro/queue` (envois) ni n'appelle
 *   `sendMessage` / `sendDm` / `enqueueDm` : les messages au client passent par `deps.admin` (AdminMessenger de Kevin).
 *   Test adverse `prospection/no-contact.test.ts`.
 * - Données publiques seulement : `t.me/<nom>`, `t.me/s/<nom>` (lecteur de la phase 27 réutilisé), `t.me/addlist/<hash>`
 *   (page publique), annuaires, résultats de recherche, 1 page liée par canal. Un lien d'invitation privé n'est JAMAIS
 *   ouvert (UNREADABLE immédiat). Aucun compte réel dans cette phase.
 * - Le texte des posts ne quitte pas la mémoire d'un job : aucune colonne ne le reçoit. Seuls `descriptionRaw`
 *   (description publique), `summaryFr` (200 car.) et au plus 3 extraits de 15 mots (`evidence`) sont gardés.
 * - Recherche web (sources B, C) = outils serveur de l'API Claude (`web_search` / `web_fetch`, Sonnet), comme les
 *   Analystes (phase 29) : aucune nouvelle clé. Les requêtes sont versionnées dans `dict/queries.json` (pas d'IA à
 *   chaque passage).
 * - Le code mesure, l'IA décrit : chiffres par `enrich/metrics.ts` ; score par `score/score.ts` (sans IA) ; tout chiffre
 *   d'un texte IA (dossier, réponse de Kevin) absent des données mesurées → rejeté (`rules/report-numbers.ts`).
 * - Rien ne sort sans le QA Global (phase 30) : Top 10 / réponses (`KEVIN_RESPONSE`), dossiers (`RECOMMENDATION`),
 *   rapport hebdo (`REPORT`), par `requireApproval`. QA refusé ou en panne → rien n'est envoyé, Kevin prévient.
 * - Jamais de repli d'Opus / Sonnet vers un modèle inférieur : échec signalé.
 *
 * Qui fournit quoi :
 * - Chantier A, SOURCEUR (`prospection/discover/*`, `prospection/dict/*`, fixtures `packages/agents/fixtures/prospection/`) :
 *   `normalizeProspectUrl`, `upsertCandidates` (dédoublonnage + `cocitationCount` + `ProspectSourceRun`),
 *   `runDiscovery(deps, lot)`, sources `directories`, `webSearch`, `social`, `graph` (`graphCandidatesFromRead`,
 *   `readFolder`), `analysts`, `manual` (`addManualProspect`), `planDiscoveryLots`, `politeProspectFetch` (débits,
 *   robots.txt, pause 24 h sur 403 / captcha).
 * - Chantier B, ENRICHISSEUR (`prospection/enrich/*`) : `parseChannelPage`, `readProspectPosts`, `computeMetrics`,
 *   `hardFilters`, `fakeSignals`, `detectLanguage`, `detectGeo`, `analyzeChannel` (Sonnet), `extractContacts`,
 *   `mergeBrands`, `regulatoryFlagFor`, `qcEnrichment`, `enrichProspect(deps, prospectId)`.
 * - Chantier C, ÉVALUATEUR + PIPELINE (`prospection/score/*`, `prospection/pipeline/*`) : `scoreProspect` (pur),
 *   `scoreAndStore`, `buildDossier` (Opus), `STATUS_TRANSITIONS`, `transitionProspect`, `buildDailyTop`,
 *   `sendDailyTop`, `handleProspectCallback`, `runReminders`, `buildWeeklyReport`, `sendWeeklyReport`, `prospectStats`.
 * - Chantier D, KEVIN + WORKER (`boss/catalog-prospection.ts`, `orders/capabilities/prospection.ts`,
 *   `orders/agents-dict.ts`, file `agents-prospection` `apps/worker/src/processors/agents-prospection.ts`, tâche
 *   `prospection.schedule`, boutons `prospect:` dans le webhook, questions des offres).
 * - Chantier E, SITE ET DOCS (page Agents → Prospection, opérations du site pour Kevin (phase 34), export CSV, guide).
 */
import type { AgentsDeps } from "../types";

export const PROSPECTION_TEAM_KEY = "prospection";
export const PROSPECTION_QUEUE = "agents-prospection";

export type ProspectKind = "CHANNEL" | "GROUP";
export type ProspectVertical = "SPORTS" | "CASINO" | "BOTH" | "OTHER";
export type ProspectRegion = "EU" | "NON_EU" | "UNKNOWN";
export type ProspectAuthenticity = "REAL" | "SUSPECT_GENERIC" | "SUSPECT_BOT" | "REPOST";
export type ContactConfidence = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type ProspectTier = "A" | "B" | "C" | "D";
export type ProspectStatus =
  | "DISCOVERED"
  | "ENRICHING"
  | "UNREADABLE"
  | "ENRICH_FAILED"
  | "QUALIFIED"
  | "DISQUALIFIED"
  | "CONTACTED"
  | "RESPONDED"
  | "NEGOTIATING"
  | "SIGNED"
  | "ACTIVE"
  | "CHURNED"
  | "SKIPPED"
  | "BLACKLISTED";
export type ProspectContactType = "TELEGRAM_USERNAME" | "EMAIL" | "WEBSITE" | "BOT" | "SOCIAL" | "MARKETPLACE" | "LINKED_GROUP" | "OTHER";
export type ProspectSourceType =
  | "DIRECTORY"
  | "WEB_SEARCH"
  | "SOCIAL"
  | "GRAPH_FORWARD"
  | "GRAPH_MENTION"
  | "FOLDER"
  | "ANALYSTS"
  | "MANUAL"
  | "ACCOUNT_SEARCH";
/** Sources de découverte (modules du Sourceur). */
export type DiscoverySource = "directories" | "web_search" | "social" | "graph" | "analysts" | "manual";
export type CompetitiveState = "FREE" | "ROTATING" | "EXCLUSIVE" | "OURS";
export type ContentType = "tips_free" | "vip_sales" | "bonus_pushing" | "streams_clips" | "news" | "mixed";
export type FakeFlag = "SUSPECT_FAKE_SUBS" | "SUSPECT_VIEW_BOT" | "SUSPECT_BOT_CONTENT" | "SUSPECT_NO_ENGAGEMENT" | "GROWTH_SPIKE";
export type RiskFlag = "SCAM_FIXED_MATCHES" | "GUARANTEED_WINS" | "PROMOTES_OUR_BRAND" | "UNDERAGE_SIGNALS";
export type DealType = "CPA" | "REVSHARE" | "HYBRID";

/** Périmètre par défaut : UE 27 + Royaume-Uni, Suisse, Norvège, Islande. Tout le reste = NON_EU. */
export const DEFAULT_COUNTRIES_SCOPE = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "CH", "NO", "IS",
] as const;

/** Poids des composantes du score (somme 100). */
export type ScoreWeights = { audience: number; engagement: number; fit: number; openness: number; competition: number; reach: number };

/** Réglages (`Setting`) et valeurs par défaut (section 1 du prompt). */
export const PROSPECTION_SETTINGS = {
  enabled: { key: "prospection.enabled", value: true },
  verticals: { key: "prospection.verticals", value: ["SPORTS", "CASINO"] as ProspectVertical[] },
  countriesScope: { key: "prospection.countries_scope", value: [...DEFAULT_COUNTRIES_SCOPE] as string[] },
  dailyTopCount: { key: "prospection.daily_top_count", value: 10 },
  dailyTopHour: { key: "prospection.daily_top_hour", value: 9 },
  discoveryDailyCap: { key: "prospection.discovery_daily_cap", value: 300 },
  enrichDailyCap: { key: "prospection.enrich_daily_cap", value: 200 },
  graphMaxDepth: { key: "prospection.graph_max_depth", value: 3 },
  minPosts30d: { key: "prospection.min_posts_30d", value: 8 },
  minMedianViews: { key: "prospection.min_median_views", value: 100 },
  qualifiedThreshold: { key: "prospection.qualified_threshold", value: 35 },
  tierAThreshold: { key: "prospection.tier_a_threshold", value: 70 },
  tierBThreshold: { key: "prospection.tier_b_threshold", value: 50 },
  dossierWeeklyCap: { key: "prospection.dossier_weekly_cap", value: 30 },
  reminderDays: { key: "prospection.reminder_days", value: 5 },
  negotiationReminderDays: { key: "prospection.negotiation_reminder_days", value: 10 },
  remindersDailyCap: { key: "prospection.reminders_daily_cap", value: 5 },
  remindersWeekend: { key: "prospection.reminders_weekend", value: false },
  tmeRateLimitMs: { key: "prospection.tme_rate_limit_ms", value: 3000 },
  directoryRateLimitMs: { key: "prospection.directory_rate_limit_ms", value: 10_000 },
  pitchDrafts: { key: "prospection.pitch_drafts", value: false },
  weights: {
    key: "prospection.weights",
    value: { audience: 30, engagement: 15, fit: 20, openness: 15, competition: 10, reach: 10 } as ScoreWeights,
  },
  /** Plafond mensuel de l'IA et des recherches web de l'équipe, en centimes (`AgentUsage` équipe prospection). */
  monthlyBudgetCents: { key: "prospection.monthly_budget_cents", value: 3000 },
  /** Pauses des sources : { [source]: { until: ISO, reason } }. */
  sourcePauses: { key: "prospection.source_pauses", value: {} as Record<string, { until: string; reason: string }> },
  /** Lots de découverte déjà faits (rotation des langues sur 7 jours) : { lastLanguageIndex, lastRunDay }. */
  rotation: { key: "prospection.rotation", value: { index: 0 } as { index: number } },
  /** Premier démarrage : questions des offres posées une fois. */
  offersAsked: { key: "prospection.offers_asked", value: null as string | null },
} as const;

export const PROSPECTION_LIMITS = {
  /** t.me : 1 requête / 3 s ; 100 posts (5 pages) par canal. */
  tmeRateMs: 3000,
  maxPostsPerChannel: 100,
  maxPreviewPages: 5,
  maxAgeDays: 90,
  /** Annuaires : 1 requête / 10 s ; 403 / captcha → pause 24 h. */
  directoryRateMs: 10_000,
  sourcePauseMs: 24 * 3600_000,
  /** Pages liées (linktree, site) : 1 page, 1 requête par canal. */
  linkedPagesPerChannel: 1,
  /** Posts envoyés à Sonnet : 30 à 50 (les plus vus + échantillon chronologique). */
  analyzeMinPosts: 30,
  analyzeMaxPosts: 50,
  /** Fenêtre des mesures : 30 jours. */
  metricsWindowDays: 30,
  /** Filtres durs. */
  abandonedAfterDays: 21,
  repostForwardRatio: 0.7,
  /** Signaux de faux. */
  fakeSubsViewRate: 0.03,
  viewBotCv: 0.05,
  viewBotMinPosts: 20,
  sameLengthTolerance: 10,
  noEngagementMinViews: 1000,
  fakePenalty: 6,
  fakePenaltyMax: 18,
  /** Région : EU si premier pays dans le périmètre et confiance ≥ 0,6. */
  geoMinConfidence: 0.6,
  /** Langue : confirmation Haiku sous 0,8. */
  languageMinConfidence: 0.8,
  /** UNKNOWN région → score plafonné à 49. */
  unknownRegionCap: 49,
  /** Données minimales. */
  summaryMaxChars: 200,
  evidenceMaxWords: 15,
  maxEvidencePerProspect: 3,
  /** ENRICH_FAILED : un nouvel essai 6 h plus tard, puis Kevin prévient. */
  enrichRetryMs: 6 * 3600_000,
  maxEnrichAttempts: 2,
  /** SKIPPED → QUALIFIED après 60 jours ; Top 10 : représenté une seule fois après 7 jours sans action. */
  skippedReturnDays: 60,
  representAfterDays: 7,
  /** Telegram : pas d'envoi d'un fichier au-delà de 50 lignes (lien vers l'export du site). */
  exportInlineMaxRows: 50,
  /** Haiku de classification : 500 jetons de sortie au plus. */
  classifyMaxTokens: 500,
  /** Job : 5 minutes au plus ; concurrence 2. */
  jobTimeoutMs: 5 * 60_000,
  concurrency: 2,
} as const;

/** Modèles (allocation validée, section « Modèles IA par agent »). */
export const PROSPECTION_MODELS = {
  queries: "claude-haiku-5-5",
  language: "claude-haiku-5-5",
  analyze: "claude-sonnet-5-5",
  dossier: "claude-opus-5-5",
  texts: "claude-haiku-5-5",
  routing: "claude-haiku-5-5",
  complex: "claude-opus-5-5",
  webSearch: "claude-sonnet-5-5",
} as const;

/** Boutons sous un prospect (`callback_data = prospect:<id>:<action>`, ≤ 64 octets : l'id cuid fait 25 caractères). */
export const PROSPECT_CALLBACK_PREFIX = "prospect:";
export type ProspectAction =
  | "contacted"
  | "signed"
  | "dossier"
  | "later"
  | "no"
  // Après « Signé » : type de deal (le montant est demandé ensuite par une question courte).
  | "deal_cpa"
  | "deal_revshare"
  | "deal_hybrid"
  // Rappels.
  | "relaunched"
  | "snooze3"
  | "abandon";

/** Un candidat trouvé par une source (avant dédoublonnage). */
export type Candidate = {
  /** Adresse telle que trouvée (`@nom`, `t.me/nom`, `t.me/s/nom`, `t.me/+hash`…). */
  url: string;
  sourceType: ProspectSourceType;
  sourceDetail: string | null;
  title?: string | null;
  /** Abonnés annoncés par un annuaire (indicatif ; la mesure vraie vient de `t.me/<nom>`). */
  announcedSubscribers?: number | null;
  category?: string | null;
  /** Fiche de place de marché (prix d'un post, contact) : preuve d'ouverture. */
  marketplace?: { url: string; price: string | null } | null;
  kind?: ProspectKind | null;
  /** Prospect d'origine (graphe) et profondeur. */
  discoveredFromId?: string | null;
  graphDepth?: number;
  vertical?: ProspectVertical | null;
  language?: string | null;
};

/** Un lot de découverte : une source × des langues × une verticale (× pays si demandé par le client). */
export type DiscoveryLot = {
  source: DiscoverySource;
  languages: string[];
  vertical: "SPORTS" | "CASINO";
  countries?: string[];
  /** Lot demandé par le client (« cherche des canaux casino en Pologne ») : identifiant pour le retour de Kevin. */
  requestId?: string | null;
  /** Prospect source pour le graphe. */
  prospectId?: string | null;
};

export type ProspectDiscoveryResult = { runId: string; found: number; newCount: number; duplicates: number; errors: string[]; paused: boolean };

/** Un post lu dans l'aperçu (en mémoire seulement ; le texte n'est jamais écrit en base). */
export type ProspectPost = {
  id: number;
  postedAt: Date;
  text: string;
  mediaKind: string;
  views: number | null;
  forwardedFrom: string | null;
  comments: number | null;
  reactions: number | null;
  buttons: Array<{ text: string; url: string }>;
  signature: string | null;
  links: string[];
  mentions: string[];
};

/** Page publique `t.me/<nom>`. */
export type ChannelPage =
  | {
      ok: true;
      title: string;
      description: string | null;
      subscribers: number | null;
      kind: ProspectKind;
      /** Aperçu `t.me/s/` disponible (lien « Preview channel »). */
      hasPreview: boolean;
    }
  | { ok: false; reason: "not_found" | "private" | "error"; message: string };

/** Mesures calculées par le code (`enrich/metrics.ts`). */
export type ProspectMetrics = {
  postsPerDay: number | null;
  medianViews: number | null;
  avgViews: number | null;
  viewRate: number | null;
  viewVarianceCv: number | null;
  forwardRatio: number | null;
  reactionRate: number | null;
  commentRate: number | null;
  linkDensity: number | null;
  postingHours: number[] | null;
  firstSeenPostAt: Date | null;
  lastPostAt: Date | null;
  posts30d: number;
  postCount: number;
};

export type BrandMention = {
  brand: string;
  country: string | null;
  links: number;
  promoCode: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  intensity: "HEAVY" | "MEDIUM" | "LIGHT";
  evidence?: string | null;
};

export type ContactFound = {
  type: ProspectContactType;
  value: string;
  label: string | null;
  source: string;
  confidence: Exclude<ContactConfidence, "NONE">;
  evidence: string | null;
};

/** Sortie JSON de la lecture IA (Sonnet), validée par le code (`enrich/analyze.ts`). */
export type ChannelAnalysis = {
  vertical: ProspectVertical;
  verticalDetails: { sports: string[]; casino: string[] };
  contentType: ContentType;
  summaryFr: string;
  quality: number;
  monetization: { sellsVip: boolean; vipPrice: string | null; sellsAds: boolean; adPrice: string | null; pushesAffiliate: boolean };
  brands: BrandMention[];
  authenticity: ProspectAuthenticity;
  authenticityReason: string;
  contacts: ContactFound[];
  riskFlags: RiskFlag[];
  geoHints: string[];
};

/** Entrée du score (lue en base, sans IA). */
export type ScoreInput = {
  kind: ProspectKind;
  region: ProspectRegion;
  countries: string[];
  vertical: ProspectVertical;
  contentType: string | null;
  regulatoryFlag: string | null;
  medianViews: number | null;
  subscribers: number | null;
  viewRate: number | null;
  reactionRate: number | null;
  commentRate: number | null;
  hasPosts: boolean;
  authenticity: ProspectAuthenticity | null;
  fakeFlags: FakeFlag[];
  riskFlags: RiskFlag[];
  monetization: { sellsVip?: boolean; sellsAds?: boolean; pushesAffiliate?: boolean; marketplaceListing?: string | null } | null;
  competitiveState: CompetitiveState | null;
  contactConfidence: ContactConfidence;
  offers: Array<{ id: string; brand: string; vertical: ProspectVertical; countries: string[]; dealTypes: Record<string, unknown> }>;
};

export type ScoreBreakdown = {
  audience: number;
  engagement: number;
  fit: number;
  openness: number;
  competition: number;
  reach: number;
  penalties: number;
};

export type ScoreResult = {
  score: number;
  breakdown: ScoreBreakdown;
  tier: ProspectTier;
  /** QUALIFIED (≥ seuil) ou DISQUALIFIED. */
  status: "QUALIFIED" | "DISQUALIFIED";
  tierReason: string;
  matchedOfferId: string | null;
  /** Plafonds appliqués (« région inconnue → 49 », « 2 signaux de faux → jamais A »). */
  caps: string[];
};

/** Accès web de l'équipe (injecté ; faux en test, aucun réseau). */
export type ProspectionWeb = {
  /** Lecture directe d'une page publique (débit et robots.txt gérés par `politeProspectFetch`). */
  fetchText(url: string, opts?: { timeoutMs?: number }): Promise<{ status: number; body: string; finalUrl: string }>;
  /** Recherche web par les outils serveur de l'API Claude (résultats sourcés). */
  search(req: { query: string; allowedDomains?: string[]; maxUses?: number }): Promise<Array<{ url: string; title: string; snippet: string }>>;
};

export type ProspectionDeps = AgentsDeps & {
  web?: ProspectionWeb;
  /** Attente (tests : instantanée) et horloge en millisecondes (tests : simulée). */
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
};

/** Tâches de la file `agents-prospection` (concurrence 2, 5 minutes par tâche, reprenables). */
export type ProspectionQueueJob =
  | { type: "prospection.schedule" }
  | { type: "prospection.discover"; lot: DiscoveryLot }
  | { type: "prospection.enrich"; prospectId: string }
  | { type: "prospection.score"; prospectId: string }
  | { type: "prospection.dossier"; prospectId: string }
  | { type: "prospection.daily-top"; requested?: { chatId?: string | null; count?: number } | null }
  | { type: "prospection.reminders" }
  | { type: "prospection.weekly-report" }
  | { type: "prospection.requalify" };
