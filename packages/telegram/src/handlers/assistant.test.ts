import { describe, expect, it, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { botInfoFromRecord } from "../factory";
import { registerHandlers } from "../handlers";
import type { BotIdentity, TelegramDeps } from "../ports";
import type { AssistantConversation, AssistantDeps } from "../assistant/deps";

// Réception par un bot en mode assistant de conversation (phase 17) : updates simulées, dépendances simulées, aucune
// base et aucun appel réseau. Le webhook ne fait qu'enregistrer et mettre un tour en file (jamais d'appel à l'IA).

const assistant: BotIdentity = {
  id: "bot_lea",
  name: "Léa",
  username: "lea_bot",
  telegramBotId: 555n,
  vertical: "DATING",
  mode: "ASSISTANT",
  personaId: "persona_1",
};

function coreDeps(): TelegramDeps & { recorded: Array<{ type: string; update: Update }> } {
  const recorded: Array<{ type: string; update: Update }> = [];
  return {
    recorded,
    recordUpdate: vi.fn(async (_bot, type: string, update: Update) => {
      recorded.push({ type, update });
    }),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberDmStatus: vi.fn(async () => undefined),
    memberWrote: vi.fn(async () => undefined),
    upsertChannel: vi.fn(async () => ({ channelId: "c1" })),
    findChannelId: vi.fn(async () => "c1"),
    setChannelAdmin: vi.fn(async () => undefined),
    revokeChannelAdmin: vi.fn(async () => undefined),
    listOurBotTelegramIds: vi.fn(async () => [555n]),
    linkAdminAccount: vi.fn(async () => null),
    isPlatformUser: vi.fn(async () => true),
    addCustomEmojis: vi.fn(async () => ({ added: 0, alreadyKnown: 0, restored: 0 }) as never),
  };
}

type FakeState = {
  conv: AssistantConversation;
  inbound: Array<Parameters<AssistantDeps["recordInbound"]>[0]>;
  fixed: Array<Parameters<AssistantDeps["recordFixedReply"]>[0]>;
  enqueued: string[];
  seenTelegramIds: Set<number>;
  activation: boolean;
  personaActive: boolean;
  /** Actif / inactif par persona (prime sur `personaActive`). */
  personaActiveById: Record<string, boolean>;
  claims: number;
  resets: number[];
};

function assistantDeps(over: Partial<FakeState["conv"]> = {}) {
  const state: FakeState = {
    conv: {
      id: "conv_1",
      status: "BOT",
      stage: "WELCOME",
      isMinor: false,
      stoppedAt: null,
      closedReason: null,
      language: null,
      personaId: null,
      source: null,
      ...over,
    },
    inbound: [],
    fixed: [],
    enqueued: [],
    seenTelegramIds: new Set(),
    activation: true,
    personaActive: true,
    personaActiveById: {},
    claims: 0,
    resets: [],
  };
  const deps: AssistantDeps = {
    memberSeen: vi.fn(async () => ({ memberId: "m1" })),
    memberStarted: vi.fn(async () => ({ memberId: "m1" })),
    ensureConversation: vi.fn(async ({ personaId, source }) => {
      if (!state.conv.source && source) state.conv.source = source;
      if (!state.conv.personaId && personaId) state.conv.personaId = personaId;
      return { ...state.conv };
    }),
    reopenConversation: vi.fn(async () => {
      if (
        state.conv.status !== "CLOSED" ||
        state.conv.stoppedAt ||
        state.conv.isMinor ||
        !["BLOCKED", "UNREACHABLE"].includes(state.conv.closedReason ?? "")
      )
        return null;
      Object.assign(state.conv, { status: "BOT", stage: "CHAT", closedReason: null });
      return { ...state.conv };
    }),
    linkAdminAccount: vi.fn(async (token: string) => (token === "good" ? { name: "Alice" } : null)),
    persona: vi.fn(async (id: string) => ({
      id,
      name: "Léa",
      gender: "F",
      languages: ["fr", "en"],
      isActive: state.personaActiveById[id] ?? state.personaActive,
    })),
    activationAllows: vi.fn(async () => state.activation),
    recordInbound: vi.fn(async (input) => {
      if (state.seenTelegramIds.has(input.telegramMessageId)) return { duplicate: true };
      state.seenTelegramIds.add(input.telegramMessageId);
      state.inbound.push(input);
      if (input.minor && !state.conv.isMinor) {
        const wasAnswering = state.conv.status === "BOT" && !state.conv.stoppedAt;
        Object.assign(state.conv, {
          isMinor: true,
          status: "CLOSED",
          stage: "CLOSED",
          closedReason: state.conv.closedReason ?? "MINOR",
        });
        return { duplicate: false, minorClosed: { wasAnswering } };
      }
      return { duplicate: false };
    }),
    recordFixedReply: vi.fn(async (input) => {
      state.fixed.push(input);
    }),
    stopConversation: vi.fn(async () => {
      if (state.conv.stoppedAt) return { changed: false };
      state.conv.stoppedAt = new Date();
      state.conv.status = "CLOSED";
      state.conv.stage = "CLOSED";
      return { changed: true };
    }),
    resetConversation: vi.fn(async ({ telegramMessageId }) => {
      if (state.resets.includes(telegramMessageId)) return { duplicate: true };
      state.resets.push(telegramMessageId);
      if (state.conv.status !== "CLOSED") state.conv.stage = "WELCOME";
      return { duplicate: false };
    }),
    claimStoppedReply: vi.fn(async () => {
      state.claims += 1;
      return state.claims === 1;
    }),
    conversationBlocked: vi.fn(async () => undefined),
    enqueueTurn: vi.fn(async (id: string) => {
      state.enqueued.push(id);
    }),
  };
  return { state, deps };
}

function makeBot(identity: BotIdentity, deps: AssistantDeps, core = coreDeps()) {
  const bot = new Bot("555:TEST", { botInfo: botInfoFromRecord(identity) });
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  let nextId = 900;
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: (payload ?? {}) as Record<string, unknown> });
    return {
      ok: true,
      result:
        method === "sendMessage"
          ? { message_id: nextId++, date: 0, chat: { id: 42, type: "private" }, text: "ok" }
          : true,
    } as never;
  });
  registerHandlers(bot, identity, core, { assistantDeps: deps });
  return { bot, apiCalls, core };
}

