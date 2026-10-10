import { afterEach, describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { registerHandlers } from "../handlers";
import { botInfoFromRecord } from "../factory";
import { MESSAGES } from "../i18n";
import type { BotIdentity, LinkImportOutcome, RecheckOutcome, TelegramDeps } from "../ports";
import { forwardedChannelOf, RecentKeys } from "./forward";

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
const from = { id: 42, is_bot: false, first_name: "Mathéo", language_code: "fr" };
const privateChat = { id: 42, type: "private" as const, first_name: "Mathéo" };
const channel = { id: -1009999, type: "channel" as const, title: "Canal VIP" };
const FR = MESSAGES.fr;

function makeDeps(
  opts: {
    platformUser?: boolean;
    dialogAdmin?: boolean;
    recheck?: RecheckOutcome;
    link?: LinkImportOutcome;
  } = {},
) {
  return {
    recordUpdate: vi.fn(async () => undefined),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberDmStatus: vi.fn(async () => undefined),
    upsertChannel: vi.fn(async () => ({ channelId: "c_vip", created: true })),
    findChannelId: vi.fn(async () => null),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n, 222n]),
    initPrimaryBot: vi.fn(async () => undefined),
    linkAdminAccount: vi.fn(async () => null),
    isPlatformUser: vi.fn(async () => opts.platformUser ?? true),
    isAdminDialogPartner: vi.fn(async () => opts.dialogAdmin ?? false),
    auditChannel: vi.fn(async () => undefined),
    recheckChannelRights: vi.fn(
      async (): Promise<RecheckOutcome> => opts.recheck ?? { admins: [], unavailable: false },
    ),
    importChannelByLink: vi.fn(
      async (): Promise<LinkImportOutcome> =>
        opts.link ?? {
          ok: true,
          title: "Mon canal",
          created: true,
          admins: [{ telegramBotId: 111n, username: "casinobot" }],
        },
    ),
  } satisfies TelegramDeps;
}

type BotSim = {
  botIsAdmin?: boolean;
  getChatFails?: boolean;
  adminsError?: { error_code: number; description: string };
};

function makeBot(deps: TelegramDeps, opts: BotSim = {}) {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "getChat") {
      if (opts.getChatFails)
        return { ok: false, error_code: 400, description: "Bad Request: chat not found" } as never;
      return {
        ok: true,
        result: { ...channel, title: "Canal VIP (titre à jour)", username: "canalvip" },
      } as never;
    }
    if (method === "getChatAdministrators") {
      if (opts.adminsError) return { ok: false, ...opts.adminsError } as never;
      if (opts.botIsAdmin === false)
        return {
          ok: false,
          error_code: 400,
          description: "Bad Request: CHAT_ADMIN_REQUIRED",
        } as never;
      return {
        ok: true,
        result: [
          {
            ...adminBase,
            user: { id: 111, is_bot: true, first_name: "CasinoBot", username: "casinobot" },
            can_post_messages: true,
          },
          {
            status: "creator",
            user: { id: 999, is_bot: false, first_name: "Owner" },
            is_anonymous: false,
          },
        ],
      } as never;
    }
    return { ok: true, result: { message_id: 1, date: 0, chat: privateChat, text: "ok" } } as never;
  });
  registerHandlers(bot, identity, deps, { extended: false });
  return { bot, apiCalls };
}

let nextUpdateId = 100;
function forwardUpdate(extra: Record<string, unknown> = {}): Update {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 1,
      chat: privateChat,
      from,
      text: "Un message du canal",
      forward_origin: { type: "channel", chat: channel, message_id: 123, date: 1 },
      ...extra,
    } as never,
  };
}
function textUpdate(text: string, extra: Record<string, unknown> = {}): Update {
  return {
    update_id: nextUpdateId++,
    message: {
      message_id: nextUpdateId,
      date: 1,
      chat: privateChat,
      from,
      text,
      ...extra,
    } as never,
  };
}

type Calls = Array<{ method: string; payload: Record<string, unknown> }>;
const sent = (apiCalls: Calls) =>
  apiCalls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
const sentText = (apiCalls: Calls) => sent(apiCalls)[0] ?? "";

afterEach(() => {
  vi.useRealTimers();
});

