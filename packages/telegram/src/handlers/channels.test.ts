import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity, TelegramDeps } from "../ports";
import { mayCreateChannelFrom } from "./channels";

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

const casino: BotIdentity = {
  id: "bot_1",
  name: "CasinoBot",
  username: "casinobot",
  telegramBotId: 111n,
  vertical: "CASINO",
};
const sport: BotIdentity = {
  id: "bot_2",
  name: "SportBot",
  username: "sportbot",
  telegramBotId: 222n,
  vertical: "SPORTS",
};
const from = { id: 42, is_bot: false, first_name: "Jean", language_code: "fr" };
const unknownChannel = { id: -1007777, type: "channel" as const, title: "Canal oublié" };
const unknownGroup = { id: -1008888, type: "supergroup" as const, title: "Groupe quelconque" };

/** Deps simulées : `upsertChannel` signale un canal nouvellement créé (`created: true`) pour le canal inconnu. */
function makeDeps(opts: { created?: boolean; known?: string | null; recorded?: bigint[] } = {}) {
  const deps = {
    recordUpdate: vi.fn(async () => undefined),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberDmStatus: vi.fn(async () => undefined),
    upsertChannel: vi.fn(async () => ({ channelId: "c_new", created: opts.created ?? true })),
    findChannelId: vi.fn(async () => opts.known ?? null),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n, 222n]),
    listChannelAdminBotIds: vi.fn(async () => opts.recorded ?? [111n, 222n]),
    initPrimaryBot: vi.fn(async () => undefined),
    linkAdminAccount: vi.fn(async () => null),
    isPlatformUser: vi.fn(async () => false),
  } satisfies TelegramDeps;
  return deps;
}

type Sim = {
  /** Identifiants Telegram des administrateurs du chat (nos bots 111 / 222, l'humain 999 est toujours créateur). */
  admins?: number[];
  /** getChatAdministrators échoue (bot non administrateur ou panne). */
  adminsError?: { error_code: number; description: string };
  /** Réponse de getChatMember par identifiant (statut, ou erreur Telegram). */
  member?: Record<number, string | { error_code: number; description: string }>;
};

const BOT_USERS: Record<
  number,
  { id: number; is_bot: true; first_name: string; username: string }
> = {
  111: { id: 111, is_bot: true, first_name: "CasinoBot", username: "casinobot" },
  222: { id: 222, is_bot: true, first_name: "SportBot", username: "sportbot" },
};

/**
 * Bot grammY dont l'API simule Telegram fidèlement : sans `return_bots: true`, getChatAdministrators omet les autres bots
 * que le bot courant (comportement documenté de l'API Bot).
 */
function makeBot(deps: TelegramDeps, sim: Sim = {}, identity: BotIdentity = casino) {
  const bot = new Bot(`${identity.telegramBotId}:TEST`, { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const self = Number(identity.telegramBotId);
  bot.api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    apiCalls.push({ method, payload: p });
    if (method === "getChatAdministrators") {
      if (sim.adminsError) return { ok: false, ...sim.adminsError } as never;
      const ids = (sim.admins ?? [111, 222]).filter((id) => id === self || p.return_bots === true);
      return {
        ok: true,
        result: [
          ...ids.map((id) => ({ ...adminBase, user: BOT_USERS[id]!, can_post_messages: true })),
          {
            status: "creator",
            user: { id: 999, is_bot: false, first_name: "Owner" },
            is_anonymous: false,
          },
        ],
      } as never;
    }
    if (method === "getChatMember") {
      const answer = sim.member?.[Number(p.user_id)] ?? "left";
      if (typeof answer !== "string") return { ok: false, ...answer } as never;
      const user = BOT_USERS[Number(p.user_id)] ?? {
        id: Number(p.user_id),
        is_bot: false,
        first_name: "x",
      };
      return {
        ok: true,
        result:
          answer === "administrator"
            ? { ...adminBase, user, can_post_messages: true }
            : { status: answer, user },
      } as never;
    }
    return { ok: true, result: true } as never;
  });
  // Handlers de base seulement : les handlers spécialisés (adhésion, réactions) ont leurs propres tests.
  registerHandlers(bot, identity, deps, { extended: false });
  return { bot, apiCalls };
}

