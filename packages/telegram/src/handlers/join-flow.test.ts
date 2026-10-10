import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { botInfoFromRecord } from "../factory";
import type { BotIdentity } from "../ports";
import type { ChannelInfo, JoinFlowDeps, MembershipInfo } from "../join-flow/deps";
import { IMPLICIT_RULE, NO_RULE, type RuleData } from "../join-flow/rules";
import { registerJoinFlowHandlers } from "./join-flow";

const identity: BotIdentity = {
  id: "bot_1",
  name: "CasinoBot",
  username: "casinobot",
  telegramBotId: 111n,
  vertical: "CASINO",
};
const chanA: ChannelInfo = {
  id: "cA",
  title: "Canal A",
  username: null,
  language: "fr",
  telegramChatId: -100100n,
  primaryBotId: "bot_1",
  isActive: true,
};
const chanB: ChannelInfo = {
  id: "cB",
  title: "Canal B",
  username: "canalb",
  language: "fr",
  telegramChatId: -100200n,
  primaryBotId: "bot_1",
  isActive: true,
};
const chanC: ChannelInfo = {
  id: "cC",
  title: "Canal C",
  username: null,
  language: "fr",
  telegramChatId: -100300n,
  primaryBotId: null,
  isActive: true,
};
/** Canal décoché « Actif » par l'équipe. */
const chanOff: ChannelInfo = {
  id: "cOff",
  title: "Canal en pause",
  username: null,
  language: "fr",
  telegramChatId: -100400n,
  primaryBotId: "bot_1",
  isActive: false,
};
/** Règle explicite « immédiat » (ce que l'équipe choisit dans la fiche canal). */
const IMMEDIATE_RULE: RuleData = { ...IMPLICIT_RULE, id: "r_immediat", name: "Immédiat" };
const from = { id: 42, is_bot: false, first_name: "Jean", language_code: "fr" };

type State = {
  memberships: Array<
    MembershipInfo & {
      expiresAt: Date | null;
      gateSatisfiedAt?: Date;
      joinedAt?: Date;
      leftAt?: Date;
    }
  >;
  dms: Array<{
    kind: string;
    text: string;
    buttons: Array<Array<{ text: string; url: string }>>;
    chatId: bigint | null;
  }>;
  events: string[];
  canDm: Array<[string, boolean]>;
  links: Record<string, string>;
};

function makeDeps(
  opts: { rule?: RuleData; actingBotId?: string | null; inviteLinkUrl?: string } = {},
) {
  const st: State = { memberships: [], dms: [], events: [], canDm: [], links: {} };
  const rule = opts.rule ?? IMMEDIATE_RULE;
  const deps: JoinFlowDeps = {
    upsertMember: async (u) => ({
      memberId: `m${u.id}`,
      languageCode: u.language_code ?? null,
      firstName: u.first_name,
    }),
    findChannelByChatId: async (id) =>
      [chanA, chanB, chanC, chanOff].find((c) => c.telegramChatId === id) ?? null,
    getChannels: async (ids) =>
      ids
        .map((id) => [chanA, chanB, chanC].find((c) => c.id === id))
        .filter((c): c is ChannelInfo => !!c),
    actingBotIdFor: async () =>
      opts.actingBotId === null ? null : { botId: opts.actingBotId ?? "bot_1" },
    findInviteLinkByUrl: async (url) =>
      url === opts.inviteLinkUrl
        ? {
            id: "link1",
            kind: "AD_ENTRY",
            name: "TT-pub-1",
            channelId: "cA",
            campaignId: null,
            adPlatform: "TIKTOK",
            adCampaignName: null,
            adName: null,
            sourceChannelId: null,
            telegramInviteLink: url,
          }
        : null,
    resolveRule: async () => rule,
    createMembership: async (d) => {
      const m = {
        ...d,
        id: `ms${st.memberships.length + 1}`,
        remindersSent: 0,
      } as State["memberships"][number];
      st.memberships.push(m);
      return { id: m.id };
    },
    updateMembership: async (id, data) => {
      const m = st.memberships.find((x) => x.id === id);
      if (m) Object.assign(m, data);
    },
    findMembershipByCode: async (code) => st.memberships.find((m) => m.code === code) ?? null,
    findLatestMembership: async (memberId, channelId) =>
      [...st.memberships]
        .reverse()
        .find((m) => m.memberId === memberId && m.channelId === channelId) ?? null,
    getRuleForMembership: async () => rule,
    incrementInviteLink: vi.fn(async () => undefined),
    findOrCreateGateLink: async (src, gate, _bot, create) => {
      const key = `${src}->${gate.id}`;
      if (!st.links[key])
        st.links[key] = (await create()) ?? `https://t.me/${gate.username ?? "x"}`;
      return st.links[key]!;
    },
    getSequenceText: async () => null,
    enqueueDm: async (i) => {
      st.dms.push({ kind: i.kind, text: i.text, buttons: i.buttons, chatId: i.chatId });
    },
    setCanDm: async (m, _b, v) => {
      st.canDm.push([m, v]);
    },
    recordEvent: async (e) => {
      st.events.push(e.type);
    },
  };
  return { deps, st };
}