describe("transfert d'un message de canal au bot (méthode 1)", () => {
  it("utilisateur de la plateforme + bot administrateur : canal ajouté, droits enregistrés, bot principal posé, audit", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(forwardUpdate());
    expect(deps.isPlatformUser).toHaveBeenCalledWith(42n);
    expect(apiCalls.some((c) => c.method === "getChat")).toBe(true);
    expect(apiCalls.find((c) => c.method === "getChatAdministrators")?.payload.return_bots).toBe(
      true,
    );
    // Titre à jour venant de getChat.
    expect(deps.upsertChannel).toHaveBeenCalledWith({
      id: channel.id,
      type: "channel",
      title: "Canal VIP (titre à jour)",
      username: "canalvip",
    });
    expect(deps.setChannelAdmin).toHaveBeenCalledWith(
      "c_vip",
      111n,
      expect.objectContaining({ status: "administrator" }),
    );
    // Canal tout juste créé : rien à retirer.
    expect(deps.revokeChannelAdmin).not.toHaveBeenCalled();
    expect(deps.initPrimaryBot).toHaveBeenCalledWith("c_vip", 111n);
    expect(deps.auditChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "channel.imported_by_forward",
        channelId: "c_vip",
        telegramUserId: 42n,
      }),
    );
    expect(sentText(apiCalls)).toBe(
      "Canal « Canal VIP (titre à jour) » ajouté ✅ (bots administrateurs : @casinobot)",
    );
    // Le /start générique n'a pas répondu en plus.
    expect(sent(apiCalls)).toHaveLength(1);
  });

  it("expéditeur inconnu : pas de « Je ne reconnais pas votre compte », rien n'est créé, traitement habituel", async () => {
    const deps = makeDeps({ platformUser: false });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(forwardUpdate());
    expect(sent(apiCalls)).toEqual([]);
    expect(deps.upsertChannel).not.toHaveBeenCalled();
    expect(
      apiCalls.some((c) => c.method === "getChat" || c.method === "getChatAdministrators"),
    ).toBe(false);
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
    const deps = makeDeps({
      recheck: { admins: [{ telegramBotId: 222n, username: "sportbot" }], unavailable: false },
    });
    const { bot, apiCalls } = makeBot(deps, { botIsAdmin: false });
    await bot.handleUpdate(forwardUpdate());
    expect(sentText(apiCalls)).toBe(
      "Canal « Canal VIP (titre à jour) » ajouté ✅ (bots administrateurs : @sportbot)",
    );
  });

  it("re-vérification impossible (réseau, 429) : « Vérification impossible pour le moment » au lieu de « aucun bot »", async () => {
    const deps = makeDeps({ recheck: { admins: [], unavailable: true } });
    const { bot, apiCalls } = makeBot(deps, {
      adminsError: { error_code: 429, description: "Too Many Requests: retry after 3" },
    });
    await bot.handleUpdate(forwardUpdate());
    expect(sentText(apiCalls)).toBe(FR.forwardCheckUnavailable);
    expect(sentText(apiCalls)).toBe(
      "Vérification impossible pour le moment, réessayez dans une minute.",
    );
    expect(deps.revokeChannelAdmin).not.toHaveBeenCalled();

    // Re-vérification qui lève : même réponse.
    const deps2 = makeDeps();
    deps2.recheckChannelRights.mockRejectedValueOnce(new Error("réseau"));
    const second = makeBot(deps2, { botIsAdmin: false });
    await second.bot.handleUpdate(forwardUpdate());
    expect(sentText(second.apiCalls)).toBe(FR.forwardCheckUnavailable);
  });

  it("accepte l'ancien champ forward_from_chat", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(
      forwardUpdate({ forward_origin: undefined, forward_from_chat: channel }),
    );
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
    expect(sentText(apiCalls)).toContain("ajouté ✅");
  });

  it("un /start (même transféré depuis une personne) passe au /start habituel", async () => {
    const deps = makeDeps({ platformUser: false });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate({
      update_id: 71,
      message: {
        message_id: 11,
        date: 1,
        chat: privateChat,
        from,
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    });
    expect(deps.upsertChannel).not.toHaveBeenCalled();
    expect(deps.memberStarted).toHaveBeenCalledTimes(1);
    expect(sentText(apiCalls)).toContain("Bonjour");
  });

  it("forwardedChannelOf ignore les autres origines", () => {
    expect(
      forwardedChannelOf({
        message_id: 1,
        date: 1,
        chat: privateChat,
        forward_origin: { type: "hidden_user", sender_user_name: "x", date: 1 },
      } as never),
    ).toBeNull();
    expect(
      forwardedChannelOf({
        message_id: 1,
        date: 1,
        chat: privateChat,
        forward_origin: { type: "channel", chat: channel, message_id: 1, date: 1 },
      } as never),
    ).toEqual(channel);
  });
});

