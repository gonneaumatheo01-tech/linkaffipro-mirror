/**
 * Agent Horaires (équipe Algorithme, sans IA), seule source des meilleurs horaires depuis la phase 21 :
 * - `Setting` `besthours.<channelId>` au format historique (8 semaines, par catégorie) + `source: "algo"` et `windows` ;
 *   `besthours.updatedAt` et `besthours.source` = "algo" ;
 * - fenêtres conseillées par canal, jour et type de post dans `ChannelAgentPlan.suggestedWindows` (plans existants).
 * Les heures de relance des personas sont proposées par l'agent Conversations (chantier B), pas ici.
 */
import type { AgentDefinition, AgentsDeps } from "../../types";
import { nowOf, writeSetting } from "../../admin/journal";
import { loadAlgoTeam } from "../../algo/settings";
import { loadInsightRows } from "../posts/insights";
import type { InsightRow } from "../posts/rank";
import { BEST_HOURS_WEEKS, buildBestHours, type BestHoursPost } from "./besthours";
import { buildChannelWindows, suggestedWindowsJson, type ChannelWindows } from "./windows";

export const BEST_HOURS_SOURCE_KEY = "besthours.source";
export const BEST_HOURS_SOURCE = "algo";

export type HorairesResult = { channels: number; posts: number; plans: number; windows: Record<string, ChannelWindows> };

export async function runHorairesAgent(deps: AgentsDeps): Promise<HorairesResult> {
  const now = nowOf(deps);
  const { settings } = await loadAlgoTeam(deps.prisma);
  const since = new Date(now.getTime() - BEST_HOURS_WEEKS * 7 * 86_400_000);
  const [channels, rows] = await Promise.all([
    deps.prisma.channel.findMany({ where: { isActive: true }, select: { id: true } }) as Promise<Array<{ id: string }>>,
    deps.prisma.post.findMany({
      where: { status: "SENT", isTemplate: false, sentAt: { gte: since } },
      select: { id: true, channelId: true, categoryId: true, sentAt: true },
    }) as Promise<Array<{ id: string; channelId: string; categoryId: string | null; sentAt: Date | null }>>,
  ]);
  const stats = rows.length
    ? ((await deps.prisma.postStats.findMany({
        where: { postId: { in: rows.map((r) => r.id) } },
        select: { postId: true, views: true, clicks: true, uniqueClickers: true, reactionsTotal: true },
      })) as Array<{ postId: string; views: number; clicks: number; uniqueClickers: number; reactionsTotal: number }>)
    : [];
  const statsBy = new Map(stats.map((s) => [s.postId, s]));
  const posts: BestHoursPost[] = rows
    .filter((r): r is typeof r & { sentAt: Date } => r.sentAt instanceof Date)
    .map((r) => {
      const s = statsBy.get(r.id);
      return {
        channelId: r.channelId,
        categoryId: r.categoryId,
        sentAt: r.sentAt,
        views: s?.views ?? 0,
        clicks: s?.clicks ?? 0,
        uniqueClickers: s?.uniqueClickers ?? 0,
        reactionsTotal: s?.reactionsTotal ?? 0,
      };
    });

  const insights = await loadInsightRows(deps, { since });
  const byChannel = new Map<string, InsightRow[]>();
  for (const r of insights) byChannel.set(r.channelId, [...(byChannel.get(r.channelId) ?? []), r]);
  const opts = { ratio: settings.windowRatio, minPostsPerCell: settings.minPostsPerCell, minPosts: settings.minPosts };
  const windows: Record<string, ChannelWindows> = {};
  let plans = 0;
  for (const c of channels) {
    const w = buildChannelWindows(byChannel.get(c.id) ?? [], opts);
    windows[c.id] = w;
    const value = { ...buildBestHours(c.id, posts, now), source: BEST_HOURS_SOURCE, windows: suggestedWindowsJson(w) };
    await writeSetting(deps, `besthours.${c.id}`, value);
    const upd = await deps.prisma.channelAgentPlan.updateMany({
      where: { channelId: c.id },
      data: { suggestedWindows: JSON.parse(JSON.stringify(suggestedWindowsJson(w))) },
    });
    plans += upd.count;
  }
  await writeSetting(deps, "besthours.updatedAt", now.toISOString());
  await writeSetting(deps, BEST_HOURS_SOURCE_KEY, BEST_HOURS_SOURCE);
  return { channels: channels.length, posts: posts.length, plans, windows };
}

export const agent: AgentDefinition = {
  key: "horaires",
  async run(_mission, ctx) {
    const r = await runHorairesAgent(ctx);
    return { ok: true, summary: `meilleurs horaires de ${r.channels} canal(aux), ${r.plans} plan(s) mis à jour` };
  },
};
