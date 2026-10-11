/**
 * Publication par le compte Telegram connecté (phase 12, base réelle, client GramJS simulé : aucune connexion réelle) :
 * - message de canal avec emojis animés (`publisher` ACCOUNT) → messages.sendMessage avec les bonnes entités (positions
 *   UTF-16), identifiants enregistrés, `post.sent` avec `publisher: "ACCOUNT"`, suppression programmée par le compte ;
 * - album avec légende, épingler et désépingler par la même session ;
 * - FLOOD_WAIT au milieu d'un envoi → nouvel essai différé, sans doublon ; session expirée → échec clair, alerte ;
 * - message BOT inchangé (Bot API, jamais le compte) ;
 * - tâches `custom-emoji` : `account-status` (Premium, droits par canal), passage périodique, `import-account`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@linkaffipro/core";
import { prisma } from "@linkaffipro/db";
import { getRedis, withMtprotoLock } from "@linkaffipro/queue";
import type * as TelegramModule from "@linkaffipro/telegram";
import { Api, helpers } from "telegram";
import type * as GramModule from "telegram";
import { runAlerts } from "../../src/maintenance/alerts";
import { processCustomEmoji } from "../../src/processors/custom-emoji";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import {
  ALREADY_PUBLISHED_NOT_FOUND_MESSAGE,
  defaultAccountPostDeps,
  MAX_ACCOUNT_DEFERRALS,
  OTHER_CHANNEL_MESSAGE,
  sendPostAccount,
} from "../../src/sending/send-post-account";
import { PARTIAL_BY_ACCOUNT_MESSAGE } from "../../src/sending/send-post";
import {
  capturedJobs,
  createBotAndChannel,
  fakeJob,
  installFakeTelegram,
  resetDb,
  type TelegramCall,
} from "./helpers";

const big = helpers.returnBigInt;
const CHAT_ID = -1001234567890n;
const EMOJI = "5368324170671202286";
const EMOJI2 = "5370869711888194012";

/** Compte Telegram simulé : requêtes consignées, réponses comme un canal, comportement réglable par test. */
const mt = vi.hoisted(() => ({
  calls: [] as unknown[],
  handler: null as null | ((req: unknown) => unknown),
  premium: true,
  dialogs: [] as unknown[],
  connects: 0,
  nextId: 900,
}));

vi.mock("telegram", async (importOriginal) => {
  const orig = await importOriginal<typeof GramModule>();
  const { Api: A, helpers: h } = orig;
  const updatesFor = (items: Array<{ randomId: unknown; entities?: unknown }>) =>
    new A.Updates({
      updates: items.flatMap((i) => {
        const id = mt.nextId++;
        return [
          new A.UpdateMessageID({ id, randomId: h.returnBigInt(String(i.randomId)) }),
          new A.UpdateNewChannelMessage({
            message: new A.Message({
              id,
              peerId: new A.PeerChannel({ channelId: h.returnBigInt(1234567890) }),
              date: 0,
              message: "",
              entities: i.entities as never,
            }),
            pts: 1,
            ptsCount: 1,
          }),
        ];
      }),
      users: [],
      chats: [],
      date: 0,
      seq: 0,
    });
  class FakeTelegramClient {
    session = { save: () => "session-simulee" };
    async connect() {
      mt.connects++;
    }
    async disconnect() {}
    async destroy() {}
    async getInputEntity(id: number) {
      return new A.InputPeerChannel({
        channelId: h.returnBigInt(String(-id).replace(/^100/, "")),
        accessHash: h.returnBigInt(5),
      });
    }
    async getDialogs() {
      return mt.dialogs.map((entity) => ({ entity }));
    }
    async getMe() {
      return new A.User({
        id: h.returnBigInt(99),
        firstName: "Admin",
        username: "admin",
        premium: mt.premium,
      });
    }
    async uploadFile(p: { file: { name: string } }) {
      return new A.InputFile({
        id: h.returnBigInt(1),
        parts: 1,
        name: p.file.name,
        md5Checksum: "",
      });
    }
    async invoke(req: unknown) {
      mt.calls.push(req);
      const custom = mt.handler?.(req);
      if (custom instanceof Error) throw custom;
      if (custom !== undefined) return custom;
      if (req instanceof A.messages.SendMessage || req instanceof A.messages.SendMedia)
        return updatesFor([{ randomId: req.randomId, entities: req.entities }]);
      if (req instanceof A.messages.SendMultiMedia)
        return updatesFor(
          req.multiMedia.map((m) => ({ randomId: m.randomId, entities: m.entities })),
        );
      if (req instanceof A.messages.UploadMedia)
        return new A.MessageMediaPhoto({
          photo: new A.Photo({
            id: h.returnBigInt(mt.nextId * 10),
            accessHash: h.returnBigInt(7),
            fileReference: Buffer.from("r"),
            date: 0,
            sizes: [],
            dcId: 2,
          }),
        });
      if (req instanceof A.messages.UnpinAllMessages)
        return new A.messages.AffectedHistory({ pts: 1, ptsCount: 1, offset: 0 });
      if (req instanceof A.channels.DeleteMessages)
        return new A.messages.AffectedMessages({ pts: 1, ptsCount: 1 });
      return new A.Updates({ updates: [], users: [], chats: [], date: 0, seq: 0 });
    }
  }
  return { ...orig, TelegramClient: FakeTelegramClient };
});