let updateId = 1;
function privateText(
  text: string,
  extra: Record<string, unknown> = {},
  messageId?: number,
): Update {
  const isCommand = text.startsWith("/");
  return {
    update_id: updateId++,
    message: {
      message_id: messageId ?? updateId,
      date: 1,
      chat: { id: 42, type: "private", first_name: "Jean" },
      from: { id: 42, is_bot: false, first_name: "Jean", language_code: "fr" },
      text,
      ...(isCommand
        ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] }
        : {}),
      ...extra,
    },
  } as Update;
}

const sent = (calls: Array<{ method: string; payload: Record<string, unknown> }>) =>
  calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

describe("bot assistant : handlers et journal", () => {
  it("journal sans texte : l'update écrite dans Event n'a que la longueur", async () => {
    const { deps } = assistantDeps();
    const { bot, core } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("je m'appelle Jean et j'habite à Lyon"));
    expect(core.recorded).toHaveLength(1);
    const logged = JSON.stringify(core.recorded[0]!.update);
    expect(logged).not.toContain("Lyon");
    expect(logged).toContain('"textLength":36');
    expect(core.memberWrote).toHaveBeenCalledTimes(1);
  });

  it("bot normal : journal inchangé (texte gardé), aucun handler de l'assistant", async () => {
    const { deps } = assistantDeps();
    const standard: BotIdentity = { ...assistant, mode: "STANDARD", personaId: null };
    const core = coreDeps();
    const bot = new Bot("555:TEST", { botInfo: botInfoFromRecord(standard) });
    bot.api.config.use(async () => ({ ok: true, result: true }) as never);
    registerHandlers(bot, standard, core, { extended: false, assistantDeps: deps });
    await bot.handleUpdate(privateText("bonjour Lyon"));
    expect(JSON.stringify(core.recorded[0]!.update)).toContain("Lyon");
    expect(deps.recordInbound).not.toHaveBeenCalled();
  });

  it("pas de /start générique, ni transfert, ni emojis animés de l'équipe", async () => {
    const { deps } = assistantDeps();
    const { bot, apiCalls, core } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/start"));
    // Aucun « Bonjour… » du bot normal : seul l'assistant (worker) répondra.
    expect(sent(apiCalls)).toEqual([]);
    expect(core.memberStarted).not.toHaveBeenCalled();
    expect(core.addCustomEmojis).not.toHaveBeenCalled();
  });
});

