import { prisma, type Vertical } from "@linkaffipro/db";
import { dayKeys, rangeDays, type Range } from "./aggregate";
import { EMPTY_TOTALS, addTotals, bestHours, cohorts, derive, deltaPct, funnel, type CohortRow, type Derived, type FunnelStep, type HourRow, type StatTotals } from "./metrics";

function dateOf(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

/** Bornes (jours civils) de la période courante et de la précédente, de même longueur. */
export function periodKeys(range: Range, now = new Date()): { current: string[]; previous: string[] } {
  const n = rangeDays(range);
  const current = dayKeys(n, now);
  const previous = dayKeys(n, new Date(now.getTime() - n * 86_400_000));
  return { current, previous };
}

async function sumDimension(dimensions: string[], keys: string[]): Promise<Map<string, StatTotals>> {
  if (dimensions.length === 0 || keys.length === 0) return new Map();
  const rows = await prisma.dailyStat.findMany({
    where: { dimension: { in: dimensions }, date: { gte: dateOf(keys[0]!), lte: dateOf(keys[keys.length - 1]!) } },
    select: { dimension: true, requests: true, approved: true, joined: true, left: true, entryClicks: true, offerClicks: true, registrations: true, ftds: true, deposits: true, depositAmount: true, ngr: true, spend: true },
  });
  const out = new Map<string, StatTotals>();
  for (const r of rows) {
    const prev = out.get(r.dimension) ?? EMPTY_TOTALS;
    out.set(r.dimension, addTotals(prev, { ...r, depositAmount: Number(r.depositAmount), ngr: Number(r.ngr), spend: Number(r.spend) }));
  }
  return out;
}

export type AdsRow = { campaignId: string; name: string; platform: string | null; vertical: Vertical | null; status: string; totals: StatTotals; derived: Derived; previous: StatTotals; deltas: Partial<Record<keyof StatTotals, number | null>> };

/** Tableau par pub (campagne) sur la période, avec la période précédente et les deltas. */
export async function loadAdsTable(range: Range, filters: { vertical?: Vertical | "" } = {}, now = new Date()): Promise<{ rows: AdsRow[]; total: StatTotals; totalDerived: Derived; lastComputedAt: Date | null }> {
  const { current, previous } = periodKeys(range, now);
  const campaigns = await prisma.campaign.findMany({ where: filters.vertical ? { vertical: filters.vertical } : {}, orderBy: { name: "asc" }, select: { id: true, name: true, adPlatform: true, vertical: true, status: true } });
  const dims = campaigns.map((c) => `campaign:${c.id}`);
  const [cur, prev, last] = await Promise.all([sumDimension(dims, current), sumDimension(dims, previous), prisma.dailyStat.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } })]);
  const rows: AdsRow[] = campaigns.map((c) => {
    const totals = cur.get(`campaign:${c.id}`) ?? EMPTY_TOTALS;
    const previousTotals = prev.get(`campaign:${c.id}`) ?? EMPTY_TOTALS;
    const deltas: AdsRow["deltas"] = {};
    for (const k of Object.keys(EMPTY_TOTALS) as (keyof StatTotals)[]) deltas[k] = deltaPct(totals[k], previousTotals[k]);
    return { campaignId: c.id, name: c.name, platform: c.adPlatform, vertical: c.vertical, status: c.status, totals, derived: derive(totals), previous: previousTotals, deltas };
  });
  const total = rows.reduce((acc, r) => addTotals(acc, r.totals), EMPTY_TOTALS);
  return { rows, total, totalDerived: derive(total), lastComputedAt: last?.updatedAt ?? null };
}

/** Totaux d'une dimension sur la période (pour l'entonnoir). */
export async function loadTotals(dimension: string, range: Range, now = new Date()): Promise<StatTotals> {
  const { current } = periodKeys(range, now);
  return (await sumDimension([dimension], current)).get(dimension) ?? EMPTY_TOTALS;
}

export async function loadFunnel(dimension: string, range: Range, now = new Date()): Promise<{ totals: StatTotals; steps: FunnelStep[] }> {
  const totals = await loadTotals(dimension, range, now);
  return { totals, steps: funnel(totals) };
}

export type ChannelDaily = { channelId: string; title: string; keys: string[]; net: number[]; joined: number; left: number; requests: number };

