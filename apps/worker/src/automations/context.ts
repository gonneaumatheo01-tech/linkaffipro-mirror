import { aggregatePlayers, computeSpendLevel, parseSpendThresholds, type AutomationContext } from "@linkaffipro/core";
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