const post = (update_id: number, chat: typeof unknownChannel = unknownChannel): Update => ({
  update_id,
  channel_post: { message_id: update_id, date: 1, chat, text: "Hello", sender_chat: chat },
});
const calls = (
  apiCalls: Array<{ method: string; payload: Record<string, unknown> }>,
  method: string,
) => apiCalls.filter((c) => c.method === method);

describe("canal inconnu : toute mise à jour crée le canal et relève les droits de nos bots", () => {
  it("chat_join_request sur un canal inconnu crée le canal, enregistre nos bots administrateurs et pose le bot principal", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    const update: Update = {
      update_id: 50,
      chat_join_request: { chat: unknownChannel, from, user_chat_id: 42, date: 1_760_000_000 },
    };
    await bot.handleUpdate(update);
    expect(deps.upsertChannel).toHaveBeenCalledWith(unknownChannel);
    // Sans return_bots, Telegram omettrait notre autre bot : le paramètre est toujours passé.
    expect(calls(apiCalls, "getChatAdministrators")[0]?.payload.return_bots).toBe(true);
    // Nos deux bots (111 et 222) sont administrateurs ; l'humain 999 est ignoré.
    expect(deps.setChannelAdmin).toHaveBeenCalledTimes(2);
    expect(deps.setChannelAdmin).toHaveBeenCalledWith(
      "c_new",
      111n,
      expect.objectContaining({ status: "administrator" }),
    );
    expect(deps.setChannelAdmin).toHaveBeenCalledWith(
      "c_new",
      222n,
      expect.objectContaining({ status: "administrator" }),
    );
    expect(deps.initPrimaryBot).toHaveBeenCalledWith("c_new", 111n);
    expect(deps.recordUpdate).toHaveBeenCalledWith(casino, "chat_join_request", update, {
      channelId: "c_new",
      memberId: "m1",
    });
  });

  it("chat_member, message_reaction_count et edited_channel_post sur un canal inconnu créent aussi le canal avec ses droits", async () => {
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
      {
        update_id: 52,
        message_reaction_count: { chat: unknownChannel, message_id: 7, date: 1, reactions: [] },
      },
      {
        update_id: 53,
        edited_channel_post: {
          message_id: 8,
          date: 1,
          edit_date: 2,
          chat: unknownChannel,
          text: "Modifié",
          sender_chat: unknownChannel,
        },
      },
    ] satisfies Update[]) {
      const deps = makeDeps();
      const { bot, apiCalls } = makeBot(deps);
      await bot.handleUpdate(update);
      expect(deps.upsertChannel).toHaveBeenCalledWith(unknownChannel);
      expect(calls(apiCalls, "getChatAdministrators")).toHaveLength(1);
      expect(deps.setChannelAdmin).toHaveBeenCalledTimes(2);
      // Canal tout juste créé : rien à retirer, aucune confirmation nécessaire.
      expect(deps.revokeChannelAdmin).not.toHaveBeenCalled();
      expect(calls(apiCalls, "getChatMember")).toHaveLength(0);
      expect(deps.recordUpdate).toHaveBeenCalledWith(
        casino,
        Object.keys(update)[1],
        update,
        expect.objectContaining({ channelId: "c_new" }),
      );
    }
  });

  it("my_chat_member (bot nommé administrateur) sur un canal inconnu crée le canal et ses droits", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 54,
      my_chat_member: {
        chat: unknownChannel,
        from: { id: 999, is_bot: false, first_name: "Owner" },
        date: 1,
        old_chat_member: { status: "left", user: BOT_USERS[111]! },
        new_chat_member: { ...adminBase, user: BOT_USERS[111]!, can_post_messages: true },
      },
    });
    expect(deps.upsertChannel).toHaveBeenCalledWith(unknownChannel);
    expect(deps.setChannelAdmin).toHaveBeenCalledWith(
      "c_new",
      111n,
      expect.objectContaining({ status: "administrator" }),
    );
    expect(deps.initPrimaryBot).toHaveBeenCalledWith("c_new", 111n);
  });

  it("un canal déjà connu ne déclenche pas de relevé des droits sur une simple demande d'adhésion", async () => {
    const deps = makeDeps({ created: false });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 55,
      chat_join_request: { chat: unknownChannel, from, user_chat_id: 42, date: 1 },
    });
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
    expect(calls(apiCalls, "getChatAdministrators")).toHaveLength(0);
    expect(deps.setChannelAdmin).not.toHaveBeenCalled();
    expect(deps.initPrimaryBot).not.toHaveBeenCalled();
  });

  it("sans droit de lecture des administrateurs, le canal est créé quand même et rien ne casse", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps, {
      adminsError: { error_code: 400, description: "Bad Request: CHAT_ADMIN_REQUIRED" },
    });
    await bot.handleUpdate(post(56));
    expect(deps.upsertChannel).toHaveBeenCalledWith(unknownChannel);
    expect(deps.setChannelAdmin).not.toHaveBeenCalled();
    expect(deps.recordUpdate).toHaveBeenCalledWith(casino, "channel_post", expect.anything(), {
      channelId: "c_new",
    });
  });
});

