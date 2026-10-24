import { describe, expect, it, vi } from "vitest";
import type { TelegramClient } from "telegram";

vi.mock("./logger", () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
const { createEntityCache, handleRequest, inviteHashOf, mailboxTick, toWirePosts, USERBOT_HEARTBEAT_KEY, USERBOT_REQUEST_PREFIX, waitAfterResolution } = await import("./reference-history");
type Ops = NonNullable<Parameters<typeof handleRequest>[0]["ops"]>;

const msg = (id: number, extra: Record<string, unknown> = {}) => ({ className: "Message", id, date: 1_792_000_000 + id, message: "", ...extra });

describe("conversion des messages (aucun média téléchargé)", () => {
  it("types de médias, vues, boutons, liens ; service ignoré ; album = un post", () => {
    const posts = toWirePosts([
      msg(10, { message: "Cote 1,85 ce soir", views: 1200, entities: [{ className: "MessageEntityUrl" }, { className: "MessageEntityMention" }], replyMarkup: { className: "ReplyInlineMarkup", rows: [{ buttons: [{}] }] } }),
      msg(9, { media: { className: "MessageMediaPhoto" }, groupedId: 77n }),
      msg(8, { media: { className: "MessageMediaPhoto" }, groupedId: 77n, message: "Album du soir" }),
      msg(7, { media: { className: "MessageMediaDocument", document: { attributes: [{ className: "DocumentAttributeVideo" }] } } }),
      msg(6, { media: { className: "MessageMediaPoll", poll: { question: { text: "Votre jeu ?" } } } }),
      msg(5, { media: { className: "MessageMediaDocument", document: { attributes: [{ className: "DocumentAttributeFilename" }] } } }),
      msg(4, { media: { className: "MessageMediaGeo" } }),
      { className: "MessageService", id: 3, date: 1 },
    ]);
    expect(posts.map((p) => [p.externalId, p.mediaKind])).toEqual([[10, "text"], [8, "photo"], [7, "video"], [6, "poll"], [5, "document"], [4, "other"]]);
    expect(posts[0]).toMatchObject({ text: "Cote 1,85 ce soir", views: 1200, hasButton: true, linkCount: 1 });
    expect(posts[1]!.text).toBe("Album du soir");
    expect(posts[3]!.text).toBe("Votre jeu ?");
    expect(posts[0]!.postedAt).toBe(new Date((1_792_000_000 + 10) * 1000).toISOString());
  });
  it("lien d'invitation seulement (jamais un nom public)", () => {
    expect(inviteHashOf("https://t.me/+AbC_12")).toBe("AbC_12");
    expect(inviteHashOf("t.me/joinchat/XyZ")).toBe("XyZ");
    expect(inviteHashOf("t.me/canal_public")).toBeNull();
  });
});

function setup(account: Record<string, unknown> = {}) {
  let now = new Date("2026-10-24T12:00:00Z");
  const rows = new Map<string, unknown>();
  const db = {
    setting: {
      findMany: async () => [...rows].map(([key, value]) => ({ key, value })).filter((r) => r.key.startsWith(USERBOT_REQUEST_PREFIX)),
      updateMany: async ({ where, data }: { where: { key: string }; data: { value: unknown } }) => (rows.has(where.key) ? (rows.set(where.key, data.value), { count: 1 }) : { count: 0 }),
      deleteMany: async ({ where }: { where: { key: string } }) => ({ count: rows.delete(where.key) ? 1 : 0 }),
      upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => rows.set(where.key, create.value),
    },
    telegramUserAccount: { findUnique: async () => ({ personaId: null, botId: null, isActive: true, status: "ACTIVE", ...account }) },
  };
  const ops = {
    isMember: vi.fn(async () => ({ member: true, title: "Canal", chatId: "-100777" })),
    history: vi.fn(async () => ({ posts: toWirePosts([msg(3, { message: "x" })]), title: "Canal", chatId: "-100777" })),
    joinInvite: vi.fn(async () => ({ title: "Canal", chatId: "-100777" })),
  } satisfies Ops;
  const client = {} as TelegramClient;
  const deps = { db: db as never, accounts: () => new Map([["acc1", { client }]]), ops, now: () => now };
  return { rows, ops, deps, advance: (ms: number) => (now = new Date(now.getTime() + ms)), now: () => now };
}

describe("demandes du worker", () => {
  const ch = { username: "canal_exemple", chatId: null };
  it("compte qui converse (persona ou bot fantôme), inactif ou non connecté : refusé, aucun appel Telegram", async () => {
    for (const acc of [{ personaId: "p1" }, { botId: "b1" }, { isActive: false }]) {
      const k = setup(acc);
      expect(await handleRequest(k.deps, { kind: "is-member", accountId: "acc1", channel: ch }, new Map())).toMatchObject({ ok: false });
      expect(k.ops.isMember).not.toHaveBeenCalled();
    }
    const k = setup();
    expect(await handleRequest(k.deps, { kind: "history", accountId: "autre", channel: ch, limit: 50 }, new Map())).toMatchObject({ ok: false, error: expect.stringMatching(/non connecté/) });
  });
  it("historique : 50 au plus, 5 s au moins entre deux lots d'un même compte ; FLOOD_WAIT renvoyé, jamais attendu", async () => {
    const k = setup();
    const gaps = new Map<string, number>();
    expect(await handleRequest(k.deps, { kind: "history", accountId: "acc1", channel: ch, limit: 500, beforeId: 40 }, gaps)).toMatchObject({ ok: true });
    expect(k.ops.history).toHaveBeenCalledWith(expect.anything(), ch, 50, 40);
    expect(await handleRequest(k.deps, { kind: "history", accountId: "acc1", channel: ch, limit: 50 }, gaps)).toBe("later");
    k.advance(5_000);
    k.ops.history.mockRejectedValueOnce(Object.assign(new Error("FLOOD_WAIT_42"), { errorMessage: "FLOOD_WAIT_42", seconds: 42 }));
    expect(await handleRequest(k.deps, { kind: "history", accountId: "acc1", channel: ch, limit: 50 }, gaps)).toEqual({ ok: false, floodWaitSeconds: 42 });
  });
  it("rejoindre : lien d'invitation seulement, une tentative", async () => {
    const k = setup();
    expect(await handleRequest(k.deps, { kind: "join-invite", accountId: "acc1", inviteLink: "t.me/canal_public" }, new Map())).toMatchObject({ ok: false });
    expect(k.ops.joinInvite).not.toHaveBeenCalled();
    expect(await handleRequest(k.deps, { kind: "join-invite", accountId: "acc1", inviteLink: "https://t.me/+AbC" }, new Map())).toMatchObject({ ok: true, chatId: "-100777" });
    expect(k.ops.joinInvite).toHaveBeenCalledTimes(1);
  });
  it("boucle : signal de vie, demande traitée et réponse écrite dans la ligne, demande abandonnée effacée", async () => {
    const k = setup();
    k.rows.set(`${USERBOT_REQUEST_PREFIX}a`, { kind: "is-member", accountId: "acc1", channel: ch, status: "PENDING", createdAt: k.now().toISOString() });
    k.rows.set(`${USERBOT_REQUEST_PREFIX}vieux`, { kind: "is-member", accountId: "acc1", channel: ch, status: "PENDING", createdAt: new Date(k.now().getTime() - 20 * 60_000).toISOString() });
    expect(await mailboxTick(k.deps, { lastHistoryAt: new Map(), lastBeatAt: 0 })).toBe("done");
    expect(k.rows.get(USERBOT_HEARTBEAT_KEY)).toEqual({ at: k.now().toISOString() });
    expect(k.rows.get(`${USERBOT_REQUEST_PREFIX}a`)).toMatchObject({ status: "DONE", response: { ok: true, member: true } });
    expect(k.rows.has(`${USERBOT_REQUEST_PREFIX}vieux`)).toBe(false);
  });
});

describe("nom public résolu une fois par lecture", () => {
  it("entité gardée 30 min par compte et par canal ; autre compte ou cache expiré → nouvelle résolution", async () => {
    let clock = 1_000_000;
    const resolve = vi.fn(async (_c: object, ch: { username: string | null }) => ({ name: ch.username }));
    const cache = createEntityCache(resolve, { now: () => clock });
    const a = {};
    const b = {};
    const ch = { username: "Exemple", chatId: null };
    const first = await cache.get(a, ch);
    clock += 60_000;
    await cache.get(a, { username: "exemple", chatId: null });
    await cache.get(a, ch);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect((await cache.get(a, ch)).resolvedAt).toBe(first.resolvedAt);
    await cache.get(b, ch);
    expect(resolve).toHaveBeenCalledTimes(2);
    clock += 31 * 60_000;
    await cache.get(a, ch);
    expect(resolve).toHaveBeenCalledTimes(3);
    cache.forget(a, ch);
    await cache.get(a, ch);
    expect(resolve).toHaveBeenCalledTimes(4);
  });
  it("5 s entre la résolution et le premier GetHistory (reste seulement)", async () => {
    const calls: number[] = [];
    const sleep = async (ms: number) => void calls.push(ms);
    await waitAfterResolution(10_000, () => 11_500, sleep);
    await waitAfterResolution(10_000, () => 20_000, sleep);
    expect(calls).toEqual([3_500]);
  });
});
