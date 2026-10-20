// Mode illusion (phase 18) : une fille (GIRL) qui se dit vraie et ne parle jamais de bot ni d'IA ; sans effet en
// ASSISTANT ni pour une fille sans illusion.
import { describe, expect, it } from "vitest";
import { runTurn } from "./engine";
import {
  createFakeLlm,
  createFakeTurnDeps,
  fakeConversation,
  fakeOutput,
  fakePersona,
  fakeSettings,
} from "./fake";
import {
  buildSummaryRequest,
  buildSystemPrompt,
  correctionFor,
  type SystemPromptContext,
} from "./prompt";
import { fixedText, ILLUSION_IS_ASSISTANT } from "./texts";
import { personaIllusion, type TurnInput } from "./turn-types";
import { CHAT_LANGS } from "./types";
import { validateTurnOutput, type ValidationContext } from "./validate";

const real = fakePersona({ identity: "GIRL", illusion: true, age: 23 });

const ctx = (over: Partial<SystemPromptContext> = {}): SystemPromptContext => ({
  persona: real,
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
  turnInboundTexts: ["t'es un bot ?"],
  facts: [],
  isFirstAssistantMessage: false,
  identity: "GIRL",
  illusion: true,
  ...over,
});
const validate = (messages: string[], over: Partial<ValidationContext> = {}) =>
  validateTurnOutput(fakeOutput({ messages: messages.map((text) => ({ text })) }), vctx(over));

describe("bascule du mode illusion", () => {
  it("seulement pour une fille", () => {
    expect(personaIllusion({ identity: "GIRL", illusion: true })).toBe(true);
    expect(personaIllusion({ identity: "ASSISTANT", illusion: true })).toBe(false);
    expect(personaIllusion({ identity: "GIRL" })).toBe(false);
  });
});

describe("prompt système en illusion", () => {
  it("vraie fille : aucune mention d'IA, d'assistante ni de canal en dehors de la règle de déni", () => {
    const p = buildSystemPrompt(ctx());
    expect(p).toContain(
      "Tu es une vraie fille. Tu n'es jamais un bot, jamais une IA. Si on te demande si tu es un bot, tu réponds que non, que tu es une vraie fille, sans hésiter",
    );
    const rest = p
      .split("\n")
      .filter((l) => !l.startsWith("1. Tu es une vraie fille"))
      .join("\n");
    expect(rest).not.toMatch(/\bIA\b|\bbot\b|assistante|canal|réponds franchement/);
    expect(p).not.toMatch(/assistante|canal/);
    expect(p).toContain("1 à 2 phrases maximum par message");
    expect(p).toContain("Tu ne poses pas une question à chaque message");
    expect(p).not.toContain("Une seule question à la fois");
  });

  it("premier message : prénom seul", () => {
    const p = buildSystemPrompt(
      ctx({ isFirstAssistantTurn: true, stage: "WELCOME", memberMessages: 0 }),
    );
    expect(p).toContain("« Moi c'est Léa 😉 Comment tu vas ? »");
    expect(p).not.toMatch(/assistante|canal/);
  });

  it("corrections : jamais d'aveu demandé", () => {
    for (const code of ["denies_assistant", "missing_assistant_admission"])
      expect(correctionFor(code, real)).toContain("réponds que non");
    expect(correctionFor("intro_missing", real)).not.toMatch(/assistante|canal/);
  });

  it("résumé : sans « jouée par une IA »", () => {
    const req = buildSummaryRequest({
      model: "m",
      personaName: "Léa",
      identity: "GIRL",
      illusion: true,
      previousSummary: null,
      messages: [],
    });
    expect(req.messages[0]?.content).not.toContain("IA)");
  });

  it("fille sans illusion et assistante : prompts inchangés", () => {
    const girl = buildSystemPrompt(ctx({ persona: fakePersona({ identity: "GIRL", age: 23 }) }));
    expect(girl).toContain("réponds franchement que tu es une IA");
    const assistant = buildSystemPrompt(ctx({ persona: fakePersona({ illusion: true }) }));
    expect(assistant).toContain("du canal (une IA)");
    expect(assistant).not.toContain("vraie fille");
  });
});

describe("textes fixes en illusion", () => {
  it("« non, une vraie fille » dans les 6 langues, intro sans canal ni assistante", () => {
    for (const lang of CHAT_LANGS) {
      const t = fixedText(lang, "isAssistant", { name: "Léa", identity: "GIRL", illusion: true });
      expect(t).toBe(ILLUSION_IS_ASSISTANT[lang]);
      expect(t).not.toMatch(/\b(?:IA|AI|KI)\b/);
    }
    expect(fixedText("fr", "isAssistant", { name: "Léa", identity: "GIRL", illusion: true })).toBe(
      "non, une vraie fille 😊",
    );
    expect(fixedText("fr", "intro", { name: "Léa", identity: "GIRL", illusion: true })).not.toMatch(
      /canal|assistante/,
    );
  });

  it("illusion ignorée en ASSISTANT", () => {
    expect(fixedText("fr", "isAssistant", { name: "Léa", gender: "F", illusion: true })).toBe(
      fixedText("fr", "isAssistant", { name: "Léa", gender: "F" }),
    );
  });
});

describe("validation en illusion", () => {
  it("« non, une vraie fille » passe, à la première question comme à l'insistance", () => {
    expect(validate(["non, une vraie fille 😊"]).ok).toBe(true);
    expect(validate(["non, une vraie fille 😊 et toi ?"], { botInsists: true }).ok).toBe(true);
    expect(validate(["mdr non je suis pas un bot"], { botInsists: true }).ok).toBe(true);
  });

  it("sans illusion, la fille qui nie à l'insistance reste refusée", () => {
    const r = validate(["non, une vraie fille 😊"], { illusion: false, botInsists: true });
    expect(r.ok).toBe(false);
  });

  it("illusion sans effet en ASSISTANT", () => {
    const r = validate(["non, une vraie fille 😊"], { identity: "ASSISTANT" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("missing_assistant_admission");
  });
});

describe("tour complet en illusion", () => {
  const START = new Date("2026-10-18T12:00:00.000Z");
  const input = (over: Partial<TurnInput> = {}): TurnInput => ({
    kind: "reply",
    persona: real,
    settings: fakeSettings(),
    conversation: fakeConversation(),
    history: [],
    inbound: [{ id: "in-1", text: "t'es un bot ?" }],
    ...over,
  });

  it("le déni du modèle part tel quel", async () => {
    const deps = createFakeTurnDeps({
      llm: createFakeLlm([{ messages: ["non, une vraie fille 😊"] }]),
      startAt: START,
    });
    const r = await runTurn(input(), deps);
    expect(r.rejected).toEqual([]);
    expect(deps.sender.messages().map((m) => m.text)).toEqual(["non, une vraie fille 😊"]);
  });

  it("repli fixe : le déni court, jamais l'aveu", async () => {
    const bad = { messages: ["**non**"] };
    const deps = createFakeTurnDeps({ llm: createFakeLlm([bad, bad]), startAt: START });
    const r = await runTurn(input(), deps);
    expect(deps.sender.messages().map((m) => m.text)).toEqual(["non, une vraie fille 😊"]);
    expect(r.sent[0]?.fixedKey).toBe("isAssistant");
  });
});