describe("/start", () => {
  it("/start tk01 : conversation (source, persona), message entrant /start, tour en file", async () => {
    const { state, deps } = assistantDeps();
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/start tk01"));
    expect(deps.memberStarted).toHaveBeenCalledWith(
      assistant,
      expect.objectContaining({ id: 42 }),
      "tk01",
    );
    expect(deps.ensureConversation).toHaveBeenCalledWith({
      botId: "bot_lea",
      memberId: "m1",
      personaId: "persona_1",
      source: "tk01",
    });
    expect(state.inbound).toHaveLength(1);
    expect(state.inbound[0]).toMatchObject({
      conversationId: "conv_1",
      text: "/start",
      media: null,
      meta: { command: "start", source: "tk01" },
      countsAsExchange: false,
    });
    expect(state.enqueued).toEqual(["conv_1"]);
    expect(sent(apiCalls)).toEqual([]);
  });

  it("source invalide : aucune source gardée, et le texte tapé n'est jamais journalisé", async () => {
    const { deps } = assistantDeps();
    const { bot } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/start je m'appelle Julie, 24 ans, Lyon"));
    expect(deps.ensureConversation).toHaveBeenCalledWith(expect.objectContaining({ source: null }));
    // `member.start` reçoit la source nettoyée (rien ici), jamais le texte brut.
    expect(deps.memberStarted).toHaveBeenCalledWith(
      assistant,
      expect.objectContaining({ id: 42 }),
      undefined,
    );
  });

  it("lien « Lier votre Telegram » de Mon compte : compte lié, aucune conversation", async () => {
    const { state, deps } = assistantDeps();
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/start admin_good"));
    expect(deps.linkAdminAccount).toHaveBeenCalledWith("good", 42n);
    expect(deps.memberStarted).toHaveBeenCalledWith(
      assistant,
      expect.objectContaining({ id: 42 }),
      undefined,
    );
    expect(sent(apiCalls)).toEqual([
      "Votre compte Telegram est maintenant lié à LinkAffi Pro, Alice.",
    ]);
    await bot.handleUpdate(privateText("/start admin_expire"));
    expect(sent(apiCalls).at(-1)).toBe("Ce lien de connexion est invalide ou a expiré.");
    expect(deps.ensureConversation).not.toHaveBeenCalled();
    expect(state.inbound).toEqual([]);
    expect(state.enqueued).toEqual([]);
  });

  it("après un /stop : rien ne repart, réponse fixe une fois par jour au plus", async () => {
    const { state, deps } = assistantDeps({
      stoppedAt: new Date(),
      status: "CLOSED",
      stage: "CLOSED",
    });
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/start"));
    await bot.handleUpdate(privateText("/start"));
    expect(state.enqueued).toEqual([]);
    expect(sent(apiCalls)).toEqual([
      "Tu m'as demandé de ne plus t'écrire, je respecte ton choix. Bonne continuation !",
    ]);
    expect(state.fixed.map((f) => f.key)).toEqual(["stoppedAlready"]);
  });
});

