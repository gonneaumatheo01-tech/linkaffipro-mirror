import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity, TelegramDeps } from "../ports";

const adminBase = {
  status: "administrator" as const,
  can_be_edited: false,
  is_anonymous: false,
  can_manage_chat: true,
  can_delete_messages: true,
  can_manage_video_chats: false,
  can_restrict_members: false,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: true,
  can_post_stories: false,
  can_edit_stories: false,
  can_delete_stories: false,
  can_send_welcome_messages: false,
};

const identity: BotIdentity = { id: "bot_1", name: "CasinoBot", username: "casinobot", telegramBotId: 111n, vertical: "CASINO" };
const from = { id: 42, is_bot: false, first_name: "Jean", language_code: "fr" };
const unknownChannel = { id: -1007777, type: "channel" as const, title: "Canal oublié" };

/** Deps simulées : `upsertChannel` signale un canal nouvellement créé (`created: true`) pour le canal inconnu. */
function makeDeps(opts: { created?: boolean } = {}) {
  const deps: TelegramDeps = {
    recordUpdate: vi.fn(async () => undefined),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberDmStatus: vi.fn(async () => undefined),
    upsertChannel: vi.fn(async () => ({ channelId: "c_new", created: opts.created ?? true })),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n, 222n]),
    linkAdminAccount: vi.fn(async () => null),
    isPlatformUser: vi.fn(async () => false),
  };
  return deps;
}

function makeBot(deps: TelegramDeps, opts: { adminsFail?: boolean } = {}) {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: unknown }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload });
    if (method === "getChatAdministrators") {
      if (opts.adminsFail) return { ok: false, error_code: 400, description: "Bad Request: CHAT_ADMIN_REQUIRED" } as never;
      return {
        ok: true,
        result: [
          { ...adminBase, user: { id: 111, is_bot: true, first_name: "CasinoBot", username: "casinobot" }, can_post_messages: true },
          { ...adminBase, user: { id: 222, is_bot: true, first_name: "SportBot", username: "sportbot" }, can_post_messages: true },
          { status: "creator", user: { id: 999, is_bot: false, first_name: "Owner" }, is_anonymous: false },
        ],
      } as never;
    }
    return { ok: true, result: true } as never;
  });
  // Handlers de base seulement : les handlers spécialisés (adhésion, réactions) ont leurs propres tests.
  registerHandlers(bot, identity, deps, { extended: false });
  return { bot, apiCalls };
}

describe("canal inconnu : toute mise à jour crée le canal et relève les droits de nos bots", () => {
  it("chat_join_request sur un canal inconnu crée le canal et enregistre nos bots administrateurs", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    const update: Update = {
      update_id: 50,
      chat_join_request: { chat: unknownChannel, from, user_chat_id: 42, date: 1_760_000_000 },
    };
    await bot.handleUpdate(update);
    expect(deps.upsertChannel).toHaveBeenCalledWith(unknownChannel);
    expect(apiCalls.some((c) => c.method === "getChatAdministrators")).toBe(true);
    // Nos deux bots (111 et 222) sont administrateurs ; l'humain 999 est ignoré.
    expect(deps.setChannelAdmin).toHaveBeenCalledTimes(2);
    expect(deps.setChannelAdmin).toHaveBeenCalledWith("c_new", 111n, expect.objectContaining({ status: "administrator" }));
    expect(deps.setChannelAdmin).toHaveBeenCalledWith("c_new", 222n, expect.objectContaining({ status: "administrator" }));
    expect(deps.recordUpdate).toHaveBeenCalledWith(identity, "chat_join_request", update, { channelId: "c_new", memberId: "m1" });
  });

  it("chat_member et message_reaction_count sur un canal inconnu créent aussi le canal avec ses droits", async () => {
    for (const update of [
      {
        update_id: 51,
        chat_member: {
          chat: unknownChannel,
          from,
          date: 1,
          old_chat_member: { status: "left" as const, user: from },
          new_chat_member: { status: "member" as const, user: from },
        },
      },
      { update_id: 52, message_reaction_count: { chat: unknownChannel, message_id: 7, date: 1, reactions: [] } },
    ] satisfies Update[]) {
      const deps = makeDeps();
      const { bot, apiCalls } = makeBot(deps);
      await bot.handleUpdate(update);
      expect(deps.upsertChannel).toHaveBeenCalledWith(unknownChannel);
      expect(apiCalls.filter((c) => c.method === "getChatAdministrators")).toHaveLength(1);
      expect(deps.setChannelAdmin).toHaveBeenCalledTimes(2);
    }
  });

  it("un canal déjà connu ne déclenche pas de relevé des droits sur une simple demande d'adhésion", async () => {
    const deps = makeDeps({ created: false });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate({ update_id: 53, chat_join_request: { chat: unknownChannel, from, user_chat_id: 42, date: 1 } });
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
    expect(apiCalls.some((c) => c.method === "getChatAdministrators")).toBe(false);
    expect(deps.setChannelAdmin).not.toHaveBeenCalled();
  });

  it("sans droit de lecture des administrateurs, le canal est créé quand même et rien ne casse", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps, { adminsFail: true });
    await bot.handleUpdate({ update_id: 54, channel_post: { message_id: 5, date: 1, chat: unknownChannel, text: "Hello", sender_chat: unknownChannel } });
    expect(deps.upsertChannel).toHaveBeenCalledWith(unknownChannel);
    expect(deps.setChannelAdmin).not.toHaveBeenCalled();
    expect(deps.recordUpdate).toHaveBeenCalledWith(identity, "channel_post", expect.anything(), { channelId: "c_new" });
  });

  it("channel_post relève les droits même sur un canal connu (droits actualisés) et retire un bot absent", async () => {
    const deps = makeDeps({ created: false });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate({ update_id: 55, channel_post: { message_id: 6, date: 1, chat: unknownChannel, text: "Hello", sender_chat: unknownChannel } });
    expect(apiCalls.filter((c) => c.method === "getChatAdministrators")).toHaveLength(1);
    expect(deps.setChannelAdmin).toHaveBeenCalledTimes(2);
    expect(deps.revokeChannelAdmin).not.toHaveBeenCalled();
  });
});
