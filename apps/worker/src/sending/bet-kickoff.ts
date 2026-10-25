/**
 * Dernier filet des paris (phase 23, règle 4) : un message de l'équipe Paris sportifs n'est jamais envoyé à moins de
 * N minutes du coup d'envoi, ni après. Revérifié au moment réel de l'envoi (le scheduler peut réclamer le message en
 * retard : worker arrêté, file engorgée, attente imposée par Telegram). Trop tard : message CANCELLED, pari SKIPPED
 * « trop tard » (sauf si un autre canal l'a déjà reçu), événement journalisé.
 * N = le plus long du délai de la catégorie et du délai de l'équipe (même règle que `withTeamBounds`).
 */
import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";

export const BET_TOO_LATE_MESSAGE = "Non publié : coup d'envoi du match trop proche ou passé (pari jamais publié en retard).";
export const BET_TOO_LATE_REASON = "trop tard : coup d'envoi trop proche au moment de l'envoi";
export const BET_STALE_ODDS_MESSAGE = "Non publié : la cote lue sur le site du bookmaker est trop ancienne au moment de l'envoi.";
export const BET_STALE_ODDS_REASON = "cote trop ancienne au moment de l'envoi (lecture du site de plus de 5 min)";
/**
 * Phase 35 (règle 3) : pari lu sur un site du client : la double lecture a moins de 3 min à la publication ; à l'envoi
 * réel (post retenu par une pause, file engorgée…), plus de 5 min depuis la lecture la plus récente → jamais envoyé.
 */
export const DIRECT_ODDS_MAX_AGE_AT_SEND_MS = 5 * 60_000;
const DEFAULT_MIN_MINUTES = 30;

type PostRef = { id: string; agentMissionId?: string | null; channelId: string; botId?: string | null };

/** Délai minimal de l'équipe (`AgentTeamConfig.settings.sports.minMinutesBeforeKickoff`), 0 si absent. */
function teamMinMinutes(settings: unknown): number {
  const sports = (settings as { sports?: { minMinutesBeforeKickoff?: unknown } } | null)?.sports;
  const n = Number(sports?.minMinutesBeforeKickoff);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** Pur : minutes pleines avant le coup d'envoi suffisantes ? */
export function betStillOnTime(kickoffAt: Date, now: Date, minMinutes: number): boolean {
  const minutesLeft = Math.floor((kickoffAt.getTime() - now.getTime()) / 60_000);
  return minutesLeft > 0 && minutesLeft >= minMinutes;
}

/** Vrai si le message était un pari arrivé trop tard (il vient d'être annulé et ne doit pas partir). */
export async function cancelLateBetPost(post: PostRef, now: Date = new Date()): Promise<boolean> {
  if (!post.agentMissionId) return false;
  const pick = await prisma.bettingPick.findFirst({
    where: { OR: [{ postId: post.id }, { missionId: post.agentMissionId }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, kickoffAt: true, categoryId: true, siteKey: true, oddsReadIds: true },
  });
  if (!pick) return false;
  let reason = BET_TOO_LATE_REASON;
  let message = BET_TOO_LATE_MESSAGE;
  let stale = false;
  if (pick.status !== "SKIPPED" && pick.siteKey) {
    const ids = Array.isArray(pick.oddsReadIds) ? (pick.oddsReadIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const reads = ids.length ? await prisma.bookmakerOdds.findMany({ where: { id: { in: ids } }, select: { readAt: true } }) : [];
    const newest = reads.reduce((m, r) => Math.max(m, r.readAt.getTime()), 0);
    stale = !newest || now.getTime() - newest > DIRECT_ODDS_MAX_AGE_AT_SEND_MS;
    if (stale) {
      reason = BET_STALE_ODDS_REASON;
      message = BET_STALE_ODDS_MESSAGE;
    }
  }
  if (pick.status !== "SKIPPED" && !stale) {
    const [category, team] = await Promise.all([
      prisma.betCategory.findUnique({ where: { id: pick.categoryId }, select: { minMinutesBeforeKickoff: true } }),
      prisma.agentTeamConfig.findUnique({ where: { teamKey: "sports" }, select: { settings: true } }),
    ]);
    const min = Math.max(category?.minMinutesBeforeKickoff ?? DEFAULT_MIN_MINUTES, teamMinMinutes(team?.settings));
    if (betStillOnTime(pick.kickoffAt, now, min)) return false;
  }
  await prisma.post.update({ where: { id: post.id }, data: { status: "CANCELLED", lastError: message } });
  // Un autre canal du même pari l'a déjà reçu : le pari reste publié (son résultat sera réglé).
  const sent = await prisma.post.count({ where: { agentMissionId: post.agentMissionId, status: "SENT" } });
  if (sent === 0) await prisma.bettingPick.updateMany({ where: { id: pick.id, status: { in: ["PROPOSED", "PUBLISHED"] } }, data: { status: "SKIPPED", skipReason: reason } });
  await recordEvent({
    type: "agents.sports.pick_skipped",
    channelId: post.channelId,
    botId: post.botId ?? null,
    payload: toJsonValue({ postId: post.id, pickId: pick.id, missionId: post.agentMissionId, reason, step: "envoi" }),
  });
  return true;
}
