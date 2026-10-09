import type { Job } from "bullmq";
import { prisma } from "@linkaffipro/db";
import { logger } from "../logger";
import { recomputeDailyStats } from "../stats/daily";
import { recomputeBestHours } from "../stats/best-hours";
import { runReports } from "../reports/send";

/**
 * File `stats` : recalculs idempotents des compteurs dénormalisés à partir des tables de détail.
 * - `{type:"tick"}` toutes les 10 minutes : tous les posts récents, liens traqués, liens d'invitation ;
 * - `{type:"post-stats", postId}` : un seul post ;
 * - `{type:"daily", days?, full?}` toutes les heures : lignes `DailyStat` des N derniers jours (ou tout si `full`) ;
 * - `{type:"reports", force?}` toutes les 10 minutes : brief quotidien et rapport hebdomadaire Telegram s'ils sont dus ;
 * - `{type:"best-hours"}` toutes les 24 h (ou à la demande depuis la fiche canal) : meilleurs horaires par canal et catégorie.
 */
export async function processStats(job: Job): Promise<unknown> {
  const data = job.data as { type?: string; postId?: string; days?: number; full?: boolean; force?: "daily" | "weekly" };
  if (data.type === "best-hours") {
    const r = await recomputeBestHours();
    return { ok: true, ...r };
  }
  if (data.type === "reports") {
    const r = await runReports(data.force);
    return { ok: true, ...r };
  }
  if (data.type === "daily") {
    const r = await recomputeDailyStats({ days: data.days, full: data.full });
    return { ok: true, ...r };
  }
  if (data.type === "post-stats" && data.postId) {
    await recomputePostStats([data.postId]);
    return { ok: true, posts: 1 };
  }
  const since = new Date(Date.now() - 90 * 86_400_000);
  const posts = await prisma.post.findMany({ where: { OR: [{ sentAt: { gte: since } }, { clicks: { some: { createdAt: { gte: since } } } }] }, select: { id: true } });
  const [p, t, i] = await Promise.all([recomputePostStats(posts.map((x) => x.id)), recomputeTrackingLinks(), recomputeInviteLinks()]);
  logger.info({ posts: p, trackingLinks: t, inviteLinks: i }, "stats recalculées");
  return { ok: true, posts: p, trackingLinks: t, inviteLinks: i };
}

export const repeatableStats: Array<{ data: Record<string, unknown>; everyMs: number; jobId: string }> = [
  { data: { type: "tick" }, everyMs: 10 * 60_000, jobId: "stats-tick" },
  { data: { type: "daily", days: 3 }, everyMs: 3_600_000, jobId: "stats-daily" },
  { data: { type: "reports" }, everyMs: 10 * 60_000, jobId: "stats-reports" },
  { data: { type: "best-hours" }, everyMs: 24 * 3_600_000, jobId: "stats-best-hours" },
];

/** Clics, cliqueurs uniques et clics offres par post, depuis `Click` (robots exclus). */
export async function recomputePostStats(postIds: string[]): Promise<number> {
  let n = 0;
  for (const postId of postIds) {
    const clicks = await prisma.click.findMany({ where: { postId, isBot: false }, select: { memberId: true, ipHash: true, subId: true } });
    const uniq = new Set(clicks.map((c) => c.memberId ?? `ip:${c.ipHash ?? ""}`));
    const offerClicks = clicks.filter((c) => c.subId).length;
    await prisma.postStats.upsert({
      where: { postId },
      create: { postId, clicks: clicks.length, uniqueClickers: uniq.size, offerClicks },
      update: { clicks: clicks.length, uniqueClickers: uniq.size, offerClicks },
    });
    n++;
  }
  return n;
}

/** `TrackingLink.clicks` / `uniqueClicks` depuis les clics humains. */
export async function recomputeTrackingLinks(): Promise<number> {
  const grouped = await prisma.click.groupBy({ by: ["trackingLinkId"], where: { isBot: false }, _count: { _all: true } });
  const links = await prisma.trackingLink.findMany({ select: { id: true } });
  const counts = new Map(grouped.map((g) => [g.trackingLinkId, g._count._all]));
  let n = 0;
  for (const link of links) {
    const total = counts.get(link.id) ?? 0;
    const uniq = total === 0 ? 0 : (await prisma.click.findMany({ where: { trackingLinkId: link.id, isBot: false }, select: { memberId: true, ipHash: true, userAgent: true }, distinct: ["memberId", "ipHash", "userAgent"] })).length;
    await prisma.trackingLink.update({ where: { id: link.id }, data: { clicks: total, uniqueClicks: uniq } });
    n++;
  }
  return n;
}

/** `InviteLink.requests / approved / joined / left` depuis `Membership`. */
export async function recomputeInviteLinks(): Promise<number> {
  const links = await prisma.inviteLink.findMany({ select: { id: true } });
  let n = 0;
  for (const link of links) {
    const [requests, approved, joined, left] = await Promise.all([
      prisma.membership.count({ where: { inviteLinkId: link.id } }),
      prisma.membership.count({ where: { inviteLinkId: link.id, approvedAt: { not: null } } }),
      prisma.membership.count({ where: { inviteLinkId: link.id, joinedAt: { not: null } } }),
      prisma.membership.count({ where: { inviteLinkId: link.id, status: { in: ["LEFT", "KICKED"] } } }),
    ]);
    await prisma.inviteLink.update({ where: { id: link.id }, data: { requests, approved, joined, left } });
    n++;
  }
  return n;
}
