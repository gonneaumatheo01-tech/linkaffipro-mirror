import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import type { InlineKeyboardMarkup } from "grammy/types";
import { processScheduler } from "../../src/processors/scheduler";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import { capturedJobs, createBotAndChannel, fakeJob, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";

const CHAT_ID = -1001234567890n;
const POST_CODE = "C0DEP0ST";

describe("message programmé : scheduler → telegram-send → SENT (base réelle)", () => {
  let botId = "";
  let channelId = "";
  let postId = "";
  let calls: TelegramCall[] = [];

  beforeAll(async () => {
    await resetDb();
    const { bot, channel } = await createBotAndChannel({ chatId: CHAT_ID });
    botId = bot.id;
    channelId = channel.id;
    const post = await prisma.post.create({
      data: {
        code: POST_CODE,
        channelId,
        botId,
        status: "SCHEDULED",
        scheduledAt: new Date(Date.now() - 60_000),
        text: "Bonus du <b>jour</b> 🎁",
        buttons: [[{ text: "Site", type: "URL", url: "https://example.org" }], [{ text: "Bonus", type: "BUTTON", slug: "btn123" }, { text: "Mon offre", type: "OFFER", slug: "offtest1" }], [{ text: "Cassé", type: "URL", url: "javascript:alert(1)" }]],
        deleteAfterMinutes: 30,
        disableLinkPreview: true,
      },
    });
    postId = post.id;
    // Message futur : ne doit pas être réclamé.
    await prisma.post.create({ data: { code: "FUTUR001", channelId, botId, status: "SCHEDULED", scheduledAt: new Date(Date.now() + 3600_000), text: "Plus tard" } });
    calls = installFakeTelegram((await apiForBot(botId)).api);
  });

  it("le scheduler réclame le message échu et l'enfile dans telegram-send", async () => {
    const r = await processScheduler(fakeJob({ type: "tick" as const }));
    expect(r).toMatchObject({ claimed: 1 });
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.status).toBe("SENDING");
    expect((await prisma.post.findUniqueOrThrow({ where: { code: "FUTUR001" } })).status).toBe("SCHEDULED");
    const jobs = capturedJobs("telegram-send");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ data: { type: "post", postId }, opts: { jobId: `post:${postId}` } });
    // Un second balayage ne réclame rien de plus (idempotent).
    expect(await processScheduler(fakeJob({ type: "tick" as const }))).toMatchObject({ claimed: 0 });
  });

  it("envoie le message avec les boutons traqués et le marque SENT", async () => {
    await processTelegramSend(fakeJob({ type: "post" as const, postId }));

    const sent = calls.find((c) => c.method === "sendMessage");
    expect(sent).toBeDefined();
    expect(sent?.payload.chat_id).toBe(Number(CHAT_ID));
    expect(sent?.payload.text).toBe("Bonus du <b>jour</b> 🎁");
    expect(sent?.payload.parse_mode).toBe("HTML");
    expect(sent?.payload.link_preview_options).toEqual({ is_disabled: true });
    const keyboard = (sent?.payload.reply_markup as InlineKeyboardMarkup).inline_keyboard;
    expect(keyboard).toEqual([
      [{ text: "Site", url: "https://example.org" }],
      [
        { text: "Bonus", url: "https://go.goolink.eu/btn123" },
        { text: "Mon offre", url: `https://t.me/bot_test?start=oofftest1_${POST_CODE}` },
      ],
    ]);

    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.status).toBe("SENT");
    expect(post.sentAt).toBeInstanceOf(Date);
    expect(post.telegramMessageIds).toEqual([1000]);
    expect(post.lastError).toBeNull();
    expect(await prisma.postStats.findUnique({ where: { postId } })).not.toBeNull();
    const events = await prisma.event.findMany({ where: { channelId, type: "post.sent" } });
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { messageIds: number[] }).messageIds).toEqual([1000]);

    // Suppression programmée après 30 minutes : tâche différée dans telegram-send.
    const del = capturedJobs("telegram-send").find((j) => j.data.type === "delete-post");
    expect(del?.data.postId).toBe(postId);
    expect(del?.opts.delay).toBe(30 * 60_000);
  });

  it("supprime les messages Telegram du post (delete-post)", async () => {
    await processTelegramSend(fakeJob({ type: "delete-post" as const, postId }));
    expect(calls.find((c) => c.method === "deleteMessage")?.payload).toEqual({ chat_id: Number(CHAT_ID), message_id: 1000 });
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.status).toBe("DELETED");
  });

  it("ignore un message qui n'est plus en cours d'envoi", async () => {
    const before = calls.length;
    await processTelegramSend(fakeJob({ type: "post" as const, postId }));
    expect(calls.length).toBe(before);
  });
});
