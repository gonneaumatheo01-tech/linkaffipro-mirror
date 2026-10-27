/**
 * Phase 32 — contrat FIGÉ de l'équipe Prospection avancée (`docs/prompts/34-phase-32-prospection-avancee.md`). Types,
 * noms, réglages et bornes partagés par plusieurs chantiers ; ne pas les renommer. Le contrat de la phase 31
 * (`contract.ts`) reste valable : aucun contact, données publiques, données minimales, débits, Europe, zéro faux,
 * le code mesure / l'IA décrit, QA Global, pas de conseil juridique, aucun réseau dans les tests.
 *
 * Décisions (voir `docs/DECISIONS-TECH.md`, phase 32) :
 * - Les alertes ont leur table (`ProspectAlert` : état NEW → SENT → SEEN / MUTED, empreinte `dedupeKey` pour
 *   l'anti-répétition 14 jours) ; chaque alerte écrit AUSSI un `ProspectEvent` `ALERT` (chronologie de la fiche).
 * - Valeur estimée = arithmétique du code (`value/estimate.ts`), jamais d'IA ; toujours une fourchette
 *   basse / probable / haute + confiance + hypothèses ; « non calibrée » tant qu'aucun coefficient calibré n'existe.
 * - Calibrage = `Recommendation` (`teamKey = "prospection"`, `source = "prospection_calibration"`), jamais appliqué
 *   sans choix du client ; bornes `CALIBRATION_BOUNDS` ; suivi par `Experiment` ; annulable.
 * - Link Affi en lecture seule : table `stats` filtrée par `affiliate_id` (agrégats), `campaigns` pour lister les
 *   affiliés récents, `profiles` seulement pour le nom (exception documentée de `docs/LINKAFFI-API.md`). Port injecté
 *   `deps.linkAffiReader` (faux en test, aucun réseau) ; jamais d'écriture (le client n'a que des GET).
 * - Recherche par compte réel : boîte aux lettres du service `apps/userbot` (comme la phase 27), requête
 *   `kind = "prospect-search"` : recherche globale + fiche publique, AUCUN join, AUCUN message ; désactivée par défaut,
 *   activée par CONFIRM via Kevin ; 1 requête / 5 s, 100 / jour / compte, arrêt au premier FLOOD_WAIT.
 *
 * Qui fournit quoi :
 * - Chantier A, VEILLEUR + RÉSEAUX (`prospection/watch/*`, `prospection/network/*`, réseau en une ligne et tri par
 *   valeur dans `pipeline/daily-top.ts`, propagation de statut dans `pipeline/status.ts`).
 * - Chantier B, VALORISATEUR + BOUCLE LINK AFFI (`prospection/value/*`, `prospection/learn/*`, lecteur Link Affi réel
 *   du worker `apps/worker/src/agents/linkaffi-reader.ts`).
 * - Chantier C, COMPTE RÉEL + KEVIN (`discover/sources/account-search.ts`, `apps/userbot` requête `prospect-search`,
 *   `boss/catalog-prospection-advanced.ts`, `orders/capabilities/prospection-advanced.ts`, `orders/agents-dict.ts`,
 *   boutons `pra:` dans `packages/telegram/src/handlers/boss-prospection.ts`).
 * - Chantier D, SITE ET DOCS (pages alertes, réseaux, valeur, affiliés, sources étendue, fiche ; opérations Kevin).
 * - Socle (fait) : schéma, ce contrat, `advanced-port.ts` (port des fonctions des chantiers), aiguillage et
 *   planification dans `jobs.ts`.
 */
import type { ProspectTier, ProspectVertical } from "./contract";

// ------------------------------------------------------------------------------------------------ Veilleur

export type ProspectAlertKind =
  | "AFFILIATE_DROPPED"
  | "NEW_AFFILIATE"
  | "AFFILIATE_SWITCHED"
  | "GROWTH_SPIKE"
  | "DECLINE"
  | "WENT_SILENT"
  | "STARTED_SELLING_ADS"
  | "MARKETPLACE_LISTED"
  | "CONTACT_CHANGED"
  | "TIER_UP"
  | "TIER_DOWN"
  | "AFFILIATE_NOT_POSTING"
  | "AFFILIATE_PUSHES_COMPETITOR"
  | "AFFILIATE_RISKY_CLAIM"
  | "AFFILIATE_SILENT";

/** Ordre du message du matin : opportunités > affiliés signés > pipeline > informations. */
export type ProspectAlertFamily = "opportunity" | "affiliate" | "pipeline" | "info";
export const ALERT_FAMILY_ORDER: ProspectAlertFamily[] = ["opportunity", "affiliate", "pipeline", "info"];
export type ProspectAlertStatus = "NEW" | "SENT" | "SEEN" | "MUTED";