// Notification Telegram de l'admin simulée : jamais d'appel réel.
const notified = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock("@linkaffipro/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof TelegramModule>()),
  notifyAdmin: vi.fn(async (text: string) => {
    notified.texts.push(text);
    return true;
  }),
}));

/** Erreur Telegram telle que GramJS la lève. */
function rpc(errorMessage: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`400: ${errorMessage}`), { errorMessage, code: 400, ...extra });
}

/** Verrou Redis de la session dans le Redis simulé des tests (SET NX PX / script de libération). */
const lockStore = new Map<string, string>();
function installLock() {
  const redis = getRedis() as unknown as Record<string, unknown>;
  redis.set = async (key: string, value: string) => {
    if (lockStore.has(key)) return null;
    lockStore.set(key, value);
    return "OK";
  };
  redis.eval = async (script: string, _n: number, key: string, token: string) => {
    if (lockStore.get(key) !== token) return 0;
    if (script.includes('"del"')) lockStore.delete(key);
    return 1;
  };
}

const sends = () =>
  mt.calls.filter(
    (c) =>
      c instanceof Api.messages.SendMessage ||
      c instanceof Api.messages.SendMedia ||
      c instanceof Api.messages.SendMultiMedia,
  );

let botId = "";
let channelId = "";
let botCalls: TelegramCall[] = [];
let seq = 0;

async function connectAccount(status = "ACTIVE") {
  await prisma.setting.upsert({
    where: { key: "telegram.userApi" },
    create: {
      key: "telegram.userApi",
      value: { apiId: 12345, apiHashEncrypted: encrypt("0123456789abcdef0123456789abcdef") },
    },
    update: {},
  });
  await prisma.telegramUserSession.upsert({
    where: { id: "main" },
    create: { id: "main", phone: "+33600000000", sessionEncrypted: encrypt(""), status },
    update: { status, lastError: null },
  });
}

async function accountPost(data: Partial<Parameters<typeof prisma.post.create>[0]["data"]> = {}) {
  seq++;
  return prisma.post.create({
    data: {
      code: `ACC${String(seq).padStart(5, "0")}`,
      channelId,
      botId,
      status: "SENDING",
      scheduledAt: new Date(Date.now() - 60_000),
      publisher: "ACCOUNT",
      text: `<b>Bonus</b> 😀 <tg-emoji emoji-id="${EMOJI}">🎁</tg-emoji>`,
      ...data,
    } as Parameters<typeof prisma.post.create>[0]["data"],
  });
}

async function cleanAccountTables() {
  await prisma.customEmoji.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.setting.deleteMany({
    where: { key: { in: ["mtproto.publishStatus", "telegram.userApi"] } },
  });
  await prisma.telegramUserSession.deleteMany();
}

beforeAll(async () => {
  await resetDb();
  await cleanAccountTables();
  const { bot, channel } = await createBotAndChannel({ chatId: CHAT_ID });
  botId = bot.id;
  channelId = channel.id;
  botCalls = installFakeTelegram((await apiForBot(botId)).api);
  installLock();
});

afterAll(async () => {
  await cleanAccountTables();
  await prisma.mediaAsset.deleteMany({
    where: { sha256: { startsWith: "sha-" }, filename: { in: ["a.jpg", "b.jpg", "c.jpg"] } },
  });
});

beforeEach(async () => {
  mt.calls.length = 0;
  mt.handler = null;
  mt.premium = true;
  mt.dialogs = [];
  botCalls.length = 0;
  lockStore.clear();
  (globalThis.__jobs ??= []).length = 0;
  notified.texts.length = 0;
  await connectAccount();
});

