/**
 * Emojis animés (phase 12, base réelle, Telegram simulé, aucun appel réseau) :
 * - aperçus de la bibliothèque par le Bot API (file `custom-emoji`, `fetch-previews` et `tick`) ;
 * - message privé avec emojis animés envoyé tel quel (message « accepté » du worker compris) ;
 * - refus de Telegram → renvoi immédiat avec les emojis de remplacement, événement, une seule alerte notifiée.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@linkaffipro/db";
import type * as TelegramModule from "@linkaffipro/telegram";
import type { Api } from "grammy";
import {
  approveMembership,
  apiForBot as approvalsApiForBot,
} from "../../src/approvals/telegram-actions";
import { runAlerts } from "../../src/maintenance/alerts";
import { processCustomEmoji } from "../../src/processors/custom-emoji";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import { capturedJobs, createBotAndChannel, fakeJob, resetDb, TEST_BOT_TOKEN } from "./helpers";

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
type TgError = { error_code: number; description: string };

/** Telegram simulé pour une instance `Api` : aperçus d'emojis et envois privés (refus des emojis animés au choix). */
function installEmojiTelegram(
  api: Api,
  world: {
    stickers: Map<string, Record<string, unknown>>;
    files: Map<string, { file_path: string; file_size?: number }>;
    sets: Map<string, { name: string; title: string }>;
    /** Réponse à un envoi qui contient une balise d'emoji animé : refus, ou entités renvoyées par Telegram. */
    onEmoji: () => TgError | "keep" | "drop";
  },
): Call[] {
  const calls: Call[] = [];
  let nextId = 7000;
  api.config.use(async (_prev, method, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: p });
    const ok = (result: unknown) => ({ ok: true, result }) as never;
    if (method === "getCustomEmojiStickers")
      return ok(
        ((p.custom_emoji_ids as string[]) ?? []).flatMap((id) => {
          const s = world.stickers.get(id);
          return s ? [s] : [];
        }),
      );
    if (method === "getFile") {
      const f = world.files.get(String(p.file_id));
      if (!f)
        return { ok: false, error_code: 400, description: "Bad Request: invalid file_id" } as never;
      return ok({ file_id: p.file_id, file_unique_id: `u-${String(p.file_id)}`, ...f });
    }
    if (method === "getStickerSet") {
      const set = world.sets.get(String(p.name));
      if (!set)
        return {
          ok: false,
          error_code: 400,
          description: "Bad Request: STICKERSET_INVALID",
        } as never;
      return ok({ ...set, sticker_type: "custom_emoji", stickers: [] });
    }
    if (/^send(Message|Photo)$/.test(method)) {
      const content = String(p.text ?? p.caption ?? "");
      const tags = (content.match(/<tg-emoji/g) ?? []).length;
      let entities: Array<{ type: string; offset: number; length: number }> = [];
      if (tags > 0) {
        const r = world.onEmoji();
        if (typeof r === "object") return { ok: false, ...r } as never;
        if (r === "keep")
          entities = Array.from({ length: tags }, () => ({
            type: "custom_emoji",
            offset: 0,
            length: 2,
          }));
      }
      return ok({
        message_id: nextId++,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(p.chat_id), type: "private" },
        text: content.replace(/<[^>]+>/g, ""),
        entities,
      });
    }
    return ok(true);
  });
  return calls;
}

const REFUSAL: TgError = {
  error_code: 400,
  description:
    'Bad Request: can\'t parse entities: Unsupported start tag "tg-emoji" at byte offset 9',
};

