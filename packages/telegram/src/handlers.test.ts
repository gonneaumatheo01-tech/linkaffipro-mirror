import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { registerHandlers, updateTypeOf } from "./handlers";
import { botInfoFromRecord } from "./factory";
import type { BotIdentity, TelegramDeps } from "./ports";

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

const identity: BotIdentity = {
  id: "bot_1",
  name: "CasinoBot",
  username: "casinobot",
  telegramBotId: 111n,
  vertical: "CASINO",
};

function makeDeps(): TelegramDeps & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const rec = <R>(name: string, ret: R) =>
    vi.fn(async (...args: unknown[]): Promise<R> => {
      (calls[name] ??= []).push(args);
      return ret;
    }) as unknown as (...args: never[]) => Promise<R>;
  return {
    calls,
    recordUpdate: rec("recordUpdate", undefined),
    memberStarted: rec("memberStarted", { memberId: "m1" }),
    memberSeen: rec("memberSeen", { memberId: "m1" }),
    memberDmStatus: rec("memberDmStatus", undefined),
    memberWrote: rec("memberWrote", undefined),
    upsertChannel: rec("upsertChannel", { channelId: "c1" }),
    findChannelId: rec("findChannelId", "c1"),
    setChannelAdmin: rec("setChannelAdmin", undefined),
    revokeChannelAdmin: rec("revokeChannelAdmin", undefined),
    listOurBotTelegramIds: rec("listOurBotTelegramIds", [111n, 222n]),
    linkAdminAccount: vi.fn(async (token: string) =>
      token === "good" ? { name: "Mathéo" } : null,
    ),
    isPlatformUser: rec("isPlatformUser", false),
  };
}

function makeBot(deps: TelegramDeps) {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: unknown }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload });
    if (method === "getChatAdministrators") {
      return {
        ok: true,
        result: [
          {
            ...adminBase,
            user: { id: 111, is_bot: true, first_name: "CasinoBot" },
            can_post_messages: true,
          },
          {
            status: "creator",
            user: { id: 999, is_bot: false, first_name: "Owner" },
            is_anonymous: false,
          },
          {
            ...adminBase,
            user: { id: 333, is_bot: true, first_name: "AutreBot" },
            can_post_messages: true,
          },
        ],
      } as never;
    }
    return {
      ok: true,
      result: {
        message_id: 1,
        date: 0,
        chat: { id: 42, type: "private", first_name: "x" },
        text: "ok",
      },
    } as never;
  });
  registerHandlers(bot, identity, deps);
  return { bot, apiCalls };
}

const from = { id: 42, is_bot: false, first_name: "Jean", language_code: "fr" };
const privateChat = { id: 42, type: "private" as const, first_name: "Jean" };

describe("/start", () => {
  it("enregistre le membre et répond en français", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    const update: Update = {
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: privateChat,
        from,
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    };
    await bot.handleUpdate(update);
    expect(deps.memberStarted).toHaveBeenCalledTimes(1);
    expect(deps.calls.memberStarted?.[0]?.[2]).toBeUndefined();
    const reply = apiCalls.find((c) => c.method === "sendMessage");
    expect(reply).toBeDefined();
    expect((reply?.payload as { text: string }).text).toBe(
      "Bonjour, je suis CasinoBot, le bot casino.",
    );
    expect(deps.recordUpdate).toHaveBeenCalledWith(identity, "message", update, { memberId: "m1" });
  });

  it("répond en anglais selon la langue du membre", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1,
        chat: privateChat,
        from: { ...from, language_code: "en-US" },
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    });
    expect(
      (apiCalls.find((c) => c.method === "sendMessage")?.payload as { text: string }).text,
    ).toBe("Hello, I am CasinoBot, the casino bot.");
  });

  it("lie un compte admin avec /start admin_<token>", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 3,
        date: 1,
        chat: privateChat,
        from,
        text: "/start admin_good",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    });
    expect(deps.linkAdminAccount).toHaveBeenCalledWith("good", 42n);
    expect(
      (apiCalls.find((c) => c.method === "sendMessage")?.payload as { text: string }).text,
    ).toContain("Mathéo");
  });

  it("signale un jeton admin invalide", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 4,
      message: {
        message_id: 4,
        date: 1,
        chat: privateChat,
        from,
        text: "/start admin_bad",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    });
    expect(
      (apiCalls.find((c) => c.method === "sendMessage")?.payload as { text: string }).text,
    ).toMatch(/invalide/);
  });
});

