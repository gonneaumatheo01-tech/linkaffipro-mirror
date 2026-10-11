import type {
  CampaignInput,
  LaCampaign,
  LaCasino,
  LaClick,
  LaCurrencyRate,
  LaFtdInvalidation,
  LaPlayer,
  LaPlayerEvent,
  LaSnapshot,
  LaStat,
  PlayerEventInput,
  PlayerEventType,
  PlayerInput,
  ProgramInput,
  RateTable,
  StatInput,
  SubIdSource,
} from "./types";

/** Convertit une date ISO (ou vide) en Date, sinon null. */
export function toDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Table de taux à partir de `currency_rates` (unités par EUR). EUR vaut toujours 1. */
export function buildRateTable(rows: LaCurrencyRate[]): RateTable {
  const table: RateTable = { EUR: 1 };
  for (const r of rows) {
    const cur = str(r.currency)?.toUpperCase();
    const rate = toNumber(r.rate);
    if (cur && rate && rate > 0) table[cur] = rate;
  }
  return table;
}

/** Convertit un montant en EUR (arrondi au centime). Devise inconnue : montant inchangé. */
export function toEur(
  amount: number | null,
  currency: string | null | undefined,
  rates: RateTable,
): number | null {
  if (amount === null) return null;
  const cur = (currency ?? "EUR").toUpperCase();
  const rate = rates[cur];
  const eur = rate && rate > 0 ? amount / rate : amount;
  return Math.round(eur * 100) / 100;
}

/** `casinos` → AffiliateProgram. */
export function mapCasino(row: LaCasino): ProgramInput | null {
  const id = str(row.id);
  if (!id) return null;
  return {
    source: "LINKAFFI",
    externalId: id,
    name: str(row.name) ?? id,
    isActive: row.is_active !== false,
    raw: row as Record<string, unknown>,
  };
}

export const SUB_ID_PLACEHOLDER = "{subid}";

/** URL d'offre avec le placeholder du sub-ID (contrat docs/LINKAFFI-SUBID.md). */
export function trackingUrlTemplateFor(
  domain: string | null | undefined,
  campaignKey: string,
): string {
  const host = (domain ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "") || "linkaffi.me";
  return `https://${host}/go/${encodeURIComponent(campaignKey)}?sub_id=${SUB_ID_PLACEHOLDER}`;
}

/** `campaigns` → AffiliateCampaign. */
export function mapCampaign(row: LaCampaign): CampaignInput | null {
  const id = str(row.id);
  const key = str(row.campaign_key);
  if (!id || !key) return null;
  return {
    externalId: id,
    campaignKey: key,
    name: str(row.name) ?? key,
    trackingUrlTemplate: trackingUrlTemplateFor(str(row.domain), key),
    programExternalId: str(row.casino_id),
    isActive: true,
    raw: row as Record<string, unknown>,
  };
}

export function normalizeSubIdSource(v: unknown): SubIdSource {
  const s = str(v)?.toLowerCase();
  return s === "postback" || s === "time_match" ? s : null;
}

/** `players` → Player (montants supposés en EUR côté Link Affi ; conversion si une devise est fournie). */
export function mapPlayer(row: LaPlayer, rates: RateTable = { EUR: 1 }): PlayerInput | null {
  const id = str(row.id);
  const ext = str(row.external_player_id);
  if (!id || !ext) return null;
  const currency = str((row as { currency?: unknown }).currency) ?? "EUR";
  const subId = str(row.sub_id);
  return {
    externalId: id,
    campaignExternalId: str(row.campaign_id),
    programExternalId: str(row.casino_id),
    externalPlayerId: ext,
    subId,
    subIdSource: subId ? normalizeSubIdSource(row.sub_id_source) : null,
    registeredAt: toDate(row.created_at),
    ftdAt: toDate(row.ftd_at),
    ftdAmount: toEur(toNumber(row.ftd_amount), currency, rates),
    depositCount: toNumber(row.all_deposits_count) ?? 0,
    redepositCount: toNumber(row.redeposits_count) ?? 0,
    depositTotal: toEur(toNumber(row.total_deposited_amount), currency, rates) ?? 0,
    status: str(row.status),
    cpaStatus: str(row.cpa_status),
    cpaAmount: toEur(toNumber(row.cpa_affiliate_amount), currency, rates),
    cpaCreditedAt: toDate(row.cpa_credited_at),
    cpaReversedAt: toDate(row.cpa_reversed_at),
    qualifiedAt: toDate(row.qualified_at),
    disqualifiedAt: toDate(row.disqualified_at),
    lastEventAt: toDate(row.last_activity_at) ?? toDate(row.updated_at),
    updatedAt: toDate(row.updated_at),
    raw: row as Record<string, unknown>,
  };
}