describe("message de canal publié par le compte connecté", () => {
  it("texte avec emoji animé : entités exactes, identifiants enregistrés, post.sent ACCOUNT, aucun appel au bot", async () => {
    const post = await accountPost({
      disableNotification: true,
      deleteAfterMinutes: 10,
      protectContent: true,
    });
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));

    const [req] = sends() as Api.messages.SendMessage[];
    expect(sends()).toHaveLength(1);
    expect(req).toBeInstanceOf(Api.messages.SendMessage);
    expect(req!.message).toBe("Bonus 😀 🎁");
    expect(req!.silent).toBe(true);
    expect(req!.noWebpage).toBe(true);
    expect(req!.noforwards).toBeUndefined();
    expect(req!.entities?.map((e) => [e.className, e.offset, e.length])).toEqual([
      ["MessageEntityBold", 0, 5],
      // « Bonus 😀 » = 5 + 1 + 2 unités UTF-16 + espace.
      ["MessageEntityCustomEmoji", 9, 2],
    ]);
    expect((req!.entities![1] as Api.MessageEntityCustomEmoji).documentId.toString()).toBe(EMOJI);
    expect((req!.peer as Api.InputPeerChannel).channelId.toString()).toBe("1234567890");
    expect(botCalls).toHaveLength(0);

    const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("SENT");
    expect(saved.telegramMessageIds).toEqual([expect.any(Number)]);
    expect(saved.lastError).toBeNull();
    expect(saved.viewsNextAt).toBeInstanceOf(Date);
    expect(await prisma.postStats.findUnique({ where: { postId: post.id } })).not.toBeNull();
    const ev = await prisma.event.findFirstOrThrow({
      where: { type: "post.sent", channelId },
      orderBy: { occurredAt: "desc" },
    });
    expect(ev.payload).toMatchObject({
      postId: post.id,
      messageIds: saved.telegramMessageIds,
      publisher: "ACCOUNT",
      customEmoji: { sent: 1, kept: 1 },
      protectContentApplied: false,
    });
    expect(
      (await prisma.telegramUserSession.findUniqueOrThrow({ where: { id: "main" } })).lastUsedAt,
    ).toBeInstanceOf(Date);

    // Suppression programmée : par le compte, jamais par le bot.
    const del = capturedJobs("telegram-send").find((j) => j.data.type === "delete-post");
    expect(del?.opts.delay).toBe(10 * 60_000);
    mt.calls.length = 0;
    await processTelegramSend(fakeJob({ type: "delete-post" as const, postId: post.id }));
    const delReq = mt.calls[0] as Api.channels.DeleteMessages;
    expect(delReq).toBeInstanceOf(Api.channels.DeleteMessages);
    expect(delReq.id).toEqual(saved.telegramMessageIds);
    expect(botCalls).toHaveLength(0);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe(
      "DELETED",
    );
    // Le verrou de la session est toujours rendu.
    expect(lockStore.size).toBe(0);
  });

  it("album avec légende : deux médias envoyés puis publiés ensemble, désépinglage puis épinglage du premier", async () => {
    const assets = await Promise.all(
      ["a", "b"].map((n) =>
        prisma.mediaAsset.create({
          data: {
            filename: `${n}.jpg`,
            mimeType: "image/jpeg",
            size: 3,
            sha256: `sha-${n}-${Date.now()}`,
            bytes: Buffer.from([1, 2, 3]),
          },
        }),
      ),
    );
    const post = await accountPost({
      text: `Album <tg-emoji emoji-id="${EMOJI2}">🔥</tg-emoji>`,
      mediaAssetIds: assets.map((a) => a.id),
      pinAfterSend: true,
      unpinPrevious: true,
    });
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    expect(mt.calls.filter((c) => c instanceof Api.messages.UploadMedia)).toHaveLength(2);
    const album = mt.calls.find(
      (c) => c instanceof Api.messages.SendMultiMedia,
    ) as Api.messages.SendMultiMedia;
    expect(album.multiMedia.map((m) => m.message)).toEqual(["Album 🔥", ""]);
    expect(album.multiMedia[0]!.entities?.[0]).toBeInstanceOf(Api.MessageEntityCustomEmoji);
    const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    const ids = saved.telegramMessageIds as number[];
    expect(ids).toHaveLength(2);
    const order = mt.calls.map((c) => (c as { className: string }).className);
    expect(order.indexOf("messages.UnpinAllMessages")).toBeLessThan(
      order.indexOf("messages.UpdatePinnedMessage"),
    );
    const pin = mt.calls.find(
      (c) => c instanceof Api.messages.UpdatePinnedMessage,
    ) as Api.messages.UpdatePinnedMessage;
    expect([pin.id, pin.silent]).toEqual([ids[0], true]);
    expect(botCalls).toHaveLength(0);
  });

  it("FLOOD_WAIT après le média : reste « en cours », nouvel essai différé, puis seul le texte part (aucun doublon)", async () => {
    const asset = await prisma.mediaAsset.create({
      data: {
        filename: "c.jpg",
        mimeType: "image/jpeg",
        size: 3,
        sha256: `sha-c-${Date.now()}`,
        bytes: Buffer.from([4, 5, 6]),
      },
    });
    // Texte de plus de 1024 caractères : la photo part seule, puis le texte.
    const text = `${"x".repeat(1100)} <tg-emoji emoji-id="${EMOJI}">🎁</tg-emoji>`;
    const post = await accountPost({ text, mediaAssetIds: [asset.id] });
    let floods = 0;
    mt.handler = (req) =>
      req instanceof Api.messages.SendMessage && floods++ === 0
        ? rpc("FLOOD_WAIT", { seconds: 42 })
        : undefined;

    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    let saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("SENDING");
    expect(saved.telegramMessageIds).toHaveLength(1);
    expect(saved.lastError).toMatch(
      /^Telegram demande d'attendre 42 s : nouvel essai à \d{2}:\d{2}\.$/,
    );
    expect(saved.attempts).toBe(1);
    const retry = capturedJobs("telegram-send").find(
      (j) => j.data.type === "post" && j.data.postId === post.id,
    );
    expect(retry?.opts).toMatchObject({ delay: 47_000, attempts: 1 });
    expect(String(retry?.opts.jobId)).toMatch(new RegExp(`^post:${post.id}:retry:`));
    expect(sends().map((c) => (c as { className: string }).className)).toEqual([
      "messages.SendMedia",
      "messages.SendMessage",
    ]);
    const floodedRandom = String((sends()[1] as Api.messages.SendMessage).randomId);

    // Le scheduler ne la reprend pas (toujours « en cours ») ; la tâche différée la termine.
    mt.calls.length = 0;
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    expect(sends().map((c) => (c as { className: string }).className)).toEqual([
      "messages.SendMessage",
    ]);
    saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("SENT");
    expect(saved.telegramMessageIds).toHaveLength(2);
    expect(saved.lastError).toBeNull();
    // Même identifiant d'envoi pour le texte repris : Telegram refuserait un second exemplaire.
    expect(String((sends()[0] as Api.messages.SendMessage).randomId)).toBe(floodedRandom);
  });

  it("session expirée : échec avec un message clair, compte à reconnecter, alerte critique et une seule notification", async () => {
    const waiting = await accountPost({
      status: "SCHEDULED",
      scheduledAt: new Date(Date.now() + 3600_000),
    });
    const post = await accountPost();
    mt.handler = (req) =>
      req instanceof Api.messages.SendMessage
        ? rpc("AUTH_KEY_UNREGISTERED", { code: 401 })
        : undefined;
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("FAILED");
    expect(saved.lastError).toBe(
      "La session du compte Telegram connecté a expiré ou a été révoquée : reconnectez-le dans Réglages → Connexions → Telegram. Puis reprogrammez ce message.",
    );
    const session = await prisma.telegramUserSession.findUniqueOrThrow({ where: { id: "main" } });
    expect(session.status).toBe("ERROR");
    const status = await prisma.setting.findUniqueOrThrow({
      where: { key: "mtproto.publishStatus" },
    });
    expect(status.value).toMatchObject({ connected: false });
    expect(
      await prisma.event.count({
        where: { type: "post.failed", payload: { path: ["postId"], equals: post.id } },
      }),
    ).toBe(1);

    await runAlerts(new Date());
    const alert = await prisma.alert.findFirstOrThrow({
      where: { kind: "telegram_account_reconnect" },
    });
    expect(alert.severity).toBe("CRITICAL");
    expect(alert.message).toContain("1 message programmé avec emojis animés ne partira pas");
    await runAlerts(new Date(Date.now() + 10 * 60_000));
    expect(await prisma.alert.count({ where: { kind: "telegram_account_reconnect" } })).toBe(1);
    expect(
      notified.texts.filter((t) => t.includes("Réglages → Connexions → Telegram → Reconnecter")),
    ).toHaveLength(1);
    await prisma.post.delete({ where: { id: waiting.id } });
  });

  it("aucun compte connecté : échec immédiat sans connexion à Telegram", async () => {
    await prisma.telegramUserSession.update({
      where: { id: "main" },
      data: { status: "DISCONNECTED" },
    });
    const connects = mt.connects;
    const post = await accountPost();
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("FAILED");
    expect(saved.lastError).toMatch(
      /^Aucun compte Telegram connecté : connectez votre compte dans Réglages → Connexions → Telegram\./,
    );
    expect(mt.connects).toBe(connects);
    expect(mt.calls).toHaveLength(0);
  });

  it("compte occupé (relevé des vues en cours) : rien n'est envoyé, nouvel essai dans une minute", async () => {
    const post = await accountPost();
    lockStore.set("mtproto:lock", "worker:views:autre");
    const out = await sendPostAccount(
      await prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: { channel: true } }),
      {
        ...defaultAccountPostDeps,
        lock: (fn, opts) => withMtprotoLock(getRedis(), fn, { ...opts, waitMs: 0 }),
      },
    );
    expect(out).toEqual({ status: "deferred", delayMs: 60_000 });
    expect(mt.calls).toHaveLength(0);
    const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("SENDING");
    expect(saved.lastError).toMatch(/occupé/);
    expect(
      capturedJobs("telegram-send").some(
        (j) => j.data.postId === post.id && j.opts.delay === 60_000,
      ),
    ).toBe(true);
  });

  it("droit de publier retiré : échec en français et canal marqué « ne peut pas publier »", async () => {
    const post = await accountPost();
    mt.handler = (req) =>
      req instanceof Api.messages.SendMessage
        ? rpc("CHAT_WRITE_FORBIDDEN", { code: 403 })
        : undefined;
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("FAILED");
    expect(saved.lastError).toMatch(/n'a pas le droit de publier dans ce canal/);
    const status = await prisma.setting.findUniqueOrThrow({
      where: { key: "mtproto.publishStatus" },
    });
    expect(
      (status.value as { channels: Record<string, { canPost: boolean }> }).channels[channelId]
        ?.canPost,
    ).toBe(false);
  });

  it("message publié par le bot : inchangé (Bot API, emojis normaux), jamais par le compte", async () => {
    const post = await accountPost({ publisher: "BOT", text: "Bonus 🎁" });
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    expect(mt.calls).toHaveLength(0);
    expect(botCalls.find((c) => c.method === "sendMessage")?.payload.text).toBe("Bonus 🎁");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("SENT");
    const ev = await prisma.event.findFirstOrThrow({
      where: { type: "post.sent", payload: { path: ["postId"], equals: post.id } },
    });
    expect((ev.payload as { publisher?: string }).publisher).toBeUndefined();
  });
});