describe("transferts multiples : une réponse, un audit", () => {
  it("10 messages du même canal transférés d'un coup : un seul traitement", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await Promise.all(Array.from({ length: 10 }, () => bot.handleUpdate(forwardUpdate())));
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
    expect(deps.auditChannel).toHaveBeenCalledTimes(1);
    expect(sent(apiCalls)).toHaveLength(1);
    expect(apiCalls.filter((c) => c.method === "getChatAdministrators")).toHaveLength(1);
  });

  it("un album (media_group_id) n'est traité qu'une fois", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    for (let i = 0; i < 3; i++)
      await bot.handleUpdate(
        forwardUpdate({
          text: undefined,
          caption: "photo",
          media_group_id: "album-1",
          photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }],
        }),
      );
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
    expect(sent(apiCalls)).toHaveLength(1);
  });

  it("aucun bot administrateur : un nouveau transfert quelques secondes plus tard est re-vérifié", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps, { botIsAdmin: false });
    await bot.handleUpdate(forwardUpdate());
    await bot.handleUpdate(forwardUpdate());
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-10T10:00:10Z"));
    await bot.handleUpdate(forwardUpdate());
    expect(deps.upsertChannel).toHaveBeenCalledTimes(2);
    expect(sent(apiCalls)).toHaveLength(2);
  });

  it("canal bien ajouté : le même transfert est ignoré pendant 60 s, puis traité de nouveau", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
    const deps = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate(forwardUpdate());
    vi.setSystemTime(new Date("2026-10-10T10:00:59Z"));
    await bot.handleUpdate(forwardUpdate());
    expect(deps.upsertChannel).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-10T10:01:01Z"));
    await bot.handleUpdate(forwardUpdate());
    expect(deps.upsertChannel).toHaveBeenCalledTimes(2);
  });
});

