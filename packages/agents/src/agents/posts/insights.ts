/**
 * Fiches de résultats des posts (`PostInsight`, agent Posts) : chaque post envoyé des 90 derniers jours la première
 * fois, puis au fil de l'eau (posts des 8 derniers jours, dont les vues et l'attribution bougent encore, et posts sans
 * fiche). Chiffres depuis `PostStats` (clics, inscriptions, dépôts : attribution existante) et `PostViewSample`.
 * Requêtes à plat, par lots (jamais les octets des médias).
 */
import type { AgentsDeps } from "../../types";
import { nowOf } from "../../admin/journal";
import { parsePayload } from "../../missions/mission";
import { countEmojis, hasButtons, parisHourDay, postFormat, viewsAt, visibleLength, type AssetInfo } from "./features";
import type { InsightRow } from "./rank";

export const INSIGHT_HISTORY_DAYS = 90;
/** Posts encore « vivants » : recalculés à chaque passage. */
export const INSIGHT_REFRESH_DAYS = 8;
const DAY = 86_400_000;
const BATCH = 200;

type PostRow = {
  id: string;
  channelId: string;
  sentAt: Date | null;
  text: string;
  mediaAssetIds: unknown;
  buttons: unknown;
  categoryId: string | null;
  vertical: string | null;
  abGroupId: string | null;
  abVariant: string | null;
  agentMissionId: string | null;
};

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

