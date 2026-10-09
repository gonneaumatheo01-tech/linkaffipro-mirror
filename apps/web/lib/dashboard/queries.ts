import { prisma, type Vertical } from "@linkaffipro/db";
import { periodDayKeys, periodEnd, periodStart, type Period } from "@/lib/periods";
import { aggregateByDay, type DaySeries } from "./aggregate";
import { cachedDashboard } from "./cache";

export type DashboardFilters = { period: Period; vertical: Vertical | ""; channelId: string };

export type Metric = { key: string; label: string; series: DaySeries; money?: boolean };

export type ChannelRow = { channelId: string; title: string; requests: number; approved: number; joined: number; left: number; offerClicks: number; registrations: number; ftds: number; depositAmount: number };

export type DashboardData = { metrics: Metric[]; channels: ChannelRow[]; keys: string[] };

/** Indicateurs du tableau de bord, mis en cache 60 s par période et filtres (voir ./cache.ts). */
export const loadDashboard: (f: DashboardFilters) => Promise<DashboardData> = cachedDashboard("overview", (f: DashboardFilters) => loadDashboardUncached(f));

/** Indicateurs du tableau de bord sur la période choisie (requêtes agrégées, bornées par la période), sans cache. */
export async function loadDashboardUncached(f: DashboardFilters): Promise<DashboardData> {
  const start = periodStart(f.period);
  const end = periodEnd(f.period);
  const keys = periodDayKeys(f.period);
  const within = { gte: start, lt: end };
  const channelWhere = { ...(f.channelId ? { id: f.channelId } : {}), ...(f.vertical ? { vertical: f.vertical } : {}) };
  const channels = await prisma.channel.findMany({ where: { isActive: true, ...channelWhere }, select: { id: true, title: true }, orderBy: { title: "asc" } });
  const channelIds = channels.map((c) => c.id);
  const byChannel = f.channelId || f.vertical ? { channelId: { in: channelIds } } : {};

  const [requested, approved, joined, left, entryClicks, offerClicks, registrations, ftds, deposits, ngrPlayers] = await Promise.all([
    prisma.membership.findMany({ where: { requestedAt: within, ...byChannel }, select: { requestedAt: true, channelId: true } }),
    prisma.membership.findMany({ where: { approvedAt: within, ...byChannel }, select: { approvedAt: true, channelId: true } }),
    prisma.membership.findMany({ where: { joinedAt: within, ...byChannel }, select: { joinedAt: true, channelId: true } }),
    prisma.membership.findMany({ where: { leftAt: within, ...byChannel }, select: { leftAt: true, channelId: true } }),
    prisma.click.findMany({ where: { createdAt: within, isBot: false, trackingLink: { kind: "AD_ENTRY", ...(channelIds.length && (f.channelId || f.vertical) ? { channelId: { in: channelIds } } : {}) } }, select: { createdAt: true } }),
    prisma.click.findMany({ where: { createdAt: within, isBot: false, subId: { not: null }, ...(f.channelId || f.vertical ? { post: { channelId: { in: channelIds } } } : {}) }, select: { createdAt: true, post: { select: { channelId: true } } } }),
    prisma.playerEvent.findMany({ where: { type: "REGISTRATION", occurredAt: within, ...(f.channelId || f.vertical ? { player: { click: { post: { channelId: { in: channelIds } } } } } : {}) }, select: { occurredAt: true, player: { select: { click: { select: { post: { select: { channelId: true } } } } } } } }),
    prisma.playerEvent.findMany({ where: { type: "FTD", occurredAt: within, ...(f.channelId || f.vertical ? { player: { click: { post: { channelId: { in: channelIds } } } } } : {}) }, select: { occurredAt: true, amount: true, player: { select: { click: { select: { post: { select: { channelId: true } } } } } } } }),
    prisma.playerEvent.findMany({ where: { type: { in: ["FTD", "DEPOSIT", "REDEPOSIT"] }, occurredAt: within, ...(f.channelId || f.vertical ? { player: { click: { post: { channelId: { in: channelIds } } } } } : {}) }, select: { occurredAt: true, amount: true, player: { select: { click: { select: { post: { select: { channelId: true } } } } } } } }),
    prisma.player.findMany({ where: { lastEventAt: within, ...(f.channelId || f.vertical ? { click: { post: { channelId: { in: channelIds } } } } : {}) }, select: { ngr: true, updatedAt: true } }),
  ]);

  const metrics: Metric[] = [
    { key: "requests", label: "Demandes", series: aggregateByDay(requested.map((m) => m.requestedAt), keys) },
    { key: "approved", label: "Acceptés", series: aggregateByDay(approved.map((m) => m.approvedAt!), keys) },
    { key: "joined", label: "Entrées", series: aggregateByDay(joined.map((m) => m.joinedAt!), keys) },
    { key: "left", label: "Départs", series: aggregateByDay(left.map((m) => m.leftAt!), keys) },
    { key: "entryClicks", label: "Clics entrée", series: aggregateByDay(entryClicks.map((c) => c.createdAt), keys) },
    { key: "offerClicks", label: "Clics offres", series: aggregateByDay(offerClicks.map((c) => c.createdAt), keys) },
    { key: "registrations", label: "Inscriptions", series: aggregateByDay(registrations.map((e) => e.occurredAt), keys) },
    { key: "ftds", label: "FTD", series: aggregateByDay(ftds.map((e) => e.occurredAt), keys) },
    { key: "deposits", label: "Dépôts (nombre)", series: aggregateByDay(deposits.map((e) => e.occurredAt), keys) },
    { key: "depositAmount", label: "Dépôts (€)", money: true, series: aggregateByDay(deposits.map((e) => ({ at: e.occurredAt, value: Number(e.amount ?? 0) })), keys) },
    { key: "ngr", label: "NGR (€)", money: true, series: aggregateByDay(ngrPlayers.map((p) => ({ at: p.updatedAt, value: Number(p.ngr) })), keys) },
  ];

  const rows = new Map<string, ChannelRow>(channels.map((c) => [c.id, { channelId: c.id, title: c.title, requests: 0, approved: 0, joined: 0, left: 0, offerClicks: 0, registrations: 0, ftds: 0, depositAmount: 0 }]));
  const bump = (id: string | null | undefined, k: keyof Omit<ChannelRow, "channelId" | "title">, v = 1) => {
    if (!id) return;
    const r = rows.get(id);
    if (r) r[k] += v;
  };
  for (const m of requested) bump(m.channelId, "requests");
  for (const m of approved) bump(m.channelId, "approved");
  for (const m of joined) bump(m.channelId, "joined");
  for (const m of left) bump(m.channelId, "left");
  for (const c of offerClicks) bump(c.post?.channelId, "offerClicks");
  for (const e of registrations) bump(e.player.click?.post?.channelId, "registrations");
  for (const e of ftds) bump(e.player.click?.post?.channelId, "ftds");
  for (const e of deposits) bump(e.player.click?.post?.channelId, "depositAmount", Number(e.amount ?? 0));

  return { metrics, channels: [...rows.values()].filter((r) => r.requests || r.approved || r.joined || r.offerClicks || r.registrations || r.ftds || r.depositAmount || f.channelId), keys };
}
