/**
 * Tests A/B de canal à conclure, pour le bloc « À faire » (fonction pure, testée dans ab.test.ts) : les deux versions
 * sont parties, la dernière il y a 24 h à 7 jours, et la règle de la fiche du test (`pickPostWinner`) donne une
 * gagnante ou une égalité. Les plus récents d'abord.
 */
import { pickPostWinner } from "@linkaffipro/core";
import type { TodoInput } from "./todo";

const DAY = 24 * 3_600_000;
/** Recul minimal avant de conclure (les clics arrivent surtout le premier jour). */
export const AB_MIN_AGE_MS = DAY;
/** Au-delà, le test n'est plus proposé. */
export const AB_MAX_AGE_MS = 7 * DAY;
/** Messages relus : la version A peut partir jusqu'à 24 h avant la B. */
export const AB_LOOKBACK_MS = AB_MAX_AGE_MS + DAY;

export type AbPostRow = {
  abGroupId: string | null;
  abVariant: string | null;
  status: string;
  sentAt: Date | null;
  channel: { title: string };
  stats: { views: number; clicks: number; uniqueClickers: number; reactionsTotal: number } | null;
};

/** Tests à conclure parmi les messages A/B relus (`AB_LOOKBACK_MS`), les plus récents d'abord. */
export function abTestsToConclude(posts: readonly AbPostRow[], now: Date): TodoInput["abTests"] {
  const groups = new Map<string, AbPostRow[]>();
  for (const p of posts) {
    // Les tests de l'équipe Algorithme (`exp_…`) se concluent tout seuls : jamais « à conclure » sur l'accueil.
    if (!p.abGroupId || p.abGroupId.startsWith("exp_")) continue;
    groups.set(p.abGroupId, [...(groups.get(p.abGroupId) ?? []), p]);
  }
  const out: Array<TodoInput["abTests"][number] & { lastSentAt: number }> = [];
  for (const [groupId, variants] of groups) {
    const sentTimes = variants.map((v) => v.sentAt?.getTime() ?? 0);
    const lastSentAt = Math.max(...sentTimes);
    const age = now.getTime() - lastSentAt;
    if (age < AB_MIN_AGE_MS || age > AB_MAX_AGE_MS) continue;
    const result = pickPostWinner(
      variants.map((v) => ({
        variant: v.abVariant ?? "?",
        sent: v.status === "SENT",
        views: v.stats?.views ?? 0,
        clicks: v.stats?.clicks ?? 0,
        uniqueClickers: v.stats?.uniqueClickers ?? 0,
        reactionsTotal: v.stats?.reactionsTotal ?? 0,
      })),
    );
    if (result.status === "pending") continue;
    const a = variants.find((v) => v.abVariant === "A") ?? variants[0]!;
    out.push({
      groupId,
      channelTitle: a.channel.title,
      winner: result.status === "winner" ? result.variant : null,
      lastSentAt,
    });
  }
  return out
    .sort((x, y) => y.lastSentAt - x.lastSentAt)
    .map(({ lastSentAt: _lastSentAt, ...t }) => t);
}