describe("tâches du compte connecté (file custom-emoji)", () => {
  it("account-status : Premium et droit de publier par canal, enregistrés par identifiant de canal", async () => {
    const other = await prisma.channel.create({
      data: { telegramChatId: -1009999999999n, title: "Autre canal", type: "CHANNEL" },
    });
    mt.dialogs = [
      new Api.Channel({
        id: big(1234567890),
        title: "Canal test",
        photo: new Api.ChatPhotoEmpty(),
        date: 0,
        broadcast: true,
        adminRights: new Api.ChatAdminRights({ postMessages: true }),
      }),
    ];
    mt.handler = (req) =>
      req instanceof Api.channels.GetParticipant ? rpc("USER_NOT_PARTICIPANT") : undefined;
    const r = await processCustomEmoji(
      fakeJob({ type: "account-status" as const, channelIds: [channelId, other.id] }),
    );
    expect(r).toMatchObject({ checked: 2, connected: true, premium: true });
    const status = (
      await prisma.setting.findUniqueOrThrow({ where: { key: "mtproto.publishStatus" } })
    ).value as {
      connected: boolean;
      premium: boolean;
      error: string | null;
      user: { id: string; username: string };
      channels: Record<string, { canPost: boolean; error?: string | null }>;
    };
    expect(status).toMatchObject({
      connected: true,
      premium: true,
      error: null,
      user: { id: "99", username: "admin" },
    });
    expect(status.channels[channelId]).toMatchObject({ canPost: true, error: null });
    expect(status.channels[other.id]).toMatchObject({ canPost: false });
    expect(status.channels[other.id]?.error).toMatch(/n'est pas dans ce canal/);
    expect(lockStore.size).toBe(0);
    await prisma.channel.delete({ where: { id: other.id } });
  });

  it("passage périodique : relève l'état s'il date de plus d'une heure, sinon ne contacte pas Telegram", async () => {
    await prisma.setting.upsert({
      where: { key: "mtproto.publishStatus" },
      create: {
        key: "mtproto.publishStatus",
        value: {
          checkedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
          connected: true,
          premium: true,
          user: null,
          error: null,
          channels: {},
        },
      },
      update: {
        value: {
          checkedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
          connected: true,
          premium: true,
          user: null,
          error: null,
          channels: {},
        },
      },
    });
    mt.premium = false;
    const r1 = (await processCustomEmoji(fakeJob({ type: "tick" as const }))) as {
      account: { premium?: boolean };
    };
    expect(r1.account.premium).toBe(false);
    const getMeCalls = mt.connects;
    const r2 = (await processCustomEmoji(fakeJob({ type: "tick" as const }))) as {
      account: { skipped?: string };
    };
    expect(r2.account.skipped).toBe("état à jour");
    expect(mt.connects).toBe(getMeCalls);
    // Session devenue « à reconnecter » : état « non connecté » sans appel à Telegram.
    await prisma.telegramUserSession.update({ where: { id: "main" }, data: { status: "ERROR" } });
    await processCustomEmoji(fakeJob({ type: "tick" as const }));
    const status = (
      await prisma.setting.findUniqueOrThrow({ where: { key: "mtproto.publishStatus" } })
    ).value;
    expect(status).toMatchObject({ connected: false });
    expect(mt.connects).toBe(getMeCalls);
  });

  it("import-account : ajoute les emojis des packs installés sans doublon, complète les connus, garde les retirés", async () => {
    const user = await prisma.user.upsert({
      where: { email: "emoji-import@test.local" },
      create: { email: "emoji-import@test.local", name: "Équipe", passwordHash: "x" },
      update: {},
    });
    await prisma.customEmoji.create({
      data: { customEmojiId: "11", fallback: "🔥", source: "FORWARD" },
    });
    await prisma.customEmoji.create({
      data: {
        customEmojiId: "12",
        fallback: "💥",
        source: "PACK",
        setName: "Fire",
        hiddenAt: new Date(),
      },
    });
    const doc = (id: string, alt: string, mimeType = "application/x-tgsticker") =>
      new Api.Document({
        id: big(id),
        accessHash: big(1),
        fileReference: Buffer.from(""),
        date: 0,
        mimeType,
        size: big(10),
        dcId: 2,
        attributes: [
          new Api.DocumentAttributeCustomEmoji({ alt, stickerset: new Api.InputStickerSetEmpty() }),
        ],
      });
    const set = (id: number, shortName: string) =>
      new Api.StickerSet({
        id: big(id),
        accessHash: big(id),
        title: `Pack ${shortName}`,
        shortName,
        count: 2,
        hash: 0,
        emojis: true,
      });
    mt.handler = (req) => {
      if (req instanceof Api.messages.GetEmojiStickers)
        return new Api.messages.AllStickers({
          hash: big(0),
          sets: [set(1, "Fire"), set(2, "Love")],
        });
      if (req instanceof Api.messages.GetStickerSet) {
        const id = (req.stickerset as Api.InputStickerSetID).id.toString();
        return id === "1"
          ? new Api.messages.StickerSet({
              set: set(1, "Fire"),
              packs: [],
              keywords: [],
              documents: [doc("11", "🔥"), doc("12", "💥"), doc("13", "🧨", "video/webm")],
            })
          : new Api.messages.StickerSet({
              set: set(2, "Love"),
              packs: [],
              keywords: [],
              documents: [doc("21", "❤️", "image/webp"), doc("13", "🧨", "video/webm")],
            });
      }
      return undefined;
    };
    const r = await processCustomEmoji(
      fakeJob({ type: "import-account" as const, requestedById: user.id }),
    );
    expect(r).toMatchObject({ added: 2, already: 2, packs: 2, totalPacks: 2 });
    const rows = await prisma.customEmoji.findMany({ orderBy: { customEmojiId: "asc" } });
    expect(
      rows.map((e) => [
        e.customEmojiId,
        e.source,
        e.setName,
        e.format,
        e.fallback,
        e.hiddenAt !== null,
        e.addedById,
      ]),
    ).toEqual([
      ["11", "FORWARD", "Fire", "tgs", "🔥", false, null],
      ["12", "PACK", "Fire", "tgs", "💥", true, null],
      ["13", "ACCOUNT", "Fire", "webm", "🧨", false, user.id],
      ["21", "ACCOUNT", "Love", "webp", "❤️", false, user.id],
    ]);
    expect(rows.find((e) => e.customEmojiId === "21")?.setTitle).toBe("Pack Love");
    const ev = await prisma.event.findFirstOrThrow({
      where: { type: "custom_emoji.added" },
      orderBy: { occurredAt: "desc" },
    });
    expect(ev.payload).toMatchObject({
      count: 2,
      source: "ACCOUNT",
      ids: ["13", "21"],
      already: 2,
    });
    const previews = capturedJobs("custom-emoji").find((j) => j.data.type === "fetch-previews");
    expect(previews?.data.customEmojiIds).toEqual(expect.arrayContaining(["13", "21", "11", "12"]));
    // Aperçus moins prioritaires qu'une vérification du compte ou un import demandé par l'équipe.
    expect(Number(previews?.opts.priority)).toBeGreaterThan(0);

    // Second import : aucun doublon, l'événement signale la fin (le site sait que l'import est terminé). Le pack
    // « Fire », déjà complet dans la bibliothèque, n'est pas relu ; « Love » (un emoji rangé sous « Fire ») l'est.
    mt.calls.length = 0;
    const again = await processCustomEmoji(
      fakeJob({ type: "import-account" as const, requestedById: user.id }),
    );
    expect(again).toMatchObject({ added: 0, already: 2, skippedPacks: 1 });
    expect(mt.calls.filter((c) => c instanceof Api.messages.GetStickerSet)).toHaveLength(1);
    expect(await prisma.customEmoji.count()).toBe(4);
    expect(
      await prisma.event.count({
        where: { type: "custom_emoji.added", payload: { path: ["source"], equals: "ACCOUNT" } },
      }),
    ).toBe(2);
    await prisma.user.delete({ where: { id: user.id } });
  });
});

describe("import des packs du compte : reprises après une attente imposée (relecture)", () => {
  const doc = (id: string, alt: string) =>
    new Api.Document({
      id: big(id),
      accessHash: big(1),
      fileReference: Buffer.from(""),
      date: 0,
      mimeType: "application/x-tgsticker",
      size: big(10),
      dcId: 2,
      attributes: [
        new Api.DocumentAttributeCustomEmoji({ alt, stickerset: new Api.InputStickerSetEmpty() }),
      ],
    });
  const set = (id: number, shortName: string) =>
    new Api.StickerSet({
      id: big(id),
      accessHash: big(id),
      title: `Pack ${shortName}`,
      shortName,
      count: 1,
      hash: 0,
      emojis: true,
    });
  const packs = [set(101, "Alpha"), set(102, "Beta"), set(103, "Gamma")];
  const askedIds = () =>
    mt.calls
      .filter((c) => c instanceof Api.messages.GetStickerSet)
      .map((c) =>
        ((c as Api.messages.GetStickerSet).stickerset as Api.InputStickerSetID).id.toString(),
      );

  beforeEach(async () => {
    await prisma.customEmoji.deleteMany();
    await prisma.event.deleteMany({ where: { type: "custom_emoji.added" } });
  });

  it("la reprise saute les packs déjà complets et termine l'import (plus de boucle sur les mêmes packs)", async () => {
    let floodOnBeta = true;
    mt.handler = (req) => {
      if (req instanceof Api.messages.GetEmojiStickers)
        return new Api.messages.AllStickers({ hash: big(0), sets: packs });
      if (req instanceof Api.messages.GetStickerSet) {
        const id = (req.stickerset as Api.InputStickerSetID).id.toString();
        if (id === "102" && floodOnBeta) {
          floodOnBeta = false;
          return rpc("FLOOD_WAIT", { seconds: 120 });
        }
        const s = packs.find((p) => p.id.toString() === id)!;
        return new Api.messages.StickerSet({
          set: s,
          packs: [],
          keywords: [],
          documents: [doc(`${id}1`, "⭐")],
        });
      }
      return undefined;
    };
    const first = await processCustomEmoji(fakeJob({ type: "import-account" as const }));
    expect(first).toMatchObject({ added: 1, packs: 1, retryInMs: 125_000 });
    expect(askedIds()).toEqual(["101", "102"]);
    const retry = capturedJobs("custom-emoji").find(
      (j) => j.data.type === "import-account" && j.opts.delay === 125_000,
    );
    expect(retry).toBeDefined();

    mt.calls.length = 0;
    const second = await processCustomEmoji(fakeJob({ type: "import-account" as const }));
    // « Alpha » est déjà complet : la lecture reprend à « Beta ».
    expect(askedIds()).toEqual(["102", "103"]);
    expect(second).toMatchObject({ added: 2, skippedPacks: 1 });
    expect(second).not.toHaveProperty("retryInMs");
    expect(await prisma.customEmoji.count()).toBe(3);
  });

  it("attente imposée à chaque passage : au plus 5 reprises, puis import signalé partiel", async () => {
    mt.handler = (req) => {
      if (req instanceof Api.messages.GetEmojiStickers)
        return new Api.messages.AllStickers({ hash: big(0), sets: packs });
      if (req instanceof Api.messages.GetStickerSet) return rpc("FLOOD_WAIT", { seconds: 120 });
      return undefined;
    };
    const results: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 6; i++) {
      (globalThis.__jobs ??= []).length = 0;
      results.push(
        (await processCustomEmoji(fakeJob({ type: "import-account" as const }))) as Record<
          string,
          unknown
        >,
      );
      const resumed = capturedJobs("custom-emoji").some((j) => j.data.type === "import-account");
      expect(resumed).toBe(i < 5);
    }
    expect(results.slice(0, 5).every((r) => r.retryInMs === 125_000)).toBe(true);
    expect(results[5]).toMatchObject({ partialStopped: true });
    expect(results[5]).not.toHaveProperty("retryInMs");
    const last = await prisma.event.findFirstOrThrow({
      where: { type: "custom_emoji.added" },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    });
    expect(last.payload).toMatchObject({ source: "ACCOUNT", partial: true, resumeStopped: true });

    // Nouvelle demande de l'équipe plus tard : la série repart de zéro (une reprise est de nouveau possible).
    (globalThis.__jobs ??= []).length = 0;
    const again = await processCustomEmoji(fakeJob({ type: "import-account" as const }));
    expect(again).toMatchObject({ retryInMs: 125_000 });
  });
});