describe("messages de la personne", () => {
  it("texte : enregistré (compte comme un échange) puis tour en file", async () => {
    const { state, deps } = assistantDeps();
    const { bot } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("salut ça va ?"));
    expect(state.inbound[0]).toMatchObject({
      text: "salut ça va ?",
      media: null,
      countsAsExchange: true,
    });
    expect(state.enqueued).toEqual(["conv_1"]);
    // Le membre vu par le middleware est réutilisé : pas de second enregistrement.
    expect(deps.memberSeen).not.toHaveBeenCalled();
  });

  it("update renvoyée par Telegram : un seul message, une seule mise en file", async () => {
    const { state, deps } = assistantDeps();
    const { bot } = makeBot(assistant, deps);
    const update = privateText("re", {}, 77);
    await bot.handleUpdate(update);
    await bot.handleUpdate({ ...update });
    expect(state.inbound).toHaveLength(1);
    expect(state.enqueued).toEqual(["conv_1"]);
  });

  it("photo avec légende : texte = légende, média décrit", async () => {
    const { state, deps } = assistantDeps();
    const { bot } = makeBot(assistant, deps);
    await bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: 501,
        date: 1,
        chat: { id: 42, type: "private", first_name: "Jean" },
        from: { id: 42, is_bot: false, first_name: "Jean" },
        photo: [{ file_id: "p", file_unique_id: "u", width: 1, height: 1 }],
        caption: "regarde",
      },
    } as Update);
    expect(state.inbound[0]).toMatchObject({ text: "regarde", media: { kind: "photo" } });
  });

  it("activation « Désactivé » : message gardé, aucune mise en file, aucune réponse", async () => {
    const { state, deps } = assistantDeps();
    state.activation = false;
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/start tk01"));
    await bot.handleUpdate(privateText("allo ?"));
    expect(state.inbound).toHaveLength(2);
    expect(state.enqueued).toEqual([]);
    expect(sent(apiCalls)).toEqual([]);
  });

  it("persona inactive, sans persona, conversation reprise par l'équipe ou mineure : seulement gardé", async () => {
    for (const setup of [
      (s: FakeState) => {
        s.personaActive = false;
      },
      (s: FakeState) => {
        s.conv.status = "HUMAN";
      },
      (s: FakeState) => {
        s.conv.isMinor = true;
        s.conv.status = "CLOSED";
      },
    ]) {
      const { state, deps } = assistantDeps();
      setup(state);
      const { bot } = makeBot(assistant, deps);
      await bot.handleUpdate(privateText("hello"));
      expect(state.inbound).toHaveLength(1);
      expect(state.enqueued).toEqual([]);
    }
    const { state, deps } = assistantDeps();
    const { bot } = makeBot({ ...assistant, personaId: null }, deps);
    await bot.handleUpdate(privateText("hello"));
    expect(state.inbound).toHaveLength(1);
    expect(state.enqueued).toEqual([]);
  });

  it("persona de la conversation (comme le worker), pas celle du bot", async () => {
    // Le bot est passé à une autre persona encore désactivée : la conversation garde la sienne, active.
    let { state, deps } = assistantDeps({ personaId: "persona_old" });
    state.personaActiveById = { persona_old: true, persona_1: false };
    let { bot } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("hello"));
    expect(deps.persona).toHaveBeenCalledWith("persona_old");
    expect(state.enqueued).toEqual(["conv_1"]);
    // L'inverse : persona de la conversation désactivée, celle du bot active → rien en file.
    ({ state, deps } = assistantDeps({ personaId: "persona_old" }));
    state.personaActiveById = { persona_old: false, persona_1: true };
    ({ bot } = makeBot(assistant, deps));
    await bot.handleUpdate(privateText("hello"));
    expect(state.inbound).toHaveLength(1);
    expect(state.enqueued).toEqual([]);
  });

  it("conversation fermée parce que le bot était bloqué : elle repart quand la personne réécrit", async () => {
    const { state, deps } = assistantDeps({
      status: "CLOSED",
      stage: "CLOSED",
      closedReason: "BLOCKED",
    });
    const { bot } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/start"));
    expect(deps.reopenConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv_1", botId: "bot_lea", memberId: "m1" }),
    );
    expect(state.conv.status).toBe("BOT");
    expect(state.enqueued).toEqual(["conv_1"]);
  });

  it("jamais rouverte : /stop, mineur, fermée par l'équipe", async () => {
    for (const over of [
      { status: "CLOSED", closedReason: "BLOCKED", stoppedAt: new Date() },
      { status: "CLOSED", closedReason: "MINOR", isMinor: true },
      { status: "CLOSED", closedReason: "TEAM" },
    ] as Array<Partial<AssistantConversation>>) {
      const { state, deps } = assistantDeps(over);
      const { bot } = makeBot(assistant, deps);
      await bot.handleUpdate(privateText("coucou"));
      expect(deps.reopenConversation).not.toHaveBeenCalled();
      expect(state.inbound).toHaveLength(1);
      expect(state.enqueued).toEqual([]);
    }
  });

  it("file indisponible : le message reste gardé, sans erreur", async () => {
    const { state, deps } = assistantDeps();
    deps.enqueueTurn = vi.fn(async () => {
      throw new Error("Redis indisponible");
    });
    const { bot } = makeBot(assistant, deps);
    await expect(bot.handleUpdate(privateText("hello"))).resolves.toBeUndefined();
    expect(state.inbound).toHaveLength(1);
  });

  it("aucune réponse ni enregistrement en groupe, ni pour un message de bot", async () => {
    const { state, deps } = assistantDeps();
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: 600,
        date: 1,
        chat: { id: -100123, type: "supergroup", title: "Groupe" },
        from: { id: 42, is_bot: false, first_name: "Jean" },
        text: "/start tk01",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    } as Update);
    await bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: 601,
        date: 1,
        chat: { id: 43, type: "private", first_name: "Robot" },
        from: { id: 43, is_bot: true, first_name: "Robot" },
        text: "hello",
      },
    } as Update);
    expect(state.inbound).toEqual([]);
    expect(deps.ensureConversation).not.toHaveBeenCalled();
    expect(sent(apiCalls)).toEqual([]);
  });

  it("bouton : seulement l'accusé de réception", async () => {
    const { state, deps } = assistantDeps();
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: "cb1",
        from: { id: 42, is_bot: false, first_name: "Jean" },
        chat_instance: "x",
        data: "g:abc",
      },
    } as Update);
    expect(apiCalls.map((c) => c.method)).toEqual(["answerCallbackQuery"]);
    expect(state.inbound).toEqual([]);
  });

  it("bot bloqué : plus de relance prévue, et le statut du bot suit", async () => {
    const { deps } = assistantDeps();
    const { bot, core } = makeBot(assistant, deps);
    await bot.handleUpdate({
      update_id: updateId++,
      my_chat_member: {
        chat: { id: 42, type: "private", first_name: "Jean" },
        from: { id: 42, is_bot: false, first_name: "Jean" },
        date: 1,
        old_chat_member: { status: "member", user: { id: 555, is_bot: true, first_name: "Léa" } },
        new_chat_member: {
          status: "kicked",
          until_date: 0,
          user: { id: 555, is_bot: true, first_name: "Léa" },
        },
      },
    } as Update);
    expect(deps.conversationBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ botId: "bot_lea", telegramUserId: 42n }),
    );
    expect(core.memberDmStatus).toHaveBeenCalledWith(assistant, expect.anything(), false);
  });
});

