import { describe, expect, it } from "vitest";
import { assistantRole, chatLangOf, FIXED_TEXT_KEYS, FIXED_TEXTS, fixedText } from "./texts";
import { CHAT_LANGS } from "./types";

const varsOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("textes fixes", () => {
  it("6 langues, toutes les clés, mêmes variables partout", () => {
    for (const lang of CHAT_LANGS)
      for (const key of FIXED_TEXT_KEYS) {
        const text = FIXED_TEXTS[lang][key];
        expect(text, `${lang}.${key}`).toBeTruthy();
        expect(varsOf(text), `${lang}.${key}`).toEqual(varsOf(FIXED_TEXTS.fr[key]));
      }
  });

  it("aucun lien dans les textes fixes", () => {
    for (const lang of CHAT_LANGS)
      for (const key of FIXED_TEXT_KEYS)
        expect(FIXED_TEXTS[lang][key]).not.toMatch(/https?:|www\.|t\.me/);
  });

  it("fixedText remplit le prénom et le rôle selon le genre", () => {
    expect(fixedText("fr", "intro", { name: "Léa", gender: "F" })).toBe(
      "Moi c'est Léa, l'assistante du canal 😉 Comment tu vas ?",
    );
    expect(fixedText("fr", "intro", { name: "Hugo", gender: "M" })).toContain(
      "Hugo, l'assistant du canal",
    );
    expect(fixedText("de", "intro", { name: "Lena", gender: "F" })).toContain("die Assistentin");
    expect(fixedText("es", "isAssistant", { name: "Lea", gender: "M" })).toContain("el asistente");
    expect(fixedText("xx", "retryLater")).toBe("attends je reviens 2 sec");
    expect(fixedText("en", "stopDone")).toBe("Got it, I won't write to you again. All the best!");
  });

  it("chatLangOf et assistantRole", () => {
    expect(chatLangOf("pt-br")).toBe("pt");
    expect(chatLangOf("EN_us")).toBe("en");
    expect(chatLangOf("nl")).toBeNull();
    expect(chatLangOf(null)).toBeNull();
    expect(assistantRole("it", "M")).toBe("l'assistente");
    expect(assistantRole("fr", null)).toBe("l'assistante");
  });
});