function makeBot(deps: JoinFlowDeps, members: Record<string, string> = {}) {
  const bot = new Bot("111:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "createChatInviteLink")
      return {
        ok: true,
        result: {
          invite_link: `https://t.me/+gate${(payload as { chat_id: number }).chat_id}`,
          creator: { id: 111, is_bot: true, first_name: "b" },
          creates_join_request: false,
          is_primary: false,
          is_revoked: false,
        },
      } as never;
    if (method === "getChatMember") {
      const p = payload as { chat_id: number; user_id: number };
      return {
        ok: true,
        result: {
          status: members[String(p.chat_id)] ?? "left",
          user: { id: p.user_id, is_bot: false, first_name: "Jean" },
        },
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
  // Canal inconnu : création simulée (sans base) ; le handler réessaie ensuite avec les mêmes deps.
  const channelDeps = {
    upsertChannel: vi.fn(async () => ({ channelId: "c_new", created: true })),
    findChannelId: vi.fn(async () => null),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [111n]),
  };
  registerJoinFlowHandlers(bot, identity, deps, channelDeps);
  return { bot, apiCalls, channelDeps };
}

const joinRequest = (chatId: number, inviteLink?: string): Update => ({
  update_id: 1,
  chat_join_request: {
    chat: { id: chatId, type: "channel", title: "Canal A" },
    from,
    user_chat_id: 42,
    date: 1_760_000_000,
    ...(inviteLink
      ? {
          invite_link: {
            invite_link: inviteLink,
            creator: { id: 111, is_bot: true, first_name: "b" },
            creates_join_request: true,
            is_primary: false,
            is_revoked: false,
          },
        }
      : {}),
  },
});
const startUpdate = (payload: string): Update => ({
  update_id: 2,
  message: {
    message_id: 1,
    date: 1,
    chat: { id: 42, type: "private", first_name: "Jean" },
    from,
    text: `/start ${payload}`,
    entities: [{ type: "bot_command", offset: 0, length: 6 }],
  },
});

describe("chat_join_request", () => {
  it("canal sans règle : demande enregistrée à valider (manuel), sans acceptation automatique ni message privé", async () => {
    const { deps, st } = makeDeps({ rule: NO_RULE });
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    expect(st.memberships).toHaveLength(1);
    const m = st.memberships[0]!;
    expect(m.status).toBe("REQUESTED");
    expect(m.approveAt).toBeNull();
    expect(m.approvalRuleId).toBeNull();
    expect(st.events).toContain("membership.requested");
    expect(st.dms).toHaveLength(0);
  });

  it("canal désactivé (« Actif » décoché) : la demande est ignorée", async () => {
    const { deps, st } = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100400));
    expect(st.memberships).toHaveLength(0);
    expect(st.dms).toHaveLength(0);
    expect(st.events).toHaveLength(0);
  });

  it("règle « immédiat » : demande planifiée immédiatement, message d'accueil sans bouton", async () => {
    const { deps, st } = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    expect(st.memberships).toHaveLength(1);
    const m = st.memberships[0]!;
    expect(m.status).toBe("SCHEDULED");
    expect(m.approveAt?.getTime()).toBe(1_760_000_000 * 1000);
    expect(m.userChatId).toBe(42n);
    expect(m.code).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(st.events).toContain("membership.requested");
    expect(st.dms).toHaveLength(1);
    expect(st.dms[0]).toMatchObject({ kind: "WELCOME", chatId: 42n });
    expect(st.dms[0]!.text).toContain("Jean");
    expect(st.dms[0]!.text).toContain("immédiatement");
    expect(st.dms[0]!.buttons).toEqual([]);
  });

  it("délai 10 minutes + lien d'entrée : snapshot de la source et compteur du lien", async () => {
    const rule: RuleData = { ...IMPLICIT_RULE, id: "r", delaySeconds: 600 };
    const { deps, st } = makeDeps({ rule, inviteLinkUrl: "https://t.me/+pub1" });
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100, "https://t.me/+pub1"));
    const m = st.memberships[0]!;
    expect(m.inviteLinkId).toBe("link1");
    expect(m.approveAt?.getTime()).toBe(1_760_000_000 * 1000 + 600_000);
    expect((m.source.inviteLink as { name: string }).name).toBe("TT-pub-1");
    expect(deps.incrementInviteLink).toHaveBeenCalledWith("link1", "requests");
    expect(st.dms[0]!.text).toContain("dans 10 minutes");
  });

  it("gate requis : PENDING_GATE, liens GATE créés, boutons rejoindre + J'ai rejoint", async () => {
    const rule: RuleData = {
      ...IMPLICIT_RULE,
      id: "r",
      delaySeconds: 60,
      gateMode: "REQUIRED",
      gateChannelIds: ["cB", "cC"],
    };
    const { deps, st } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    const m = st.memberships[0]!;
    expect(m.status).toBe("PENDING_GATE");
    expect(m.approveAt).toBeNull();
    expect(apiCalls.filter((c) => c.method === "createChatInviteLink")).toHaveLength(2);
    const btns = st.dms[0]!.buttons;
    expect(btns).toHaveLength(3);
    expect(btns[0]![0]!.text).toBe("Rejoindre Canal B");
    expect(btns[2]![0]!.text).toBe("✅ J'ai rejoint");
    expect(btns[2]![0]!.url).toBe(`https://t.me/casinobot?start=g${m.code}`);
    expect((m.source.gates as unknown[]).length).toBe(2);
  });

  it("gate SOFT : planifié malgré tout, canaux proposés", async () => {
    const rule: RuleData = {
      ...IMPLICIT_RULE,
      id: "r",
      delaySeconds: 60,
      gateMode: "SOFT",
      gateChannelIds: ["cB"],
    };
    const { deps, st } = makeDeps({ rule });
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    expect(st.memberships[0]!.status).toBe("SCHEDULED");
    expect(st.dms[0]!.buttons).toHaveLength(2);
  });

  it("ignore la demande si un autre bot agit pour le canal ou si le canal est inconnu", async () => {
    const { deps, st } = makeDeps({ actingBotId: "bot_2" });
    const { bot, channelDeps } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    expect(channelDeps.upsertChannel).not.toHaveBeenCalled();
    await bot.handleUpdate(joinRequest(-100999));
    // Canal inconnu : il est créé (droits relevés) avant un second essai.
    expect(channelDeps.upsertChannel).toHaveBeenCalledWith({
      id: -100999,
      type: "channel",
      title: "Canal A",
    });
    expect(st.memberships).toHaveLength(0);
    expect(st.dms).toHaveLength(0);
  });
});