describe("/stop", () => {
  it("définitif : conversation stoppée, réponse fixe gardée, plus aucun tour ensuite", async () => {
    const { state, deps } = assistantDeps();
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/stop"));
    expect(deps.stopConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv_1", botId: "bot_lea", memberId: "m1" }),
    );
    expect(sent(apiCalls)).toEqual(["C'est noté, je ne t'écrirai plus. Bonne continuation !"]);
    expect(state.fixed[0]).toMatchObject({ key: "stopDone", telegramMessageId: 900 });
    // Message suivant : gardé, jamais traité.
    await bot.handleUpdate(privateText("finalement si"));
    expect(state.inbound.map((m) => m.text)).toEqual(["finalement si"]);
    expect(state.enqueued).toEqual([]);
    // Second /stop : rien de nouveau.
    await bot.handleUpdate(privateText("/stop"));
    expect(deps.stopConversation).toHaveBeenCalledTimes(1);
    expect(sent(apiCalls)).toHaveLength(1);
  });

  it("activation « Désactivé » : stoppée quand même, sans réponse", async () => {
    const { state, deps } = assistantDeps();
    state.activation = false;
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/stop"));
    expect(deps.stopConversation).toHaveBeenCalledTimes(1);
    expect(sent(apiCalls)).toEqual([]);
  });

  it("réponse dans la langue de la conversation", async () => {
    const { deps } = assistantDeps({ language: "en" });
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/stop"));
    expect(sent(apiCalls)).toEqual(["Got it, I won't write to you again. All the best!"]);
  });
});