describe("emojis animés : aperçus, messages privés, repli et alerte (base réelle)", () => {
  let botId = "";
  let channelId = "";
  let memberId = "";
  let calls: Call[] = [];
  const world = {
    stickers: new Map<string, Record<string, unknown>>(),
    files: new Map<string, { file_path: string; file_size?: number }>(),
    sets: new Map<string, { name: string; title: string }>(),
    onEmoji: (): TgError | "keep" | "drop" => "keep",
  };
  const downloads: string[] = [];

  beforeAll(async () => {
    await resetDb();
    await prisma.customEmoji.deleteMany();
    await prisma.alert.deleteMany({ where: { kind: "custom_emoji_refused" } });
    const created = await createBotAndChannel();
    botId = created.bot.id;
    channelId = created.channel.id;
    const member = await prisma.member.create({
      data: { telegramUserId: 9_120_001n, firstName: "Léa", languageCode: "fr" },
    });
    memberId = member.id;
    await prisma.memberBotState.create({ data: { memberId, botId, canDm: true } });
    calls = installEmojiTelegram((await apiForBot(botId)).api, world);
    installEmojiTelegram(approvalsApiForBot(created.bot), world);
    // Téléchargement des fichiers Telegram simulé : l'adresse contient le jeton du bot (jamais journalisée).
    vi.stubGlobal("fetch", async (url: string) => {
      const prefix = `https://api.telegram.org/file/bot${TEST_BOT_TOKEN}/`;
      if (!String(url).startsWith(prefix)) return new Response("not found", { status: 404 });
      const path = String(url).slice(prefix.length);
      downloads.push(path);
      if (path.startsWith("big/")) return new Response(new Uint8Array(600 * 1024));
      if (path.startsWith("neterr/")) throw new TypeError(`fetch failed: ${String(url)}`);
      return new Response(new TextEncoder().encode(`contenu:${path}`));
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.customEmoji.deleteMany();
  });

  beforeEach(() => {
    world.onEmoji = () => "keep";
  });

  describe("aperçus de la bibliothèque (Bot API simulé)", () => {
    beforeAll(async () => {
      world.stickers.set("101", {
        file_id: "F101",
        file_unique_id: "U101",
        type: "custom_emoji",
        width: 100,
        height: 100,
        is_animated: true,
        is_video: false,
        emoji: "🔥",
        set_name: "PackFeu",
        custom_emoji_id: "101",
        file_size: 4000,
      });
      world.stickers.set("102", {
        file_id: "F102",
        file_unique_id: "U102",
        type: "custom_emoji",
        width: 100,
        height: 100,
        is_animated: false,
        is_video: true,
        emoji: "🎁",
        set_name: "PackFeu",
        custom_emoji_id: "102",
      });
      world.stickers.set("104", {
        file_id: "F104",
        file_unique_id: "U104",
        type: "custom_emoji",
        width: 100,
        height: 100,
        is_animated: false,
        is_video: false,
        emoji: "⭐",
        set_name: "PackEtoiles",
        custom_emoji_id: "104",
        file_size: 700 * 1024,
        thumbnail: {
          file_id: "T104",
          file_unique_id: "UT104",
          width: 100,
          height: 100,
          file_size: 3000,
        },
      });
      world.files.set("F101", { file_path: "stickers/f101.tgs", file_size: 4000 });
      world.files.set("F102", { file_path: "videos/f102.webm" });
      world.files.set("T104", { file_path: "thumbnails/t104.jpg", file_size: 3000 });
      world.sets.set("PackFeu", { name: "PackFeu", title: "Pack de feu" });

      await prisma.customEmoji.createMany({
        data: [
          { customEmojiId: "101", fallback: "🔥", source: "FORWARD" },
          // Emoji de remplacement inconnu (vide) : complété par Telegram.
          { customEmojiId: "102", fallback: "", source: "FORWARD" },
          // Inconnu de Telegram (retiré par son auteur).
          { customEmojiId: "103", fallback: "😀", source: "FORWARD" },
          {
            customEmojiId: "104",
            fallback: "⭐",
            source: "PACK",
            setName: "PackEtoiles",
            setTitle: "Étoiles",
          },
          // Aperçu déjà là : jamais retéléchargé.
          {
            customEmojiId: "105",
            fallback: "🎯",
            source: "PACK",
            previewBytes: new TextEncoder().encode("déjà"),
            previewMime: "image/webp",
            previewAt: new Date(),
          },
        ],
      });
    });

    it("fetch-previews : aperçus téléchargés et stockés, pack, format et emoji de remplacement complétés", async () => {
      const r = await processCustomEmoji(
        fakeJob({
          type: "fetch-previews" as const,
          customEmojiIds: ["101", "102", "103", "104", "105"],
        }),
      );
      expect(r).toMatchObject({ requested: 4, fetched: 3, failed: 1, setTitles: 1 });
      const byId = new Map((await prisma.customEmoji.findMany()).map((e) => [e.customEmojiId, e]));
      const a = byId.get("101")!;
      expect(a).toMatchObject({
        format: "tgs",
        previewMime: "application/x-tgsticker",
        setName: "PackFeu",
        setTitle: "Pack de feu",
        previewError: null,
      });
      expect(Buffer.from(a.previewBytes!).toString()).toBe("contenu:stickers/f101.tgs");
      expect(a.previewAt).toBeInstanceOf(Date);
      expect(byId.get("102")).toMatchObject({
        format: "webm",
        previewMime: "video/webm",
        fallback: "🎁",
        setTitle: "Pack de feu",
      });
      expect(byId.get("103")?.previewBytes).toBeNull();
      expect(byId.get("103")?.previewError).toMatch(/introuvable chez Telegram/);
      // Fichier trop lourd : vignette fixe à la place.
      expect(byId.get("104")).toMatchObject({
        format: "webp",
        previewMime: "image/jpeg",
        setTitle: "Étoiles",
      });
      expect(Buffer.from(byId.get("105")!.previewBytes!).toString()).toBe("déjà");
      expect(downloads.some((d) => d.includes("105"))).toBe(false);
      const stickerCalls = calls.filter((c) => c.method === "getCustomEmojiStickers");
      expect(stickerCalls).toHaveLength(1);
      expect(stickerCalls[0]!.payload.custom_emoji_ids).toEqual(["101", "102", "103", "104"]);
      // Le jeton n'est jamais enregistré.
      for (const e of byId.values())
        expect(String(e.previewError ?? "")).not.toContain("TEST-TOKEN");
    });

    it("tick : un échec n'est réessayé qu'au bout d'une heure ; un emoji retiré de la bibliothèque est laissé", async () => {
      const before = calls.length;
      expect(await processCustomEmoji(fakeJob({ type: "tick" as const }))).toMatchObject({
        previews: { requested: 0, skipped: "nothing" },
      });
      expect(calls.length).toBe(before);
      await prisma.customEmoji.update({
        where: { customEmojiId: "103" },
        data: { previewAt: new Date(Date.now() - 2 * 3600_000) },
      });
      await prisma.customEmoji.create({
        data: { customEmojiId: "106", fallback: "🙈", source: "FORWARD", hiddenAt: new Date() },
      });
      const r = (await processCustomEmoji(fakeJob({ type: "tick" as const }))) as {
        previews: { requested: number };
      };
      expect(r.previews.requested).toBe(1);
      expect(calls.at(-1)?.payload.custom_emoji_ids).toEqual(["103"]);
    });

    it("fichier plus lourd que 512 Ko au téléchargement : refusé, erreur mémorisée", async () => {
      world.stickers.set("108", {
        file_id: "F108",
        file_unique_id: "U108",
        type: "custom_emoji",
        width: 100,
        height: 100,
        is_animated: false,
        is_video: false,
        emoji: "🐘",
        custom_emoji_id: "108",
      });
      world.files.set("F108", { file_path: "big/f108.webp" });
      await prisma.customEmoji.create({
        data: { customEmojiId: "108", fallback: "🐘", source: "FORWARD" },
      });
      await processCustomEmoji(
        fakeJob({ type: "fetch-previews" as const, customEmojiIds: ["108"] }),
      );
      const e = await prisma.customEmoji.findUniqueOrThrow({ where: { customEmojiId: "108" } });
      expect(e).toMatchObject({
        previewBytes: null,
        format: "webp",
        previewError: "Aperçu trop lourd (plus de 512 Ko).",
      });
    });

    it("téléchargement impossible : erreur mémorisée sans jamais citer l'adresse (qui contient le jeton)", async () => {
      world.stickers.set("109", {
        file_id: "F109",
        file_unique_id: "U109",
        type: "custom_emoji",
        width: 100,
        height: 100,
        is_animated: true,
        is_video: false,
        emoji: "🌧️",
        custom_emoji_id: "109",
      });
      world.files.set("F109", { file_path: "neterr/f109.tgs" });
      await prisma.customEmoji.create({
        data: { customEmojiId: "109", fallback: "🌧️", source: "FORWARD" },
      });
      await processCustomEmoji(
        fakeJob({ type: "fetch-previews" as const, customEmojiIds: ["109"] }),
      );
      const e = await prisma.customEmoji.findUniqueOrThrow({ where: { customEmojiId: "109" } });
      expect(e.previewBytes).toBeNull();
      expect(e.previewError).toBe("Téléchargement impossible (réseau ou délai dépassé).");
      expect(e.previewError).not.toContain("TEST-TOKEN");
    });

    it("par lots de 200 identifiants", async () => {
      const ids = Array.from({ length: 201 }, (_, i) => String(20_000 + i));
      await prisma.customEmoji.createMany({
        data: ids.map((customEmojiId) => ({
          customEmojiId,
          fallback: "😀",
          source: "PACK" as const,
        })),
      });
      const before = calls.filter((c) => c.method === "getCustomEmojiStickers").length;
      (globalThis.__jobs ??= []).length = 0;
      const r = await processCustomEmoji(
        fakeJob({ type: "fetch-previews" as const, customEmojiIds: ids }),
      );
      // Une tâche ne traite qu'un lot : le reste part dans une tâche à part, moins prioritaire, pour qu'une
      // vérification du compte (bouton « Vérifier ») ou un import demandé par l'équipe passe entre deux lots.
      expect(r).toMatchObject({ requested: 200, queued: 1 });
      const next = capturedJobs("custom-emoji").filter((j) => j.data.type === "fetch-previews");
      expect(next).toHaveLength(1);
      expect(next[0]!.data.customEmojiIds).toEqual([ids[200]]);
      expect(Number(next[0]!.opts.priority)).toBeGreaterThan(0);
      await processCustomEmoji(fakeJob(next[0]!.data as { type: "fetch-previews" }));
      const batches = calls
        .filter((c) => c.method === "getCustomEmojiStickers")
        .slice(before)
        .map((c) => (c.payload.custom_emoji_ids as string[]).length);
      expect(batches).toEqual([200, 1]);
    });

    it("aucun bot actif : rien n'est touché", async () => {
      await prisma.bot.update({ where: { id: botId }, data: { isActive: false } });
      try {
        await prisma.customEmoji.create({
          data: { customEmojiId: "107", fallback: "🍀", source: "FORWARD" },
        });
        expect(
          await processCustomEmoji(
            fakeJob({ type: "fetch-previews" as const, customEmojiIds: ["107"] }),
          ),
        ).toMatchObject({ skipped: "no_bot" });
        expect(
          (await prisma.customEmoji.findUniqueOrThrow({ where: { customEmojiId: "107" } }))
            .previewAt,
        ).toBeNull();
      } finally {
        await prisma.bot.update({ where: { id: botId }, data: { isActive: true } });
      }
    });
  });

  describe("messages privés avec emojis animés", () => {
    const TEXT = 'Bienvenue <tg-emoji emoji-id="5368324170671202286">🎉</tg-emoji> <b>Léa</b>';

    async function queueDm(text = TEXT) {
      const om = await prisma.outboundMessage.create({
        data: {
          botId,
          memberId,
          kind: "TEST",
          text,
          buttons: [[{ text: "Voir", url: "https://example.org" }]],
        },
      });
      await processTelegramSend(fakeJob({ type: "dm" as const, outboundMessageId: om.id }));
      return prisma.outboundMessage.findUniqueOrThrow({ where: { id: om.id } });
    }
    const fallbackEvents = () =>
      prisma.event.findMany({
        where: { type: "dm.custom_emoji_fallback" },
        orderBy: { occurredAt: "asc" },
      });

    it("acceptés par Telegram : envoyés tels quels, aucun repli", async () => {
      const before = calls.length;
      const om = await queueDm();
      const sends = calls.slice(before).filter((c) => c.method === "sendMessage");
      expect(sends).toHaveLength(1);
      expect(sends[0]!.payload).toMatchObject({
        chat_id: 9_120_001,
        text: TEXT,
        parse_mode: "HTML",
      });
      expect(om).toMatchObject({ status: "SENT", error: null });
      expect(await fallbackEvents()).toHaveLength(0);
    });

    it("message « accepté » du worker : le texte de l'équipe garde ses emojis animés jusqu'à Telegram", async () => {
      const seq = await prisma.sequence.create({
        data: { name: "Accepté", channelId, trigger: "APPROVED" },
      });
      await prisma.sequenceStep.create({
        data: {
          sequenceId: seq.id,
          texts: {
            fr: 'C\'est fait {prenom} <tg-emoji emoji-id="5361111111111111111">✅</tg-emoji>',
          },
        },
      });
      // Demande de moins de 5 minutes avec `user_chat_id` : le bot peut encore écrire « Accepté » (phase 14).
      const m = await prisma.membership.create({
        data: {
          code: "EMOJI001",
          memberId,
          channelId,
          status: "SCHEDULED",
          approveAt: new Date(),
          userChatId: 9_120_001n,
        },
      });
      expect(await approveMembership(m.id)).toBe("approved");
      const accepted = await prisma.outboundMessage.findFirstOrThrow({
        where: { memberId, kind: "ACCEPTED" },
      });
      expect(accepted.text).toBe(
        'C\'est fait Léa <tg-emoji emoji-id="5361111111111111111">✅</tg-emoji>',
      );
      const job = capturedJobs("telegram-send").find(
        (j) => j.data.outboundMessageId === accepted.id,
      )!;
      const before = calls.length;
      await processTelegramSend(fakeJob(job.data as { type: "dm"; outboundMessageId: string }));
      const sent = calls.slice(before).find((c) => c.method === "sendMessage");
      expect(sent?.payload.text).toBe(accepted.text);
    });

    it("refusés par Telegram : renvoi immédiat avec les emojis de remplacement, journalisé, une seule alerte notifiée", async () => {
      world.onEmoji = () => REFUSAL;
      const before = calls.length;
      const om = await queueDm();
      const sends = calls.slice(before).filter((c) => c.method === "sendMessage");
      expect(sends.map((c) => c.payload.text)).toEqual([TEXT, "Bienvenue 🎉 <b>Léa</b>"]);
      expect(sends[1]!.payload.reply_markup).toEqual(sends[0]!.payload.reply_markup);
      expect(om).toMatchObject({
        status: "SENT",
        telegramMessageId: expect.any(Number),
        error: "Envoyé avec les emojis normaux : Telegram a refusé les emojis animés.",
      });
      const events = await fallbackEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ memberId, botId });
      expect(events[0]!.payload).toMatchObject({
        outboundMessageId: om.id,
        botId,
        error: REFUSAL.description,
        resent: true,
      });

      // Passage d'alertes : une alerte, une notification.
      notified.texts.length = 0;
      await runAlerts(new Date());
      const alerts = await prisma.alert.findMany({ where: { kind: "custom_emoji_refused" } });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ severity: "WARNING", resolvedAt: null });
      expect(alerts[0]!.message).toContain(
        "1 message privé de la dernière heure est parti avec les emojis normaux",
      );
      expect(alerts[0]!.message).toContain("@bot_test");
      const emojiNotes = () => notified.texts.filter((t) => t.includes("emojis normaux"));
      expect(emojiNotes()).toHaveLength(1);

      // Nouveau refus, nouveau passage : toujours une seule alerte et une seule notification.
      await queueDm();
      await runAlerts(new Date(Date.now() + 5 * 60_000));
      expect(await prisma.alert.count({ where: { kind: "custom_emoji_refused" } })).toBe(1);
      expect(emojiNotes()).toHaveLength(1);
      expect(await fallbackEvents()).toHaveLength(2);
    });
  });
});