describe("pas de canal fantôme", () => {
  it("bot retiré (left / kicked) d'un canal inconnu : rien n'est créé, aucun appel à Telegram", async () => {
    for (const status of ["left", "kicked"] as const) {
      const deps = makeDeps();
      const { bot, apiCalls } = makeBot(deps);
      await bot.handleUpdate({
        update_id: 60,
        my_chat_member: {
          chat: unknownChannel,
          from: { id: 999, is_bot: false, first_name: "Owner" },
          date: 1,
          old_chat_member: { ...adminBase, user: BOT_USERS[111]!, can_post_messages: true },
          new_chat_member:
            status === "kicked"
              ? { status, user: BOT_USERS[111]!, until_date: 0 }
              : { status, user: BOT_USERS[111]! },
        },
      });
      expect(deps.upsertChannel).not.toHaveBeenCalled();
      expect(deps.revokeChannelAdmin).not.toHaveBeenCalled();
      expect(apiCalls).toHaveLength(0);
      expect(deps.recordUpdate).toHaveBeenCalledWith(casino, "my_chat_member", expect.anything(), {
        memberId: "m1",
      });
    }
  });

  it("bot retiré d'un canal connu : ses droits sont retirés, sans recréer le canal", async () => {
    const deps = makeDeps({ known: "c_old" });
    const { bot } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 61,
      my_chat_member: {
        chat: unknownChannel,
        from: { id: 999, is_bot: false, first_name: "Owner" },
        date: 1,
        old_chat_member: { ...adminBase, user: BOT_USERS[111]!, can_post_messages: true },
        new_chat_member: { status: "left", user: BOT_USERS[111]! },
      },
    });
    expect(deps.upsertChannel).not.toHaveBeenCalled();
    expect(deps.revokeChannelAdmin).toHaveBeenCalledWith("c_old", 111n);
  });

  it("groupe inconnu : un message ou un ajout comme simple membre ne crée rien ; une promotion administrateur le crée", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 62,
      message: { message_id: 1, date: 1, chat: unknownGroup, from, text: "salut" },
    });
    await bot.handleUpdate({
      update_id: 63,
      my_chat_member: {
        chat: unknownGroup,
        from,
        date: 1,
        old_chat_member: { status: "left", user: BOT_USERS[111]! },
        new_chat_member: { status: "member", user: BOT_USERS[111]! },
      },
    });
    expect(deps.upsertChannel).not.toHaveBeenCalled();
    await bot.handleUpdate({
      update_id: 64,
      my_chat_member: {
        chat: unknownGroup,
        from,
        date: 1,
        old_chat_member: { status: "member", user: BOT_USERS[111]! },
        new_chat_member: { ...adminBase, user: BOT_USERS[111]! },
      },
    });
    expect(deps.upsertChannel).toHaveBeenCalledWith(unknownGroup);
  });

  it("mayCreateChannelFrom : règles par type de mise à jour", () => {
    const u = {} as Update;
    expect(mayCreateChannelFrom("channel_post", u, unknownChannel)).toBe(true);
    expect(mayCreateChannelFrom("message", u, unknownGroup)).toBe(false);
    expect(mayCreateChannelFrom("chat_join_request", u, unknownGroup)).toBe(true);
    expect(mayCreateChannelFrom("chat_member", u, unknownGroup)).toBe(true);
  });
});

