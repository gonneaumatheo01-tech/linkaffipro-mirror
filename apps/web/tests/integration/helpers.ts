import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import type { Api } from "grammy";

/** Vide les tables touchées par les tests (ordre : dépendances d'abord). Base de test uniquement. */
export async function resetDb(): Promise<void> {
  if (!/linkaffipro_test/.test(process.env.DATABASE_URL ?? ""))
    throw new Error("resetDb refuse de tourner hors de la base de test");
  await prisma.$transaction([
    prisma.postbackLog.deleteMany(),
    prisma.playerEvent.deleteMany(),
    prisma.player.deleteMany(),
    prisma.postbackEndpoint.deleteMany(),
    prisma.click.deleteMany(),
    prisma.outboundMessage.deleteMany(),
    prisma.postStats.deleteMany(),
    prisma.trackingLink.deleteMany(),
    prisma.post.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.approvalRule.deleteMany(),
    prisma.inviteLink.deleteMany(),
    prisma.sequenceStep.deleteMany(),
    prisma.sequence.deleteMany(),
    prisma.channelBotAdmin.deleteMany(),
    prisma.affiliateCampaign.deleteMany(),
    prisma.affiliateProgram.deleteMany(),
    prisma.event.deleteMany(),
    prisma.memberBotState.deleteMany(),
    prisma.member.deleteMany(),
    prisma.channel.deleteMany(),
    prisma.bot.deleteMany(),
    // Phase 17 : conversations, messages et liens d'offre de l'assistant partent avec les membres et les bots
    // (cascade) ; les personas restent sinon d'un test à l'autre.
    prisma.persona.deleteMany(),
    prisma.syncState.deleteMany(),
  ]);
  // Vidé en place : le mock de la file garde une référence sur ce tableau (voir setup.ts).
  (globalThis.__jobs ??= []).length = 0;
}

/** Attend la fin des rappels `after()` déclenchés par les routes (voir setup.ts). */
export async function flushAfter(): Promise<void> {
  const list = globalThis.__afterPromises ?? [];
  globalThis.__afterPromises = [];
  await Promise.all(list);
}

/** Contexte de route Next (params asynchrones). */
export function ctx<T extends Record<string, unknown>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

/** Tâches BullMQ capturées par le mock de `@linkaffipro/queue` (voir setup.ts). */
export function capturedJobs(queue?: string) {
  const all = globalThis.__jobs ?? [];
  return queue ? all.filter((j) => j.queue === queue) : all;
}

export type TelegramCall = { method: string; payload: Record<string, unknown> };

/**
 * Intercepte l'API grammY d'un bot : aucun appel réseau, chaque méthode reçoit une réponse plausible
 * et l'appel est consigné dans la liste retournée.
 */
export function installFakeTelegram(api: Api): TelegramCall[] {
  const calls: TelegramCall[] = [];
  let nextMessageId = 1000;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    let result: unknown = true;
    if (/^send(Message|Photo|Video|Animation|Document)$/.test(method)) {
      result = {
        message_id: nextMessageId++,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(p.chat_id), type: Number(p.chat_id) < 0 ? "channel" : "private" },
        text: p.text ?? p.caption ?? "",
      };
    } else if (method === "sendMediaGroup") {
      result = ((p.media as unknown[]) ?? []).map(() => ({
        message_id: nextMessageId++,
        date: 0,
        chat: { id: Number(p.chat_id), type: "channel" },
      }));
    } else if (method === "getChatMember") {
      result = {
        status: "member",
        user: { id: Number(p.user_id), is_bot: false, first_name: "x" },
      };
    } else if (method === "createChatInviteLink") {
      result = {
        invite_link: `https://t.me/+gate${String(p.chat_id).replace(/\D/g, "").slice(-6)}`,
        creator: { id: 1, is_bot: true, first_name: "bot" },
        creates_join_request: false,
        is_primary: false,
        is_revoked: false,
        name: p.name,
      };
    }
    return { ok: true, result } as never;
  });
  return calls;
}

export const TEST_BOT_TOKEN = "111:TEST-TOKEN-xxxxxxxxxxxxxxxxxxxxxxxxxxxx";

/** Bot + canal administré par ce bot (le cas nominal de tous les parcours). */
export async function createBotAndChannel(
  opts: { webhookSecret?: string; chatId?: bigint; title?: string } = {},
) {
  const bot = await prisma.bot.create({
    data: {
      name: "Bot test",
      username: "bot_test",
      telegramBotId: 111n,
      tokenEncrypted: encrypt(TEST_BOT_TOKEN),
      vertical: "CASINO",
      webhookSecret: opts.webhookSecret ?? "secret-integration",
    },
  });
  const channel = await prisma.channel.create({
    data: {
      telegramChatId: opts.chatId ?? -1001234567890n,
      title: opts.title ?? "Canal test",
      type: "CHANNEL",
      language: "fr",
      primaryBotId: bot.id,
      isTest: true,
    },
  });
  await prisma.channelBotAdmin.create({
    data: {
      channelId: channel.id,
      botId: bot.id,
      rights: { status: "administrator", can_invite_users: true },
    },
  });
  return { bot, channel };
}

/** Requête webhook Telegram signée avec le secret du bot. */
export function webhookRequest(update: unknown, secret = "secret-integration"): Request {
  return new Request("http://localhost/api/telegram/x", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": secret, "content-type": "application/json" },
    body: JSON.stringify(update),
  });
}

