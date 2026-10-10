import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity, TelegramDeps } from "../ports";
import { forwardedChannelOf } from "./forward";

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
const from = { id: 42, is_bot: false, first_name: "Mathéo", language_code: "fr" };
const privateChat = { id: 42, type: "private" as const, first_name: "Mathéo" };
const channel = { id: -1009999, type: "channel" as const, title: "Canal VIP" };

function makeDeps(opts: { platformUser?: boolean; recheck?: Array<{ telegramBotId: bigint; username: string }> } = {}) {
  return {
    recordUpdate: vi.fn(async () => undefined),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberDmStatus: vi.fn(async () => undefined),
    upsertChannel: vi.fn(async () => ({ channelId: "c_vip", created: true })),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n, 222n]),
    linkAdminAccount: vi.fn(async () => null),
    isPlatformUser: vi.fn(async () => opts.platformUser ?? true),
    auditChannel: vi.fn(async () => undefined),
    recheckChannelRights: vi.fn(async () => opts.recheck ?? []),
  } satisfies TelegramDeps;
}

function makeBot(deps: TelegramDeps, opts: { botIsAdmin?: boolean; getChatFails?: boolean } = {}) {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "getChat") {
      if (opts.getChatFails) return { ok: false, error_code: 400, description: "Bad Request: chat not found" } as never;
      return { ok: true, result: { ...channel, title: "Canal VIP (titre à jour)", username: "canalvip" } } as never;
    }
    if (method === "getChatAdministrators") {
      if (opts.botIsAdmin === false) return { ok: false, error_code: 400, description: "Bad Request: CHAT_ADMIN_REQUIRED" } as never;
      return {
        ok: true,
        result: [
          { ...adminBase, user: { id: 111, is_bot: true, first_name: "CasinoBot", username: "casinobot" }, can_post_messages: true },
          { status: "creator", user: { id: 999, is_bot: false, first_name: "Owner" }, is_anonymous: false },
        ],
      } as never;
    }
    return { ok: true, result: { message_id: 1, date: 0, chat: privateChat, text: "ok" } } as never;
  });
  registerHandlers(bot, identity, deps, { extended: false });
  return { bot, apiCalls };
}

function forwardUpdate(extra: Record<string, unknown> = {}): Update {
  return {
    update_id: 70,
    message: {
      message_id: 10,
      date: 1,
      chat: privateChat,
      from,
      text: "Un message du canal",
      forward_origin: { type: "channel", chat: channel, message_id: 123, date: 1 },
      ...extra,
    } as never,
  };
}

const sentText = (apiCalls: Array<{ method: string; payload: Record<string, unknown> }>) => String(apiCalls.find((c) => c.method === "sendMessage")?.payload.text ?? "");

describe("transfert d'un message de canal au bot (méthode 1)", () => {
  it("utilisateur de la plateforme + bot administrateur : canal ajouté, droits enregistrés, audit", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(forwardUpdate());
    expect(deps.isPlatformUser).toHaveBeenCalledWith(42n);
    expect(apiCalls.some((c) => c.method === "getChat")).toBe(true);
    // Titre à jour venant de getChat.
    expect(deps.upsertChannel).toHaveBeenCalledWith({ id: channel.id, type: "channel", title: "Canal VIP (titre à jour)", username: "canalvip" });
    expect(deps.setChannelAdmin).toHaveBeenCalledWith("c_vip", 111n, expect.objectContaining({ status: "administrator" }));
    // 222 n'est pas administrateur : droits retirés (sans effet s'il n'en avait pas).
    expect(deps.revokeChannelAdmin).toHaveBeenCalledWith("c_vip", 222n);
    expect(deps.auditChannel).toHaveBeenCalledWith(expect.objectContaining({ action: "channel.imported_by_forward", channelId: "c_vip", telegramUserId: 42n }));
    expect(sentText(apiCalls)).toBe("Canal « Canal VIP (titre à jour) » ajouté ✅ (bots administrateurs : @casinobot)");
    // Le /start générique n'a pas répondu en plus.
    expect(apiCalls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
  });

  it("expéditeur inconnu : réponse neutre, rien n'est créé", async () => {
    const deps = makeDeps({ platformUser: false });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(forwardUpdate());
    expect(sentText(apiCalls)).toBe("Je ne reconnais pas votre compte.");
    expect(deps.upsertChannel).not.toHaveBeenCalled();
    expect(apiCalls.some((c) => c.method === "getChat" || c.method === "getChatAdministrators")).toBe(false);
    expect(deps.auditChannel).not.toHaveBeenCalled();
  });

  it("bot pas administrateur (et aucun autre) : canal créé quand même, explication claire", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps, { botIsAdmin: false, getChatFails: true });
    await bot.handleUpdate(forwardUpdate());
    // getChat a échoué : les informations du transfert servent telles quelles.
    expect(deps.upsertChannel).toHaveBeenCalledWith(channel);
    expect(deps.setChannelAdmin).not.toHaveBeenCalled();
    expect(deps.recheckChannelRights).toHaveBeenCalledWith("c_vip");
    const text = sentText(apiCalls);
    expect(text).toContain("aucun de nos bots n'en est administrateur");
    expect(text).toContain("Administrateurs → Ajouter un administrateur → @casinobot");
  });

  it("bot pas administrateur mais un autre de nos bots l'est : confirmation avec ce bot", async () => {
    const deps = makeDeps({ recheck: [{ telegramBotId: 222n, username: "sportbot" }] });
    const { bot, apiCalls } = makeBot(deps, { botIsAdmin: false });
    await bot.handleUpdate(forwardUpdate());
    expect(sentText(apiCalls)).toBe("Canal « Canal VIP (titre à jour) » ajouté ✅ (bots administrateurs : @sportbot)");
  });

  it("accepte l'ancien champ forward_from_chat", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(forwardUpdate({ forward_origin: undefined, forward_from_chat: channel }));
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
    expect(sentText(apiCalls)).toContain("ajouté ✅");
  });

  it("un message privé ordinaire ou un transfert depuis une personne passe au /start habituel", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate({ update_id: 71, message: { message_id: 11, date: 1, chat: privateChat, from, text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }], forward_origin: { type: "user", sender_user: from, date: 1 } } });
    expect(deps.upsertChannel).not.toHaveBeenCalled();
    expect(deps.memberStarted).toHaveBeenCalledTimes(1);
    expect(sentText(apiCalls)).toContain("Bonjour");
  });

  it("forwardedChannelOf ignore les autres origines", () => {
    expect(forwardedChannelOf({ message_id: 1, date: 1, chat: privateChat, forward_origin: { type: "hidden_user", sender_user_name: "x", date: 1 } } as never)).toBeNull();
    expect(forwardedChannelOf({ message_id: 1, date: 1, chat: privateChat, forward_origin: { type: "channel", chat: channel, message_id: 1, date: 1 } } as never)).toEqual(channel);
  });
});
