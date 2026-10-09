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
  it("ignore un canal inconnu", async () => {
    channelFind.mockResolvedValue(null);
    const bot = new Bot("1:T", { botInfo: botInfoFromRecord(identity) });
    registerReactionHandlers(bot, identity);
    await bot.handleUpdate({ update_id: 2, message_reaction_count: { chat: { id: -1, type: "channel", title: "C" }, message_id: 1, date: 1, reactions: [] } });
    expect(statsUpsert).not.toHaveBeenCalled();
  });
});