/** Alerte détectée par le code (`watch/diff.ts`, `watch/affiliates-watch.ts`), avant écriture. */
export type DetectedAlert = {
  kind: ProspectAlertKind;
  family: ProspectAlertFamily;
  /** Empreinte : `${kind}:${objet}` (marque, contact…) ; même empreinte en 14 jours → ignorée. */
  dedupeKey: string;
  /** Force 0-100 (tri du message du matin). */
  strength: number;
  /** Chiffres mesurés par le code (avant / après, jours, %). */
  data: Record<string, unknown>;
  /** Preuve ≤ 15 mots (extrait de post), jamais plus. */
  evidence?: string | null;
};

/** Point d'historique (`ProspectSnapshot`) tel que lu par `diff.ts`. */
export type SnapshotPoint = {
  takenAt: Date;
  subscribers: number | null;
  medianViews: number | null;
  viewRate: number | null;
  postsPerDay: number | null;
  brands: Array<{ brand: string; intensity: "HEAVY" | "MEDIUM" | "LIGHT"; lastSeenAt: string | null }>;
  competitiveState: string | null;
  bestContact: string | null;
  sellsAds: boolean;
  marketplace: boolean;
  lastPostAt: Date | null;
  tier: ProspectTier | null;
  score: number | null;
};

/** Boutons sous une alerte : `pra:<alertId>:<action>` (≤ 64 octets). */
export const ALERT_CALLBACK_PREFIX = "pra:";
export type ProspectAlertAction = "seen" | "note" | "mute";

export const WATCH_LIMITS = {
  /** Cadences de relecture (jours) par statut / niveau. */
  cadenceDays: { qualifiedAB: 7, qualifiedC: 21, pipeline: 7, signed: 3, skipped: 60, disqualifiedLow: 45 },
  /** Relecture allégée : page + 1 page d'aperçu (20 posts). */
  previewPosts: 20,
  /** Historique : 26 points au plus par prospect. */
  maxSnapshots: 26,
  /** Seuils des changements. */
  droppedAfterDays: 14,
  growthSubsPct: 0.3,
  growthViewsPct: 0.4,
  declineViewsPct: 0.3,
  windowDays: 30,
  silentDays: 21,
  affiliateNotPostingDays: 14,
  /** Message du matin : 09:10 Paris, 8 alertes au plus, pas la même en 14 jours, couper après 5 ignorées. */
  digestHour: 9,
  digestMinute: 10,
  digestMax: 8,
  repeatDays: 14,
  ignoredBeforeMuteOffer: 5,
  /** Relectures par passage nocturne (même plafond journalier que l'enrichissement de la phase 31). */
  perNight: 120,
  evidenceMaxWords: 15,
} as const;

// ------------------------------------------------------------------------------------------------ Réseaux

export type NetworkLinkKind = "same_contact" | "same_signature" | "same_linked_group" | "same_site" | "cross_forwards" | "same_description" | "same_promo_code";
/** Points par preuve (section 2 du prompt). Réseau formé à ≥ 4 points. */
export const NETWORK_LINK_POINTS: Record<NetworkLinkKind, number> = {
  same_contact: 3,
  same_signature: 2,
  same_linked_group: 3,
  same_site: 2,
  cross_forwards: 2,
  same_description: 1,
  same_promo_code: 2,
};
export const NETWORK_MIN_POINTS = 4;
export type NetworkEvidence = { a: string; b: string; kind: NetworkLinkKind; points: number; detail: string };

// ------------------------------------------------------------------------------------------------ Valorisateur

/** Segment = verticale | premier pays | type de contenu | niveau (`SPORTS|FR|tips_free|A`). */
export type ProspectSegment = { vertical: ProspectVertical; country: string; contentType: string; tier: ProspectTier | "?" };
export const segmentKey = (s: ProspectSegment): string => `${s.vertical}|${s.country || "?"}|${s.contentType || "?"}|${s.tier}`;

/** Valeur estimée mensuelle (`Prospect.valueEstimate`). Toujours une fourchette, jamais un chiffre seul. */
export type ValueEstimate = {
  low: number;
  base: number;
  high: number;
  currency: "EUR";
  /** Hypothèses visibles (taux, montants, part de posts promotionnels, réductions appliquées). */
  assumptions: {
    promoReach: number;
    promoShare: number;
    ctr: number;
    regRate: number;
    ftdRate: number;
    cpa: number | null;
    revsharePct: number | null;
    arpuMonth: number | null;
    reductions: string[];
    /** Revshare sans ARPU fourni : la part revshare est absente (jamais inventée). */
    missing: string[];
  };
  /** `default` (non calibrée) ou segment calibré. */
  calibratedBy: "default" | string;
  confidence: "low" | "medium" | "high";
  computedAt: string;
  offerId: string | null;
};