describe("/reset", () => {
  it("efface la conversation, réponse fixe, aucun tour lancé", async () => {
    const { state, deps } = assistantDeps({ stage: "CHAT" });
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/reset", {}, 321));
    expect(deps.resetConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv_1", memberId: "m1", telegramMessageId: 321 }),
    );
    expect(sent(apiCalls)).toEqual(["C'est fait, j'ai tout oublié. On recommence ? 😊"]);
    expect(state.inbound).toEqual([]);
    expect(state.enqueued).toEqual([]);
  });

  it("après un /stop : rien ne repart, « tu m'as demandé… » une fois par jour", async () => {
    const { state, deps } = assistantDeps({
      stoppedAt: new Date(),
      status: "CLOSED",
      stage: "CLOSED",
    });
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/reset"));
    await bot.handleUpdate(privateText("/reset"));
    expect(deps.resetConversation).toHaveBeenCalledTimes(2);
    expect(state.conv.stoppedAt).not.toBeNull();
    expect(state.enqueued).toEqual([]);
    expect(sent(apiCalls)).toHaveLength(1);
    expect(state.fixed.map((f) => f.key)).toEqual(["stoppedAlready"]);
  });

  it("même /reset renvoyé par Telegram : effacé et répondu une seule fois", async () => {
    const { deps } = assistantDeps({ stage: "CHAT" });
    const { bot, apiCalls } = makeBot(assistant, deps);
    const update = privateText("/reset", {}, 400);
    await bot.handleUpdate(update);
    await bot.handleUpdate({ ...update });
    expect(deps.resetConversation).toHaveBeenCalledTimes(2);
    expect(sent(apiCalls)).toEqual(["C'est fait, j'ai tout oublié. On recommence ? 😊"]);
  });

  it("persona désactivée (assistant mis en sourdine) : effacée, sans « On recommence ? »", async () => {
    const { state, deps } = assistantDeps({ stage: "CHAT", personaId: "persona_1" });
    state.personaActive = false;
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/reset"));
    expect(deps.resetConversation).toHaveBeenCalledTimes(1);
    expect(sent(apiCalls)).toEqual([]);
  });

  it("conversation reprise par l'équipe : effacée, l'assistant se tait", async () => {
    const { deps } = assistantDeps({ status: "HUMAN" });
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/reset"));
    expect(deps.resetConversation).toHaveBeenCalledTimes(1);
    expect(sent(apiCalls)).toEqual([]);
  });
});

