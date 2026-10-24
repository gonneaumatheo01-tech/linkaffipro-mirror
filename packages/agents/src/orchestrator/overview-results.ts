/**
 * Résultats des posts produits par les agents (supervision, phase 25) sur 7 et 28 jours : fiches `PostInsight`
 * (vues, clics, inscriptions, premiers dépôts : attribution existante de `PostStats`) et commissions comme dans
 * Statistiques (CPA nette des joueurs venus d'un clic sur le post : `PlayerEvent` CPA + / CPA_REVERSAL −, jamais la part
 * du revenu, jamais attribuée à un message). Posts du canal Test exclus (simulation). Lecture par lots.
 */
import type { Db } from "@linkaffipro/db";

export type ResultsWindow = "d7" | "d28";
export type PostResults = { posts: number; views: number; clicks: number; registrations: number; ftds: number; commissions: number };

const DAY = 86_400_000;
const BATCH = 500;

function chunks<T>(list: readonly T[], n = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

async function batched<T>(ids: readonly string[], fn: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunks(ids)) out.push(...(await fn(part)));
  return out;
}

/** Commission nette par post (CPA créditée − annulée), joueurs rattachés par leur clic. */
export async function commissionsByPost(prisma: Db, postIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!postIds.length) return out;
  const clicks = await batched(postIds, (part) =>
    prisma.click.findMany({ where: { postId: { in: part }, isBot: false }, select: { id: true, postId: true } }) as Promise<{ id: string; postId: string | null }[]>,
  );
  if (!clicks.length) return out;
  const postOfClick = new Map(clicks.map((c) => [c.id, c.postId]));
  const players = await batched([...postOfClick.keys()], (part) =>
    prisma.player.findMany({ where: { clickId: { in: part } }, select: { id: true, clickId: true } }) as Promise<{ id: string; clickId: string | null }[]>,
  );
  if (!players.length) return out;
  const postOfPlayer = new Map(players.map((p) => [p.id, p.clickId ? postOfClick.get(p.clickId) ?? null : null]));
  const events = await batched([...postOfPlayer.keys()], (part) =>
    prisma.playerEvent.findMany({
      where: { playerId: { in: part }, type: { in: ["CPA", "CPA_REVERSAL"] } },
      select: { playerId: true, amount: true },
    }) as Promise<{ playerId: string; amount: unknown }[]>,
  );
  for (const e of events) {
    const postId = postOfPlayer.get(e.playerId);
    const n = Number(e.amount ?? 0);
    if (postId && Number.isFinite(n)) out.set(postId, (out.get(postId) ?? 0) + n);
  }
  return out;
}

/** Résultats par équipe (clé = `AgentMission.teamKey`) et par fenêtre. */
export async function postResults(prisma: Db, now: Date): Promise<Record<string, Record<ResultsWindow, PostResults>>> {
  const since28 = new Date(now.getTime() - 28 * DAY);
  const since7 = new Date(now.getTime() - 7 * DAY);
  const insights = (await prisma.postInsight.findMany({
    where: { sentAt: { gte: since28 }, agentMissionId: { not: null } },
    select: { postId: true, channelId: true, sentAt: true, viewsFinal: true, clicks: true, registrations: true, ftds: true, agentMissionId: true },
  })) as { postId: string; channelId: string; sentAt: Date; viewsFinal: number; clicks: number; registrations: number; ftds: number; agentMissionId: string | null }[];
  if (!insights.length) return {};
  const missionIds = [...new Set(insights.map((i) => i.agentMissionId!))];
  const channelIds = [...new Set(insights.map((i) => i.channelId))];
  const [missions, testChannels] = await Promise.all([
    batched(missionIds, (part) => prisma.agentMission.findMany({ where: { id: { in: part } }, select: { id: true, teamKey: true } }) as Promise<{ id: string; teamKey: string }[]>),
    prisma.channel.findMany({ where: { id: { in: channelIds }, isTest: true }, select: { id: true } }) as Promise<{ id: string }[]>,
  ]);
  const teamOf = new Map(missions.map((m) => [m.id, m.teamKey]));
  const test = new Set(testChannels.map((c) => c.id));
  const kept = insights.filter((i) => !test.has(i.channelId) && teamOf.has(i.agentMissionId!));
  const commissions = await commissionsByPost(prisma, kept.map((i) => i.postId));
  const out: Record<string, Record<ResultsWindow, PostResults>> = {};
  const zero = (): PostResults => ({ posts: 0, views: 0, clicks: 0, registrations: 0, ftds: 0, commissions: 0 });
  for (const i of kept) {
    const team = teamOf.get(i.agentMissionId!)!;
    out[team] ??= { d7: zero(), d28: zero() };
    const windows: ResultsWindow[] = i.sentAt.getTime() >= since7.getTime() ? ["d7", "d28"] : ["d28"];
    for (const w of windows) {
      const r = out[team]![w];
      r.posts++;
      r.views += i.viewsFinal;
      r.clicks += i.clicks;
      r.registrations += i.registrations;
      r.ftds += i.ftds;
      r.commissions = Math.round((r.commissions + (commissions.get(i.postId) ?? 0)) * 100) / 100;
    }
  }
  return out;
}
