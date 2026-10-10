import { beforeEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";

const channelFind = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const postFindFirst = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const statsUpsert = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => undefined);
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    channel: { findUnique: (...a: unknown[]) => channelFind(...a) },
    post: { findFirst: (...a: unknown[]) => postFindFirst(...a) },
    postStats: { upsert: (...a: unknown[]) => statsUpsert(...a) },
  },
}));

import { registerReactionHandlers, summarizeReactions } from "./reactions";
import { botInfoFromRecord } from "../factory";

const identity = { id: "b1", name: "Bot", username: "bot", telegramBotId: 1n, vertical: "CASINO" as const };

describe("réactions", () => {
  beforeEach(() => {
    channelFind.mockReset();
    postFindFirst.mockReset();
    statsUpsert.mockClear();
  });
  it("résume les réactions", () => {
    expect(summarizeReactions([{ type: { type: "emoji", emoji: "👍" }, total_count: 3 }, { type: { type: "custom_emoji", custom_emoji_id: "123" }, total_count: 1 }])).toEqual({ reactions: { "👍": 3, "custom:123": 1 }, total: 4 });
  });
  it("met à jour PostStats pour le message correspondant", async () => {
    channelFind.mockResolvedValue({ id: "c1" });
    postFindFirst.mockResolvedValue({ id: "p1" });
    const bot = new Bot("1:T", { botInfo: botInfoFromRecord(identity) });
    registerReactionHandlers(bot, identity);
    await bot.handleUpdate({
      update_id: 1,
      message_reaction_count: { chat: { id: -100123, type: "channel", title: "C" }, message_id: 42, date: 1, reactions: [{ type: { type: "emoji", emoji: "🔥" }, total_count: 2 }] },
    });
    expect(postFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ channelId: "c1" }) }));
    expect(statsUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { postId: "p1" }, update: { reactions: { "🔥": 2 }, reactionsTotal: 2 } }));
  });
  it("crée un canal inconnu (droits relevés) puis ignore le message sans Post correspondant", async () => {
    channelFind.mockResolvedValue(null);
    postFindFirst.mockResolvedValue(null);
    const channelDeps = {
      upsertChannel: vi.fn(async () => ({ channelId: "c_new", created: true })),
      setChannelAdmin: vi.fn(async () => undefined),
      revokeChannelAdmin: vi.fn(async () => undefined),
      listOurBotTelegramIds: vi.fn(async () => [1n]),
    };
    const bot = new Bot("1:T", { botInfo: botInfoFromRecord(identity) });
    bot.api.config.use(async (_prev, method) => {
      if (method === "getChatAdministrators") return { ok: true, result: [{ status: "administrator", user: { id: 1, is_bot: true, first_name: "Bot" }, can_be_edited: false, is_anonymous: false, can_manage_chat: true, can_delete_messages: true, can_manage_video_chats: false, can_restrict_members: false, can_promote_members: false, can_change_info: false, can_invite_users: true, can_post_stories: false, can_edit_stories: false, can_delete_stories: false, can_send_welcome_messages: false }] } as never;
      return { ok: true, result: true } as never;
    });
    registerReactionHandlers(bot, identity, channelDeps);
    await bot.handleUpdate({ update_id: 2, message_reaction_count: { chat: { id: -1, type: "channel", title: "C" }, message_id: 1, date: 1, reactions: [] } });
    expect(channelDeps.upsertChannel).toHaveBeenCalledWith({ id: -1, type: "channel", title: "C" });
    expect(channelDeps.setChannelAdmin).toHaveBeenCalledWith("c_new", 1n, expect.objectContaining({ status: "administrator" }));
    expect(postFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ channelId: "c_new" }) }));
    expect(statsUpsert).not.toHaveBeenCalled();
  });
});