describe("corrections après relecture : mineur à la réception, « STOP » écrit, conversation bloquée par l'équipe", () => {
  it("âge déclaré, l'assistante a la parole : fermée dès la réception, arrêt poli, aucun tour en file", async () => {
    const { state, deps } = assistantDeps({ stage: "CHAT" });
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("au fait j'ai 16 ans mais je suis mature"));
    expect(state.inbound[0]).toMatchObject({
      minor: { age: 16, botId: "bot_lea", memberId: "m1" },
      countsAsExchange: true,
    });
    expect(state.conv).toMatchObject({ isMinor: true, status: "CLOSED" });
    expect(state.enqueued).toEqual([]);
    expect(state.fixed.map((f) => f.key)).toEqual(["minorStop"]);
    expect(sent(apiCalls)[0]).toMatch(/réservé aux adultes/);
  });

  it("âge déclaré pendant que l'équipe a la main (ou limite atteinte) : fermée quand même, sans message", async () => {
    const { state, deps } = assistantDeps({ status: "HUMAN", stage: "CHAT" });
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("j'ai 16 ans"));
    expect(state.conv).toMatchObject({ isMinor: true, status: "CLOSED" });
    expect(sent(apiCalls)).toEqual([]);
    expect(state.enqueued).toEqual([]);
    // Rendre la main ensuite ne peut plus rien déclencher : la conversation est close (mineur).
    await bot.handleUpdate(privateText("salut"));
    expect(state.enqueued).toEqual([]);
  });

  it("assistant désactivé : fermée pour mineur, sans message", async () => {
    const { state, deps } = assistantDeps();
    state.activation = false;
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("Lucas 16 ans"));
    expect(state.conv.isMinor).toBe(true);
    expect(sent(apiCalls)).toEqual([]);
  });

  it("« STOP » écrit sans barre oblique : comme /stop (définitif, réponse fixe), gardé dans le fil, rien en file", async () => {
    const { state, deps } = assistantDeps({ stage: "CHAT" });
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("STOP"));
    expect(deps.stopConversation).toHaveBeenCalledTimes(1);
    expect(state.enqueued).toEqual([]);
    expect(state.fixed.map((f) => f.key)).toEqual(["stopDone"]);
    expect(sent(apiCalls)).toEqual(["C'est noté, je ne t'écrirai plus. Bonne continuation !"]);
    expect(state.inbound[0]).toMatchObject({
      text: "STOP",
      meta: { command: "stop", typed: true },
      countsAsExchange: false,
    });
    // Ensuite : plus aucune réponse de l'IA.
    await bot.handleUpdate(privateText("ok"));
    expect(state.enqueued).toEqual([]);
  });

  it("« arrête de m'écrire » seul vaut /stop ; « stop 😂 » est un message normal", async () => {
    let { state, deps } = assistantDeps();
    let { bot } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("Arrête de m'écrire stp"));
    expect(deps.stopConversation).toHaveBeenCalledTimes(1);
    ({ state, deps } = assistantDeps());
    ({ bot } = makeBot(assistant, deps));
    await bot.handleUpdate(privateText("stop 😂"));
    expect(deps.stopConversation).not.toHaveBeenCalled();
    expect(state.enqueued).toEqual(["conv_1"]);
  });

  it("conversation bloquée par l'équipe : /stop sans « c'est noté », puis ni /start ni /reset ne répondent", async () => {
    const { state, deps } = assistantDeps({
      status: "CLOSED",
      stage: "CLOSED",
      closedReason: "TEAM",
    });
    const { bot, apiCalls } = makeBot(assistant, deps);
    await bot.handleUpdate(privateText("/stop"));
    expect(deps.stopConversation).toHaveBeenCalledTimes(1);
    expect(state.conv.stoppedAt).not.toBeNull();
    await bot.handleUpdate(privateText("/start"));
    await bot.handleUpdate(privateText("/reset"));
    expect(sent(apiCalls)).toEqual([]);
    expect(state.fixed).toEqual([]);
    expect(deps.claimStoppedReply).not.toHaveBeenCalled();
  });
});