describe("/start g<code>", () => {
  const rule: RuleData = {
    ...IMPLICIT_RULE,
    id: "r",
    delaySeconds: 60,
    gateMode: "REQUIRED",
    gateChannelIds: ["cB", "cC"],
  };

  it("tous les canaux rejoints → SCHEDULED et confirmation", async () => {
    const { deps, st } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps, { "-100200": "member", "-100300": "administrator" });
    await bot.handleUpdate(joinRequest(-100100));
    const m = st.memberships[0]!;
    await bot.handleUpdate(startUpdate(`g${m.code}`));
    expect(m.status).toBe("SCHEDULED");
    expect(m.gateSatisfiedAt).toBeInstanceOf(Date);
    expect(m.approveAt!.getTime() - m.gateSatisfiedAt!.getTime()).toBe(60_000);
    expect(st.canDm).toContainEqual(["m42", true]);
    expect(st.events).toContain("membership.gate_satisfied");
    const reply = apiCalls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(reply.payload.text)).toContain("dans 1 minute");
    expect(reply.payload.reply_markup).toBeUndefined();
  });

  it("canal manquant → liste des manquants avec boutons, statut inchangé", async () => {
    const { deps, st } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps, { "-100200": "member" });
    await bot.handleUpdate(joinRequest(-100100));
    const m = st.memberships[0]!;
    await bot.handleUpdate(startUpdate(`g${m.code}`));
    expect(m.status).toBe("PENDING_GATE");
    const reply = apiCalls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(reply.payload.text)).toContain("Canal C");
    expect(String(reply.payload.text)).not.toContain("Canal B");
    expect(reply.payload.reply_markup).toBeDefined();
  });

  it("code inconnu ou membre différent → message d'erreur", async () => {
    const { deps } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(startUpdate("gZZZZZZZZ"));
    expect(String(apiCalls.at(-1)!.payload.text)).toMatch(/ne retrouve pas/);
  });

  it("laisse passer un /start ordinaire (pas de payload g…)", async () => {
    const { deps } = makeDeps({ rule });
    const { bot, apiCalls } = makeBot(deps);
    await bot.handleUpdate(startUpdate("admin_x"));
    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 42, type: "private", first_name: "Jean" },
        from,
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    });
    expect(apiCalls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
  });
});

