import { describe, expect, it } from "vitest";
import { LANGS, MESSAGES, pickLang, t } from "./i18n";
import { formatDelay } from "./join-flow/rules";
import { DEFAULT_TEXTS, baseLang, defaultText } from "./join-flow/texts";
import { DEFAULT_OFFER_REPLY, INVALID_OFFER_REPLY } from "./offers/logic";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n du bot", () => {
  it("couvre les six langues", () => {
    expect(LANGS).toEqual(["fr", "en", "es", "pt", "de", "it"]);
  });

  it("chaque langue a toutes les clés du français, avec les mêmes variables", () => {
    const fr = MESSAGES.fr as Record<string, unknown>;
    for (const lang of LANGS) {
      const dict = MESSAGES[lang] as Record<string, unknown>;
      for (const [key, value] of Object.entries(fr)) {
        expect(dict[key], `${lang}.${key} manquant`).toBeDefined();
        if (typeof value === "string") {
          expect(typeof dict[key]).toBe("string");
          expect((dict[key] as string).trim().length, `${lang}.${key} vide`).toBeGreaterThan(0);
          expect(
            placeholders(dict[key] as string),
            `${lang}.${key} : variables différentes`,
          ).toEqual(placeholders(value));
        } else {
          expect(Object.keys(dict[key] as object).sort()).toEqual(
            Object.keys(value as object).sort(),
          );
        }
      }
      expect(Object.keys(dict).sort()).toEqual(Object.keys(fr).sort());
    }
  });

  it("pickLang reconnaît es, pt, pt-br, de, it et retombe sur fr", () => {
    expect(pickLang("es")).toBe("es");
    expect(pickLang("pt")).toBe("pt");
    expect(pickLang("pt-br")).toBe("pt");
    expect(pickLang("pt_BR")).toBe("pt");
    expect(pickLang("de-AT")).toBe("de");
    expect(pickLang("it")).toBe("it");
    expect(pickLang("en-US")).toBe("en");
    expect(pickLang("zh")).toBe("fr");
    expect(pickLang(undefined)).toBe("fr");
    expect(baseLang("pt-BR")).toBe("pt");
  });

  it("t() remplit les variables et traduit l'univers", () => {
    expect(t("es", "welcome", { botName: "Bot", vertical: "SPORTS" })).toBe(
      "Hola, soy Bot, el bot de apuestas deportivas.",
    );
    expect(t("de", "adminLinked", { name: "Max" })).toContain("Max");
    expect(t("it", "offerInvalid")).toBe("Questo link non è più valido.");
  });

  it("textes par défaut du flux d'adhésion et des offres dans chaque langue", () => {
    for (const lang of LANGS) {
      expect(DEFAULT_TEXTS.approved[lang]).toContain("{canal}");
      expect(defaultText("joinedLabel", lang).startsWith("✅")).toBe(true);
      expect(DEFAULT_OFFER_REPLY[lang].text).toContain("{prenom}");
      expect(DEFAULT_OFFER_REPLY[lang].button.length).toBeGreaterThan(0);
      expect(INVALID_OFFER_REPLY[lang].length).toBeGreaterThan(0);
    }
  });

  it("formatDelay parle chaque langue", () => {
    expect(formatDelay(0, "es")).toBe("inmediatamente");
    expect(formatDelay(600, "fr")).toBe("dans 10 minutes");
    expect(formatDelay(3600, "en")).toBe("in 1 hour");
    expect(formatDelay(7200, "de")).toBe("in 2 Stunden");
    expect(formatDelay(86400, "it")).toBe("tra 1 giorno");
    expect(formatDelay(172800, "pt")).toBe("em 2 dias");
  });
});
