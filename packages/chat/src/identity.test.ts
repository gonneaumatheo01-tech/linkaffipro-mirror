// Identité de la persona (phase 18) : une fille (GIRL) sans « assistante » ni « canal », honnête quand on insiste ;
// l'assistante (ASSISTANT, défaut) inchangée.
import { describe, expect, it } from "vitest";
import { fakeOutput, fakePersona } from "./fake";
import {
  buildSummaryRequest,
  buildSystemPrompt,
  correctionFor,
  type SystemPromptContext,
} from "./prompt";
import { fixedText, GIRL_FIXED_TEXTS } from "./texts";
import { CHAT_LANGS } from "./types";
import {
  admitsBeingAi,
  botQuestionInsists,
  validateTurnOutput,
  type ValidationContext,
} from "./validate";

const girl = fakePersona({ identity: "GIRL", age: 24 });

const ctx = (over: Partial<SystemPromptContext> = {}): SystemPromptContext => ({
  persona: girl,
  lang: "fr",
  kind: "reply",
  stage: "CHAT",
  style: {},
  facts: [],
  summary: null,
  isFirstAssistantTurn: false,
  memberMessages: 5,
  offerSends: 0,
  ...over,
});

const vctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  personaName: "Léa",
  offerPitch: "",
  memberTexts: [],
  turnInboundTexts: ["salut"],
  facts: [],
  isFirstAssistantMessage: false,
  identity: "GIRL",
  ...over,
});
const validate = (messages: string[], over: Partial<ValidationContext> = {}) =>
  validateTurnOutput(fakeOutput({ messages: messages.map((text) => ({ text })) }), vctx(over));

describe("prompt système d'une fille", () => {
  it("cadre de fille avec l'âge, sans assistante ni canal", () => {
    const p = buildSystemPrompt(ctx());
    expect(p).toContain(
      "Tu es Léa, 24 ans, une fille sur Telegram. Tu discutes en privé avec quelqu'un qui t'a écrit.",
    );
    expect(p).not.toMatch(/assistante virtuelle|assistante du canal|Rencontres Paris/);
    expect(p).toContain("réponds simplement que non");
    expect(p).toContain(
      "Si la personne insiste ou redemande, réponds franchement que tu es une IA",
    );
  });

  it("sans âge : pas d'âge inventé", () => {
    const p = buildSystemPrompt(ctx({ persona: fakePersona({ identity: "GIRL" }) }));
    expect(p).toContain("Tu es Léa, une fille sur Telegram.");
  });

  it("premier message : prénom seul, exemple de fille", () => {
    const p = buildSystemPrompt(
      ctx({ isFirstAssistantTurn: true, stage: "WELCOME", memberMessages: 0 }),
    );
    expect(p).toContain("présente-toi en une phrase naturelle en disant ton prénom (en français");
    expect(p).toContain("« Moi c'est Léa 😉 Comment tu vas ? »");
    expect(p).not.toContain("du canal");
  });

  it("corrections sans assistante ni canal", () => {
    for (const code of ["denies_assistant", "missing_assistant_admission", "intro_missing"])
      expect(correctionFor(code, girl)).not.toMatch(/assistante virtuelle|du canal/);
  });

  it("résumé : une fille jouée par une IA", () => {
    const req = buildSummaryRequest({
      model: "m",
      personaName: "Léa",
      identity: "GIRL",
      previousSummary: null,
      messages: [],
    });
    expect(req.messages[0]!.content).toContain("une fille sur Telegram");
  });
});

describe("prompt : envoi du lien", () => {
  it("seuil atteint : consigne claire de proposer l'app quand le courant passe", () => {
    for (const persona of [girl, fakePersona()]) {
      const p = buildSystemPrompt(ctx({ persona }));
      expect(p).toContain("c'est le moment");
      expect(p).toContain("propose l'app dès ce tour avec send_offer : true et stage : PROPOSAL");
    }
  });

  it("lien déjà envoyé une fois : pas de relance de la consigne", () => {
    expect(buildSystemPrompt(ctx({ offerSends: 1 }))).not.toContain("c'est le moment");
  });
});

describe("textes fixes d'une fille", () => {
  it("6 langues, ni canal ni assistante, l'aveu dit être une IA", () => {
    for (const lang of CHAT_LANGS) {
      const intro = fixedText(lang, "intro", { name: "Léa", identity: "GIRL" });
      const admit = fixedText(lang, "isAssistant", { name: "Léa", identity: "GIRL" });
      expect(intro).toContain("Léa");
      for (const t of [intro, admit]) expect(t).not.toMatch(/canal|channel|kanal|canale|assist/i);
      expect(admitsBeingAi(admit)).toBe(true);
      expect(GIRL_FIXED_TEXTS[lang].intro).toContain("{name}");
    }
  });

  it("assistante : textes de la phase 17 inchangés", () => {
    expect(fixedText("fr", "intro", { name: "Léa" })).toBe(
      "Moi c'est Léa, l'assistante du canal 😉 Comment tu vas ?",
    );
  });
});

describe("validation d'une fille", () => {
  it("se présente par son prénom seul", () => {
    expect(validate(["Moi c'est Léa 😉 et toi ?"], { isFirstAssistantMessage: true }).ok).toBe(
      true,
    );
    expect(validate(["Coucou 😉 et toi ?"], { isFirstAssistantMessage: true })).toMatchObject({
      ok: false,
      codes: ["intro_missing"],
    });
  });

  it("première question : peut répondre que non", () => {
    const r = validate(["Haha non je suis pas un bot, pourquoi ?"], {
      turnInboundTexts: ["t'es un bot ?"],
      botInsists: false,
    });
    expect(r.ok).toBe(true);
  });

  it("insistance : l'aveu d'être une IA est exigé, sans canal ni assistante", () => {
    const deny = validate(["Mais non je te jure, je suis une vraie fille"], {
      turnInboundTexts: ["sérieux t'es une IA ?"],
      botInsists: true,
    });
    expect(deny).toMatchObject({ ok: false });
    if (!deny.ok) expect(deny.codes).toEqual(["denies_assistant", "missing_assistant_admission"]);
    expect(
      validate(["Ok je vais être honnête : je suis une IA 😊 mais j'aime bien parler avec toi"], {
        turnInboundTexts: ["sérieux t'es une IA ?"],
        botInsists: true,
      }).ok,
    ).toBe(true);
  });

  it("assistante : toujours l'aveu dès la première question", () => {
    expect(
      validate(["Haha non je suis pas un bot"], {
        identity: undefined,
        turnInboundTexts: ["t'es un bot ?"],
      }),
    ).toMatchObject({ ok: false, codes: ["denies_assistant", "missing_assistant_admission"] });
  });
});

describe("insistance", () => {
  it("question déjà posée plus tôt, ou deux fois dans le tour", () => {
    const history = [{ direction: "IN" as const, text: "t'es un bot ?" }];
    expect(botQuestionInsists([], ["t'es un bot ?"])).toBe(false);
    expect(botQuestionInsists(history, ["non mais sérieux t'es une IA ?"])).toBe(true);
    expect(botQuestionInsists(history, ["tu fais quoi ce soir ?"])).toBe(false);
    expect(botQuestionInsists([], ["t'es un bot ?", "t'es une IA ?"])).toBe(true);
  });
});
