import { describe, expect, it } from "vitest";
import { buildDmKeyboard, buildInlineKeyboard, buttonUrl, parseButtons } from "./keyboard";

const ctx = { trackingBaseUrl: "https://go.goolink.eu/", botUsername: "casinobot", postCode: "P0stC0de" };

describe("clavier inline des messages", () => {
  it("construit les URL selon le type", () => {
    expect(buttonUrl({ text: "Site", type: "URL", url: "https://ex.com" }, ctx)).toBe("https://ex.com");
    expect(buttonUrl({ text: "Lien", type: "BUTTON", slug: "abc12345" }, ctx)).toBe("https://go.goolink.eu/abc12345");
    expect(buttonUrl({ text: "Offre", type: "OFFER", slug: "off12345" }, ctx)).toBe("https://t.me/casinobot?start=ooff12345_P0stC0de");
  });
  it("bouton Offre sans message conteneur (message à un groupe) : lien du bot sans code, que le bot accepte", () => {
    // `o<slug>_` (code vide) serait refusé par le bot (« offre invalide ») ; `o<slug>` est accepté.
    expect(buttonUrl({ text: "Offre", type: "OFFER", slug: "off12345" }, { ...ctx, postCode: "" })).toBe("https://t.me/casinobot?start=ooff12345");
  });
  it("ignore les boutons invalides et les lignes vides", () => {
    const kb = buildInlineKeyboard([[{ text: "ok", type: "URL", url: "https://a" }, { text: "ko", type: "URL", url: "javascript:x" }], [{ text: "vide", type: "BUTTON" }]], ctx);
    expect(kb).toEqual({ inline_keyboard: [[{ text: "ok", url: "https://a" }]] });
    expect(buildInlineKeyboard([], ctx)).toBeUndefined();
  });
  it("tronque les libellés à 64 caractères", () => {
    const kb = buildInlineKeyboard([[{ text: "x".repeat(80), type: "URL", url: "https://a" }]], ctx);
    expect(kb?.inline_keyboard[0]?.[0]?.text).toHaveLength(64);
  });
  it("parse un JSON de boutons tolérant", () => {
    expect(parseButtons(null)).toEqual([]);
    expect(parseButtons([[{ text: "a", type: "URL", url: "https://a" }, null], "x", []])).toEqual([[{ text: "a", type: "URL", url: "https://a" }]]);
  });
  it("construit un clavier de message privé", () => {
    expect(buildDmKeyboard([[{ text: "Rejoindre", url: "https://t.me/+abc" }], [{ text: "Fait", url: "tg://resolve?domain=x" }]])).toEqual({
      inline_keyboard: [[{ text: "Rejoindre", url: "https://t.me/+abc" }], [{ text: "Fait", url: "tg://resolve?domain=x" }]],
    });
    expect(buildDmKeyboard([])).toBeUndefined();
  });
});
