import { audit, prisma, recordEvent, toJsonValue } from "@linkaffipro/db";
import type { Chat, User } from "grammy/types";
import type { AdminRights, BotIdentity, LinkImportOutcome, TelegramDeps } from "./ports";
import { ensureDefaultSequences } from "./sequences/ensure";
import { choosePrimaryBot, sameRights } from "./channels/primary-bot";

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

/** Violation d'unicité Prisma (P2002) : l'enregistrement vient d'être créé par un appel concurrent. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/** Identifiant Telegram de l'admin du dialogue avec Claude (`Setting admin.telegramUserId`, posé par `pnpm tg:send`). */
async function isDialogAdmin(telegramUserId: bigint): Promise<boolean> {
  const setting = await prisma.setting.findUnique({ where: { key: "admin.telegramUserId" } });
  return (
    !!setting && typeof setting.value === "string" && setting.value === telegramUserId.toString()
  );
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
    await prisma.bot
      .update({ where: { id: bot.id }, data: { lastWebhookAt: new Date() } })
      .catch(() => undefined);
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
    await recordEvent({
      type: "member.start",
      memberId: member.id,
      botId: bot.id,
      payload: { payload: payload ?? null },
    });
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
    await recordEvent({
      type: canDm ? "member.unblocked" : "member.blocked",
      memberId: member.id,
      botId: bot.id,
    });
  },

  async upsertChannel(chat) {
    const type = chat.type === "channel" ? "CHANNEL" : "GROUP";
    const username = "username" in chat ? (chat.username ?? null) : null;
    const data = { title: chatTitle(chat), username, type } as const;
    const telegramChatId = BigInt(chat.id);
    const known = await prisma.channel.findUnique({
      where: { telegramChatId },
      select: { id: true, title: true, username: true, type: true },
    });
    if (known) {
      if (
        known.title !== data.title ||
        known.username !== data.username ||
        known.type !== data.type
      ) {
        await prisma.channel.update({ where: { id: known.id }, data });
      }
      return { channelId: known.id, created: false };
    }
    // Création atomique : plusieurs bots reçoivent souvent la même première mise à jour en même temps ;
    // seul celui dont l'insertion réussit voit `created: true` (et crée les séquences par défaut).
    let channelId: string;
    try {
      channelId = (
        await prisma.channel.create({ data: { telegramChatId, ...data }, select: { id: true } })
      ).id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await prisma.channel.update({
        where: { telegramChatId },
        data,
        select: { id: true },
      });
      return { channelId: winner.id, created: false };
    }
    // Canal nouvellement détecté : séquences de messages privés par défaut (jamais bloquant).
    try {
      await ensureDefaultSequences(channelId);
    } catch (err) {
      console.warn(
        "[telegram] séquences par défaut impossibles pour",
        channelId,
        (err as Error).message,
      );
    }
    return { channelId, created: true };
  },

  async findChannelId(telegramChatId) {
    const channel = await prisma.channel.findUnique({
      where: { telegramChatId: BigInt(telegramChatId) },
      select: { id: true },
    });
    return channel?.id ?? null;
  },

  async setChannelAdmin(channelId, botTelegramId, rights: AdminRights) {
    const bot = await prisma.bot.findUnique({
      where: { telegramBotId: botTelegramId },
      select: { id: true },
    });
    if (!bot) return;
    const where = { channelId_botId: { channelId, botId: bot.id } };
    // Pas d'écriture si rien n'a changé : `detectedAt` (qui départage les bots sans bot principal) ne bouge
    // que lorsqu'un bot retiré redevient administrateur ; l'événement n'est écrit que s'il y a du nouveau.
    let change: "created" | "reactivated" | "rights_changed" | null = null;
    for (let attempt = 0; attempt < 2 && change === null; attempt++) {
      const existing = await prisma.channelBotAdmin.findUnique({
        where,
        select: { rights: true, revokedAt: true },
      });
      if (!existing) {
        try {
          await prisma.channelBotAdmin.create({
            data: { channelId, botId: bot.id, rights: toJsonValue(rights) },
          });
          change = "created";
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          // Créé au même instant par un autre bot : on relit et on compare au tour suivant.
        }
        continue;
      }
      if (existing.revokedAt) {
        await prisma.channelBotAdmin.update({
          where,
          data: { rights: toJsonValue(rights), revokedAt: null, detectedAt: new Date() },
        });
        change = "reactivated";
      } else if (!sameRights(existing.rights, rights)) {
        await prisma.channelBotAdmin.update({ where, data: { rights: toJsonValue(rights) } });
        change = "rights_changed";
      }
      break;
    }
    if (change)
      await recordEvent({
        type: "channel.bot_admin_detected",
        channelId,
        botId: bot.id,
        payload: toJsonValue({ ...rights, change }),
      });
  },

  async revokeChannelAdmin(channelId, botTelegramId) {
    const bot = await prisma.bot.findUnique({
      where: { telegramBotId: botTelegramId },
      select: { id: true },
    });
    if (!bot) return;
    const { count } = await prisma.channelBotAdmin.updateMany({
      where: { channelId, botId: bot.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Rien à retirer (le bot n'était pas administrateur) : pas d'événement.
    if (count > 0)
      await recordEvent({ type: "channel.bot_admin_revoked", channelId, botId: bot.id });
  },

  async listOurBotTelegramIds() {
    const bots = await prisma.bot.findMany({ select: { telegramBotId: true } });
    return bots.map((b) => b.telegramBotId);
  },

  async listChannelAdminBotIds(channelId) {
    const rows = await prisma.channelBotAdmin.findMany({
      where: { channelId, revokedAt: null },
      select: { bot: { select: { telegramBotId: true } } },
    });
    return rows.map((r) => r.bot.telegramBotId);
  },

  async initPrimaryBot(channelId, detectorBotTelegramId) {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { primaryBotId: true, vertical: true },
    });
    if (!channel || channel.primaryBotId) return;
    const [admins, detector] = await Promise.all([
      prisma.channelBotAdmin.findMany({
        where: { channelId, revokedAt: null, bot: { isActive: true } },
        orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
        select: { bot: { select: { id: true, vertical: true } } },
      }),
      detectorBotTelegramId === null
        ? Promise.resolve(null)
        : prisma.bot.findFirst({
            where: { telegramBotId: detectorBotTelegramId, isActive: true },
            select: { id: true, vertical: true },
          }),
    ]);
    const choice = choosePrimaryBot({
      channelVertical: channel.vertical,
      detector,
      admins: admins.map((a) => a.bot),
    });
    if (!choice) return;
    // Jamais d'écrasement d'un choix de l'équipe (ni d'un appel concurrent) : seulement si le champ est encore vide.
    const { count } = await prisma.channel.updateMany({
      where: { id: channelId, primaryBotId: null },
      data: { primaryBotId: choice.botId },
    });
    if (count > 0)
      await recordEvent({
        type: "channel.primary_bot_set",
        channelId,
        botId: choice.botId,
        payload: { reason: choice.reason },
      });
  },

  async linkAdminAccount(token, telegramUserId) {
    const user = await prisma.user.findUnique({ where: { telegramLinkToken: token } });
    if (!user || !user.isActive) return null;
    await prisma.user.update({
      where: { id: user.id },
      data: { telegramUserId, telegramLinkToken: null },
    });
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "user.telegram_linked",
        entityType: "User",
        entityId: user.id,
      },
    });
    return { name: user.name };
  },

  async isPlatformUser(telegramUserId) {
    const user = await prisma.user.findFirst({
      where: { telegramUserId, isActive: true },
      select: { id: true },
    });
    if (user) return true;
    return isDialogAdmin(telegramUserId);
  },

  async isAdminDialogPartner(telegramUserId) {
    return isDialogAdmin(telegramUserId);
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
    return {
      admins: r.admins.map((a) => ({ telegramBotId: a.telegramBotId, username: a.username })),
      unavailable: r.status === "unavailable" || r.status === "no_bot",
    };
  },

  async importChannelByLink(input, telegramUserId): Promise<LinkImportOutcome> {
    const { ChannelImportError, importChannelByUsername, rightsUnverified } =
      await import("./service");
    const user = await prisma.user.findFirst({ where: { telegramUserId }, select: { id: true } });
    try {
      const r = await importChannelByUsername(input, {
        userId: user?.id ?? null,
        metadata: { telegramUserId: telegramUserId.toString(), via: "bot" },
      });
      return {
        ok: true,
        title: r.title,
        created: r.created,
        admins: r.admins.map((a) => ({ telegramBotId: a.telegramBotId, username: a.username })),
        unavailable: rightsUnverified(r.status),
      };
    } catch (err) {
      if (!(err instanceof ChannelImportError)) {
        console.warn("[telegram] import par lien impossible", (err as Error).message);
        return { ok: false, reason: "unavailable" };
      }
      const reason =
        err.code === "invite" || err.code === "private"
          ? "private"
          : err.code === "invalid"
            ? "invalid"
            : err.code === "not_found" || err.code === "person"
              ? "not_found"
              : "unavailable";
      return { ok: false, reason };
    }
  },
};

export type { BotIdentity };