describe("aide aux utilisateurs de la plateforme (texte, lien, transfert sans origine canal)", () => {
  it("texte libre : aide courte (méthode 1, contenu protégé → publier puis supprimer, ou lien public), une fois toutes les 6 h", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T10:00:00Z"));
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(textUpdate("le transfert ne marche pas"));
    expect(sent(apiCalls)).toEqual([FR.forwardHelp]);
    expect(FR.forwardHelp).toContain("transférez-moi un message");
    expect(FR.forwardHelp).toContain("contenu protégé");
    expect(FR.forwardHelp).toContain("supprimez-le");
    await bot.handleUpdate(textUpdate("fait"));
    expect(sent(apiCalls)).toHaveLength(1);
    vi.setSystemTime(new Date("2026-10-10T16:00:01Z"));
    await bot.handleUpdate(textUpdate("encore"));
    expect(sent(apiCalls)).toHaveLength(2);
    expect(deps.upsertChannel).not.toHaveBeenCalled();
  });

  it("transfert venant d'une personne ou d'un compte masqué : aide", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(
      forwardUpdate({
        forward_origin: { type: "hidden_user", sender_user_name: "Quelqu'un", date: 1 },
      }),
    );
    expect(sent(apiCalls)).toEqual([FR.forwardHelp]);
    expect(deps.upsertChannel).not.toHaveBeenCalled();
  });

  it("aide dans la langue de l'utilisateur", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(textUpdate("hello", { from: { ...from, language_code: "en" } }));
    expect(sent(apiCalls)).toEqual([MESSAGES.en.forwardHelp]);
  });

  it("lien public t.me/<nom> collé : import du canal (méthode 2) et confirmation", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(textUpdate("https://t.me/mon_canal."));
    expect(deps.importChannelByLink).toHaveBeenCalledWith("https://t.me/mon_canal", 42n);
    expect(sentText(apiCalls)).toBe(
      "Canal « Mon canal » ajouté ✅ (bots administrateurs : @casinobot)",
    );
    await bot.handleUpdate(textUpdate("@mon_canal"));
    // Même canal dans la minute : pas de second import.
    expect(deps.importChannelByLink).toHaveBeenCalledTimes(1);
  });

  it("lien cité au milieu d'une phrase : aucun import (canal d'un autre, réponse au dialogue)", async () => {
    const deps = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate(textUpdate("regarde t.me/canal_concurrent"));
    await bot.handleUpdate(textUpdate("voici le canal https://t.me/mon_canal merci"));
    expect(deps.importChannelByLink).not.toHaveBeenCalled();
    expect(deps.upsertChannel).not.toHaveBeenCalled();
  });

  it("lien d'offre d'un bot (t.me/<bot>?start=…) : ni import ni « Je ne trouve pas ce canal »", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(textUpdate("https://t.me/casinobot?start=oAbC123"));
    expect(deps.importChannelByLink).not.toHaveBeenCalled();
    expect(sent(apiCalls)).not.toContain(FR.forwardLinkNotFound);
  });

  it("lien importé mais droits non vérifiables pour le moment : « réessayez dans une minute », pas « aucun bot »", async () => {
    const deps = makeDeps({
      link: { ok: true, title: "Mon canal", created: true, admins: [], unavailable: true },
    });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(textUpdate("t.me/mon_canal"));
    expect(sent(apiCalls)).toEqual([FR.forwardCheckUnavailable]);
  });

  it("réponse à un message (dialogue) : pas d'aide", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(
      textUpdate("fait", {
        reply_to_message: { message_id: 7, date: 1, chat: privateChat, text: "Réponds « fait »" },
      }),
    );
    expect(sent(apiCalls)).toEqual([]);
  });

  it("l'admin du dialogue avec Claude (bot casino) : ses réponses « fait », « 1 » ne reçoivent pas l'aide", async () => {
    const deps = makeDeps({ dialogAdmin: true });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(textUpdate("fait"));
    await bot.handleUpdate(textUpdate("1"));
    expect(deps.isAdminDialogPartner).toHaveBeenCalledWith(42n);
    expect(sent(apiCalls)).toEqual([]);
    // Un transfert sans origine canal reste une tentative d'ajout : aide.
    await bot.handleUpdate(
      forwardUpdate({
        forward_origin: { type: "hidden_user", sender_user_name: "Quelqu'un", date: 1 },
      }),
    );
    expect(sent(apiCalls)).toEqual([FR.forwardHelp]);
  });

  it("l'aide rappelle que le bot doit être administrateur pour voir une publication", () => {
    expect(FR.forwardHelp).toContain("ajoutez-moi comme administrateur du canal");
    expect(FR.forwardPrivateLink).toContain("ajoutez-moi comme administrateur du canal");
    expect(MESSAGES.en.forwardHelp).toContain("administrator");
    expect(MESSAGES.en.forwardPrivateLink).toContain("administrator");
    expect(MESSAGES.es.forwardHelp).toContain("administrador");
    expect(MESSAGES.pt.forwardHelp).toContain("administrador");
    expect(MESSAGES.de.forwardHelp).toContain("Administrator");
    expect(MESSAGES.it.forwardHelp).toContain("amministratore");
  });

  it("lien d'un canal privé (t.me/c/… ou invitation) : orientation vers la méthode 1, sans import", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(textUpdate("https://t.me/c/1234567890/55"));
    await bot.handleUpdate(textUpdate("https://t.me/+AbCdEf123"));
    expect(deps.importChannelByLink).not.toHaveBeenCalled();
    expect(sent(apiCalls)).toEqual([FR.forwardPrivateLink, FR.forwardPrivateLink]);
  });

  it("lien introuvable ou vérification impossible : message clair", async () => {
    const notFound = makeDeps({ link: { ok: false, reason: "not_found" } });
    const a = makeBot(notFound);
    await a.bot.handleUpdate(textUpdate("t.me/canal_inexistant"));
    expect(sent(a.apiCalls)).toEqual([FR.forwardLinkNotFound]);

    const down = makeDeps({ link: { ok: false, reason: "unavailable" } });
    const b = makeBot(down);
    await b.bot.handleUpdate(textUpdate("t.me/canal_vip"));
    expect(sent(b.apiCalls)).toEqual([FR.forwardCheckUnavailable]);
  });

  it("expéditeur inconnu : ni aide ni import", async () => {
    const deps = makeDeps({ platformUser: false });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(textUpdate("https://t.me/mon_canal"));
    await bot.handleUpdate(textUpdate("bonjour"));
    expect(sent(apiCalls)).toEqual([]);
    expect(deps.importChannelByLink).not.toHaveBeenCalled();
  });

  it("une photo sans texte ni transfert : rien de particulier", async () => {
    const deps = makeDeps();
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate({
      update_id: nextUpdateId++,
      message: {
        message_id: 1,
        date: 1,
        chat: privateChat,
        from,
        photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }],
      },
    });
    expect(sent(apiCalls)).toEqual([]);
    expect(deps.isPlatformUser).not.toHaveBeenCalled();
  });
});

describe("RecentKeys", () => {
  it("retient une clé pendant sa durée, puis l'oublie ; shorten raccourcit", () => {
    let now = 0;
    const keys = new RecentKeys(() => now);
    expect(keys.hit("a", 1000)).toBe(false);
    expect(keys.hit("a", 1000)).toBe(true);
    now = 999;
    expect(keys.hit("a", 1000)).toBe(true);
    now = 1000;
    expect(keys.hit("a", 1000)).toBe(false);
    keys.shorten("a", 10);
    now = 1011;
    expect(keys.hit("a", 1000)).toBe(false);
  });

  it("reste bornée en mémoire", () => {
    let now = 0;
    const keys = new RecentKeys(() => now, 3);
    for (const k of ["a", "b", "c", "d"]) keys.hit(k, 10);
    now = 5;
    // La table pleine a été vidée pour accueillir « d » : « a » est oubliée, « d » reste connue.
    expect(keys.hit("d", 10)).toBe(true);
    expect(keys.hit("a", 10)).toBe(false);
  });
});