/**
 * Règle de précédence du sub-ID entre la valeur connue chez nous et une nouvelle valeur Link Affi :
 * `postback` l'emporte toujours sur `time_match` ; à source égale, la plus récente (`updated_at`) gagne ;
 * une valeur ne disparaît jamais (null n'écrase pas).
 */
export function chooseSubId(
  current: { subId: string | null; subIdSource: SubIdSource; updatedAt: Date | null },
  incoming: { subId: string | null; subIdSource: SubIdSource; updatedAt: Date | null },
): { subId: string | null; subIdSource: SubIdSource } {
  if (!incoming.subId) return { subId: current.subId, subIdSource: current.subIdSource };
  if (!current.subId) return { subId: incoming.subId, subIdSource: incoming.subIdSource };
  const rank = (s: SubIdSource) => (s === "postback" ? 2 : s === "time_match" ? 1 : 0);
  if (rank(incoming.subIdSource) > rank(current.subIdSource))
    return { subId: incoming.subId, subIdSource: incoming.subIdSource };
  if (rank(incoming.subIdSource) < rank(current.subIdSource))
    return { subId: current.subId, subIdSource: current.subIdSource };
  const newer = (incoming.updatedAt?.getTime() ?? 0) >= (current.updatedAt?.getTime() ?? 0);
  return newer
    ? { subId: incoming.subId, subIdSource: incoming.subIdSource }
    : { subId: current.subId, subIdSource: current.subIdSource };
}

/**
 * Type d'un événement `player_events`. Une seule source de NGR daté (phase 8) : les variations des instantanés
 * `revshare_snapshots` (voir la synchro du worker). Un « revenue » / « ngr » de player_events est donc gardé comme
 * événement brut (OTHER), pour ne jamais compter deux fois le même revenu.
 */
export function mapEventType(
  event: string | null | undefined,
  details: Record<string, unknown> | null | undefined,
): PlayerEventType {
  switch ((event ?? "").toLowerCase()) {
    case "registration":
    case "signup":
      return "REGISTRATION";
    case "ftd":
      return "FTD";
    case "any_dep":
    case "deposit":
      return details?.is_redeposit === true ? "REDEPOSIT" : "DEPOSIT";
    case "lifecycle_redeposit":
    case "redeposit":
      return "REDEPOSIT";
    case "click":
      return "CLICK";
    default:
      return "OTHER";
  }
}

/**
 * `player_events` → PlayerEvent. Pour un dépôt, Link Affi envoie le cumul dans `amount` et le delta dans
 * `details.redeposit_delta` : on garde le montant du dépôt lui-même.
 */
export function mapPlayerEvent(
  row: LaPlayerEvent,
  rates: RateTable = { EUR: 1 },
): PlayerEventInput | null {
  const playerId = str(row.player_id);
  const id = str(row.id);
  if (!playerId || !id) return null;
  const details = (row.details && typeof row.details === "object" ? row.details : null) as Record<
    string,
    unknown
  > | null;
  const type = mapEventType(row.event, details);
  let amount = toNumber(row.amount);
  if ((type === "DEPOSIT" || type === "REDEPOSIT") && details) {
    const delta = toNumber(details.redeposit_delta);
    const before = toNumber(details.cumulative_before);
    if (delta !== null) amount = delta;
    else if (before !== null && amount !== null) amount = amount - before;
  }
  const currency = str(row.currency);
  return {
    playerExternalId: playerId,
    type,
    amount: toEur(amount, currency, rates),
    currency: amount === null ? null : "EUR",
    occurredAt: toDate(row.created_at) ?? new Date(0),
    externalId: str(row.idempotency_key) ?? id,
    raw: row as Record<string, unknown>,
  };
}

