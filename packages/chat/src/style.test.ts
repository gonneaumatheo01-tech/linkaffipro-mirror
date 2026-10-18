import { describe, expect, it } from "vitest";
import { mergeFacts, parseFacts } from "./memory";
import {
  describeStyle,
  mergeStyle,
  parseStyleProfile,
  personaLanguages,
  replyLanguage,
} from "./style";

describe("style", () => {
  it("parseStyleProfile : tolérant", () => {
    expect(parseStyleProfile(null)).toEqual({});
    expect(
      parseStyleProfile({
        length: "short",
        emojis: "lots",
        language: "de",
        interest: 12.6,
        updatedAt: "x",
      }),
    ).toEqual({
      length: "short",
      language: "de",
      interest: 10,
      updatedAt: "x",
    });
  });

  it("mergeStyle : la dernière estimation l'emporte, date mise à jour", () => {
    const now = new Date("2026-10-18T10:00:00Z");
    const merged = mergeStyle(
      { length: "long", interest: 2 },
      {
        length: "short",
        emojis: "many",
        register: "casual",
        language: "en",
        tone: "flirty",
        interest: 8,
      },
      now,
    );
    expect(merged).toEqual({
      length: "short",
      emojis: "many",
      register: "casual",
      language: "en",
      tone: "flirty",
      interest: 8,
      updatedAt: now.toISOString(),
    });
  });

  it("replyLanguage : langue de la personne parmi celles de la persona, sinon la première de la persona", () => {
    const langs = ["fr", "en"];
    expect(
      replyLanguage({
        style: { language: "en" },
        memberLanguageCode: "fr",
        personaLanguages: langs,
      }),
    ).toBe("en");
    expect(replyLanguage({ style: {}, memberLanguageCode: "en-US", personaLanguages: langs })).toBe(
      "en",
    );
    expect(replyLanguage({ style: {}, memberLanguageCode: "de", personaLanguages: langs })).toBe(
      "fr",
    );
    expect(
      replyLanguage({
        style: { language: "it" },
        memberLanguageCode: "en",
        personaLanguages: langs,
      }),
    ).toBe("fr");
    expect(replyLanguage({ style: {}, memberLanguageCode: null, personaLanguages: ["es"] })).toBe(
      "es",
    );
    expect(replyLanguage({ style: {}, memberLanguageCode: null, personaLanguages: [] })).toBe("fr");
    expect(personaLanguages(["EN", "xx", "en", "pt-BR"])).toEqual(["en", "pt"]);
  });

  it("describeStyle", () => {
    expect(describeStyle({})).toBeNull();
    expect(describeStyle({ length: "short", emojis: "few", tone: "shy", interest: 7 })).toBe(
      "messages courts, quelques emojis, ton timide, intérêt estimé 7/10",
    );
  });
});

describe("faits retenus", () => {
  it("dédoublonnés (casse et accents), coupés à 120 caractères, 20 au plus (les plus anciens partent)", () => {
    expect(mergeFacts(["Habite à Lyon"], ["habite a lyon", "  Aime   le jazz ", ""])).toEqual([
      "Habite à Lyon",
      "Aime le jazz",
    ]);
    expect(mergeFacts([], ["x".repeat(200)])[0]).toHaveLength(120);
    const many = Array.from({ length: 25 }, (_, i) => `fait ${i}`);
    const merged = mergeFacts(many.slice(0, 15), many.slice(15));
    expect(merged).toHaveLength(20);
    expect(merged[0]).toBe("fait 5");
    expect(merged[19]).toBe("fait 24");
    expect(parseFacts(["a", 1, " ", "b"])).toEqual(["a", "b"]);
    expect(parseFacts("x")).toEqual([]);
  });
});
