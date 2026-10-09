/**
 * Types des lignes Link Affi (tels qu'observés, voir docs/LINKAFFI-SCHEMA.md) et des entrées
 * de notre modèle. Tout est optionnel : le mapping tolère les colonnes manquantes.
 */
export type LaCasino = {
  id?: string;
  name?: string | null;
  commission_type?: string | null;
  cpa_amount?: number | null;
  revshare_percent?: number | null;
  is_active?: boolean | null;
  geos?: string[] | null;
  affiliate_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [k: string]: unknown;
};

export type LaCampaign = {
  id?: string;
  affiliate_id?: string | null;
  name?: string | null;
  campaign_key?: string | null;
  casino_id?: string | null;
  domain?: string | null;
  created_at?: string | null;
  [k: string]: unknown;
};

export type LaPlayer = {
  id?: string;
  casino_id?: string | null;
  external_player_id?: string | number | null;
  affiliate_id?: string | null;
  campaign_id?: string | null;
  sub_id?: string | null;
  sub_id_source?: string | null;
  status?: string | null;
  cpa_status?: string | null;
  ftd_amount?: number | null;
  ftd_at?: string | null;
  all_deposits_count?: number | null;
  total_deposited_amount?: number | null;
  redeposits_count?: number | null;
  redeposits_amount?: number | null;
  last_deposit_at?: string | null;
  last_activity_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [k: string]: unknown;
};

export type LaPlayerEvent = {
  id?: string;
  player_id?: string | null;
  casino_id?: string | null;
  event?: string | null;
  idempotency_key?: string | null;
  amount?: number | null;
  currency?: string | null;
  result?: string | null;
  details?: Record<string, unknown> | null;
  created_at?: string | null;
  [k: string]: unknown;
};

export type LaPlayerFinancials = {
  player_id?: string | null;
  cpa_affiliate?: number | null;
  cpa_eligible?: boolean | null;
  updated_at?: string | null;
  [k: string]: unknown;
};

export type LaSnapshot = {
  id?: string;
  player_id?: string | number | null;
  casino_id?: string | null;
  last_ngr?: number | null;
  last_total?: number | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
  [k: string]: unknown;
};

export type LaFtdInvalidation = {
  id?: string;
  player_id?: string | number | null;
  casino_id?: string | null;
  reason?: string | null;
  created_at?: string | null;
  [k: string]: unknown;
};

export type LaClick = {
  id?: string;
  campaign_id?: string | null;
  casino_id?: string | null;
  sub_id?: string | null;
  device?: string | null;
  browser?: string | null;
  country?: string | null;
  created_at?: string | null;
  [k: string]: unknown;
};

export type LaCurrencyRate = { currency?: string | null; rate?: number | null; last_updated?: string | null };

/** Taux : unités de devise pour 1 EUR (EUR = 1). */
export type RateTable = Record<string, number>;

export type SubIdSource = "postback" | "time_match" | null;

export type ProgramInput = {
  source: "LINKAFFI";
  externalId: string;
  name: string;
  isActive: boolean;
  raw: Record<string, unknown>;
};

export type CampaignInput = {
  externalId: string;
  campaignKey: string | null;
  name: string;
  trackingUrlTemplate: string;
  /** externalId du casino (AffiliateProgram.externalId) */
  programExternalId: string | null;
  isActive: boolean;
  raw: Record<string, unknown>;
};

export type PlayerInput = {
  externalId: string;
  /** externalId de la campagne Link Affi (campaigns.id) */
  campaignExternalId: string | null;
  programExternalId: string | null;
  externalPlayerId: string;
  subId: string | null;
  subIdSource: SubIdSource;
  registeredAt: Date | null;
  ftdAt: Date | null;
  ftdAmount: number | null;
  depositCount: number;
  redepositCount: number;
  depositTotal: number;
  status: string | null;
  lastEventAt: Date | null;
  updatedAt: Date | null;
  raw: Record<string, unknown>;
};

export type PlayerEventType = "CLICK" | "REGISTRATION" | "FTD" | "DEPOSIT" | "REDEPOSIT" | "NGR" | "OTHER";

export type PlayerEventInput = {
  /** players.id Link Affi */
  playerExternalId: string;
  type: PlayerEventType;
  amount: number | null;
  currency: string | null;
  occurredAt: Date;
  externalId: string;
  raw: Record<string, unknown>;
};