// ============================================================
// Monde Telegram simulé à plusieurs bots (canaux existants, droits, return_bots)
// ============================================================

type TelegramError = { error_code: number; description: string };

/** Un chat du monde simulé : administrateurs (identifiants Telegram de bots ou d'humains) et nom public éventuel. */
export type FakeChat = {
  id: number;
  title: string;
  type?: "channel" | "supergroup";
  username?: string;
  admins: Set<number>;
};

/**
 * Telegram simulé, partagé par plusieurs bots : chaque bot voit le monde avec ses propres droits, comme le vrai Telegram.
 * - `getChatAdministrators` : refus (403) si le bot n'est pas administrateur ; sans `return_bots: true`, les autres bots sont omis ;
 * - `getChat` : un canal public (avec nom) est lisible par tous, un canal privé seulement par ses administrateurs ;
 * - `getChatMember` : « administrator » ou « left » ;
 * - `down` : panne forcée d'un bot (500, 429…) sur ces trois méthodes.
 */
export class FakeTelegramWorld {
  readonly chats = new Map<number, FakeChat>();
  readonly bots = new Map<number, { username: string; name: string }>();
  readonly down = new Map<number, TelegramError>();

  addChat(chat: Omit<FakeChat, "admins"> & { admins: number[] }): FakeChat {
    const c = { ...chat, admins: new Set(chat.admins) };
    this.chats.set(chat.id, c);
    return c;
  }

  private find(chatId: unknown): FakeChat | undefined {
    if (typeof chatId === "string" && chatId.startsWith("@")) {
      const name = chatId.slice(1).toLowerCase();
      return [...this.chats.values()].find((c) => c.username?.toLowerCase() === name);
    }
    return this.chats.get(Number(chatId));
  }

  private member(id: number, chat: FakeChat) {
    const bot = this.bots.get(id);
    const user = bot
      ? { id, is_bot: true, first_name: bot.name, username: bot.username }
      : { id, is_bot: false, first_name: `Humain ${id}` };
    if (!chat.admins.has(id)) return { status: "left", user };
    return {
      status: "administrator",
      user,
      can_be_edited: false,
      is_anonymous: false,
      can_manage_chat: true,
      can_delete_messages: true,
      can_manage_video_chats: false,
      can_restrict_members: true,
      can_promote_members: false,
      can_change_info: false,
      can_invite_users: true,
      can_post_messages: true,
      can_post_stories: false,
      can_edit_stories: false,
      can_delete_stories: false,
      can_send_welcome_messages: false,
    };
  }

  /** Branche le monde sur l'API grammY d'un bot (instance mise en cache par `getOrCreateBot`). */
  install(
    api: Api,
    self: { telegramBotId: bigint; username: string; name: string },
  ): TelegramCall[] {
    const selfId = Number(self.telegramBotId);
    this.bots.set(selfId, { username: self.username, name: self.name });
    const calls: TelegramCall[] = [];
    let nextMessageId = 5000;
    api.config.use(async (_prev, method, payload) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      calls.push({ method, payload: p });
      const fail = (e: TelegramError) => ({ ok: false, ...e }) as never;
      const ok = (result: unknown) => ({ ok: true, result }) as never;
      if (
        method === "getChat" ||
        method === "getChatAdministrators" ||
        method === "getChatMember"
      ) {
        const down = this.down.get(selfId);
        if (down) return fail(down);
        const chat = this.find(p.chat_id);
        if (!chat) return fail({ error_code: 400, description: "Bad Request: chat not found" });
        const isAdmin = chat.admins.has(selfId);
        if (method === "getChat") {
          if (!isAdmin && !chat.username)
            return fail({ error_code: 400, description: "Bad Request: chat not found" });
          return ok({
            id: chat.id,
            type: chat.type ?? "channel",
            title: chat.title,
            ...(chat.username ? { username: chat.username } : {}),
          });
        }
        if (!isAdmin)
          return fail({
            error_code: 403,
            description: "Forbidden: bot is not a member of the channel chat",
          });
        if (method === "getChatMember") return ok(this.member(Number(p.user_id), chat));
        const ids = [...chat.admins].filter(
          (id) => !this.bots.has(id) || id === selfId || p.return_bots === true,
        );
        return ok(ids.map((id) => this.member(id, chat)));
      }
      if (/^send(Message|Photo|Video|Animation|Document)$/.test(method)) {
        return ok({
          message_id: nextMessageId++,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(p.chat_id), type: Number(p.chat_id) < 0 ? "channel" : "private" },
          text: p.text ?? p.caption ?? "",
        });
      }
      return ok(true);
    });
    return calls;
  }
}

/** Crée un bot de test en base (jeton factice chiffré) ; `n` distingue les bots (111, 222, 333…). */
export async function createTestBot(
  n: number,
  vertical: "CASINO" | "SPORTS" | "DATING" = "CASINO",
  webhookSecret = `secret-${n}`,
) {
  return prisma.bot.create({
    data: {
      name: `Bot ${n}`,
      username: `bot_${n}`,
      telegramBotId: BigInt(n),
      tokenEncrypted: encrypt(`${n}:TEST-TOKEN-${"x".repeat(30)}`),
      vertical,
      webhookSecret,
    },
  });
}
