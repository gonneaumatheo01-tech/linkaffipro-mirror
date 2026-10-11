import { prisma } from "@linkaffipro/db";
import { linkAffiTableLabel } from "@linkaffipro/core";
import { dayKey } from "../stats/aggregate";
import { EMPTY_METRICS, type NamedMetrics, type ReportData, type ReportMetrics } from "./format";
import { describeBackup, type BackupStatus } from "../backups/plan";
import { BACKUP_SETTING_KEY } from "../backups/run";

/** Date UTC minuit correspondant à une clé AAAA-MM-JJ (format de stockage de `DailyStat.date`). */
export function utcDateOf(key: string): Date {
  return new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))));
}

/** Clé de jour décalée de `delta` jours. */
export function shiftKey(key: string, delta: number): string {
  const d = utcDateOf(key);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

type Row = { dimension: string; requests: number; approved: number; joined: number; left: number; entryClicks: number; offerClicks: number; registrations: number; ftds: number; deposits: number; depositAmount: unknown; ngr: unknown; spend: unknown; commissions: unknown };

function add(acc: ReportMetrics, r: Row): ReportMetrics {
  return {
    requests: acc.requests + r.requests,
    approved: acc.approved + r.approved,
    joined: acc.joined + r.joined,
    left: acc.left + r.left,
    entryClicks: acc.entryClicks + r.entryClicks,
    offerClicks: acc.offerClicks + r.offerClicks,
    registrations: acc.registrations + r.registrations,
    ftds: acc.ftds + r.ftds,
    deposits: acc.deposits + r.deposits,
    depositAmount: acc.depositAmount + Number(r.depositAmount ?? 0),
    ngr: acc.ngr + Number(r.ngr ?? 0),
    spend: acc.spend + Number(r.spend ?? 0),
    commissions: Math.round((acc.commissions + Number(r.commissions ?? 0)) * 100) / 100,
  };
}

/** Somme des lignes `DailyStat` par dimension entre deux clés incluses. */
async function sumByDimension(fromKey: string, toKey: string, prefix: string): Promise<Map<string, ReportMetrics>> {
  const rows = await prisma.dailyStat.findMany({
    where: { date: { gte: utcDateOf(fromKey), lte: utcDateOf(toKey) }, dimension: prefix === "all" ? "all" : { startsWith: prefix } },
    select: { dimension: true, requests: true, approved: true, joined: true, left: true, entryClicks: true, offerClicks: true, registrations: true, ftds: true, deposits: true, depositAmount: true, ngr: true, spend: true, commissions: true },
  });
  const out = new Map<string, ReportMetrics>();
  for (const r of rows) out.set(r.dimension, add(out.get(r.dimension) ?? EMPTY_METRICS, r));
  return out;
}

function score(m: ReportMetrics): number {
  return m.ftds * 100 + m.registrations * 10 + m.approved + m.offerClicks * 0.1;
}

/** Une ligne du top mérite d'être citée : de l'activité, de la dépense ou des commissions. */
function worthShowing(m: ReportMetrics): boolean {
  return score(m) > 0 || m.spend > 0 || m.commissions !== 0;
}

async function topNamed(fromKey: string, toKey: string, prefix: "campaign:" | "channel:", limit = 5): Promise<NamedMetrics[]> {
  const sums = await sumByDimension(fromKey, toKey, prefix);
  const entries = [...sums.entries()].filter(([, m]) => worthShowing(m)).sort((a, b) => score(b[1]) - score(a[1])).slice(0, limit);
  if (entries.length === 0) return [];
  const ids = entries.map(([dim]) => dim.slice(prefix.length));
  const names = new Map<string, string>();
  if (prefix === "campaign:") for (const c of await prisma.campaign.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names.set(c.id, c.name);
  else for (const c of await prisma.channel.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })) names.set(c.id, c.title);
  return entries.map(([dim, m]) => ({ ...m, name: names.get(dim.slice(prefix.length)) ?? dim }));
}

async function statusBlock(now: Date): Promise<Pick<ReportData, "openAlerts" | "sync" | "upcomingPosts" | "backup">> {
  const [alerts, states, posts, backupSetting] = await Promise.all([
    prisma.alert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: { kind: true, message: true } }),
    prisma.syncState.findMany({ select: { source: true, lastSuccessAt: true, lastError: true } }),
    prisma.post.findMany({ where: { status: "SCHEDULED", scheduledAt: { gte: now, lte: new Date(now.getTime() + 86_400_000) } }, orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true, channel: { select: { title: true } } } }),
    prisma.setting.findUnique({ where: { key: BACKUP_SETTING_KEY } }),
  ]);
  const backup = describeBackup(backupSetting && backupSetting.value && typeof backupSetting.value === "object" ? (backupSetting.value as BackupStatus) : null);
  const lastSuccessAt = states.reduce<Date | null>((acc, s) => (s.lastSuccessAt && (!acc || s.lastSuccessAt > acc) ? s.lastSuccessAt : acc), null);
  const errors = states.filter((s) => s.lastError).map((s) => `${linkAffiTableLabel(s.source)} : ${s.lastError}`).slice(0, 3);
  return { openAlerts: alerts, sync: { lastSuccessAt, errors }, backup, upcomingPosts: posts.map((p) => ({ channel: p.channel.title, scheduledAt: p.scheduledAt ?? now })) };
}

const dayLabel = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortLabel = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

/** Données du brief quotidien : la veille (Paris) comparée à l'avant-veille. */
export async function buildDailyData(now: Date = new Date()): Promise<ReportData> {
  const today = dayKey(now);
  const yesterday = shiftKey(today, -1);
  const before = shiftKey(today, -2);
  const [cur, prev, topCampaigns, topChannels, status] = await Promise.all([
    sumByDimension(yesterday, yesterday, "all"),
    sumByDimension(before, before, "all"),
    topNamed(yesterday, yesterday, "campaign:"),
    topNamed(yesterday, yesterday, "channel:"),
    statusBlock(now),
  ]);
  return { periodLabel: dayLabel.format(utcDateOf(yesterday)), current: cur.get("all") ?? EMPTY_METRICS, previous: prev.get("all") ?? EMPTY_METRICS, topCampaigns, topChannels, ...status };
}

/** Données du rapport hebdomadaire : les 7 derniers jours révolus comparés aux 7 précédents. */
export async function buildWeeklyData(now: Date = new Date()): Promise<ReportData> {
  const today = dayKey(now);
  const to = shiftKey(today, -1);
  const from = shiftKey(today, -7);
  const prevTo = shiftKey(today, -8);
  const prevFrom = shiftKey(today, -14);
  const [cur, prev, topCampaigns, topChannels, status] = await Promise.all([
    sumByDimension(from, to, "all"),
    sumByDimension(prevFrom, prevTo, "all"),
    topNamed(from, to, "campaign:"),
    topNamed(from, to, "channel:"),
    statusBlock(now),
  ]);
  return { periodLabel: `semaine du ${shortLabel.format(utcDateOf(from))} au ${shortLabel.format(utcDateOf(to))}`, current: cur.get("all") ?? EMPTY_METRICS, previous: prev.get("all") ?? EMPTY_METRICS, topCampaigns, topChannels, ...status };
}
