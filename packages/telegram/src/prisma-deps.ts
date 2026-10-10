import { audit, prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import type { Chat, User } from "grammy/types";
import type { AdminRights, BotIdentity, TelegramDeps } from "./ports";
import { ensureDefaultSequences } from "./sequences/ensure";

function memberData(from: User) {
  return {
    firstName: from.first_name ?? null,
    lastName: from.last_name ?? null,
    username: from.username ?? null,
    languageCode: from.language_code ?? null,
    isPremium: from.is_premium ?? false,
    lastSeenAt: new Date(),
  };
}

function chatTitle(chat: Chat): string {
  if ("title" in chat && chat.title) return chat.title;
  if ("username" in chat && chat.username) return `@${chat.username}`;
  return String(chat.id);
}

/** Implémentation réelle des dépendances des handlers, sur Prisma. */
export const prismaTelegramDeps: TelegramDeps = {
  async recordUpdate(bot, updateType, update, refs) {
    await recordEvent({
      type: `telegram.${updateType}`,
      botId: bot.id,
      memberId: refs.memberId,
      channelId: refs.channelId,
      payload: toJsonValue(update),
    });
    await prisma.bot.update({ where: { id: bot.id }, data: { lastWebhookAt: new Date() } }).catch(() => undefined);
  },

  async memberSeen(_bot, from) {
    const member = await prisma.member.upsert({
      where: { telegramUserId: BigInt(from.id) },
      create: { telegramUserId: BigInt(from.id), ...memberData(from) },
      update: memberData(from),
      select: { id: true },
    });
    return { memberId: member.id };
  },

  async memberStarted(bot, from, payload) {
    const member = await prisma.member.upsert({
      where: { telegramUserId: BigInt(from.id) },
      create: { telegramUserId: BigInt(from.id), ...memberData(from) },
      update: memberData(from),
      select: { id: true },
    });
    const now = new Date();
    await prisma.memberBotState.upsert({
      where: { memberId_botId: { memberId: member.id, botId: bot.id } },
      create: { memberId: member.id, botId: bot.id, canDm: true, startedAt: now },
      update: { canDm: true, startedAt: now, blockedAt: null },
    });
    await recordEvent({ type: "member.start", memberId: member.id, botId: bot.id, payload: { payload: payload ?? null } });
    return { memberId: member.id };
  },

  async memberDmStatus(bot, from, canDm) {
    const member = await prisma.member.upsert({
      where: { telegramUserId: BigInt(from.id) },
      create: { telegramUserId: BigInt(from.id), ...memberData(from) },
      update: memberData(from),
      select: { id: true },
    });
    await prisma.memberBotState.upsert({
      where: { memberId_botId: { memberId: member.id, botId: bot.id } },
      create: { memberId: member.id, botId: bot.id, canDm, blockedAt: canDm ? null : new Date() },
      update: { canDm, blockedAt: canDm ? null : new Date() },
    });
    await recordEvent({ type: canDm ? "member.unblocked" : "member.blocked", memberId: member.id, botId: bot.id });
  },

  async upsertChannel(chat) {
    const type = chat.type === "channel" ? "CHANNEL" : "GROUP";
    const username = "username" in chat ? (chat.username ?? null) : null;
    const known = await prisma.channel.findUnique({ where: { telegramChatId: BigInt(chat.id) }, select: { id: true } });
    const channel = await prisma.channel.upsert({
      where: { telegramChatId: BigInt(chat.id) },
      create: { telegramChatId: BigInt(chat.id), title: chatTitle(chat), username, type },
      update: { title: chatTitle(chat), username, type },
      select: { id: true },
    });
    if (!known) {
      // Canal nouvellement détecté : séquences de messages privés par défaut (jamais bloquant).
      try {
        await ensureDefaultSequences(channel.id);
      } catch (err) {
        console.warn("[telegram] séquences par défaut impossibles pour", channel.id, (err as Error).message);
      }
    }
    return { channelId: channel.id, created: !known };
  },

  async setChannelAdmin(channelId, botTelegramId, rights: AdminRights) {
    const bot = await prisma.bot.findUnique({ where: { telegramBotId: botTelegramId }, select: { id: true } });
    if (!bot) return;
    await prisma.channelBotAdmin.upsert({
      where: { channelId_botId: { channelId, botId: bot.id } },
      create: { channelId, botId: bot.id, rights: toJsonValue(rights) },
      update: { rights: toJsonValue(rights), revokedAt: null, detectedAt: new Date() },
    });
    await recordEvent({ type: "channel.bot_admin_detected", channelId, botId: bot.id, payload: toJsonValue(rights) });
  },

  async revokeChannelAdmin(channelId, botTelegramId) {
    const bot = await prisma.bot.findUnique({ where: { telegramBotId: botTelegramId }, select: { id: true } });
    if (!bot) return;
    const { count } = await prisma.channelBotAdmin.updateMany({
      where: { channelId, botId: bot.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Rien à retirer (le bot n'était pas administrateur) : pas d'événement.
    if (count > 0) await recordEvent({ type: "channel.bot_admin_revoked", channelId, botId: bot.id });
  },

  async listOurBotTelegramIds() {
    const bots = await prisma.bot.findMany({ select: { telegramBotId: true } });
    return bots.map((b) => b.telegramBotId);
  },

  async linkAdminAccount(token, telegramUserId) {
    const user = await prisma.user.findUnique({ where: { telegramLinkToken: token } });
    if (!user || !user.isActive) return null;
    await prisma.user.update({
      where: { id: user.id },
      data: { telegramUserId, telegramLinkToken: null },
    });
    await prisma.auditLog.create({
      data: { userId: user.id, action: "user.telegram_linked", entityType: "User", entityId: user.id },
    });
    return { name: user.name };
  },

  async isPlatformUser(telegramUserId) {
    const user = await prisma.user.findFirst({ where: { telegramUserId, isActive: true }, select: { id: true } });
    if (user) return true;
    const setting = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
    return !!setting && typeof setting.value === "string" && setting.value === telegramUserId.toString();
  },

  async auditChannel({ action, channelId, telegramUserId, metadata }) {
    const user = await prisma.user.findFirst({ where: { telegramUserId }, select: { id: true } });
    await audit({
      userId: user?.id ?? null,
      action,
      entityType: "Channel",
      entityId: channelId,
      metadata: { ...(metadata ?? {}), telegramUserId: telegramUserId.toString() },
    });
  },

  async recheckChannelRights(channelId) {
    const { recheckChannelRights } = await import("./service");
    const r = await recheckChannelRights(channelId, { audit: false });
    return r.admins.map((a) => ({ telegramBotId: a.telegramBotId, username: a.username }));
  },
};

export type { BotIdentity };
