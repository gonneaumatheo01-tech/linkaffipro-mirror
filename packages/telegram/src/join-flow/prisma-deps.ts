import { prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import { enqueueDm } from "@linkaffipro/queue";
import type { User } from "grammy/types";
import type { ChannelInfo, InviteLinkInfo, JoinFlowDeps, MembershipInfo } from "./deps";
import { resolveRule, ruleFromRow, type RuleData } from "./rules";

function memberData(from: User) {
  return { firstName: from.first_name ?? null, lastName: from.last_name ?? null, username: from.username ?? null, languageCode: from.language_code ?? null, isPremium: from.is_premium ?? false, lastSeenAt: new Date() };
}

const channelSelect = { id: true, title: true, username: true, language: true, telegramChatId: true, primaryBotId: true } as const;
const linkSelect = { id: true, kind: true, name: true, channelId: true, campaignId: true, adPlatform: true, adCampaignName: true, adName: true, sourceChannelId: true, telegramInviteLink: true } as const;
const membershipSelect = { id: true, code: true, memberId: true, channelId: true, status: true, requestedAt: true, approveAt: true, userChatId: true, inviteLinkId: true, approvalRuleId: true, source: true, remindersSent: true } as const;

function toMembership(m: { source: unknown } & Omit<MembershipInfo, "source">): MembershipInfo {
  return { ...m, source: (m.source && typeof m.source === "object" ? (m.source as Record<string, unknown>) : {}) };
}

async function ruleFor(channelId: string, inviteLinkId: string | null): Promise<RuleData> {
  const [linkRule, defaultRule] = await Promise.all([
    inviteLinkId ? prisma.approvalRule.findUnique({ where: { inviteLinkId } }) : Promise.resolve(null),
    prisma.approvalRule.findFirst({ where: { channelId, isDefault: true }, orderBy: { updatedAt: "desc" } }),
  ]);
  return resolveRule(linkRule, defaultRule);
}

export const prismaJoinFlowDeps: JoinFlowDeps = {
  async upsertMember(from) {
    const m = await prisma.member.upsert({
      where: { telegramUserId: BigInt(from.id) },
      create: { telegramUserId: BigInt(from.id), ...memberData(from) },
      update: memberData(from),
      select: { id: true, languageCode: true, firstName: true },
    });
    return { memberId: m.id, languageCode: m.languageCode, firstName: m.firstName };
  },
  async findChannelByChatId(chatId) {
    return prisma.channel.findUnique({ where: { telegramChatId: chatId }, select: channelSelect });
  },
  async getChannels(ids) {
    if (ids.length === 0) return [];
    const rows = await prisma.channel.findMany({ where: { id: { in: ids } }, select: channelSelect });
    return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is ChannelInfo => !!r);
  },
  async actingBotIdFor(channelId) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { primaryBotId: true, title: true } });
    const admins = await prisma.channelBotAdmin.findMany({ where: { channelId, revokedAt: null, bot: { isActive: true } }, orderBy: { detectedAt: "asc" }, select: { botId: true } });
    if (admins.length === 0) return null;
    const primary = channel?.primaryBotId && admins.find((a) => a.botId === channel.primaryBotId);
    if (primary) return { botId: primary.botId };
    const fallback = admins[0]!;
    return { botId: fallback.botId, warning: channel?.primaryBotId ? `bot principal non administrateur de « ${channel.title} », bot de secours utilisé` : undefined };
  },
  async findInviteLinkByUrl(url) {
    return prisma.inviteLink.findUnique({ where: { telegramInviteLink: url }, select: linkSelect }) as Promise<InviteLinkInfo | null>;
  },
  resolveRule: ruleFor,
  async createMembership(data) {
    const m = await prisma.membership.create({ data: { ...data, source: toJsonValue(data.source) }, select: { id: true } });
    return { id: m.id };
  },
  async updateMembership(id, data) {
    const { source, ...rest } = data;
    await prisma.membership.update({ where: { id }, data: { ...rest, ...(source ? { source: toJsonValue(source) } : {}) } });
  },
  async findMembershipByCode(code) {
    const m = await prisma.membership.findUnique({ where: { code }, select: membershipSelect });
    return m ? toMembership(m) : null;
  },
  async findLatestMembership(memberId, channelId) {
    const m = await prisma.membership.findFirst({ where: { memberId, channelId }, orderBy: { requestedAt: "desc" }, select: membershipSelect });
    return m ? toMembership(m) : null;
  },
  async getRuleForMembership(m) {
    if (m.approvalRuleId) {
      const row = await prisma.approvalRule.findUnique({ where: { id: m.approvalRuleId } });
      if (row) return ruleFromRow(row);
    }
    return ruleFor(m.channelId, m.inviteLinkId);
  },
  async incrementInviteLink(id, field) {
    await prisma.inviteLink.update({ where: { id }, data: { [field]: { increment: 1 } } }).catch(() => undefined);
  },
  async findOrCreateGateLink(sourceChannelId, gate, botId, create) {
    const existing = await prisma.inviteLink.findFirst({ where: { channelId: gate.id, kind: "GATE", sourceChannelId, isActive: true }, select: { telegramInviteLink: true } });
    if (existing) return existing.telegramInviteLink;
    const url = await create();
    if (!url) return gate.username ? `https://t.me/${gate.username}` : null;
    await prisma.inviteLink.create({
      data: { channelId: gate.id, botId, telegramInviteLink: url, name: `gate:${sourceChannelId}`, kind: "GATE", createsJoinRequest: false, sourceChannelId, language: gate.language },
    }).catch(() => undefined);
    return url;
  },
  async getSequenceText(channelId, botId, trigger) {
    const seq = await prisma.sequence.findFirst({
      where: { trigger, isActive: true, OR: [{ channelId, botId }, { channelId, botId: null }, { channelId: null, botId }, { channelId: null, botId: null }] },
      orderBy: [{ channelId: "desc" }, { botId: "desc" }],
      include: { steps: { orderBy: { order: "asc" }, take: 1 } },
    });
    const step = seq?.steps[0];
    if (!step) return null;
    const texts = step.texts && typeof step.texts === "object" ? (step.texts as Record<string, string>) : {};
    const buttons = Array.isArray(step.buttons) ? (step.buttons as unknown[]) : [];
    return { texts, buttons };
  },
  async enqueueDm(input) {
    await enqueueDm({ ...input, buttons: input.buttons });
  },
  async setCanDm(memberId, botId, canDm) {
    await prisma.memberBotState.upsert({
      where: { memberId_botId: { memberId, botId } },
      create: { memberId, botId, canDm, startedAt: canDm ? new Date() : null, blockedAt: canDm ? null : new Date() },
      update: { canDm, ...(canDm ? { startedAt: new Date(), blockedAt: null } : { blockedAt: new Date() }) },
    });
  },
  async recordEvent(input) {
    await recordEvent(input);
  },
};
