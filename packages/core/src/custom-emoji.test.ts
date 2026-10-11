import { describe, expect, it } from "vitest";
import {
  accountPublishProblem,
  customEmojiIdsOf,
  customEmojiTag,
  hasCustomEmoji,
  isValidCustomEmojiId,
  parseEmojiPackLink,
  planPostPublisher,
  withFallbackEmojis,
  type MtprotoPublishStatus,
} from "./custom-emoji";
import { textLength } from "./telegram-html";

const A = '<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>';
const B = "<tg-emoji emoji-id='5377498341074542641'>🔥</tg-emoji>";

describe("balises d'emojis animés", () => {
  it("trouve les identifiants sans doublon, dans l'ordre", () => {
    expect(customEmojiIdsOf(`Salut ${A} et ${B} puis ${A}`)).toEqual([
      "5368324170671202286",
      "5377498341074542641",
    ]);
    expect(customEmojiIdsOf("<b>rien</b>")).toEqual([]);
  });

  it("détecte un emoji animé, même après un appel précédent (expression globale remise à zéro)", () => {
    expect(hasCustomEmoji(A)).toBe(true);
    expect(hasCustomEmoji(A)).toBe(true);
    expect(hasCustomEmoji("<b>x</b> 👍")).toBe(false);
    expect(hasCustomEmoji(null)).toBe(false);
  });

  it("remplace chaque emoji animé par son emoji de remplacement, sans toucher au reste", () => {
    expect(withFallbackEmojis(`<b>Go</b> ${A}${B} !`)).toBe("<b>Go</b> 👍🔥 !");
  });

  it("un emoji animé compte comme son emoji de remplacement dans la longueur du texte", () => {
    expect(textLength(`ab${A}`)).toBe(textLength("ab👍"));
  });

  it("fabrique une balise valide, emoji de remplacement échappé, identifiant contrôlé", () => {
    expect(customEmojiTag("5368324170671202286", "👍")).toBe(A);
    expect(customEmojiTag("1", "")).toBe('<tg-emoji emoji-id="1">⭐</tg-emoji>');
    expect(customEmojiTag("1", "<")).toBe('<tg-emoji emoji-id="1">&lt;</tg-emoji>');
    expect(() => customEmojiTag("12a", "👍")).toThrow();
    expect(isValidCustomEmojiId("0")).toBe(false);
    expect(isValidCustomEmojiId("123456789012345678901")).toBe(false);
  });
});

describe("lien d'un pack d'emojis", () => {
  it("accepte les liens addemoji et le nom seul", () => {
    expect(parseEmojiPackLink("https://t.me/addemoji/NeonPack")).toBe("NeonPack");
    expect(parseEmojiPackLink("t.me/addemoji/Neon_Pack/")).toBe("Neon_Pack");
    expect(parseEmojiPackLink("tg://addemoji?set=Neon")).toBe("Neon");
    expect(parseEmojiPackLink("  Neon  ")).toBe("Neon");
  });
  it("refuse un pack d'autocollants ou un texte quelconque", () => {
    expect(parseEmojiPackLink("https://t.me/addstickers/Cats")).toBeNull();
    expect(parseEmojiPackLink("https://example.com/x")).toBeNull();
    expect(parseEmojiPackLink("2 mots")).toBeNull();
  });
});

describe("qui publie un message de canal", () => {
  it("sans emoji animé : le bot, avec ses boutons", () => {
    expect(planPostPublisher({ text: "Salut 👍", hasButtons: true })).toMatchObject({
      publisher: "BOT",
      keepButtons: true,
    });
  });
  it("emojis animés sans bouton : le compte connecté", () => {
    expect(planPostPublisher({ text: A, hasButtons: false })).toMatchObject({
      publisher: "ACCOUNT",
      keepButtons: false,
    });
  });
  it("emojis animés et boutons : choix imposé, puis compte (sans boutons) ou bot (emojis normaux)", () => {
    expect(planPostPublisher({ text: A, hasButtons: true })).toMatchObject({
      publisher: null,
      needsChoice: true,
    });
    expect(planPostPublisher({ text: A, hasButtons: true, choice: "emojis" })).toMatchObject({
      publisher: "ACCOUNT",
      keepButtons: false,
      text: A,
    });
    expect(
      planPostPublisher({ text: `x ${A}`, hasButtons: true, choice: "buttons" }),
    ).toMatchObject({
      publisher: "BOT",
      keepButtons: true,
      text: "x 👍",
    });
  });
});

describe("compte connecté prêt à publier", () => {
  const ok: MtprotoPublishStatus = {
    checkedAt: "2026-10-11T10:00:00Z",
    connected: true,
    premium: true,
    user: { id: "1", firstName: "Fred", username: null },
    error: null,
    channels: {
      c1: { canPost: true, checkedAt: "2026-10-11T10:00:00Z" },
      c2: { canPost: false, checkedAt: "x" },
    },
  };
  it("dit ce qui manque, en français", () => {
    expect(accountPublishProblem(ok, "c1")).toBeNull();
    expect(accountPublishProblem(null, "c1")).toMatch(/Aucun compte Telegram connecté/);
    expect(accountPublishProblem({ ...ok, premium: false }, "c1")).toMatch(/Premium/);
    expect(accountPublishProblem(ok, "c2")).toMatch(/administrateur/);
    expect(accountPublishProblem(ok, "c3")).toMatch(/pas encore vérifiés/);
    expect(accountPublishProblem({ ...ok, error: "Session expirée." }, "c1")).toBe(
      "Session expirée.",
    );
  });
});