describe("reprises du message publié par le compte (relecture)", () => {
  const busyDeps = {
    ...defaultAccountPostDeps,
    lock: <T>(fn: () => Promise<T>, opts: { owner: string; waitMs: number }) =>
      withMtprotoLock(getRedis(), fn, { ...opts, waitMs: 0 }),
  };
  const load = (id: string) =>
    prisma.post.findUniqueOrThrow({ where: { id }, include: { channel: true } });

  it("coupure réseau puis « identifiant d'envoi déjà utilisé » : message retrouvé dans le canal, SENT, épinglé, suppression programmée", async () => {
    const post = await accountPost({ pinAfterSend: true, deleteAfterMinutes: 15 });
    let first = true;
    mt.handler = (req) => {
      if (req instanceof Api.messages.SendMessage) {
        if (first) {
          first = false;
          // Parti chez Telegram, mais la connexion coupe avant la réponse.
          return new Error("Connection closed");
        }
        return rpc("RANDOM_ID_DUPLICATE");
      }
      if (req instanceof Api.messages.GetHistory)
        return new Api.messages.ChannelMessages({
          pts: 1,
          count: 2,
          topics: [],
          chats: [],
          users: [],
          messages: [
            new Api.Message({
              id: 951,
              peerId: new Api.PeerChannel({ channelId: big(1234567890) }),
              date: Math.floor(Date.now() / 1000),
              message: "Autre message",
              out: true,
            }),
            new Api.Message({
              id: 950,
              peerId: new Api.PeerChannel({ channelId: big(1234567890) }),
              date: Math.floor(Date.now() / 1000),
              message: "Bonus 😀 🎁",
              out: true,
              entities: [
                new Api.MessageEntityBold({ offset: 0, length: 5 }),
                new Api.MessageEntityCustomEmoji({ offset: 9, length: 2, documentId: big(EMOJI) }),
              ],
            }),
          ],
        });
      return undefined;
    };
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    let saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("SENDING");
    expect(saved.lastError).toMatch(/Telegram ne répond pas/);

    mt.calls.length = 0;
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("SENT");
    expect(saved.telegramMessageIds).toEqual([950]);
    expect(saved.lastError).toBeNull();
    const pin = mt.calls.find(
      (c) => c instanceof Api.messages.UpdatePinnedMessage,
    ) as Api.messages.UpdatePinnedMessage;
    expect(pin?.id).toBe(950);
    expect(
      capturedJobs("telegram-send").some(
        (j) => j.data.type === "delete-post" && j.data.postId === post.id,
      ),
    ).toBe(true);
    expect(
      await prisma.event.count({
        where: { type: "post.failed", payload: { path: ["postId"], equals: post.id } },
      }),
    ).toBe(0);
    const ev = await prisma.event.findFirstOrThrow({
      where: { type: "post.sent", payload: { path: ["postId"], equals: post.id } },
    });
    expect(ev.payload).toMatchObject({
      messageIds: [950],
      alreadyPublishedSteps: 1,
      notFoundSteps: 0,
      customEmoji: { sent: 1, kept: 1 },
    });
  });

  it("« identifiant d'envoi déjà utilisé » et message introuvable : SENT avec une note, jamais en échec", async () => {
    const post = await accountPost();
    mt.handler = (req) => {
      if (req instanceof Api.messages.SendMessage) return rpc("RANDOM_ID_DUPLICATE");
      if (req instanceof Api.messages.GetHistory)
        return new Api.messages.ChannelMessages({
          pts: 1,
          count: 0,
          topics: [],
          chats: [],
          users: [],
          messages: [],
        });
      return undefined;
    };
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("SENT");
    expect(saved.lastError).toBe(ALREADY_PUBLISHED_NOT_FOUND_MESSAGE);
  });

  it("reports comptés par programmation et par cause, pas avec le compteur cumulé", async () => {
    // Message reprogrammé après un échec : compteur cumulé déjà élevé.
    const post = await accountPost({ attempts: 15 });
    lockStore.set("mtproto:lock", "worker:views:autre");
    for (let i = 0; i < MAX_ACCOUNT_DEFERRALS; i++)
      expect((await sendPostAccount(await load(post.id), busyDeps)).status).toBe("deferred");
    expect(
      await prisma.event.count({
        where: {
          type: "post.deferred",
          AND: [
            { payload: { path: ["postId"], equals: post.id } },
            { payload: { path: ["cause"], equals: "busy" } },
          ],
        },
      }),
    ).toBe(MAX_ACCOUNT_DEFERRALS);
    // Une coupure réseau a ses propres reports.
    lockStore.clear();
    mt.handler = (req) =>
      req instanceof Api.messages.SendMessage ? new Error("Connection closed") : undefined;
    expect((await sendPostAccount(await load(post.id), defaultAccountPostDeps)).status).toBe(
      "deferred",
    );
    // Session occupée une fois de trop pour cette programmation : échec.
    mt.handler = null;
    lockStore.set("mtproto:lock", "worker:views:autre");
    const out = await sendPostAccount(await load(post.id), busyDeps);
    expect(out.status).toBe("failed");
    expect((await load(post.id)).lastError).toMatch(/après plusieurs essais/);
    // Reprogrammé (nouvelle heure) : les reports repartent de zéro.
    await prisma.post.update({
      where: { id: post.id },
      data: { status: "SENDING", scheduledAt: new Date(Date.now() - 1000) },
    });
    expect((await sendPostAccount(await load(post.id), busyDeps)).status).toBe("deferred");
  });

  it("publié en partie par le compte, puis passé au bot : refusé, rien n'est republié, la partie publiée reste suivie", async () => {
    const post = await accountPost({ text: "Bonus 🎁", publisher: "BOT" });
    await prisma.post.update({
      where: { id: post.id },
      data: { telegramMessageIds: [901, 902] },
    });
    await prisma.event.create({
      data: {
        type: "post.failed",
        channelId,
        botId,
        payload: {
          postId: post.id,
          publisher: "ACCOUNT",
          error: "x",
          messageIds: [901, 902],
          messageChannelId: channelId,
        },
      },
    });
    await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
    expect(botCalls).toHaveLength(0);
    expect(mt.calls).toHaveLength(0);
    const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(saved.status).toBe("FAILED");
    expect(saved.lastError).toBe(PARTIAL_BY_ACCOUNT_MESSAGE);
    expect(saved.telegramMessageIds).toEqual([901, 902]);
    const ev = await prisma.event.findFirstOrThrow({
      where: {
        type: "post.failed",
        AND: [
          { payload: { path: ["postId"], equals: post.id } },
          { payload: { path: ["error"], equals: PARTIAL_BY_ACCOUNT_MESSAGE } },
        ],
      },
    });
    expect(ev.payload).toMatchObject({ messageIds: [901, 902], messageChannelId: channelId });
  });

  it("canal changé après une publication interrompue : refusé (même reprogrammé deux fois), rien n'est publié", async () => {
    const other = await prisma.channel.create({
      data: { telegramChatId: -1007777777777n, title: "Autre canal", type: "CHANNEL" },
    });
    const post = await accountPost({ channelId: other.id, text: "Bonus 🎁" });
    await prisma.post.update({ where: { id: post.id }, data: { telegramMessageIds: [903] } });
    await prisma.event.create({
      data: {
        type: "post.failed",
        channelId,
        botId,
        payload: { postId: post.id, publisher: "ACCOUNT", error: "x", messageIds: [903] },
      },
    });
    for (let i = 0; i < 2; i++) {
      await prisma.post.update({ where: { id: post.id }, data: { status: "SENDING" } });
      await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
      const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
      expect(saved.status).toBe("FAILED");
      expect(saved.lastError).toBe(OTHER_CHANNEL_MESSAGE);
    }
    expect(sends()).toHaveLength(0);
    await prisma.post.delete({ where: { id: post.id } });
    await prisma.event.deleteMany({ where: { channelId: other.id } });
    await prisma.channel.delete({ where: { id: other.id } });
  });
});
