/**
 * Gains (phase 10) : nos commissions moins la dépense pub. Règles pures, partagées par le site, le worker et la reprise.
 *
 * Commissions = CPA nette + part de revshare (en euros, part de l'affilié, jamais celle du manager) :
 * - CPA : par joueur (`players.cpa_affiliate_amount`, `cpa_status`, `cpa_credited_at`, `cpa_reversed_at` de Link Affi).
 *   Créditée le jour du crédit (événement `CPA`, montant positif) ; si Link Affi l'annule, retranchée le jour de
 *   l'annulation (événement `CPA_REVERSAL`, montant négatif). La table agrégée `stats` de Link Affi n'est PAS utilisée
 *   pour la CPA : elle corrige la ligne du jour d'origine (vérifié le 11 octobre : 5 CPA créditées le 4, 2 annulées
 *   le 6, la ligne du 4 affiche 3 CPA).
 *   Link Affi ne garde que l'état courant du joueur : un nouveau crédit après une annulation ouvre un nouveau cycle,
 *   l'ancien couple crédit / annulation est gardé tel quel (identifiants suffixés `:1`, `:2`…, voir `diffCpaEvents`).
 * - Part de revshare : n'existe chez Link Affi qu'en agrégat (`stats.revshare_revenue`, par affilié, offre et jour),
 *   copié ligne par ligne dans `AffiliateDailyStat`. Seules nos offres comptent (offres rattachées à nos campagnes).
 * Les dépôts et le revenu net (NGR) sont l'argent du casino : ils ne s'ajoutent jamais aux gains.
 */

/** Identifiants des événements joueurs de commission (clé d'upsert stable par joueur Link Affi). */
export const CPA_EXTERNAL_PREFIX = "cpa:";
export const CPA_REVERSAL_EXTERNAL_PREFIX = "cpa_reversal:";

/** État CPA d'un joueur Link Affi (`players`), dates déjà converties. */
export type CpaState = {
  /** `players.id` Link Affi. */
  laPlayerId: string;
  /** `players.cpa_status` : none | approved | not_eligible | reversed. */
  status: string | null;
  /** `players.cpa_affiliate_amount`, en euros (part de l'affilié). */
  amount: number | null;
  /** `players.cpa_credited_at`. */
  creditedAt: Date | null;
  /** `players.cpa_reversed_at`. */
  reversedAt: Date | null;
  /** `players.qualified_at` : repli quand `cpa_credited_at` manque (anciens joueurs approuvés). */
  qualifiedAt?: Date | null;
  /** `players.disqualified_at` : repli quand `cpa_reversed_at` manque. */
  disqualifiedAt?: Date | null;
  /**
   * `players.updated_at` : moment où Link Affi a changé la ligne. Date d'un nouveau crédit qui ne porte pas de date
   * plus récente que l'annulation précédente (voir `diffCpaEvents`).
   */
  observedAt?: Date | null;
};

/**
 * Réglage (`Setting`) où la synchro garde la dernière table de taux Link Affi (`currency_rates`), pour que la reprise
 * `db:phase10:gains` convertisse les commissions exactement comme elle.
 */
export const CURRENCY_RATES_SETTING_KEY = "linkaffi.currencyRates";

/** Taux de conversion : unités de devise pour 1 EUR (table Link Affi `currency_rates`, EUR = 1). */
export type CpaRates = Readonly<Record<string, number>>;

function rowStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function rowNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * État CPA d'une ligne `players` de Link Affi (règle unique de la synchro et de la reprise `db:phase10:gains`) :
 * statut tel quel, montant de l'affilié converti en euros comme les autres montants du joueur (devise de la ligne,
 * EUR par défaut ; montant ÷ taux, au centime ; devise inconnue : montant inchangé), dates ISO lues telles quelles.
 * null sans identifiant Link Affi.
 */
export function cpaStateFromRow(row: unknown, rates: CpaRates = { EUR: 1 }): CpaState | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const laPlayerId = rowStr(r.id);
  if (!laPlayerId) return null;
  const raw = rowNum(r.cpa_affiliate_amount);
  const currency = (rowStr(r.currency) ?? "EUR").toUpperCase();
  const rate = rates[currency];
  const eur = raw === null ? null : rate && rate > 0 ? raw / rate : raw;
  return {
    laPlayerId,
    status: rowStr(r.cpa_status),
    amount: eur === null ? null : Math.round(eur * 100) / 100,
    creditedAt: rowDate(r.cpa_credited_at),
    reversedAt: rowDate(r.cpa_reversed_at),
    qualifiedAt: rowDate(r.qualified_at),
    disqualifiedAt: rowDate(r.disqualified_at),
    observedAt: rowDate(r.updated_at),
  };
}

