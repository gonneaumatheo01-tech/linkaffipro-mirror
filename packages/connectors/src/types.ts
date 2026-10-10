/**
 * Contrat commun des connecteurs publicitaires (Meta, TikTok) : OAuth, liste des comptes, rapports journaliers.
 * Ce paquet ne touche ni à la base ni aux secrets chiffrés : il reçoit des jetons en clair et renvoie des
 * lignes normalisées ; le site et le worker font le reste. Toutes les requêtes passent par `fetch` injectable (tests).
 */
export type Platform = "META" | "TIKTOK";

/** Identifiants d'application développeur saisis dans Réglages → Connecteurs → Applications. */
export type AppCredentials = { clientId: string; secret: string; extra?: Record<string, unknown> };

/** Jeton(s) obtenus après OAuth. */
export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  /** Date d'expiration du jeton d'accès si connue. */
  expiresAt?: Date | null;
  scopes?: string | null;
  /** Données supplémentaires renvoyées par la plateforme (ex. TikTok : advertiser_ids). */
  raw?: Record<string, unknown>;
};

/** Compte publicitaire accessible par le jeton. */
export type ExternalAdAccount = {
  externalId: string;
  name: string;
  currency: string;
  timezone?: string | null;
  businessName?: string | null;
  /** Libellé lisible du statut (actif, désactivé…), déjà en français. */
  statusLabel?: string | null;
  active: boolean;
};

/** Ligne de rapport journalier normalisée, au niveau pub (ou groupe / campagne si la plateforme ne descend pas plus bas). */
export type AdInsightRow = {
  /** AAAA-MM-JJ dans le fuseau du compte. */
  date: string;
  campaignExternalId: string;
  campaignName: string;
  adSetExternalId?: string | null;
  adSetName?: string | null;
  adExternalId?: string | null;
  adName?: string | null;
  /** Dépense dans la devise du compte. */
  spend: number;
  currency: string;
  impressions: number;
  clicks: number;
  reach?: number | null;
  /** « Résultats » selon la plateforme (conversions), si disponibles. */
  results?: number | null;
};

export type DateRange = { from: string; to: string };

/** Fenêtre d'un appel de rapport (certaines plateformes limitent la plage par requête). */
export type FetchOptions = { fetchImpl?: typeof fetch; now?: Date; sandbox?: boolean };

export interface AdsProvider {
  readonly platform: Platform;
  /** Vérifie que les identifiants d'application sont acceptés par la plateforme (sans connecter de compte). */
  verifyApp(app: AppCredentials, opts?: FetchOptions): Promise<{ ok: true; detail?: string } | { ok: false; error: string }>;
  /** URL de la page de connexion chez la plateforme. */
  authorizeUrl(app: AppCredentials, redirectUri: string, state: string): string;
  /** Échange le code reçu sur l'URL de retour contre un jeton (longue durée si la plateforme le permet). */
  exchangeCode(app: AppCredentials, code: string, redirectUri: string, opts?: FetchOptions): Promise<TokenSet>;
  /** Renouvelle le jeton s'il approche de l'expiration ; `null` si la plateforme ne le permet pas (reconnexion). */
  refresh(app: AppCredentials, tokens: TokenSet, opts?: FetchOptions): Promise<TokenSet | null>;
  /** Comptes publicitaires visibles par ce jeton. */
  listAccounts(app: AppCredentials, tokens: TokenSet, opts?: FetchOptions): Promise<ExternalAdAccount[]>;
  /** Rapport journalier au niveau pub pour un compte et une plage (incluse, AAAA-MM-JJ). Découpe la plage si nécessaire. */
  fetchDailyInsights(app: AppCredentials, tokens: TokenSet, account: { externalId: string; currency: string }, range: DateRange, opts?: FetchOptions): Promise<AdInsightRow[]>;
}
