import { prisma, ourPlayers, type Prisma, type Vertical } from "@linkaffipro/db";
import {
  periodDates,
  periodDayKeys,
  periodEnd,
  periodStart,
  previousPeriod,
  type Period,
} from "@/lib/periods";
import { campaignScope } from "./campaign-scope";
import { sumDays, unionTotal } from "./union-total";
import {
  EMPTY_TOTALS,
  addTotals,
  bestHours,
  cohorts,
  derive,
  deltaPct,
  funnel,
  type CohortRow,
  type Derived,
  type FunnelStep,
  type HourRow,
  type StatTotals,
} from "./metrics";

/**
 * Setting écrit par le worker à la fin de chaque recalcul réussi (`DAILY_LAST_RUN_KEY`, apps/worker/src/stats/daily.ts) :
 * `{ at, full, … }`. Les lignes inchangées n'étant pas réécrites, leur `updatedAt` ne dit pas quand le calcul a tourné.
 */
const DAILY_LAST_RUN_KEY = "stats.daily.lastRunAt";

/** Heure du dernier recalcul réussi des statistiques journalières (null si jamais). */
async function lastDailyRun(): Promise<Date | null> {
  const [setting, last] = await Promise.all([
    prisma.setting.findUnique({ where: { key: DAILY_LAST_RUN_KEY } }),
    prisma.dailyStat.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  const at = (setting?.value as { at?: unknown } | null)?.at;
  const parsed = typeof at === "string" ? new Date(at) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  // Avant la première écriture du Setting : dernière ligne écrite.
  return last?.updatedAt ?? null;
}

/** Clés de jour de la période courante et de la précédente (même longueur, collée). */
export function periodKeys(period: Period): { current: string[]; previous: string[] } {
  return { current: periodDayKeys(period), previous: periodDayKeys(previousPeriod(period)) };
}

/** Totaux par dimension et par jour (`AAAA-MM-JJ`) sur la période. */
async function sumDimensionByDay(
  dimensions: string[],
  period: Period,
): Promise<Map<string, Map<string, StatTotals>>> {
  const out = new Map<string, Map<string, StatTotals>>();
  if (dimensions.length === 0) return out;
  const { dateFrom, dateTo } = periodDates(period);
  const rows = await prisma.dailyStat.findMany({
    where: { dimension: { in: dimensions }, date: { gte: dateFrom, lte: dateTo } },
    select: {
      dimension: true,
      date: true,
      requests: true,
      approved: true,
      joined: true,
      left: true,
      entryClicks: true,
      offerClicks: true,
      registrations: true,
      ftds: true,
      deposits: true,
      depositAmount: true,
      ngr: true,
      spend: true,
    },
  });
  for (const { dimension, date, ...r } of rows) {
    const byDay = out.get(dimension) ?? new Map<string, StatTotals>();
    const key = date.toISOString().slice(0, 10);
    byDay.set(
      key,
      addTotals(byDay.get(key) ?? EMPTY_TOTALS, {
        ...r,
        depositAmount: Number(r.depositAmount),
        ngr: Number(r.ngr),
        spend: Number(r.spend),
      }),
    );
    out.set(dimension, byDay);
  }
  return out;
}

async function sumDimension(
  dimensions: string[],
  period: Period,
): Promise<Map<string, StatTotals>> {
  if (dimensions.length === 0) return new Map();
  const { dateFrom, dateTo } = periodDates(period);
  const rows = await prisma.dailyStat.findMany({
    where: { dimension: { in: dimensions }, date: { gte: dateFrom, lte: dateTo } },
    select: {
      dimension: true,
      requests: true,
      approved: true,
      joined: true,
      left: true,
      entryClicks: true,
      offerClicks: true,
      registrations: true,
      ftds: true,
      deposits: true,
      depositAmount: true,
      ngr: true,
      spend: true,
    },
  });
  const out = new Map<string, StatTotals>();
  for (const r of rows) {
    const prev = out.get(r.dimension) ?? EMPTY_TOTALS;
    out.set(
      r.dimension,
      addTotals(prev, {
        ...r,
        depositAmount: Number(r.depositAmount),
        ngr: Number(r.ngr),
        spend: Number(r.spend),
      }),
    );
  }
  return out;
}

export type AdsRow = {
  campaignId: string;
  name: string;
  platform: string | null;
  vertical: Vertical | null;
  status: string;
  totals: StatTotals;
  derived: Derived;
  previous: StatTotals;
  previousDerived: Derived;
  deltas: Partial<Record<keyof StatTotals | keyof Derived, number | null>>;
};

/**
 * Dimension « toutes campagnes » écrite par le worker (apps/worker/src/stats) : chaque événement rattaché à au moins
 * une campagne y compte une seule fois, même quand une offre partagée le place dans plusieurs lignes.
 */
export function campaignsUnionDimension(vertical?: Vertical | ""): string {
  return vertical ? `campaigns:${vertical}` : "campaigns";
}

/** Tableau par campagne (la nôtre) sur la période, avec la période précédente et les deltas (totaux et indicateurs dérivés). */
export async function loadAdsTable(
  period: Period,
  filters: { vertical?: Vertical | ""; campaignId?: string } = {},
): Promise<{
  rows: AdsRow[];
  total: StatTotals;
  totalDerived: Derived;
  previousTotal: StatTotals;
  previousTotalDerived: Derived;
  totalDeltas: AdsRow["deltas"];
  lastComputedAt: Date | null;
}> {
  const previous = previousPeriod(period);
  const campaigns = await prisma.campaign.findMany({
    where: {
      ...(filters.vertical ? { vertical: filters.vertical } : {}),
      ...(filters.campaignId ? { id: filters.campaignId } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, adPlatform: true, vertical: true, status: true },
  });
  const dims = campaigns.map((c) => `campaign:${c.id}`);
  const union = campaignsUnionDimension(filters.vertical);
  const [cur, prev, lastComputedAt] = await Promise.all([
    sumDimensionByDay([...dims, union], period),
    sumDimensionByDay([...dims, union], previous),
    lastDailyRun(),
  ]);
  const rows: AdsRow[] = campaigns.map((c) => {
    const totals = sumDays(cur.get(`campaign:${c.id}`));
    const previousTotals = sumDays(prev.get(`campaign:${c.id}`));
    const derived = derive(totals);
    const previousDerived = derive(previousTotals);
    return {
      campaignId: c.id,
      name: c.name,
      platform: c.adPlatform,
      vertical: c.vertical,
      status: c.status,
      totals,
      derived,
      previous: previousTotals,
      previousDerived,
      deltas: computeDeltas(totals, derived, previousTotals, previousDerived),
    };
  });
  // Total : joueurs distincts (dimension « toutes campagnes ») les jours où le worker l'a écrite, somme des lignes les
  // autres jours (voir union-total.ts). Une seule campagne demandée : son total est sa ligne.
  const totalOf = (byDim: Map<string, Map<string, StatTotals>>) =>
    unionTotal(
      byDim.get(union),
      dims.map((d) => byDim.get(d) ?? new Map<string, StatTotals>()),
    );
  const total = filters.campaignId ? (rows[0]?.totals ?? EMPTY_TOTALS) : totalOf(cur);
  const previousTotal = filters.campaignId ? (rows[0]?.previous ?? EMPTY_TOTALS) : totalOf(prev);
  const totalDerived = derive(total);
  const previousTotalDerived = derive(previousTotal);
  return {
    rows,
    total,
    totalDerived,
    previousTotal,
    previousTotalDerived,
    totalDeltas: computeDeltas(total, totalDerived, previousTotal, previousTotalDerived),
    lastComputedAt,
  };
}

/** Variations en % de chaque total et de chaque indicateur dérivé (null si non calculable). */
export function computeDeltas(
  totals: StatTotals,
  derived: Derived,
  prevTotals: StatTotals,
  prevDerived: Derived,
): AdsRow["deltas"] {
  const deltas: AdsRow["deltas"] = {};
  for (const k of Object.keys(EMPTY_TOTALS) as (keyof StatTotals)[])
    deltas[k] = deltaPct(totals[k], prevTotals[k]);
  for (const k of Object.keys(derived) as (keyof Derived)[]) {
    const a = derived[k];
    const b = prevDerived[k];
    deltas[k] = a === null || b === null ? null : deltaPct(a, b);
  }
  return deltas;
}

/** Totaux d'une dimension sur la période (pour l'entonnoir). */
export async function loadTotals(dimension: string, period: Period): Promise<StatTotals> {
  return (await sumDimension([dimension], period)).get(dimension) ?? EMPTY_TOTALS;
}

export type FunnelData = {
  totals: StatTotals;
  steps: FunnelStep[];
  previous: { totals: StatTotals; steps: FunnelStep[] } | null;
};

/** Entonnoir d'une dimension ; avec `compare`, celui de la période précédente. */
export async function loadFunnel(
  dimension: string,
  period: Period,
  compare = false,
): Promise<FunnelData> {
  const [totals, prevTotals] = await Promise.all([
    loadTotals(dimension, period),
    compare ? loadTotals(dimension, previousPeriod(period)) : Promise.resolve(null),
  ]);
  return {
    totals,
    steps: funnel(totals),
    previous: prevTotals ? { totals: prevTotals, steps: funnel(prevTotals) } : null,
  };
}

export type ChannelDaily = {
  channelId: string;
  title: string;
  keys: string[];
  net: number[];
  joined: number;
  left: number;
  requests: number;
  previous: { joined: number; left: number; requests: number } | null;
};

/** Croissance nette par jour et par canal (joined − left), depuis `DailyStat` ; avec `compare`, les totaux de la période précédente. */
export async function loadChannelGrowth(
  period: Period,
  channelId: string | "",
  compare = false,
): Promise<ChannelDaily[]> {
  const current = periodDayKeys(period);
  const channels = await prisma.channel.findMany({
    where: { isActive: true, ...(channelId ? { id: channelId } : {}) },
    orderBy: { title: "asc" },
    select: { id: true, title: true },
  });
  if (channels.length === 0) return [];
  const dims = channels.map((c) => `channel:${c.id}`);
  const { dateFrom, dateTo } = periodDates(period);
  const [rows, prev] = await Promise.all([
    prisma.dailyStat.findMany({
      where: { dimension: { in: dims }, date: { gte: dateFrom, lte: dateTo } },
      select: { dimension: true, date: true, joined: true, left: true, requests: true },
    }),
    compare ? sumDimension(dims, previousPeriod(period)) : Promise.resolve(null),
  ]);
  return channels.map((c) => {
    const mine = rows.filter((r) => r.dimension === `channel:${c.id}`);
    const byDay = new Map(mine.map((r) => [r.date.toISOString().slice(0, 10), r]));
    const net = current.map((k) => {
      const r = byDay.get(k);
      return r ? r.joined - r.left : 0;
    });
    const p = prev?.get(`channel:${c.id}`) ?? (prev ? EMPTY_TOTALS : null);
    return {
      channelId: c.id,
      title: c.title,
      keys: current,
      net,
      joined: mine.reduce((a, r) => a + r.joined, 0),
      left: mine.reduce((a, r) => a + r.left, 0),
      requests: mine.reduce((a, r) => a + r.requests, 0),
      previous: p ? { joined: p.joined, left: p.left, requests: p.requests } : null,
    };
  });
}

export type CohortFilters = { vertical: Vertical | ""; channelId: string; campaignId?: string };

/**
 * Cohortes par semaine d'arrivée (première demande d'adhésion dans la période choisie), depuis les tables sources.
 * Filtres : univers et canal (canal de la demande), campagne (demandes passées par ses liens d'entrée).
 * Seuls « nos » joueurs comptent ; la LTV somme les variations de NGR datées (`PlayerEvent` NGR), jamais le cumul.
 */
export async function loadCohorts(
  period: Period,
  filters: CohortFilters = { vertical: "", channelId: "" },
): Promise<CohortRow[]> {
  const and: Prisma.MembershipWhereInput[] = [
    { requestedAt: { gte: periodStart(period), lt: periodEnd(period) } },
  ];
  if (filters.channelId || filters.vertical) {
    const channels = await prisma.channel.findMany({
      where: {
        ...(filters.channelId ? { id: filters.channelId } : {}),
        ...(filters.vertical ? { vertical: filters.vertical } : {}),
      },
      select: { id: true },
    });
    and.push({ channelId: { in: channels.map((c) => c.id) } });
  }
  if (filters.campaignId) {
    // Membres d'une campagne : arrivés par un de ses liens d'entrée (même règle que sa fiche et que le worker).
    const scope = await campaignScope(filters.campaignId);
    and.push({ inviteLinkId: { in: scope.inviteLinkIds } });
  }
  const firstRequests = await prisma.membership.groupBy({
    by: ["memberId"],
    where: { AND: and },
    _min: { requestedAt: true },
  });
  const memberIds = firstRequests.map((m) => m.memberId);
  if (memberIds.length === 0) return [];
  const ours = await ourPlayers();
  const players = await prisma.player.findMany({
    where: { AND: [ours, { memberId: { in: memberIds } }] },
    select: {
      memberId: true,
      registeredAt: true,
      ftdAt: true,
      events: {
        where: { type: { in: ["FTD", "DEPOSIT", "REDEPOSIT", "NGR"] } },
        select: { type: true, occurredAt: true, amount: true },
      },
    },
  });
  const byMember = new Map<string, typeof players>();
  for (const p of players) {
    const list = byMember.get(p.memberId!) ?? [];
    list.push(p);
    byMember.set(p.memberId!, list);
  }
  return cohorts(
    firstRequests.map((m) => {
      const ps = byMember.get(m.memberId) ?? [];
      const events = ps.flatMap((p) => p.events);
      const registeredAt =
        ps
          .map((p) => p.registeredAt)
          .filter((d): d is Date => !!d)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const ftdAt =
        ps
          .map((p) => p.ftdAt)
          .filter((d): d is Date => !!d)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      return {
        memberId: m.memberId,
        arrivedAt: m._min.requestedAt!,
        registeredAt,
        ftdAt,
        deposits: events
          .filter((e) => e.type !== "NGR")
          .map((e) => ({ at: e.occurredAt, amount: Number(e.amount ?? 0) })),
        ngr: events.filter((e) => e.type === "NGR").reduce((a, e) => a + Number(e.amount ?? 0), 0),
      };
    }),
  );
}

export type CategoryRow = {
  categoryId: string | null;
  name: string;
  color: string;
  posts: number;
  clicks: number;
  clicksPerPost: number;
};

/** Meilleurs horaires et meilleures catégories sur les messages envoyés de la période. */
export async function loadBestTimes(
  period: Period,
  channelId: string | "",
): Promise<{ hours: HourRow[]; categories: CategoryRow[] }> {
  const posts = await prisma.post.findMany({
    where: {
      status: "SENT",
      sentAt: { gte: periodStart(period), lt: periodEnd(period) },
      ...(channelId ? { channelId } : {}),
    },
    select: {
      sentAt: true,
      categoryId: true,
      category: { select: { name: true, color: true } },
      stats: { select: { clicks: true } },
    },
  });
  const hours = bestHours(
    posts.filter((p) => p.sentAt).map((p) => ({ sentAt: p.sentAt!, clicks: p.stats?.clicks ?? 0 })),
  );
  const cats = new Map<string | null, CategoryRow>();
  for (const p of posts) {
    const key = p.categoryId ?? null;
    const row = cats.get(key) ?? {
      categoryId: key,
      name: p.category?.name ?? "Sans catégorie",
      color: p.category?.color ?? "#94a3b8",
      posts: 0,
      clicks: 0,
      clicksPerPost: 0,
    };
    row.posts += 1;
    row.clicks += p.stats?.clicks ?? 0;
    cats.set(key, row);
  }
  const categories = [...cats.values()]
    .map((r) => ({
      ...r,
      clicksPerPost: r.posts > 0 ? Math.round((r.clicks / r.posts) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.clicksPerPost - a.clicksPerPost);
  return { hours, categories };
}