export type CpaEventType = "CPA" | "CPA_REVERSAL";
export type CpaEvent = { type: CpaEventType; amount: number; occurredAt: Date; externalId: string };

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

function statusOf(s: CpaState): "approved" | "reversed" | "other" {
  const v = (s.status ?? "").trim().toLowerCase();
  return v === "approved" || v === "reversed" ? v : "other";
}

/**
 * Dates retenues d'une CPA : crédit = `cpa_credited_at`, à défaut `qualified_at` ; annulation (statut `reversed`
 * seulement) = `cpa_reversed_at`, à défaut `disqualified_at`, à défaut le jour du crédit ; jamais avant le crédit.
 * Statut sans commission (none, not_eligible) : aucune date.
 */
export function effectiveCpaDates(s: CpaState): {
  creditedAt: Date | null;
  reversedAt: Date | null;
} {
  const status = statusOf(s);
  if (status === "other") return { creditedAt: null, reversedAt: null };
  const creditedAt = s.creditedAt ?? s.qualifiedAt ?? null;
  if (status !== "reversed") return { creditedAt, reversedAt: null };
  let reversedAt = s.reversedAt ?? s.disqualifiedAt ?? creditedAt;
  if (reversedAt && creditedAt && reversedAt < creditedAt) reversedAt = creditedAt;
  return { creditedAt, reversedAt };
}

/**
 * Événements de commission d'un joueur, recalculés depuis son état Link Affi (idempotent : mêmes identifiants à chaque
 * passage). Rien sans montant positif ni date de crédit (une annulation sans crédit daté ne retranche rien).
 */
export function cpaEvents(s: CpaState): CpaEvent[] {
  const amount = typeof s.amount === "number" && Number.isFinite(s.amount) ? round2(s.amount) : 0;
  if (!(amount > 0)) return [];
  const { creditedAt, reversedAt } = effectiveCpaDates(s);
  if (!creditedAt) return [];
  const out: CpaEvent[] = [
    {
      type: "CPA",
      amount,
      occurredAt: creditedAt,
      externalId: `${CPA_EXTERNAL_PREFIX}${s.laPlayerId}`,
    },
  ];
  if (reversedAt)
    out.push({
      type: "CPA_REVERSAL",
      amount: -amount,
      occurredAt: reversedAt,
      externalId: `${CPA_REVERSAL_EXTERNAL_PREFIX}${s.laPlayerId}`,
    });
  return out;
}

/** Vrai pour un identifiant d'événement de commission (les autres événements du joueur ne sont jamais touchés). */
export function isCpaExternalId(id: string | null | undefined): boolean {
  return (
    typeof id === "string" &&
    (id.startsWith(CPA_EXTERNAL_PREFIX) || id.startsWith(CPA_REVERSAL_EXTERNAL_PREFIX))
  );
}

function cpaIdRest(id: string): string {
  return id.startsWith(CPA_REVERSAL_EXTERNAL_PREFIX)
    ? id.slice(CPA_REVERSAL_EXTERNAL_PREFIX.length)
    : id.slice(CPA_EXTERNAL_PREFIX.length);
}

/**
 * Vrai pour un cycle clos gardé (`cpa:<joueur>:<n>`, `cpa_reversal:<joueur>:<n>`) : un crédit suivi de son
 * annulation, avant un nouveau crédit. Jamais réécrit ni retiré.
 */
export function isArchivedCpaId(id: string | null | undefined): boolean {
  return typeof id === "string" && isCpaExternalId(id) && cpaIdRest(id).includes(":");
}

