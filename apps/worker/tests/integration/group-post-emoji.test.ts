/**
 * Messages programmés publiés par le bot avec des emojis animés (phase 12, base réelle, Telegram simulé : aucun appel
 * réseau). Cas d'un groupe : le bot y garde ses emojis animés (Bot API 9.4, propriétaire Premium). Si Telegram les
 * refuse (Premium expiré, emoji retiré par son auteur), le même message repart aussitôt avec les emojis normaux
 * (texte, légende d'une photo, légende d'un album), au lieu de passer en échec ; s'il les retire en silence, c'est
 * signalé sans renvoi. Événement `post.custom_emoji_fallback`, note sur le message, alerte `custom_emoji_refused`.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import type * as TelegramModule from "@linkaffipro/telegram";
import type { Api } from "grammy";
import { runAlerts } from "../../src/maintenance/alerts";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import { POST_CUSTOM_EMOJI_FALLBACK_NOTE } from "../../src/sending/send-post";
import { createBotAndChannel, fakeJob, resetDb } from "./helpers";

// Notification Telegram de l'admin simulée : jamais d'appel réel.
const notified = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock("@linkaffipro/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof TelegramModule>()),
  notifyAdmin: vi.fn(async (text: string) => {
    notified.texts.push(text);
    return true;
  }),
}));

type Call = { method: string; payload: Record<string, unknown> };
/** Réponse de Telegram à un envoi qui contient une balise d'emoji animé. */
type EmojiMode = "refuse" | "keep" | "drop" | "other-error";

const GROUP_CHAT = -1005550001;
const EMOJI = "5368324170671202286";
const TEXT = `Bonus <tg-emoji emoji-id="${EMOJI}">🎁</tg-emoji> <b>VIP</b>`;
const PLAIN = "Bonus 🎁 <b>VIP</b>";
const REFUSAL =
  'Bad Request: can\'t parse entities: Unsupported start tag "tg-emoji" at byte offset 6';

const world = { mode: "keep" as EmojiMode };

function contentOf(method: string, p: Record<string, unknown>): string {
  if (method === "sendMediaGroup")
    return String((p.media as Array<{ caption?: string }> | undefined)?.[0]?.caption ?? "");
  return String(p.text ?? p.caption ?? "");
}

/** Telegram simulé (groupe) : refus, conservation ou retrait des emojis animés selon `world.mode`. */
function installGroupTelegram(api: Api): Call[] {
  const calls: Call[] = [];
  let nextId = 5000;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (!/^send(Message|Photo|Video|Animation|Document|MediaGroup)$/.test(method))
      return { ok: true, result: true } as never;
    const content = contentOf(method, p);
    const tags = (content.match(/<tg-emoji/g) ?? []).length;
    let entities: Array<{ type: string; offset: number; length: number }> = [];
    if (tags > 0) {
      if (world.mode === "refuse")
        return { ok: false, error_code: 400, description: REFUSAL } as never;
      if (world.mode === "other-error")
        return { ok: false, error_code: 400, description: "Bad Request: chat not found" } as never;
      if (world.mode === "keep")
        entities = Array.from({ length: tags }, () => ({
          type: "custom_emoji",
          offset: 0,
          length: 2,
        }));
    }
    const chat = { id: Number(p.chat_id), type: "supergroup", title: "Groupe" };
    const visible = content.replace(/<[^>]+>/g, "");
    const photo = [{ file_id: `F${nextId}`, file_unique_id: `U${nextId}`, width: 1, height: 1 }];
    if (method === "sendMediaGroup") {
      const media = (p.media as unknown[]) ?? [];
      return {
        ok: true,
        result: media.map((_, i) => ({
          message_id: nextId++,
          date: 0,
          chat,
          photo,
          ...(i === 0 && content ? { caption: visible, caption_entities: entities } : {}),
        })),
      } as never;
    }
    if (method === "sendMessage")
      return {
        ok: true,
        result: { message_id: nextId++, date: 0, chat, text: visible, entities },
      } as never;
    return {
      ok: true,
      result: {
        message_id: nextId++,
        date: 0,
        chat,
        photo,
        ...(content ? { caption: visible, caption_entities: entities } : {}),
      },
    } as never;
  });
  return calls;
}

