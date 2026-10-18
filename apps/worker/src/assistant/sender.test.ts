import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const state = {
    outbound: [] as Row[],
    messages: [] as Row[],
    updates: [] as Row[],
    deleted: [] as string[],
    events: [] as Array<{ conv: Row; input: Row }>,
    rl: [] as string[],
    typing: [] as Array<{ chatId: number; action: string }>,
    guardCalls: [] as Array<{ conversationId: string; resetsAtStart: number | null }>,
    verdicts: [] as Array<{ ok: true } | { ok: false; reason: string }>,
  };
  const tx = {
    outboundMessage: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.outbound.push(data);
        return { id: `om${state.outbound.length}` };
      }),
    },
    conversationMessage: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.messages.push(data);
        return { id: `cm${state.messages.length}` };
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    conversationMessage: {
      update: vi.fn(async (args: Row) => {
        state.updates.push(args);
        return args;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        state.deleted.push(where.id);
        return {};
      }),
    },
  };
  const api = {
    sendChatAction: vi.fn(async (chatId: number, action: string) => {
      state.typing.push({ chatId, action });
      return true;
    }),
  };
  return { state, prisma, api };
});

vi.mock("@linkaffipro/db", () => ({ prisma: db.prisma, toJsonValue: (v: unknown) => v }));
vi.mock("@linkaffipro/queue", () => ({ getRedis: () => ({}) }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../sending/api", () => ({
  apiForBot: vi.fn(async () => ({ api: db.api, username: "lea_bot" })),
}));
vi.mock("../sending/rate-limit", () => ({
  RateLimiter: class {
    forBot = async (id: string) => {
      db.state.rl.push(`bot:${id}`);
    };
    forPrivateChat = async (id: unknown) => {
      db.state.rl.push(`chat:${String(id)}`);
    };
  },
}));
vi.mock("../sending/send-dm", () => ({ sendDm: vi.fn() }));
vi.mock("./guard", () => ({
  conversationGuard: vi.fn(async (conversationId: string, resetsAtStart: number | null) => {
    db.state.guardCalls.push({ conversationId, resetsAtStart });
    return db.state.verdicts.shift() ?? { ok: true };
  }),
}));
vi.mock("./events", () => ({
  recordConversationEvent: vi.fn(async (conv: Row, input: Row) => {
    db.state.events.push({ conv, input });
  }),
}));

import type { DmSendResult } from "../sending/send-dm";
import { NOT_OURS_ERROR, createWorkerChatSender, type SenderContext } from "./sender";

const ctx = (): SenderContext => ({
  conversationId: "conv1",
  botId: "bot1",
  memberId: "mem1",
  chatId: 4242n,
  turnId: "t1",
  pendingOffer: null,
  offerSendsBefore: 0,
  resetsAtStart: 0,
});

const sent = (id: number): DmSendResult => ({
  status: "SENT",
  telegramMessageId: id,
  blocked: false,
  unreachable: false,
  error: null,
});