/** Numéro du dernier cycle clos gardé d'un joueur (0 s'il n'y en a pas). */
function lastArchiveIndex(stored: readonly StoredCpaEvent[], laPlayerId: string): number {
  let max = 0;
  for (const e of stored) {
    if (!isArchivedCpaId(e.externalId)) continue;
    const rest = cpaIdRest(e.externalId!);
    const cut = rest.lastIndexOf(":");
    if (rest.slice(0, cut) !== laPlayerId) continue;
    const n = Number(rest.slice(cut + 1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/** Événement de commission déjà en base (lecture avant écriture). */
export type StoredCpaEvent = {
  id: string;
  externalId: string | null;
  type: string;
  amount: unknown;
  occurredAt: Date;
};

/** Écritures d'alignement des événements de commission d'un joueur (voir `diffCpaEvents`). */
export type CpaDiff = {
  /** Événements à créer ou réécrire (montant, date ou type changés). */
  upserts: CpaEvent[];
  /** Identifiants `cpa:` / `cpa_reversal:` du cycle en cours qui ne sont plus voulus (ex. statut repassé à « none »). */
  deletes: string[];
  /** Cycle clos gardé : la ligne `id` change d'identifiant (`from` → `to`), montant et date inchangés. */
  renames: Array<{ id: string; from: string; to: string }>;
  /** Identifiants des `upserts` qui sont une NOUVELLE commission ou annulation (à journaliser), pas une réécriture. */
  created: string[];
  /** Jours de Paris touchés (statistiques journalières à recalculer). */
  days: string[];
};

const later = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

/**
 * Écritures pour aligner les événements de commission d'un joueur sur l'état Link Affi (idempotent : un second
 * passage sur le même état ne produit rien).
 * Cycles : Link Affi ne garde que le dernier crédit et la dernière annulation. Quand un crédit et son annulation sont
 * déjà enregistrés et que Link Affi crédite de nouveau (statut repassé à « approved », ou crédit daté après
 * l'annulation), l'ancien couple est gardé tel quel sous `cpa:<joueur>:<n>` / `cpa_reversal:<joueur>:<n>` (les jours
 * passés ne changent pas) et le nouveau crédit est créé. Sa date ne peut pas précéder la dernière annulation gardée :
 * à défaut d'une date de crédit plus récente, c'est `observedAt` (mise à jour de la ligne Link Affi), ou le jour de
 * l'annulation. Une même annulation dont seule la date est corrigée reste dans son cycle.
 */
export function diffCpaEvents(
  stored: readonly StoredCpaEvent[],
  desired: readonly CpaEvent[],
  opts: { observedAt?: Date | null } = {},
): CpaDiff {
  const current = stored.filter(
    (e) => isCpaExternalId(e.externalId) && !isArchivedCpaId(e.externalId),
  );
  const byId = new Map(current.map((e) => [e.externalId!, e]));
  const renames: CpaDiff["renames"] = [];
  let want = [...desired];
  const credit = want.find((e) => e.type === "CPA");
  if (credit) {
    const laId = credit.externalId.slice(CPA_EXTERNAL_PREFIX.length);
    const creditId = `${CPA_EXTERNAL_PREFIX}${laId}`;
    const reversalId = `${CPA_REVERSAL_EXTERNAL_PREFIX}${laId}`;
    const observed = opts.observedAt ?? null;
    // Date du crédit voulu : jamais avant `floor` (dernière annulation d'un cycle clos) ; un crédit déjà placé après
    // `floor` garde sa date (idempotence : `observedAt` change à chaque mise à jour de la ligne).
    const placeCredit = (floor: Date | null) => {
      const c = want.find((e) => e.type === "CPA")!;
      if (!floor || c.occurredAt.getTime() > floor.getTime()) return;
      const kept = byId.get(creditId);
      const at =
        kept && kept.occurredAt.getTime() >= floor.getTime()
          ? kept.occurredAt
          : observed
            ? later(observed, floor)
            : floor;
      want = want.map((e) => (e.type === "CPA" ? { ...e, occurredAt: at } : e));
    };
    const archived = stored.filter(
      (e) =>
        isArchivedCpaId(e.externalId) &&
        e.externalId!.startsWith(`${CPA_REVERSAL_EXTERNAL_PREFIX}${laId}:`),
    );
    const archivedFloor = archived.reduce<Date | null>(
      (m, e) => (!m || e.occurredAt > m ? e.occurredAt : m),
      null,
    );
    placeCredit(archivedFloor);
    const prevCredit = byId.get(creditId);
    const prevReversal = byId.get(reversalId);
    const nowCredit = want.find((e) => e.type === "CPA")!;
    const stillReversed = want.some((e) => e.type === "CPA_REVERSAL");
    const newCycle =
      prevCredit &&
      prevReversal &&
      (!stillReversed || nowCredit.occurredAt.getTime() > prevReversal.occurredAt.getTime());
    if (newCycle) {
      const n = lastArchiveIndex(stored, laId) + 1;
      renames.push(
        { id: prevCredit.id, from: creditId, to: `${creditId}:${n}` },
        { id: prevReversal.id, from: reversalId, to: `${reversalId}:${n}` },
      );
      byId.delete(creditId);
      byId.delete(reversalId);
      placeCredit(prevReversal.occurredAt);
    }
    // Une annulation n'est jamais datée avant son crédit.
    const at = want.find((e) => e.type === "CPA")!.occurredAt;
    want = want.map((e) =>
      e.type === "CPA_REVERSAL" && e.occurredAt.getTime() < at.getTime()
        ? { ...e, occurredAt: at }
        : e,
    );
  }
  const wanted = new Set(want.map((e) => e.externalId));
  const days = new Set<string>();
  const upserts: CpaEvent[] = [];
  const created: string[] = [];
  for (const e of want) {
    const prev = byId.get(e.externalId);
    const same =
      prev &&
      prev.type === e.type &&
      Number(prev.amount) === e.amount &&
      prev.occurredAt.getTime() === e.occurredAt.getTime();
    if (same) continue;
    upserts.push(e);
    if (!prev) created.push(e.externalId);
    days.add(parisDayKey(e.occurredAt));
    if (prev) days.add(parisDayKey(prev.occurredAt));
  }
  const deletes: string[] = [];
  for (const [id, prev] of byId) {
    if (wanted.has(id)) continue;
    deletes.push(id);
    days.add(parisDayKey(prev.occurredAt));
  }
  return { upserts, deletes, renames, created, days: [...days].sort() };
}

const parisFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Jour civil de Paris (`AAAA-MM-JJ`) d'un instant. */
export function parisDayKey(d: Date): string {
  return parisFmt.format(d);
}

/** `AAAA-MM-JJ` d'une date `@db.Date` (minuit UTC) ou d'une clé déjà écrite. */
function dateKey(v: Date | string): string {
  return typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

/**
 * Jour retenu pour une ligne de revshare : le jour de la ligne (`stats.date`, jour de Paris chez Link Affi), ou le jour
 * de Paris où la ligne a été créée si c'est plus tard.
 * - Correction AJOUTÉE après coup (nouvelle ligne datée du jour d'origine, `created_at` récent) : comptée le jour où
 *   elle arrive, comme une CPA annulée.
 * - Ligne RÉÉCRITE en place par Link Affi (même ligne, sans `updated_at`, `created_at` inchangé) : le montant change au
 *   jour d'origine ; ce jour passé change donc. La synchro relit les 7 derniers jours à chaque passage et les 35
 *   derniers une fois par nuit (`statsQueries`) ; le recalcul horaire reprend les jours touchés (`dirtySince`).
 */
export function revshareDayKey(row: { date: Date | string; sourceCreatedAt: Date | null }): string {
  const day = dateKey(row.date);
  if (!row.sourceCreatedAt) return day;
  const created = parisDayKey(row.sourceCreatedAt);
  return created > day ? created : day;
}

export type RevshareRow = {
  date: Date | string;
  sourceCreatedAt: Date | null;
  affiliateCampaignId: string | null;
  revshareRevenue: number | string | { toString(): string };
};

/** Part de revshare par jour retenu (centimes), lignes de nos offres seulement. */
export function sumRevshareByDay(
  rows: ReadonlyArray<RevshareRow>,
  offerIds: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.affiliateCampaignId || !offerIds.has(r.affiliateCampaignId)) continue;
    const v = Number(r.revshareRevenue);
    if (!Number.isFinite(v)) continue;
    const k = revshareDayKey(r);
    out.set(k, (out.get(k) ?? 0) + v);
  }
  for (const [k, v] of out) out.set(k, round2(v));
  return out;
}

type Where = Record<string, unknown>;

/**
 * Condition Prisma (`AffiliateDailyStatWhereInput`) : lignes de nos offres dont le jour retenu (`revshareDayKey`) est
 * dans la période. `dateFrom` / `dateTo` : jours `@db.Date` de la période ; `since` / `until` : minuit de Paris du
 * premier jour et du lendemain du dernier (bornes de `sourceCreatedAt`). Sans offre : aucune ligne.
 */
export function revshareRowWhere(
  b: { dateFrom: Date; dateTo: Date; since: Date; until: Date },
  offerIds: readonly string[],
): Where {
  const ids = [...new Set(offerIds)];
  if (ids.length === 0) return { affiliateCampaignId: { in: [] } };
  return {
    affiliateCampaignId: { in: ids },
    // max(date, jour de création) ≤ fin  ⇔  date ≤ fin ET créée avant la fin ;
    // max(date, jour de création) ≥ début  ⇔  date ≥ début OU créée depuis le début.
    date: { lte: b.dateTo },
    AND: [
      { OR: [{ sourceCreatedAt: null }, { sourceCreatedAt: { lt: b.until } }] },
      { OR: [{ date: { gte: b.dateFrom } }, { sourceCreatedAt: { gte: b.since } }] },
    ],
  };
}

/** Commissions = CPA nette + part de revshare (au centime). */
export function commissionsOf(cpa: number, revshare: number): number {
  return round2((Number.isFinite(cpa) ? cpa : 0) + (Number.isFinite(revshare) ? revshare : 0));
}

/** Gains = commissions − dépense pub (au centime). Jamais les dépôts ni le revenu net. */
export function gainsOf(commissions: number, spend: number): number {
  return round2(
    (Number.isFinite(commissions) ? commissions : 0) - (Number.isFinite(spend) ? spend : 0),
  );
}

/** Retour sur dépense pub = commissions ÷ dépense ; null sans dépense. */
export function commissionsRoas(commissions: number, spend: number): number | null {
  return spend > 0 && Number.isFinite(commissions) ? commissions / spend : null;
}