let botId = "";
let channelId = "";
let calls: Call[] = [];
let seq = 0;

async function groupPost(data: Record<string, unknown> = {}) {
  seq++;
  const post = await prisma.post.create({
    data: {
      code: `GRP${String(seq).padStart(5, "0")}`,
      channelId,
      botId,
      status: "SENDING",
      scheduledAt: new Date(Date.now() - 60_000),
      text: TEXT,
      buttons: [[{ text: "Site", type: "URL", url: "https://example.org" }]],
      ...data,
    } as Parameters<typeof prisma.post.create>[0]["data"],
  });
  await processTelegramSend(fakeJob({ type: "post" as const, postId: post.id }));
  return prisma.post.findUniqueOrThrow({ where: { id: post.id } });
}

async function photos(n: number) {
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      prisma.mediaAsset.create({
        data: {
          filename: `g${i}.jpg`,
          mimeType: "image/jpeg",
          size: 3,
          sha256: `sha-grp-${seq}-${i}-${Date.now()}`,
          bytes: Buffer.from([1, 2, 3]),
        },
      }),
    ),
  );
}

const fallbackEvents = (postId: string) =>
  prisma.event.findMany({
    where: { type: "post.custom_emoji_fallback", payload: { path: ["postId"], equals: postId } },
  });
const sentEvent = (postId: string) =>
  prisma.event.findFirstOrThrow({
    where: { type: "post.sent", payload: { path: ["postId"], equals: postId } },
  });

beforeAll(async () => {
  await resetDb();
  await prisma.alert.deleteMany({ where: { kind: "custom_emoji_refused" } });
  await prisma.mediaAsset.deleteMany({ where: { sha256: { startsWith: "sha-grp-" } } });
  const created = await createBotAndChannel({ chatId: BigInt(GROUP_CHAT), title: "Groupe VIP" });
  botId = created.bot.id;
  channelId = created.channel.id;
  await prisma.channel.update({ where: { id: channelId }, data: { type: "GROUP" } });
  calls = installGroupTelegram((await apiForBot(botId)).api);
});

beforeEach(() => {
  world.mode = "keep";
  calls.length = 0;
});