/** `revshare_snapshots` → NGR par (casino, identifiant externe du joueur). */
export function mapRevshareSnapshot(
  row: LaSnapshot,
  rates: RateTable = { EUR: 1 },
): { programExternalId: string; externalPlayerId: string; ngr: number; at: Date | null } | null {
  const p = str(row.casino_id);
  const ext = str(row.player_id);
  const ngr = toEur(toNumber(row.last_ngr), "EUR", rates);
  if (!p || !ext || ngr === null) return null;
  return {
    programExternalId: p,
    externalPlayerId: ext,
    ngr,
    at: toDate(row.last_seen_at) ?? toDate(row.updated_at),
  };
}

/** `deposit_snapshots` → dépôts cumulés par (casino, identifiant externe), avec la date réelle de l'instantané. */
export function mapDepositSnapshot(
  row: LaSnapshot,
  rates: RateTable = { EUR: 1 },
): {
  programExternalId: string;
  externalPlayerId: string;
  depositTotal: number;
  at: Date | null;
} | null {
  const p = str(row.casino_id);
  const ext = str(row.player_id);
  const total = toEur(toNumber(row.last_total), "EUR", rates);
  if (!p || !ext || total === null) return null;
  return {
    programExternalId: p,
    externalPlayerId: ext,
    depositTotal: total,
    at: toDate(row.last_seen_at) ?? toDate(row.updated_at),
  };
}

/** `ftd_invalidations` → annulation du FTD (clé = identifiant externe + casino). */
export function mapFtdInvalidation(
  row: LaFtdInvalidation,
): {
  programExternalId: string;
  externalPlayerId: string;
  reason: string | null;
  at: Date;
  externalId: string;
} | null {
  const p = str(row.casino_id);
  const ext = str(row.player_id);
  const id = str(row.id);
  if (!p || !ext || !id) return null;
  return {
    programExternalId: p,
    externalPlayerId: ext,
    reason: str(row.reason),
    at: toDate(row.created_at) ?? new Date(0),
    externalId: `ftd_invalidation:${id}`,
  };
}

/** `clicks` → sub-ID à rattacher (seulement les lignes qui en portent un). */
export function mapClick(
  row: LaClick,
): { subId: string; campaignExternalId: string | null; at: Date | null } | null {
  const subId = str(row.sub_id);
  if (!subId) return null;
  return { subId, campaignExternalId: str(row.campaign_id), at: toDate(row.created_at) };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * `stats` → `AffiliateDailyStat`. Une ligne sans offre (prime manuelle, correction) est gardée telle quelle : elle ne
 * compte dans aucune campagne. Montants en EUR (la table n'a pas de devise) ; revshare à 4 décimales (Link Affi en
 * donne jusqu'à 18, souvent quelques centimes par ligne). Sans identifiant ou sans jour lisible : ignorée.
 */
export function mapStat(row: LaStat): StatInput | null {
  const id = str(row.id);
  const date = str(row.date)?.slice(0, 10) ?? null;
  if (!id || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const int = (v: unknown) => Math.trunc(toNumber(v) ?? 0);
  const money = (v: unknown) => Math.round((toNumber(v) ?? 0) * 100) / 100;
  return {
    externalId: id,
    date,
    campaignExternalId: str(row.campaign_id),
    programExternalId: str(row.casino_id),
    affiliateExternalId: str(row.affiliate_id),
    clicks: int(row.clicks),
    signups: int(row.signups),
    deposits: int(row.deposits),
    depositAmount: money(row.deposit_amount),
    revenue: round4(toNumber(row.revenue) ?? 0),
    cpaRevenue: round4(toNumber(row.cpa_revenue) ?? 0),
    revshareRevenue: round4(toNumber(row.revshare_revenue) ?? 0),
    sourceCreatedAt: toDate(row.created_at),
    raw: row as Record<string, unknown>,
  };
}

/** Affiliés Link Affi propriétaires d'offres (`campaigns.affiliate_id`, gardé dans la ligne brute), sans doublon. */
export function ourAffiliateIds(offers: ReadonlyArray<{ raw: unknown }>): string[] {
  const out = new Set<string>();
  for (const o of offers) {
    const raw = o.raw && typeof o.raw === "object" ? (o.raw as Record<string, unknown>) : null;
    const id = raw ? str(raw.affiliate_id) : null;
    if (id) out.add(id);
  }
  return [...out];
}