describe("relevé des droits avec plusieurs de nos bots", () => {
  it("2 bots administrateurs, la publication reçue par chacun : aucun retrait", async () => {
    const deps = makeDeps({ created: false });
    const a = makeBot(deps, { admins: [111, 222] }, casino);
    const b = makeBot(deps, { admins: [111, 222] }, sport);
    await Promise.all([a.bot.handleUpdate(post(70)), b.bot.handleUpdate(post(70))]);
    expect(deps.revokeChannelAdmin).not.toHaveBeenCalled();
    // Chaque bot voit les deux bots (return_bots) et les enregistre.
    expect(deps.setChannelAdmin).toHaveBeenCalledTimes(4);
    expect(calls([...a.apiCalls, ...b.apiCalls], "getChatMember")).toHaveLength(0);
  });

  it("un bot vraiment retiré (getChatMember « left ») perd ses droits", async () => {
    const deps = makeDeps({ created: false });
    const { bot, apiCalls } = makeBot(deps, { admins: [111], member: { 222: "left" } });
    await bot.handleUpdate(post(71));
    expect(calls(apiCalls, "getChatMember").map((c) => c.payload.user_id)).toEqual([222]);
    expect(deps.revokeChannelAdmin).toHaveBeenCalledWith("c_new", 222n);
    expect(deps.revokeChannelAdmin).toHaveBeenCalledTimes(1);
  });

  it("liste incomplète : getChatMember dit « administrateur », droits enregistrés au lieu d'un retrait", async () => {
    const deps = makeDeps({ created: false });
    const { bot } = makeBot(deps, { admins: [111], member: { 222: "administrator" } });
    await bot.handleUpdate(post(72));
    expect(deps.revokeChannelAdmin).not.toHaveBeenCalled();
    expect(deps.setChannelAdmin).toHaveBeenCalledWith(
      "c_new",
      222n,
      expect.objectContaining({ status: "administrator" }),
    );
  });

  it("confirmation impossible (429, panne) : on ne retire rien sur un doute", async () => {
    for (const error of [
      { error_code: 429, description: "Too Many Requests: retry after 5" },
      { error_code: 500, description: "Internal Server Error" },
    ]) {
      const deps = makeDeps({ created: false });
      const { bot } = makeBot(deps, { admins: [111], member: { 222: error } });
      await bot.handleUpdate(post(73));
      expect(deps.revokeChannelAdmin).not.toHaveBeenCalled();
    }
  });

  it("« user not found » confirme l'absence ; seuls les bots enregistrés comme administrateurs sont vérifiés", async () => {
    const deps = makeDeps({ created: false, recorded: [111n, 222n] });
    const { bot } = makeBot(deps, {
      admins: [111],
      member: { 222: { error_code: 400, description: "Bad Request: user not found" } },
    });
    await bot.handleUpdate(post(74));
    expect(deps.revokeChannelAdmin).toHaveBeenCalledWith("c_new", 222n);

    const deps2 = makeDeps({ created: false, recorded: [111n] });
    const second = makeBot(deps2, { admins: [111] });
    await second.bot.handleUpdate(post(75));
    expect(calls(second.apiCalls, "getChatMember")).toHaveLength(0);
    expect(deps2.revokeChannelAdmin).not.toHaveBeenCalled();
  });
});
