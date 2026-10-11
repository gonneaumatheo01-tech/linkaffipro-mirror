import { describe, expect, it, vi } from "vitest";
import { GrammyError } from "grammy";
import {
  CUSTOM_EMOJIS_DROPPED_ERROR,
  customEmojiTagCount,
  customEmojisDropped,
  isCustomEmojiRefusal,
  sendWithEmojiFallback,
} from "./fallback";

const tgError = (code: number, description: string) =>
  new GrammyError("call failed", { ok: false, error_code: code, description }, "sendMessage", {});

const HTML = 'Bonus <tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji> du <b>jour</b>';
const PLAIN = "Bonus 🔥 du <b>jour</b>";

describe("refus des emojis animés par Telegram", () => {
  it("reconnaît un 400 de mise en forme ou d'entité quand le texte contient un emoji animé", () => {
    for (const d of [
      'Bad Request: can\'t parse entities: Unsupported start tag "tg-emoji" at byte offset 6',
      "Bad Request: ENTITY_TEXT_INVALID",
      "Bad Request: DOCUMENT_INVALID",
      "Bad Request: custom emoji entities can be used only by bots with a Premium owner",
      "Bad Request: PREMIUM_ACCOUNT_REQUIRED",
    ])
      expect(isCustomEmojiRefusal(tgError(400, d), HTML), d).toBe(true);
    expect(isCustomEmojiRefusal(tgError(403, "Forbidden: PREMIUM_ACCOUNT_REQUIRED"), HTML)).toBe(
      true,
    );
    // Forme équivalente (erreur transportée sans la classe grammY).
    expect(
      isCustomEmojiRefusal(
        { error_code: 400, description: "Bad Request: can't parse entities" },
        HTML,
      ),
    ).toBe(true);
  });

  it("ne confond jamais avec un blocage, une limite de débit ou une autre erreur", () => {
    expect(isCustomEmojiRefusal(tgError(403, "Forbidden: bot was blocked by the user"), HTML)).toBe(
      false,
    );
    expect(isCustomEmojiRefusal(tgError(429, "Too Many Requests: retry after 5"), HTML)).toBe(
      false,
    );
    expect(isCustomEmojiRefusal(tgError(400, "Bad Request: chat not found"), HTML)).toBe(false);
    expect(isCustomEmojiRefusal(tgError(400, "Bad Request: message is too long"), HTML)).toBe(
      false,
    );
    expect(isCustomEmojiRefusal(new Error("réseau"), HTML)).toBe(false);
  });

  it("sans emoji animé dans le texte, aucune erreur n'est un refus d'emoji", () => {
    expect(isCustomEmojiRefusal(tgError(400, "Bad Request: can't parse entities"), PLAIN)).toBe(
      false,
    );
    expect(isCustomEmojiRefusal(tgError(400, "Bad Request: can't parse entities"), null)).toBe(
      false,
    );
  });
});

describe("emojis animés retirés sans refus", () => {
  it("compte les balises (doublons compris)", () => {
    expect(customEmojiTagCount(HTML + HTML)).toBe(2);
    expect(customEmojiTagCount(PLAIN)).toBe(0);
    expect(customEmojiTagCount(undefined)).toBe(0);
  });

  it("compare aux entités du message renvoyé par Telegram (texte ou légende)", () => {
    const kept = {
      message_id: 1,
      text: "Bonus 🔥 du jour",
      entities: [{ type: "custom_emoji" }, { type: "bold" }],
    };
    const dropped = { message_id: 1, text: "Bonus 🔥 du jour", entities: [{ type: "bold" }] };
    expect(customEmojisDropped(HTML, kept)).toBe(false);
    expect(customEmojisDropped(HTML, dropped)).toBe(true);
    expect(
      customEmojisDropped(HTML, {
        message_id: 2,
        caption: "x",
        caption_entities: [{ type: "custom_emoji" }],
      }),
    ).toBe(false);
    expect(customEmojisDropped(HTML, { message_id: 2, caption: "x" })).toBe(true);
    // Rien à comparer : réponse qui n'est pas un message, ou texte sans emoji animé.
    expect(customEmojisDropped(HTML, true)).toBe(false);
    expect(customEmojisDropped(HTML, { message_id: 3 })).toBe(false);
    expect(customEmojisDropped(PLAIN, dropped)).toBe(false);
  });
});

describe("envoi avec repli", () => {
  it("renvoie aussitôt avec les emojis de remplacement quand Telegram refuse, puis signale", async () => {
    const send = vi
      .fn<(t: string) => Promise<{ message_id: number }>>()
      .mockRejectedValueOnce(
        tgError(400, "Bad Request: can't parse entities: Unsupported start tag"),
      )
      .mockResolvedValueOnce({ message_id: 7 });
    const onFallback = vi.fn();
    const r = await sendWithEmojiFallback(HTML, send, onFallback);
    expect(r).toEqual({ message_id: 7 });
    expect(send.mock.calls.map((c) => c[0])).toEqual([HTML, PLAIN]);
    expect(onFallback).toHaveBeenCalledWith({
      error: "Bad Request: can't parse entities: Unsupported start tag",
      resent: true,
    });
  });

  it("laisse remonter une autre erreur sans renvoi ni signalement", async () => {
    const send = vi.fn(async () => {
      throw tgError(403, "Forbidden: bot was blocked by the user");
    });
    const onFallback = vi.fn();
    await expect(sendWithEmojiFallback(HTML, send, onFallback)).rejects.toBeInstanceOf(GrammyError);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("un renvoi qui échoue remonte son erreur, sans signalement (le souci n'était pas les emojis)", async () => {
    const send = vi.fn(async () => {
      throw tgError(
        400,
        "Bad Request: can't parse entities: Can't find end tag corresponding to start tag \"b\"",
      );
    });
    const onFallback = vi.fn();
    await expect(sendWithEmojiFallback(HTML, send, onFallback)).rejects.toBeInstanceOf(GrammyError);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("emojis retirés par Telegram : signalement sans renvoi (pas de doublon)", async () => {
    const send = vi.fn(async () => ({ message_id: 9, text: "Bonus 🔥 du jour", entities: [] }));
    const onFallback = vi.fn();
    await sendWithEmojiFallback(HTML, send, onFallback);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith({ error: CUSTOM_EMOJIS_DROPPED_ERROR, resent: false });
  });

  it("texte sans emoji animé : envoi normal ; une erreur du signalement ne bloque jamais", async () => {
    const send = vi.fn(async () => ({ message_id: 1, text: "x" }));
    await sendWithEmojiFallback(PLAIN, send, () => {
      throw new Error("base indisponible");
    });
    expect(send).toHaveBeenCalledTimes(1);
    const refuse = vi
      .fn<(t: string) => Promise<number>>()
      .mockRejectedValueOnce(tgError(400, "Bad Request: DOCUMENT_INVALID"))
      .mockResolvedValueOnce(2);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      sendWithEmojiFallback(HTML, refuse, async () => {
        throw new Error("base indisponible");
      }),
    ).resolves.toBe(2);
    warn.mockRestore();
  });
});
