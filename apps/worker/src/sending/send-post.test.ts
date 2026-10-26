/**
 * Filet de `sendPost` (phase 17) : un message de canal resté sur un bot devenu assistant de conversation n'est jamais
 * publié ; il échoue avec une raison claire (le site choisit un bot normal à la modification suivante).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const state = { post: null as Row | null, updates: [] as Row[] };
  const prisma = {
    post: {
      findUnique: vi.fn(async () => state.post),
      update: vi.fn(async ({ data }: { data: Row }) => {
        state.updates.push(data);
        return data;
      }),
    },
    postStats: { upsert: vi.fn(async () => undefined) },
  };
  const api = {
    sendMessage: vi.fn(async () => ({ message_id: 7 })),
    unpinAllChatMessages: vi.fn(async () => true),
    pinChatMessage: vi.fn(async () => true),
  };
  return { state, prisma, api };
});

vi.mock("@linkaffipro/db", () => ({
  prisma: db.prisma,
  recordEvent: vi.fn(async () => undefined),
  toJsonValue: (v: unknown) => v,
}));
vi.mock("@linkaffipro/queue", () => ({ enqueue: vi.fn(async () => ({})), getRedis: () => ({}) }));
vi.mock("@linkaffipro/telegram", () => ({
  CUSTOM_EMOJIS_DROPPED_ERROR: "dropped",
  customEmojisDropped: () => false,
  sendWithEmojiFallback: (html: string, send: (h: string) => Promise<unknown>) => send(html),
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./api", () => ({
  apiForBot: vi.fn(async () => ({ api: db.api, username: "casino_bot", mode: "STANDARD" })),
}));
vi.mock("./media", () => ({
  loadMedia: vi.fn(async () => null),
  rememberTelegramFile: vi.fn(async () => undefined),
  toInputMedia: vi.fn(),
}));
vi.mock("./rate-limit", () => ({
  RateLimiter: class {
    forBot = async () => undefined;
    forChannel = async () => undefined;
  },
}));
// Phase 30 : verrou du QA Global testé à part (`qa-gate.test.ts`) ; ici les posts passent.
vi.mock("./qa-gate", () => ({ passesQaGate: vi.fn(async () => true) }));
vi.mock("./send-post-account", () => ({
  sendPostAccount: vi.fn(async () => undefined),
  deletePostAccount: vi.fn(async () => undefined),
  partialPublicationChannel: vi.fn(async () => null),
}));

import { recordEvent } from "@linkaffipro/db";
import { apiForBot } from "./api";
import { POST_BY_ASSISTANT_MESSAGE, sendPost } from "./send-post";
import { sendPostAccount } from "./send-post-account";

const post = (over: Row = {}): Row => ({
  id: "p1",
  code: "CODE1",
  status: "SENDING",
  publisher: "BOT",
  channelId: "c1",
  botId: "b1",
  bot: { id: "b1", mode: "STANDARD", isActive: true },
  channel: { telegramChatId: -100123n },
  text: "Bonjour",
  buttons: [],
  mediaAssetIds: [],
  telegramMessageIds: null,
  sentAt: null,
  disableNotification: false,
  protectContent: false,
  disableLinkPreview: true,
  pinAfterSend: false,
  unpinPrevious: false,
  deleteAfterMinutes: null,
  ...over,
});

beforeEach(() => {
  db.state.updates = [];
  vi.clearAllMocks();
});

describe("message de canal d'un bot devenu assistant de conversation", () => {
  it("jamais publié : échec avec une raison claire, journalisé", async () => {
    db.state.post = post({ bot: { id: "b1", mode: "ASSISTANT", isActive: true } });
    await sendPost("p1");
    expect(apiForBot).not.toHaveBeenCalled();
    expect(db.api.sendMessage).not.toHaveBeenCalled();
    expect(db.state.updates).toEqual([
      expect.objectContaining({ status: "FAILED", lastError: POST_BY_ASSISTANT_MESSAGE }),
    ]);
    expect(vi.mocked(recordEvent).mock.calls[0]![0]).toMatchObject({
      type: "post.failed",
      botId: "b1",
      payload: { postId: "p1", error: POST_BY_ASSISTANT_MESSAGE },
    });
  });

  it("publié par le compte Telegram connecté : le bot n'intervient pas, rien n'est refusé", async () => {
    db.state.post = post({
      publisher: "ACCOUNT",
      bot: { id: "b1", mode: "ASSISTANT", isActive: true },
    });
    await sendPost("p1");
    expect(sendPostAccount).toHaveBeenCalledTimes(1);
    expect(db.state.updates).toEqual([]);
  });

  it("bot normal : publié comme avant", async () => {
    db.state.post = post();
    await sendPost("p1");
    expect(db.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(db.state.updates.at(-1)).toMatchObject({ status: "SENT", telegramMessageIds: [7] });
  });
});