export const VALUE_DEFAULTS = {
  promoShare: { key: "prospection.value.promo_share", value: 0.25 },
  ctr: { key: "prospection.value.ctr", value: 0.015 },
  regRate: { key: "prospection.value.reg_rate", value: 0.1 },
  ftdRate: { key: "prospection.value.ftd_rate", value: 0.3 },
  /** ARPU mensuel par joueur déposant (revshare) : à fournir par le client ; absent → pas de part revshare. */
  arpuMonth: { key: "prospection.value.arpu_month", value: null as number | null },
  /** Tri du Top 10 : `tier_then_value` (phase 32) ou `tier_then_score` (phase 31). */
  dailyTopSort: { key: "prospection.daily_top_sort", value: "tier_then_value" as "tier_then_value" | "tier_then_score" },
} as const;

/** Fourchette = base × [0,4 ; 1 ; 2,2] ; réductions : SUSPECT_GENERIC × 0,6 ; chaque signal de faux × 0,8. */
export const VALUE_RANGE = { low: 0.4, base: 1, high: 2.2, suspectGeneric: 0.6, perFakeFlag: 0.8 } as const;

// ------------------------------------------------------------------------------------------------ Boucle Link Affi

/** Bornes du calibrage (règle 4). */
export const CALIBRATION_BOUNDS = {
  minAffiliates: 3,
  minDays: 30,
  /** Ratio réel / estimé écrêté. */
  ratioMin: 0.25,
  ratioMax: 4,
  /** Un coefficient bouge de 50 % au plus par mois, un poids du score de 20 % au plus par mois. */
  coefficientMaxChange: 0.5,
  weightMaxChange: 0.2,
  /** Expérience de suivi après application. */
  experimentDays: 30,
} as const;
export const CALIBRATION_SOURCE = "prospection_calibration";
export const CHURN_PROPOSE_AFTER_DAYS = 60;
/** Rappel du rattachement Link Affi : une fois par semaine, 3 fois au plus. */
export const LINK_REMINDER = { everyDays: 7, max: 3 } as const;

/** Lecteur Link Affi (lecture seule, injecté : réel dans le worker, faux en test). */
export type LinkAffiReader = {
  /** Agrégats d'un affilié sur une période (table `stats`, `eq.affiliate_id`) ; champs absents = null. */
  affiliateStats(affiliateId: string, from: string, to: string): Promise<{ clicks: number | null; regs: number | null; ftd: number | null; revenueCents: number | null; missing: string[] }>;
  /** Affiliés récents (table `campaigns` + nom par `profiles`) pour proposer des correspondances numérotées. */
  recentAffiliates(limit: number): Promise<Array<{ affiliateId: string; name: string | null; firstCampaignAt: string | null }>>;
};

// ------------------------------------------------------------------------------------------------ Compte réel

export const ACCOUNT_SEARCH = {
  enabled: { key: "prospection.account_search.enabled", value: false },
  /** Proposition faite une fois par Kevin. */
  offeredKey: "prospection.account_search.offered",
  /** Compteurs du jour `{ day, perAccount: { [accountId]: n }, flood?: { at, seconds } }`. */
  countersKey: "prospection.account_search.counters",
  rateMs: 5000,
  perAccountPerDay: 100,
  /** Lot : 20 requêtes au plus. */
  perLot: 20,
} as const;

// ------------------------------------------------------------------------------------------------ Modèles

export const PROSPECTION_ADVANCED_MODELS = {
  alertTexts: "claude-haiku-5-5",
  affiliatePosts: "claude-sonnet-5-5",
  calibrationText: "claude-opus-5-5",
  complex: "claude-opus-5-5",
  accountQueries: "claude-haiku-5-5",
} as const;

// ------------------------------------------------------------------------------------------------ File

/** Tâches ajoutées à la file `agents-prospection` par la phase 32. */
export type ProspectionAdvancedJob =
  | { type: "prospection.requalify-one"; prospectId: string }
  | { type: "prospection.alerts-digest" }
  | { type: "prospection.networks" }
  | { type: "prospection.values" }
  | { type: "prospection.learn-pull"; month?: string | null }
  | { type: "prospection.calibrate" }
  | { type: "prospection.monthly-report"; month?: string | null }
  | { type: "prospection.link-reminders" }
  | { type: "prospection.account-search"; lot: { vertical: "SPORTS" | "CASINO"; languages: string[]; requestId?: string | null } };

/** Repères de planification (`Setting prospection.runs2`). */
export const PROSPECTION_ADVANCED_RUNS_SETTING = "prospection.runs2";
