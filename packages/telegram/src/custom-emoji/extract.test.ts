import { describe, expect, it } from "vitest";
import type { MessageEntity } from "grammy/types";
import {
  CUSTOM_EMOJI_ADD_FAILED_REPLY,
  MAX_CUSTOM_EMOJIS_PER_MESSAGE,
  customEmojiAddedReply,
  customEmojisOfMessage,
  messageHasCustomEmoji,
} from "./extract";

const ce = (offset: number, length: number, id: string): MessageEntity =>
  ({ type: "custom_emoji", offset, length, custom_emoji_id: id }) as MessageEntity;

describe("emojis animés d'un message", () => {
  it("lit l'emoji de remplacement aux positions UTF-16 (emojis sur deux unités, texte accentué avant)", () => {
    // « Été 🔥 » : É t é espace = 4 unités, 🔥 = 2 unités (offset 4) ; « 👍🏽 » = 4 unités (avec teinte).
    const text = "Été 🔥 et 👍🏽 !";
    const fire = text.indexOf("🔥");
    const thumb = text.indexOf("👍🏽");
    expect(fire).toBe(4);
    const r = customEmojisOfMessage({
      text,
      entities: [ce(fire, 2, "5368324170671202286"), ce(thumb, 4, "5361111111111111111")],
    });
    expect(r).toEqual([
      { customEmojiId: "5368324170671202286", fallback: "🔥" },
      { customEmojiId: "5361111111111111111", fallback: "👍🏽" },
    ]);
  });

  it("lit aussi la légende d'un média, sans doublon, et ignore les autres entités", () => {
    const caption = "😀 bonus 😀 ⭐";
    const r = customEmojisOfMessage({
      caption,
      caption_entities: [
        { type: "bold", offset: 3, length: 5 },
        ce(0, 2, "111"),
        ce(9, 2, "111"),
        ce(12, 1, "222"),
      ],
    });
    expect(r).toEqual([
      { customEmojiId: "111", fallback: "😀" },
      { customEmojiId: "222", fallback: "⭐" },
    ]);
  });

  it("ignore un identifiant invalide et garde le premier emoji de remplacement non vide", () => {
    const text = "x 😎";
    const r = customEmojisOfMessage({
      text,
      entities: [ce(0, 0, "333"), ce(2, 2, "333"), ce(2, 2, "0"), ce(2, 2, "abc")],
    });
    expect(r).toEqual([{ customEmojiId: "333", fallback: "😎" }]);
  });

  it("rien sans entité d'emoji animé", () => {
    expect(customEmojisOfMessage({ text: "Bonjour" })).toEqual([]);
    expect(
      messageHasCustomEmoji({
        text: "Bonjour",
        entities: [{ type: "bold", offset: 0, length: 3 }],
      }),
    ).toBe(false);
    expect(messageHasCustomEmoji({ caption: "😀", caption_entities: [ce(0, 2, "1")] })).toBe(true);
  });

  it("s'arrête à la limite par message", () => {
    const n = MAX_CUSTOM_EMOJIS_PER_MESSAGE + 5;
    const text = "😀".repeat(n);
    const entities = Array.from({ length: n }, (_, i) => ce(i * 2, 2, String(1000 + i)));
    expect(customEmojisOfMessage({ text, entities })).toHaveLength(MAX_CUSTOM_EMOJIS_PER_MESSAGE);
  });
});

describe("réponse du bot après l'ajout", () => {
  it("annonce les ajouts et ceux déjà présents", () => {
    expect(
      customEmojiAddedReply({
        added: ["1", "2", "3", "4", "5"],
        restored: ["6"],
        already: ["7", "8"],
      }),
    ).toBe(
      "6 emojis animés ajoutés ✅\n2 déjà dans la bibliothèque\n\nRetrouvez-les sur le site : Messages → Emojis animés.",
    );
    expect(customEmojiAddedReply({ added: ["1"], restored: [], already: [] })).toBe(
      "1 emoji animé ajouté ✅\n\nRetrouvez-le sur le site : Messages → Emojis animés.",
    );
    expect(customEmojiAddedReply({ added: ["1"], restored: [], already: ["2"] })).toContain(
      "1 déjà dans la bibliothèque",
    );
  });

  it("tout est déjà dans la bibliothèque", () => {
    expect(customEmojiAddedReply({ added: [], restored: [], already: ["1"] })).toBe(
      "Cet emoji animé est déjà dans la bibliothèque ✅\n\nRetrouvez-le sur le site : Messages → Emojis animés.",
    );
    expect(customEmojiAddedReply({ added: [], restored: [], already: ["1", "2", "3"] })).toMatch(
      /^Ces 3 emojis animés sont déjà dans la bibliothèque ✅/,
    );
  });

  it("aucune réponse sans emoji ; texte d'échec en français simple", () => {
    expect(customEmojiAddedReply({ added: [], restored: [], already: [] })).toBeNull();
    expect(CUSTOM_EMOJI_ADD_FAILED_REPLY).toMatch(/Renvoyez-moi le message/);
  });
});