/** Croissance nette par jour et par canal (joined − left), depuis `DailyStat`. */
export async function loadChannelGrowth(range: Range, channelId: string | "", now = new Date()): Promise<ChannelDaily[]> {
  const { current } = periodKeys(range, now);
  const channels = await prisma.channel.findMany({ where: { isActive: true, ...(channelId ? { id: channelId } : {}) }, orderBy: { title: "asc" }, select: { id: true, title: true } });
  if (channels.length === 0) return [];
  const rows = await prisma.dailyStat.findMany({ where: { dimension: { in: channels.map((c) => `channel:${c.id}`) }, date: { gte: dateOf(current[0]!), lte: dateOf(current[current.length - 1]!) } }, select: { dimension: true, date: true, joined: true, left: true, requests: true } });
  return channels.map((c) => {
    const mine = rows.filter((r) => r.dimension === `channel:${c.id}`);
    const byDay = new Map(mine.map((r) => [r.date.toISOString().slice(0, 10), r]));
    const net = current.map((k) => { const r = byDay.get(k); return r ? r.joined - r.left : 0; });
    return { channelId: c.id, title: c.title, keys: current, net, joined: mine.reduce((a, r) => a + r.joined, 0), left: mine.reduce((a, r) => a + r.left, 0), requests: mine.reduce((a, r) => a + r.requests, 0) };
  });
}

/** Cohortes par semaine d'arrivée (première demande d'adhésion), depuis les tables sources. */
export async function loadCohorts(weeks = 12, now = new Date()): Promise<CohortRow[]> {
  const since = new Date(now.getTime() - weeks * 7 * 86_400_000);
  const firstRequests = await prisma.membership.groupBy({ by: ["memberId"], where: { requestedAt: { gte: since } }, _min: { requestedAt: true } });
  const memberIds = firstRequests.map((m) => m.memberId);
  if (memberIds.length === 0) return [];
  const players = await prisma.player.findMany({ where: { memberId: { in: memberIds } }, select: { memberId: true, registeredAt: true, ftdAt: true, ngr: true, events: { where: { type: { in: ["FTD", "DEPOSIT", "REDEPOSIT"] } }, select: { occurredAt: true, amount: true } } } });
  const byMember = new Map<string, typeof players>();
  for (const p of players) {
    const list = byMember.get(p.memberId!) ?? [];
    list.push(p);
    byMember.set(p.memberId!, list);
  }
  return cohorts(
    firstRequests.map((m) => {
      const ps = byMember.get(m.memberId) ?? [];
      const registeredAt = ps.map((p) => p.registeredAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const ftdAt = ps.map((p) => p.ftdAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      return { memberId: m.memberId, arrivedAt: m._min.requestedAt!, registeredAt, ftdAt, deposits: ps.flatMap((p) => p.events.map((e) => ({ at: e.occurredAt, amount: Number(e.amount ?? 0) }))), ngr: ps.reduce((a, p) => a + Number(p.ngr), 0) };
    }),
  );
}

export type CategoryRow = { categoryId: string | null; name: string; color: string; posts: number; clicks: number; clicksPerPost: number };

/** Meilleurs horaires et meilleures catégories sur les messages envoyés de la période. */
export async function loadBestTimes(range: Range, channelId: string | "", now = new Date()): Promise<{ hours: HourRow[]; categories: CategoryRow[] }> {
  const since = new Date(now.getTime() - rangeDays(range) * 86_400_000);
  const posts = await prisma.post.findMany({ where: { status: "SENT", sentAt: { gte: since }, ...(channelId ? { channelId } : {}) }, select: { sentAt: true, categoryId: true, category: { select: { name: true, color: true } }, stats: { select: { clicks: true } } } });
  const hours = bestHours(posts.filter((p) => p.sentAt).map((p) => ({ sentAt: p.sentAt!, clicks: p.stats?.clicks ?? 0 })));
  const cats = new Map<string | null, CategoryRow>();
  for (const p of posts) {
    const key = p.categoryId ?? null;
    const row = cats.get(key) ?? { categoryId: key, name: p.category?.name ?? "Sans catégorie", color: p.category?.color ?? "#94a3b8", posts: 0, clicks: 0, clicksPerPost: 0 };
    row.posts += 1;
    row.clicks += p.stats?.clicks ?? 0;
    cats.set(key, row);
  }
  const categories = [...cats.values()].map((r) => ({ ...r, clicksPerPost: r.posts > 0 ? Math.round((r.clicks / r.posts) * 100) / 100 : 0 })).sort((a, b) => b.clicksPerPost - a.clicksPerPost);
  return { hours, categories };
}