describe("envoi des messages de l'assistant", () => {
  beforeEach(() => {
    for (const k of Object.keys(db.state) as Array<keyof typeof db.state>) db.state[k].length = 0;
  });

  it("chaque partie : message de conversation + message privé (texte échappé), envoyés dans l'ordre", async () => {
    const order: string[] = [];
    const sendDm = vi.fn(async (id: string) => {
      order.push(id);
      return sent(order.length + 100);
    });
    const sender = createWorkerChatSender(ctx(), { sendDm });
    expect(await sender.sendText("Salut <3 & toi ?")).toEqual({ ok: true, telegramMessageId: 101 });
    expect(await sender.sendText("Deuxième")).toEqual({ ok: true, telegramMessageId: 102 });
    expect(order).toEqual(["om1", "om2"]);
    expect(db.state.outbound[0]).toMatchObject({
      botId: "bot1",
      memberId: "mem1",
      kind: "ASSISTANT",
      text: "Salut &lt;3 &amp; toi ?",
      buttons: [],
      mediaAssetId: null,
    });
    expect(db.state.messages[0]).toMatchObject({
      conversationId: "conv1",
      direction: "OUT",
      author: "ASSISTANT",
      text: "Salut <3 & toi ?",
      turnId: "t1",
      partIndex: 0,
      outboundMessageId: "om1",
      meta: {},
    });
    expect(db.state.messages[1]).toMatchObject({ partIndex: 1, outboundMessageId: "om2" });
    expect(db.state.updates[0]).toEqual({
      where: { id: "cm1" },
      data: { telegramMessageId: 101n },
    });
    expect(sender.sentRows).toEqual([
      { conversationMessageId: "cm1", partIndex: 0, offerSubId: null },
      { conversationMessageId: "cm2", partIndex: 1, offerSubId: null },
    ]);
    expect(db.state.events).toHaveLength(0);
  });

  it("le message qui porte le bouton du lien : sub-ID gardé et événement `offer_sent` une fois parti", async () => {
    const c = ctx();
    c.offerSendsBefore = 1;
    c.pendingOffer = { subId: "AbCdEfGh1234", url: "https://go.goolink.eu/a/AbCdEfGh1234" };
    const sender = createWorkerChatSender(c, {
      sendDm: async () => sent(7),
      now: () => new Date("2026-10-18T10:00:00Z"),
    });
    const buttons = [[{ text: "Découvrir l'app", url: "https://go.goolink.eu/a/AbCdEfGh1234" }]];
    await sender.sendMedia({ mediaAssetId: "media1" }, "Regarde 😊", { buttons });
    expect(db.state.outbound[0]).toMatchObject({
      buttons,
      mediaAssetId: "media1",
      text: "Regarde 😊",
    });
    expect(db.state.messages[0]).toMatchObject({
      media: { kind: "photo", mediaAssetId: "media1" },
      meta: { offerSubId: "AbCdEfGh1234" },
    });
    expect(db.state.events).toEqual([
      {
        conv: { id: "conv1", botId: "bot1", memberId: "mem1" },
        input: {
          type: "offer_sent",
          payload: { subId: "AbCdEfGh1234", offerSends: 2 },
          at: new Date("2026-10-18T10:00:00Z"),
        },
      },
    ]);
    expect(c.pendingOffer).toBeNull();
    expect(sender.sentRows[0]?.offerSubId).toBe("AbCdEfGh1234");
  });

  it("refus de Telegram : la ligne de conversation est retirée, le moteur apprend le blocage ; pas d'`offer_sent`", async () => {
    const c = ctx();
    c.pendingOffer = { subId: "AbCdEfGh1234", url: "https://go.goolink.eu/a/AbCdEfGh1234" };
    const sender = createWorkerChatSender(c, {
      sendDm: async () => ({
        status: "BLOCKED",
        telegramMessageId: null,
        blocked: true,
        unreachable: false,
        error: "Cette personne a bloqué le bot.",
      }),
    });
    const r = await sender.sendText("Le voici", {
      buttons: [[{ text: "Voir", url: "https://go.goolink.eu/a/AbCdEfGh1234" }]],
    });
    expect(r).toEqual({
      ok: false,
      blocked: true,
      unreachable: false,
      error: "Cette personne a bloqué le bot.",
    });
    expect(db.state.deleted).toEqual(["cm1"]);
    expect(db.state.events).toHaveLength(0);
    expect(sender.sentRows).toHaveLength(0);
    const unreachable = createWorkerChatSender(ctx(), {
      sendDm: async () => ({
        status: "FAILED",
        telegramMessageId: null,
        blocked: false,
        unreachable: true,
        error: "x",
      }),
    });
    expect(await unreachable.sendText("a")).toMatchObject({
      ok: false,
      unreachable: true,
      blocked: false,
    });
  });

  it("/stop, reprise ou /reset entre deux parties : la suite (et le bouton d'offre) ne part jamais", async () => {
    const c = ctx();
    c.pendingOffer = { subId: "AbCdEfGh1234", url: "https://go.goolink.eu/a/AbCdEfGh1234" };
    const sendDm = vi.fn(async () => sent(1));
    const sender = createWorkerChatSender(c, { sendDm });
    expect(await sender.sendText("Partie 1")).toEqual({ ok: true, telegramMessageId: 1 });
    db.state.verdicts.push({ ok: false, reason: "stopped" });
    expect(
      await sender.sendText("Partie 2", {
        buttons: [[{ text: "Voir", url: "https://go.goolink.eu/a/AbCdEfGh1234" }]],
      }),
    ).toEqual({ ok: false, blocked: false, unreachable: false, error: NOT_OURS_ERROR });
    // Relu avant chaque partie, avec le nombre de /reset du début du tour.
    expect(db.state.guardCalls).toEqual([
      { conversationId: "conv1", resetsAtStart: 0 },
      { conversationId: "conv1", resetsAtStart: 0 },
    ]);
    expect(sendDm).toHaveBeenCalledTimes(1);
    expect(db.state.outbound).toHaveLength(1);
    expect(db.state.messages).toHaveLength(1);
    expect(db.state.events).toHaveLength(0);
    expect(sender.sentRows).toHaveLength(1);
  });

  it("« écrit… » : débit du bot seulement, jamais le jeton « 1 message/s » du chat", async () => {
    const sender = createWorkerChatSender(ctx(), { sendDm: async () => sent(1) });
    await sender.sendTyping();
    expect(db.state.typing).toEqual([{ chatId: 4242, action: "typing" }]);
    expect(db.state.rl).toEqual(["bot:bot1"]);
  });
});
