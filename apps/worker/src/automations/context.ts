import { aggregatePlayers, computeSpendLevel, evaluateCondition, graphContextFromData, parseSpendThresholds, type AutomationContext, type GraphCondition, type GraphMemberContext } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { lastActivity } from "../maintenance/retention";
import { daysSince } from "./engine";

export type MemberSnapshot = {
  memberId: string;
  firstName: string | null;
  languageCode: string | null;
  telegramUserId: bigint;
  channelId: string | null;
  channelTitle: string | null;
  campaignId: string | null;
  ctx: AutomationContext;
};

/** Contexte d'un membre : canal et pub de sa dernière adhésion, langue, niveau de dépense, inactivité ; surchargé par le contexte de l'événement. */
export async function buildMemberContext(memberId: string, eventCtx: Record<string, unknown> = {}, now = new Date()): Promise<MemberSnapshot | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      memberships: { orderBy: { requestedAt: "desc" }, take: 1, include: { channel: { select: { title: true } }, inviteLink: { select: { ad: { select: { adSet: { select: { campaignId: true } } } } } } } },
      players: { select: { registeredAt: true, depositCount: true, depositTotal: true } },
    },
  });
  if (!member || member.anonymizedAt) return null;
  const [lastClick, lastOut, thresholds] = await Promise.all([
    prisma.click.findFirst({ where: { memberId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.outboundMessage.findFirst({ where: { memberId, status: "SENT" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
    prisma.setting.findUnique({ where: { key: "spend.thresholds" } }).then((s) => parseSpendThresholds(s?.value)).catch(() => parseSpendThresholds(undefined)),
  ]);
  const latest = member.memberships[0] ?? null;
  const last = lastActivity({ lastSeenAt: member.lastSeenAt, lastMembershipAt: latest?.joinedAt ?? latest?.requestedAt ?? null, lastClickAt: lastClick?.createdAt ?? null, lastOutboundAt: lastOut?.sentAt ?? null, anonymizedAt: null });
  const spendLevel = computeSpendLevel(aggregatePlayers(member.players.map((p) => ({ registeredAt: p.registeredAt, depositCount: p.depositCount, depositTotal: Number(p.depositTotal) }))), thresholds);
  const channelId = (typeof eventCtx.channelId === "string" ? eventCtx.channelId : null) ?? latest?.channelId ?? null;
  const channel = channelId && channelId !== latest?.channelId ? await prisma.channel.findUnique({ where: { id: channelId }, select: { title: true } }) : null;
  return {
    memberId,
    firstName: member.firstName,
    languageCode: member.languageCode,
    telegramUserId: member.telegramUserId,
    channelId,
    channelTitle: channel?.title ?? latest?.channel.title ?? null,
    campaignId: latest?.inviteLink?.ad?.adSet.campaignId ?? null,
    ctx: {
      channelId,
      campaignId: latest?.inviteLink?.ad?.adSet.campaignId ?? null,
      languageCode: member.languageCode,
      spendLevel,
      inactiveDays: daysSince(last, now),
      categoryId: typeof eventCtx.categoryId === "string" ? eventCtx.categoryId : null,
    },
  };
}

/**
 * État du membre pour les conditions d'un graphe, lu en base à l'instant de l'évaluation (lecture seule) ; null si le
 * membre est introuvable ou anonymisé. Mêmes sources que `buildMemberContext` (joueurs rattachés au membre, seuils
 * `spend.thresholds`), plus : étiquettes, canaux où il est accepté (adhésion la plus récente de chaque canal),
 * campagnes de ses liens d'entrée (InviteLink.campaignId et pubs, comme `campaignMemberWhere`), clics d'offre (avec
 * identifiant de suivi, hors robots) depuis `since` et inactivité comptée sur ses propres actions seulement (dernière
 * visite, dernière demande ou entrée, dernier clic ; pas nos messages, sinon une relance remettrait le compteur à zéro).
 */
export async function buildGraphContext(memberId: string, opts: { since: Date; excludeClickId?: string | null }, now = new Date()): Promise<GraphMemberContext | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      anonymizedAt: true,
      languageCode: true,
      tags: true,
      lastSeenAt: true,
      memberships: { orderBy: { requestedAt: "desc" }, select: { channelId: true, status: true, inviteLinkId: true, requestedAt: true, joinedAt: true } },
      players: { select: { registeredAt: true, ftdAt: true, depositCount: true, depositTotal: true } },
    },
  });
  if (!member || member.anonymizedAt) return null;
  const inviteLinkIds = [...new Set(member.memberships.map((m) => m.inviteLinkId).filter((id): id is string => !!id))];
  const [lastClick, offerClicks, thresholds, links] = await Promise.all([
    prisma.click.findFirst({ where: { memberId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.click.count({ where: { memberId, isBot: false, subId: { not: null }, createdAt: { gt: opts.since }, ...(opts.excludeClickId ? { id: { not: opts.excludeClickId } } : {}) } }),
    prisma.setting.findUnique({ where: { key: "spend.thresholds" } }).then((s) => parseSpendThresholds(s?.value)).catch(() => parseSpendThresholds(undefined)),
    inviteLinkIds.length ? prisma.inviteLink.findMany({ where: { id: { in: inviteLinkIds } }, select: { campaignId: true, ad: { select: { adSet: { select: { campaignId: true } } } } } }) : Promise.resolve([]),
  ]);
  const latest = member.memberships[0] ?? null;
  const last = lastActivity({ lastSeenAt: member.lastSeenAt, lastMembershipAt: latest?.joinedAt ?? latest?.requestedAt ?? null, lastClickAt: lastClick?.createdAt ?? null, lastOutboundAt: null, anonymizedAt: null });
  return graphContextFromData({
    players: member.players.map((p) => ({ registeredAt: p.registeredAt, ftdAt: p.ftdAt, depositCount: p.depositCount, depositTotal: Number(p.depositTotal) })),
    thresholds,
    languageCode: member.languageCode,
    tags: member.tags,
    memberships: member.memberships,
    campaignIds: links.flatMap((l) => [l.campaignId, l.ad?.adSet.campaignId].filter((id): id is string => !!id)),
    inactiveDays: daysSince(last, now),
    offerClicksSinceStart: offerClicks,
  });
}

/**
 * Évaluateur de conditions d'une exécution de graphe : l'état du membre est lu à la première condition rencontrée,
 * puis réutilisé ; `invalidate()` force une nouvelle lecture (après une étiquette posée par la relance).
 */
export function graphConditionEvaluator(memberId: string, opts: { since: Date; excludeClickId?: string | null }, now = new Date()) {
  let cached: Promise<GraphMemberContext | null> | null = null;
  return {
    async evaluate(condition: GraphCondition): Promise<boolean> {
      cached ??= buildGraphContext(memberId, opts, now);
      const ctx = await cached;
      if (!ctx) throw new Error("Membre introuvable ou anonymisé.");
      return evaluateCondition(condition, ctx);
    },
    invalidate(): void {
      cached = null;
    },
  };
}