function chunks<T>(list: readonly T[], n = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Test A/B d'une mission (`payload.experiment`), ou d'un groupe A/B `exp_<id>`. */
export function experimentOf(payload: Record<string, unknown>, abGroupId: string | null): string | null {
  const e = payload.experiment as { id?: unknown } | undefined;
  if (e && typeof e.id === "string") return e.id;
  return abGroupId?.startsWith("exp_") ? abGroupId.slice(4) : null;
}

export async function computePostInsights(
  deps: AgentsDeps,
  opts: { full?: boolean; days?: number } = {},
): Promise<{ computed: number; considered: number }> {
  const now = nowOf(deps);
  const since = new Date(now.getTime() - (opts.days ?? INSIGHT_HISTORY_DAYS) * DAY);
  const fresh = new Date(now.getTime() - INSIGHT_REFRESH_DAYS * DAY);
  const all = (await deps.prisma.post.findMany({
    where: { status: "SENT", isTemplate: false, sentAt: { gte: since } },
    select: { id: true, sentAt: true },
  })) as Array<{ id: string; sentAt: Date | null }>;
  let todo = all;
  if (!opts.full && all.length) {
    const have = new Set(
      (
        (await deps.prisma.postInsight.findMany({
          where: { sentAt: { gte: since } },
          select: { postId: true },
        })) as Array<{ postId: string }>
      ).map((r) => r.postId),
    );
    todo = all.filter((p) => !have.has(p.id) || (p.sentAt && p.sentAt >= fresh));
  }
  let computed = 0;
  for (const part of chunks(todo.map((p) => p.id))) computed += await computeBatch(deps, part, now);
  return { computed, considered: all.length };
}

async function computeBatch(deps: AgentsDeps, postIds: string[], now: Date): Promise<number> {
  const { prisma } = deps;
  const posts = (await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: {
      id: true,
      channelId: true,
      sentAt: true,
      text: true,
      mediaAssetIds: true,
      buttons: true,
      categoryId: true,
      vertical: true,
      abGroupId: true,
      abVariant: true,
      agentMissionId: true,
    },
  })) as unknown as PostRow[];
  if (!posts.length) return 0;
  const assetIds = [...new Set(posts.flatMap((p) => ids(p.mediaAssetIds)))];
  const missionIds = [...new Set(posts.map((p) => p.agentMissionId).filter((x): x is string => !!x))];
  const categoryIds = [...new Set(posts.map((p) => p.categoryId).filter((x): x is string => !!x))];
  const channelIds = [...new Set(posts.map((p) => p.channelId))];
  const [stats, samples, assets, missions, categories, channels] = await Promise.all([
    prisma.postStats.findMany({ where: { postId: { in: postIds } } }),
    prisma.postViewSample.findMany({ where: { postId: { in: postIds } }, select: { postId: true, at: true, views: true } }),
    assetIds.length ? prisma.mediaAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, mimeType: true, kind: true } }) : [],
    missionIds.length ? prisma.agentMission.findMany({ where: { id: { in: missionIds } }, select: { id: true, payload: true, channelId: true } }) : [],
    categoryIds.length ? prisma.messageCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }) : [],
    prisma.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, vertical: true } }),
  ]);
  const missionList = missions as Array<{ id: string; payload: unknown; channelId: string | null }>;
  // Persona du plan : canal VISÉ par la mission (le canal Test en simulation n'a pas de plan).
  const planChannels = [...new Set([...channelIds, ...missionList.map((m) => m.channelId).filter((x): x is string => !!x)])];
  const plans = (await prisma.channelAgentPlan.findMany({
    where: { channelId: { in: planChannels } },
    select: { channelId: true, personaId: true },
  })) as Array<{ channelId: string; personaId: string | null }>;
  const statsBy = new Map((stats as Array<Record<string, unknown> & { postId: string }>).map((s) => [s.postId, s]));
  const samplesBy = new Map<string, { at: Date; views: number }[]>();
  for (const s of samples as Array<{ postId: string; at: Date; views: number }>)
    samplesBy.set(s.postId, [...(samplesBy.get(s.postId) ?? []), { at: s.at, views: s.views }]);
  const assetsBy = new Map((assets as AssetInfo[]).map((a) => [a.id, a]));
  const missionBy = new Map(missionList.map((m) => [m.id, m]));
  const categoryBy = new Map((categories as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const verticalBy = new Map((channels as Array<{ id: string; vertical: string | null }>).map((c) => [c.id, c.vertical]));
  const personaBy = new Map(plans.map((p) => [p.channelId, p.personaId]));

  let n = 0;
  for (const p of posts) {
    if (!p.sentAt) continue;
    const s: Record<string, unknown> = statsBy.get(p.id) ?? {};
    const mission = p.agentMissionId ? missionBy.get(p.agentMissionId) : undefined;
    const payload = mission ? (parsePayload(mission.payload) as Record<string, unknown>) : {};
    const sm = samplesBy.get(p.id) ?? [];
    const { hour, weekday } = parisHourDay(p.sentAt);
    const media = ids(p.mediaAssetIds);
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
    const lastSample = sm.reduce<number | null>((m, x) => (m === null || x.views > m ? x.views : m), null);
    const data = {
      channelId: p.channelId,
      vertical: p.vertical ?? verticalBy.get(p.channelId) ?? null,
      sentAt: p.sentAt,
      views1h: viewsAt(p.sentAt, sm, 1),
      views2h: viewsAt(p.sentAt, sm, 2),
      views24h: viewsAt(p.sentAt, sm, 24),
      viewsFinal: Math.max(int(s.views), lastSample ?? 0),
      forwards: int(s.forwards),
      reactions: int(s.reactionsTotal),
      clicks: int(s.clicks),
      offerClicks: int(s.offerClicks),
      registrations: int(s.registrations),
      ftds: int(s.ftds),
      deposits: int(s.deposits),
      format: postFormat(media, assetsBy),
      theme: str(payload.theme) ?? (p.categoryId ? (categoryBy.get(p.categoryId) ?? null) : null),
      categoryId: p.categoryId,
      personaId: str(payload.personaId) ?? personaBy.get(mission?.channelId ?? p.channelId) ?? null,
      textLength: visibleLength(p.text),
      emojiCount: countEmojis(p.text),
      hasButtons: hasButtons(p.buttons),
      hourParis: hour,
      weekdayParis: weekday,
      abGroupId: p.abGroupId,
      abVariant: p.abVariant,
      agentMissionId: p.agentMissionId,
      model: str(payload.model),
      experimentId: experimentOf(payload, p.abGroupId),
      // Phase 23 : résultat du pari publié (réglé par la tâche `settle`), jamais effacé par un recalcul.
      ...(str(payload.betResult) ? { betResult: str(payload.betResult) } : {}),
      computedAt: now,
    };
    await prisma.postInsight.upsert({ where: { postId: p.id }, create: { postId: p.id, ...data }, update: data });
    n++;
  }
  return n;
}

/** Fiches d'une période (pour les classements, les horaires et les tests). */
export async function loadInsightRows(
  deps: Pick<AgentsDeps, "prisma">,
  opts: { since: Date; until?: Date; channelIds?: string[] },
): Promise<InsightRow[]> {
  const rows = await deps.prisma.postInsight.findMany({
    where: {
      sentAt: { gte: opts.since, ...(opts.until ? { lt: opts.until } : {}) },
      ...(opts.channelIds ? { channelId: { in: opts.channelIds } } : {}),
    },
  });
  return rows as unknown as InsightRow[];
}
