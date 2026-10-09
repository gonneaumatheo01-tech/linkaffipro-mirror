import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hashIp, safeEqual } from "./crypto.js";
import { isShortId, shortId } from "./short-id.js";
import { isBotUserAgent } from "./bots.js";
import { extractTrackingParams, isTrackingHost } from "./tracking.js";
import { isRole, isVertical } from "./constants.js";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("chiffrement AES-256-GCM", () => {
  it("chiffre puis déchiffre un jeton", () => {
    const token = "123456789:AAE-exemple-de-jeton";
    const enc = encrypt(token, KEY);
    expect(enc).not.toContain(token);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decrypt(enc, KEY)).toBe(token);
  });
  it("produit un chiffré différent à chaque appel (IV aléatoire)", () => {
    expect(encrypt("a", KEY)).not.toBe(encrypt("a", KEY));
  });
  it("refuse une mauvaise clé", () => {
    const enc = encrypt("secret", KEY);
    expect(() => decrypt(enc, Buffer.alloc(32, 9).toString("base64"))).toThrow();
  });
  it("refuse une clé de mauvaise taille", () => {
    expect(() => encrypt("x", "court")).toThrow(/32 octets/);
  });
  it("hache une IP de façon stable avec un sel", () => {
    expect(hashIp("1.2.3.4", "sel")).toBe(hashIp("1.2.3.4", "sel"));
    expect(hashIp("1.2.3.4", "sel")).not.toBe(hashIp("1.2.3.4", "autre"));
    expect(hashIp("1.2.3.4", "sel")).toHaveLength(64);
  });
  it("compare à temps constant", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("ids courts", () => {
  it("fait 8 caractères base62", () => {
    for (let i = 0; i < 200; i++) {
      const id = shortId();
      expect(id).toMatch(/^[0-9A-Za-z]{8}$/);
      expect(isShortId(id)).toBe(true);
    }
  });
  it("est aléatoire", () => {
    const set = new Set(Array.from({ length: 500 }, () => shortId()));
    expect(set.size).toBe(500);
  });
  it("accepte une longueur personnalisée", () => {
    expect(shortId(12)).toHaveLength(12);
  });
});

describe("détection de robots", () => {
  it.each([
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)",
    "TelegramBot (like TwitterBot)",
    "WhatsApp/2.23.20.0 A",
    "curl/8.4.0",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Slackbot-LinkExpanding 1.0",
    "",
    null,
  ])("reconnaît %s comme robot", (ua) => {
    expect(isBotUserAgent(ua)).toBe(true);
  });
  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ])("laisse passer un navigateur : %s", (ua) => {
    expect(isBotUserAgent(ua)).toBe(false);
  });
});

describe("tracking", () => {
  it("extrait les identifiants de clic et les utm", () => {
    const p = extractTrackingParams(new URLSearchParams("ttclid=abc&utm_source=tiktok&utm_campaign=c1&foo=bar&FBCLID=x"));
    expect(p.clickIds).toEqual({ ttclid: "abc", fbclid: "x" });
    expect(p.utm).toEqual({ utm_source: "tiktok", utm_campaign: "c1" });
  });
  it("reconnaît l'hôte de tracking", () => {
    expect(isTrackingHost("goolink.eu", "goolink.eu")).toBe(true);
    expect(isTrackingHost("www.goolink.eu:443", "goolink.eu")).toBe(true);
    expect(isTrackingHost("GOOLINK.EU", "goolink.eu")).toBe(true);
    expect(isTrackingHost("linkaffipro.com", "goolink.eu")).toBe(false);
    expect(isTrackingHost(null, "goolink.eu")).toBe(false);
    expect(isTrackingHost("goolink.eu", undefined)).toBe(false);
  });
});

describe("constantes", () => {
  it("valide les univers et rôles", () => {
    expect(isVertical("CASINO")).toBe(true);
    expect(isVertical("casino")).toBe(false);
    expect(isRole("MANAGER")).toBe(true);
    expect(isRole("ROOT")).toBe(false);
  });
});