describe("message programmé d'un groupe avec emojis animés, publié par le bot", () => {
  it("acceptés par Telegram : publié tel quel, sans repli ni note", async () => {
    const post = await groupPost();
    const sends = calls.filter((c) => c.method === "sendMessage");
    expect(sends.map((c) => c.payload.text)).toEqual([TEXT]);
    expect(post).toMatchObject({ status: "SENT", lastError: null });
    expect(await fallbackEvents(post.id)).toHaveLength(0);
    expect((await sentEvent(post.id)).payload).not.toHaveProperty("customEmojiFallback");
  });

  it("texte refusé : renvoyé aussitôt avec l'emoji normal, mêmes boutons, publié, noté et journalisé", async () => {
    world.mode = "refuse";
    const post = await groupPost();
    const sends = calls.filter((c) => c.method === "sendMessage");
    expect(sends.map((c) => c.payload.text)).toEqual([TEXT, PLAIN]);
    expect(sends[1]!.payload.parse_mode).toBe("HTML");
    expect(sends[1]!.payload.reply_markup).toEqual(sends[0]!.payload.reply_markup);
    expect(sends[1]!.payload.reply_markup).toBeDefined();
    expect(post).toMatchObject({
      status: "SENT",
      lastError: POST_CUSTOM_EMOJI_FALLBACK_NOTE.resent,
      attempts: 0,
    });
    expect(post.telegramMessageIds).toHaveLength(1);
    const events = await fallbackEvents(post.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ channelId, botId });
    expect(events[0]!.payload).toEqual({
      postId: post.id,
      botId,
      error: REFUSAL,
      resent: true,
    });
    expect((await sentEvent(post.id)).payload).toMatchObject({ customEmojiFallback: true });
    expect(await prisma.event.count({ where: { type: "post.failed" } })).toBe(0);
  });

  it("légende d'une photo refusée : la photo repart avec la légende de remplacement et ses boutons", async () => {
    world.mode = "refuse";
    const [asset] = await photos(1);
    const post = await groupPost({ mediaAssetIds: [asset!.id] });
    const sent = calls.filter((c) => c.method === "sendPhoto");
    expect(sent.map((c) => c.payload.caption)).toEqual([TEXT, PLAIN]);
    expect(sent[1]!.payload.reply_markup).toEqual(sent[0]!.payload.reply_markup);
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
    expect(post).toMatchObject({
      status: "SENT",
      lastError: POST_CUSTOM_EMOJI_FALLBACK_NOTE.resent,
    });
    expect(await fallbackEvents(post.id)).toHaveLength(1);
  });

  it("album refusé : l'album repart avec la légende de remplacement, le message des boutons part directement avec les emojis normaux", async () => {
    world.mode = "refuse";
    const assets = await photos(2);
    const post = await groupPost({ mediaAssetIds: assets.map((a) => a.id) });
    const albums = calls.filter((c) => c.method === "sendMediaGroup");
    expect(albums.map((c) => contentOf(c.method, c.payload))).toEqual([TEXT, PLAIN]);
    // Une fois le refus constaté, la suite du même message part sans nouvel essai refusé.
    const texts = calls.filter((c) => c.method === "sendMessage");
    expect(texts.map((c) => c.payload.text)).toEqual([PLAIN]);
    expect(post).toMatchObject({ status: "SENT" });
    expect(post.telegramMessageIds).toHaveLength(3);
    expect(await fallbackEvents(post.id)).toHaveLength(1);
  });

  it("emojis retirés en silence par Telegram : rien n'est renvoyé, signalé et noté", async () => {
    world.mode = "drop";
    const post = await groupPost();
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
    expect(post).toMatchObject({
      status: "SENT",
      lastError: POST_CUSTOM_EMOJI_FALLBACK_NOTE.dropped,
    });
    const events = await fallbackEvents(post.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ resent: false });
  });

  it("album dont la légende perd ses emojis en silence : signalé aussi", async () => {
    world.mode = "drop";
    const assets = await photos(2);
    const post = await groupPost({ mediaAssetIds: assets.map((a) => a.id), buttons: [] });
    expect(calls.filter((c) => c.method === "sendMediaGroup")).toHaveLength(1);
    expect(post).toMatchObject({
      status: "SENT",
      lastError: POST_CUSTOM_EMOJI_FALLBACK_NOTE.dropped,
    });
    expect(await fallbackEvents(post.id)).toHaveLength(1);
  });

  it("refus sans rapport avec les emojis : échec habituel, sans renvoi", async () => {
    world.mode = "other-error";
    const post = await groupPost();
    expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
    expect(post.status).toBe("FAILED");
    expect(await fallbackEvents(post.id)).toHaveLength(0);
  });

  it("alerte « emojis animés refusés » : les messages programmés comptent, une seule notification", async () => {
    await prisma.event.deleteMany({
      where: { type: { in: ["post.custom_emoji_fallback", "dm.custom_emoji_fallback"] } },
    });
    world.mode = "refuse";
    await groupPost();
    notified.texts.length = 0;
    await runAlerts(new Date());
    const alerts = await prisma.alert.findMany({ where: { kind: "custom_emoji_refused" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.message).toContain(
      "1 message programmé de la dernière heure est parti avec les emojis normaux",
    );
    expect(alerts[0]!.message).toContain("@bot_test");
    const emojiNotes = () => notified.texts.filter((t) => t.includes("emojis normaux"));
    expect(emojiNotes()).toHaveLength(1);
    await groupPost();
    await runAlerts(new Date(Date.now() + 5 * 60_000));
    expect(await prisma.alert.count({ where: { kind: "custom_emoji_refused" } })).toBe(1);
    expect(emojiNotes()).toHaveLength(1);
  });
});