describe("chat_member", () => {
  const cm = (oldS: string, newS: string, link?: string): Update => ({
    update_id: 5,
    chat_member: {
      chat: { id: -100100, type: "channel", title: "Canal A" },
      from: { id: 42, is_bot: false, first_name: "Jean" },
      date: 1_760_000_100,
      old_chat_member: { status: oldS, user: from } as never,
      new_chat_member: { status: newS, user: from } as never,
      ...(link
        ? {
            invite_link: {
              invite_link: link,
              creator: { id: 111, is_bot: true, first_name: "b" },
              creates_join_request: false,
              is_primary: false,
              is_revoked: false,
            },
          }
        : {}),
    },
  });

  it("entrée effective : joinedAt sur la demande en cours + événement", async () => {
    const { deps, st } = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate(joinRequest(-100100));
    await bot.handleUpdate(cm("left", "member"));
    expect(st.memberships[0]).toMatchObject({ status: "APPROVED" });
    expect(st.memberships[0]!.joinedAt).toBeInstanceOf(Date);
    expect(st.events).toContain("membership.joined");
  });

  it("entrée sans demande connue : nouvelle adhésion directe, lien GATE compté", async () => {
    const { deps, st } = makeDeps({ inviteLinkUrl: "https://t.me/+gate" });
    const { bot } = makeBot(deps);
    await bot.handleUpdate(cm("left", "member", "https://t.me/+gate"));
    expect(st.memberships).toHaveLength(1);
    expect(st.memberships[0]!.source).toMatchObject({ joinedDirectly: true });
    expect(deps.incrementInviteLink).toHaveBeenCalledWith("link1", "joined");
  });

  it("canal désactivé : entrées et départs ignorés par le flux d'adhésion", async () => {
    const { deps, st } = makeDeps();
    const { bot } = makeBot(deps);
    const off = cm("left", "member");
    (off.chat_member as { chat: { id: number } }).chat.id = -100400;
    await bot.handleUpdate(off);
    expect(st.memberships).toHaveLength(0);
    expect(st.events).toHaveLength(0);
  });

  it("départ et exclusion", async () => {
    const { deps, st } = makeDeps();
    const { bot } = makeBot(deps);
    await bot.handleUpdate(cm("left", "member"));
    await bot.handleUpdate(cm("member", "left"));
    expect(st.memberships[0]!.status).toBe("LEFT");
    await bot.handleUpdate(cm("left", "member"));
    await bot.handleUpdate(cm("member", "kicked"));
    expect(st.memberships[1]!.status).toBe("KICKED");
    expect(st.events.filter((e) => e === "membership.left")).toHaveLength(1);
    expect(st.events).toContain("membership.kicked");
  });
});