describe("message privé au bot (phase 14)", () => {
  it("une personne qui écrit au bot (autre chose que /start) devient joignable", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 5,
      message: { message_id: 5, date: 1, chat: privateChat, from, text: "ok" },
    });
    expect(deps.calls.memberWrote).toEqual([[identity, "m1"]]);
  });

  it("une photo envoyée au bot compte aussi", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 6,
      message: {
        message_id: 6,
        date: 1,
        chat: privateChat,
        from,
        photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }],
      },
    });
    expect(deps.calls.memberWrote).toEqual([[identity, "m1"]]);
  });

  it("un message dans un groupe ou un message modifié ne compte pas", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps);
    const group = { id: -1009876, type: "supergroup" as const, title: "Groupe" };
    await bot.handleUpdate({
      update_id: 7,
      message: { message_id: 7, date: 1, chat: group, from, text: "ok" },
    });
    await bot.handleUpdate({
      update_id: 9,
      edited_message: {
        message_id: 5,
        date: 1,
        edit_date: 2,
        chat: privateChat,
        from,
        text: "ok !",
      },
    });
    expect(deps.calls.memberWrote).toBeUndefined();
  });

  it("un échec de l'enregistrement ne bloque jamais le reste", async () => {
    const deps = makeDeps();
    deps.memberWrote = vi.fn(async () => {
      throw new Error("base indisponible");
    });
    const { bot } = makeBot(deps);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const update: Update = {
      update_id: 10,
      message: { message_id: 10, date: 1, chat: privateChat, from, text: "ok" },
    };
    await bot.handleUpdate(update);
    expect(deps.recordUpdate).toHaveBeenCalledWith(identity, "message", update, { memberId: "m1" });
    err.mockRestore();
  });
});

describe("my_chat_member", () => {
  const channel = { id: -1001234, type: "channel" as const, title: "Canal Test" };

  it("détecte le bot ajouté comme administrateur d'un canal", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps);
    const update: Update = {
      update_id: 10,
      my_chat_member: {
        chat: channel,
        from: { id: 999, is_bot: false, first_name: "Owner" },
        date: 1,
        old_chat_member: {
          status: "left",
          user: { id: 111, is_bot: true, first_name: "CasinoBot" },
        },
        new_chat_member: {
          ...adminBase,
          user: { id: 111, is_bot: true, first_name: "CasinoBot" },
          can_post_messages: true,
          can_edit_messages: true,
        },
      },
    };
    await bot.handleUpdate(update);
    expect(deps.upsertChannel).toHaveBeenCalledWith(channel);
    expect(deps.setChannelAdmin).toHaveBeenCalledTimes(1);
    const [channelId, botTgId, rights] = deps.calls.setChannelAdmin?.[0] as [
      string,
      bigint,
      Record<string, unknown>,
    ];
    expect(channelId).toBe("c1");
    expect(botTgId).toBe(111n);
    expect(rights).toMatchObject({
      status: "administrator",
      can_post_messages: true,
      can_invite_users: true,
    });
    expect(deps.recordUpdate).toHaveBeenCalledWith(identity, "my_chat_member", update, {
      channelId: "c1",
      memberId: "m1",
    });
  });

  it("révoque quand le bot est retiré", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 11,
      my_chat_member: {
        chat: channel,
        from: { id: 999, is_bot: false, first_name: "Owner" },
        date: 1,
        old_chat_member: {
          ...adminBase,
          user: { id: 111, is_bot: true, first_name: "CasinoBot" },
          can_post_messages: true,
        },
        new_chat_member: {
          status: "left",
          user: { id: 111, is_bot: true, first_name: "CasinoBot" },
        },
      },
    });
    expect(deps.revokeChannelAdmin).toHaveBeenCalledWith("c1", 111n);
    expect(deps.setChannelAdmin).not.toHaveBeenCalled();
    // Canal connu : retrouvé sans être recréé.
    expect(deps.upsertChannel).not.toHaveBeenCalled();
  });

  it("marque un membre qui bloque le bot en privé", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 12,
      my_chat_member: {
        chat: privateChat,
        from,
        date: 1,
        old_chat_member: {
          status: "member",
          user: { id: 111, is_bot: true, first_name: "CasinoBot" },
        },
        new_chat_member: {
          status: "kicked",
          user: { id: 111, is_bot: true, first_name: "CasinoBot" },
          until_date: 0,
        },
      },
    });
    expect(deps.memberDmStatus).toHaveBeenCalledWith(identity, from, false);
  });
});

describe("channel_post", () => {
  it("enregistre le canal et détecte nos bots parmi les administrateurs", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    const channel = { id: -1005555, type: "channel" as const, title: "Nouveau canal" };
    await bot.handleUpdate({
      update_id: 20,
      channel_post: {
        message_id: 5,
        date: 1,
        chat: channel,
        text: "Bonjour",
        sender_chat: channel,
      },
    });
    expect(deps.upsertChannel).toHaveBeenCalledWith(channel);
    expect(apiCalls.some((c) => c.method === "getChatAdministrators")).toBe(true);
    // Seul notre bot (111) est enregistré ; 333 n'est pas à nous, 999 est un humain.
    expect(deps.setChannelAdmin).toHaveBeenCalledTimes(1);
    expect(deps.calls.setChannelAdmin?.[0]?.[1]).toBe(111n);
  });
});

describe("updateTypeOf", () => {
  it("retrouve le type d'une update", () => {
    expect(updateTypeOf({ update_id: 1, message: {} as never })).toBe("message");
    expect(updateTypeOf({ update_id: 1, chat_join_request: {} as never })).toBe(
      "chat_join_request",
    );
  });
});
