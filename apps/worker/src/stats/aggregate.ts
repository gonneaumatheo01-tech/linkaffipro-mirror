/**
 * Agrégation journalière (Europe/Paris) d'événements vers les lignes `DailyStat`, par dimension.
 * Fonction pure, testée ; le chargement des données est dans `daily.ts`.
 */

export const METRIC_KEYS = [
  "requests",
  "approved",
  "joined",
  "left",
  "entryClicks",
  "offerClicks",
  "registrations",
  "ftds",
  "deposits",
  "depositAmount",
  "ngr",
  "spend",
  "cpaCommissions",
  "revshareCommissions",
  "commissions",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type DailyRow = Record<MetricKey, number> & { date: string; dimension: string };

export type StatEventKind =
  | "request"
  | "approved"
  | "joined"
  | "left"
  | "entryClick"
  | "offerClick"
  | "registration"
  | "ftd"
  | "deposit"
  | "ngr"
  | "spend"
  /** Commission CPA d'un joueur (montant signé : + au crédit, − le jour de l'annulation). */
  | "cpa"
  /** Part de revshare d'une offre (agrégat Link Affi, jour retenu `revshareDayKey`). */
  | "revshare";

export type StatEvent = {
  kind: StatEventKind;
  at: Date;
  /** Montant (dépôts, NGR, dépense, commissions). */
  amount?: number;
  channelId?: string | null;
  /** Campagne principale de l'événement (dimension `campaign:<id>`). */
  campaignId?: string | null;
  /**
   * Autres campagnes (offre partagée par plusieurs campagnes, voir @linkaffipro/core campaign-attribution) : l'événement
   * compte dans la ligne de chacune, mais une seule fois dans « all » et dans « campaigns ».
   */
  extraCampaignIds?: string[] | null;
  /** Univers des campagnes de l'événement : dimension « toutes campagnes » par univers (`campaigns:<V>`). */
  campaignVerticals?: string[] | null;
  adId?: string | null;
  vertical?: string | null;
};

const dayFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Clé de jour `AAAA-MM-JJ` en heure de Paris. */
export function dayKey(d: Date): string {
  return dayFmt.format(d);
}

/** Clés de jour (Paris) de `from` à `to` inclus, à partir de dates UTC. */
export function dayKeysBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let t = from.getTime(); t <= to.getTime() + 86_400_000; t += 86_400_000) {
    const k = dayKey(new Date(t));
    if (!seen.has(k) && k <= dayKey(to)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** Minuit Paris (en UTC) du jour `key` (AAAA-MM-JJ). */
export function parisMidnightUtc(key: string): Date {
  const base = Date.UTC(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)) - 1,
    Number(key.slice(8, 10)),
    0,
    0,
    0,
  );
  for (const offsetH of [2, 1, 0]) {
    const candidate = base - offsetH * 3_600_000;
    if (dayKey(new Date(candidate)) === key && dayKey(new Date(candidate - 60_000)) !== key)
      return new Date(candidate);
  }
  return new Date(base);
}

/** Au centime, sans « −0 ». */
function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

function emptyRow(date: string, dimension: string): DailyRow {
  return {
    date,
    dimension,
    requests: 0,
    approved: 0,
    joined: 0,
    left: 0,
    entryClicks: 0,
    offerClicks: 0,
    registrations: 0,
    ftds: 0,
    deposits: 0,
    depositAmount: 0,
    ngr: 0,
    spend: 0,
    cpaCommissions: 0,
    revshareCommissions: 0,
    commissions: 0,
  };
}

/**
 * Dimensions touchées par un événement (toujours "all" + chaque clé connue). Un événement rattaché à au moins une
 * campagne compte aussi, une seule fois, dans « campaigns » (total sans doublon de l'onglet Campagnes du tableau de
 * bord) et dans « campaigns:<univers> » pour chaque univers de ses campagnes.
 */
export function dimensionsOf(ev: StatEvent): string[] {
  const dims = ["all"];
  if (ev.channelId) dims.push(`channel:${ev.channelId}`);
  const campaigns = [
    ...new Set([ev.campaignId, ...(ev.extraCampaignIds ?? [])].filter((c): c is string => !!c)),
  ];
  for (const c of campaigns) dims.push(`campaign:${c}`);
  if (ev.adId) dims.push(`ad:${ev.adId}`);
  if (ev.vertical) dims.push(`vertical:${ev.vertical}`);
  if (campaigns.length > 0) {
    dims.push("campaigns");
    for (const v of new Set(ev.campaignVerticals ?? [])) if (v) dims.push(`campaigns:${v}`);
  }
  return dims;
}

function apply(row: DailyRow, ev: StatEvent): void {
  const amt = ev.amount ?? 0;
  switch (ev.kind) {
    case "request":
      row.requests += 1;
      break;
    case "approved":
      row.approved += 1;
      break;
    case "joined":
      row.joined += 1;
      break;
    case "left":
      row.left += 1;
      break;
    case "entryClick":
      row.entryClicks += 1;
      break;
    case "offerClick":
      row.offerClicks += 1;
      break;
    case "registration":
      row.registrations += 1;
      break;
    case "ftd":
      row.ftds += 1;
      break;
    case "deposit":
      row.deposits += 1;
      row.depositAmount += amt;
      break;
    case "ngr":
      row.ngr += amt;
      break;
    case "spend":
      row.spend += amt;
      break;
    case "cpa":
      row.cpaCommissions += amt;
      break;
    case "revshare":
      row.revshareCommissions += amt;
      break;
  }
}

/**
 * Agrège les événements par (jour Paris, dimension). Seuls les jours de `days` sont conservés.
 * Les dimensions sans événement n'ont pas de ligne (l'appelant peut remettre à zéro les anciennes lignes).
 */
export function aggregateDaily(events: StatEvent[], days: string[]): DailyRow[] {
  const allowed = new Set(days);
  const rows = new Map<string, DailyRow>();
  for (const ev of events) {
    const date = dayKey(ev.at);
    if (!allowed.has(date)) continue;
    for (const dim of dimensionsOf(ev)) {
      const key = `${date}|${dim}`;
      let row = rows.get(key);
      if (!row) {
        row = emptyRow(date, dim);
        rows.set(key, row);
      }
      apply(row, ev);
    }
  }
  const out = [...rows.values()];
  for (const r of out) {
    r.depositAmount = Math.round(r.depositAmount * 100) / 100;
    r.ngr = Math.round(r.ngr * 100) / 100;
    r.spend = Math.round(r.spend * 100) / 100;
    r.cpaCommissions = round2(r.cpaCommissions);
    r.revshareCommissions = round2(r.revshareCommissions);
    // Commissions = CPA nette + part de revshare, toujours égale à la somme des deux colonnes affichées.
    r.commissions = round2(r.cpaCommissions + r.revshareCommissions);
  }
  return out.sort((a, b) =>
    a.date === b.date ? a.dimension.localeCompare(b.dimension) : a.date.localeCompare(b.date),
  );
}
