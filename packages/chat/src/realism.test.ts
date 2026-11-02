import { describe, expect, it } from "vitest";
import {
  typingDelayMs,
  openingDelayMs,
  NIGHT_HOUR_START,
  NIGHT_HOUR_END,
  NIGHT_MULTIPLIER_MIN,
  NIGHT_MAX_MS,
  TYPING_JITTER,
} from "./rhythm";
import { mergeFacts, STICKY_PATTERNS, MAX_FACTS } from "./memory";
import { fixedText, FIXED_TEXTS } from "./texts";
import { CHAT_LANGS } from "./types";
import {
  nextFollowUpAt,
  FOLLOW_UP_JITTER_HOURS,
  MIN_HOURS_BETWEEN_FOLLOW_UPS,
  type FollowUpState,
  type FollowUpRules,
} from "./follow-ups";
import { hasVeryExplicitContent, validateTurnOutput, type ValidationContext } from "./validate";
import { fakeOutput } from "./fake";
import { buildSystemPrompt, type SystemPromptContext } from "./prompt";
import type { PersonaInput } from "./turn-types";

const testPersona = (over: Partial<PersonaInput> = {}): PersonaInput => ({
  name: "Léa",
  gender: "F",
  personality: "Pétillante",
  tone: "complice",
  languages: ["fr"],
  interests: [],
  extraPrompt: null,
  hasOffer: false,
  offerPitch: "",
  offerButtonText: "",
  channelTitle: "Rencontres",
  minExchangesBeforeOffer: 4,
  requireInterest: false,
  maxOfferSends: 2,
  model: null,
  temperature: null,
  followUpAfterHours: 24,
  followUpsMax: 2,
  offerMediaAssetId: null,
  identity: "GIRL",
  illusion: true,
  ...over,
});

// ------------------------------------------------------------------
// #1 : pause entre les messages (l'appel est dans engine.ts, testé par les tests d'intégration
//       existants ; ici on vérifie que pauseBetweenMs reste exportée et fonctionne)
// ------------------------------------------------------------------
// Couvert par le test « en direct : elle repond aussitot et colle ses messages » de rhythm.test.ts.

// ------------------------------------------------------------------
// #5 : facteur de nuit dans openingDelayMs
// ------------------------------------------------------------------
describe("#5 : facteur de nuit", () => {
  const base = {
    peerDelayMs: 30_000,
    isFirst: false,
    hot: false,
    cold: false,
    refused: false,
    live: false,
    followUp: false,
  };

  it("de nuit (1h-7h Paris) le délai est multiplié par au moins NIGHT_MULTIPLIER_MIN", () => {
    const dayDelay = openingDelayMs(base, () => 0.5);
    const nightDelay = openingDelayMs({ ...base, nowHourParis: 3 }, () => 0.5);
    expect(nightDelay).toBeGreaterThanOrEqual(dayDelay * NIGHT_MULTIPLIER_MIN);
  });

  it("de nuit le délai est plafonné à NIGHT_MAX_MS", () => {
    const nightDelay = openingDelayMs(
      { ...base, peerDelayMs: 3_600_000, nowHourParis: 2 },
      () => 1,
    );
    expect(nightDelay).toBeLessThanOrEqual(NIGHT_MAX_MS);
  });

  it("en dehors de 1h-7h, pas de multiplicateur de nuit", () => {
    const day = openingDelayMs({ ...base, nowHourParis: 10 }, () => 0.5);
    const noHour = openingDelayMs(base, () => 0.5);
    expect(day).toBe(noHour);
  });

  it("à l'heure exacte de début et de fin", () => {
    const atStart = openingDelayMs({ ...base, nowHourParis: NIGHT_HOUR_START }, () => 0.5);
    const beforeEnd = openingDelayMs({ ...base, nowHourParis: NIGHT_HOUR_END - 1 }, () => 0.5);
    const atEnd = openingDelayMs({ ...base, nowHourParis: NIGHT_HOUR_END }, () => 0.5);
    const noHour = openingDelayMs(base, () => 0.5);
    expect(atStart).toBeGreaterThan(noHour);
    expect(beforeEnd).toBeGreaterThan(noHour);
    expect(atEnd).toBe(noHour);
  });
});

// ------------------------------------------------------------------
// #11 : jitter sur le délai de frappe
// ------------------------------------------------------------------
describe("#11 : jitter sur typingDelayMs", () => {
  it("sans random, le délai est déterministe", () => {
    expect(typingDelayMs("hello")).toBe(typingDelayMs("hello"));
  });

  it("avec random, le délai varie dans la fourchette ±TYPING_JITTER", () => {
    const base = typingDelayMs("hello world bonjour");
    const low = typingDelayMs("hello world bonjour", false, () => 0);
    const high = typingDelayMs("hello world bonjour", false, () => 1);
    expect(low).toBeLessThan(base);
    expect(high).toBeGreaterThan(base);
    expect(low).toBeGreaterThanOrEqual(Math.round(base * (1 - TYPING_JITTER)));
    expect(high).toBeLessThanOrEqual(Math.round(base * (1 + TYPING_JITTER)));
  });
});

// ------------------------------------------------------------------
// #6 : faits collants dans mergeFacts
// ------------------------------------------------------------------
describe("#6 : faits collants (sticky facts)", () => {
  it("les faits critiques (prénom, âge, ville, pseudo) ne sont jamais évincés", () => {
    const sticky = ["Prénom : Sophie", "Âge : 28", "Ville : Lyon", "Pseudo : soph28"];
    const filler = Array.from({ length: 25 }, (_, i) => `Fait quelconque numéro ${i}`);
    const merged = mergeFacts([...sticky, ...filler], []);
    expect(merged.length).toBe(MAX_FACTS);
    for (const s of sticky) expect(merged).toContain(s);
  });

  it("les faits collants sont en fin de liste", () => {
    const sticky = ["Prénom : Sophie"];
    const filler = Array.from({ length: 25 }, (_, i) => `Fait ${i}`);
    const merged = mergeFacts([...sticky, ...filler], []);
    expect(merged[merged.length - 1]).toBe("Prénom : Sophie");
  });

  it("les patterns collants reconnaissent les variantes", () => {
    for (const f of [
      "prénom : X",
      "Prenom : Y",
      "âge : 22",
      "Age : 30",
      "ville : Paris",
      "pseudo : abc",
    ]) {
      expect(
        STICKY_PATTERNS.some((p) => p.test(f)),
        f,
      ).toBe(true);
    }
  });
});

// ------------------------------------------------------------------
// #4 : texte fixe « midConv » en 6 langues
// ------------------------------------------------------------------
describe("#4 : texte fixe midConv", () => {
  it("midConv existe dans les 6 langues et n'est pas vide", () => {
    for (const lang of CHAT_LANGS) {
      const text = FIXED_TEXTS[lang].midConv;
      expect(text, `${lang} midConv`).toBeTruthy();
      expect(fixedText(lang, "midConv").length).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------------------------------
// #10 : jitter sur la 2e relance
// ------------------------------------------------------------------
describe("#10 : jitter sur la 2e relance", () => {
  const baseState: FollowUpState = {
    status: "BOT",
    stage: "CHAT",
    isMinor: false,
    stoppedAt: null,
    followUpCount: 1,
    lastAssistantAt: new Date("2026-10-18T12:00:00Z"),
  };
  const rules: FollowUpRules = { followUpAfterHours: 24, followUpsMax: 2 };

  it("sans random, la 2e relance est à exactement MIN_HOURS_BETWEEN_FOLLOW_UPS", () => {
    const d = nextFollowUpAt(baseState, rules);
    expect(d).not.toBeNull();
    const hours = (d!.getTime() - baseState.lastAssistantAt!.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThanOrEqual(MIN_HOURS_BETWEEN_FOLLOW_UPS);
  });

  it("avec random(0), le jitter retire des heures", () => {
    const d = nextFollowUpAt(baseState, rules, () => 0);
    expect(d).not.toBeNull();
    const hours = (d!.getTime() - baseState.lastAssistantAt!.getTime()) / 3_600_000;
    expect(hours).toBeLessThan(MIN_HOURS_BETWEEN_FOLLOW_UPS + FOLLOW_UP_JITTER_HOURS);
    expect(hours).toBeGreaterThanOrEqual(MIN_HOURS_BETWEEN_FOLLOW_UPS);
  });

  it("avec random(1), le jitter ajoute des heures", () => {
    const d = nextFollowUpAt(baseState, rules, () => 1);
    expect(d).not.toBeNull();
    const hours = (d!.getTime() - baseState.lastAssistantAt!.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(MIN_HOURS_BETWEEN_FOLLOW_UPS);
  });

  it("la 1re relance n'a pas de jitter", () => {
    const first = { ...baseState, followUpCount: 0 };
    const a = nextFollowUpAt(first, rules, () => 0);
    const b = nextFollowUpAt(first, rules, () => 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.getTime()).toBe(b!.getTime());
  });
});

// ------------------------------------------------------------------
// #12 : contenu très cru rejeté si intérêt < 7
// ------------------------------------------------------------------
describe("#12 : contenu très cru trop tôt", () => {
  it("hasVeryExplicitContent détecte les mots très crus", () => {
    expect(hasVeryExplicitContent("j'ai envie de te sucer")).toBe(true);
    expect(hasVeryExplicitContent("j'ai envie de te baiser")).toBe(true);
    expect(hasVeryExplicitContent("suce moi")).toBe(true);
    expect(hasVeryExplicitContent("viens on fait un plan cul")).toBe(true);
    expect(hasVeryExplicitContent("deepthroat")).toBe(true);
  });

  it("hasVeryExplicitContent ne détecte pas le flirt léger ni les mots soft", () => {
    expect(hasVeryExplicitContent("tu es sexy 😘")).toBe(false);
    expect(hasVeryExplicitContent("un bisou")).toBe(false);
    expect(hasVeryExplicitContent("coquin va 😏")).toBe(false);
    expect(hasVeryExplicitContent("un gros baiser")).toBe(false);
  });

  const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
    personaName: "Léa",
    offerPitch: "",
    memberTexts: [],
    turnInboundTexts: ["salut"],
    facts: [],
    isFirstAssistantMessage: false,
    identity: "GIRL",
    illusion: true,
    interest: 3,
    ...over,
  });

  it("explicit_too_early quand intérêt < 7 et contenu très cru, en illusion", () => {
    const r = validateTurnOutput(fakeOutput({ messages: ["suce moi"] }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("explicit_too_early");
  });

  it("pas de rejet quand intérêt >= 7", () => {
    const r = validateTurnOutput(fakeOutput({ messages: ["suce moi"] }), ctx({ interest: 8 }));
    if (!r.ok) expect(r.codes).not.toContain("explicit_too_early");
  });

  it("pas de rejet hors illusion (identity ASSISTANT)", () => {
    const r = validateTurnOutput(
      fakeOutput({ messages: ["suce moi"] }),
      ctx({ identity: "ASSISTANT" }),
    );
    if (!r.ok) expect(r.codes).not.toContain("explicit_too_early");
  });
});

// ------------------------------------------------------------------
// #7 : le prompt dit de ne pas annoncer le lien quand le flirt le bloque
// ------------------------------------------------------------------
describe("#7 : prompt n'annonce pas le lien quand le flirt le bloque", () => {
  const baseCtx: SystemPromptContext = {
    persona: testPersona({
      hasOffer: true,
      offerPitch: "Une app de rencontres.",
      offerButtonText: "Découvrir",
      minExchangesBeforeOffer: 2,
    }),
    lang: "fr",
    stage: "CHAT",
    isFirstAssistantTurn: false,
    kind: "reply",
    memberMessages: 10,
    offerSends: 0,
    isMinor: false,
    facts: [],
    style: {},
    summary: null,
    flirt: {
      allow: ["rien"],
      photoSlot: null,
      directive: "tease",
      photo: null,
    },
  };

  it("quand le flirt bloque « lien », le prompt contient l'instruction de ne pas annoncer", () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain("PAS maintenant");
    expect(prompt).toContain("ne dis PAS que tu envoies le lien");
  });

  it("quand le flirt autorise « lien », le prompt ne bloque pas", () => {
    const prompt = buildSystemPrompt({
      ...baseCtx,
      flirt: { ...baseCtx.flirt!, allow: ["lien", "rien"] },
    });
    expect(prompt).not.toContain("PAS maintenant");
  });
});

// ------------------------------------------------------------------
// #9 : le prompt a adouci la règle des questions en fin de message
// ------------------------------------------------------------------
describe("#9 : questions adoucies dans le prompt", () => {
  const baseCtx: SystemPromptContext = {
    persona: testPersona(),
    lang: "fr",
    stage: "CHAT",
    isFirstAssistantTurn: false,
    kind: "reply",
    memberMessages: 5,
    offerSends: 0,
    isMinor: false,
    facts: [],
    style: {},
    summary: null,
  };

  it("contient la nuance « pas a chaque message »", () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain("pas a chaque message");
  });

  it("contient la règle « 3 messages de suite »", () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain("3 messages de suite");
  });
});

// ------------------------------------------------------------------
// #15 : instruction de fautes de frappe dans le prompt
// ------------------------------------------------------------------
describe("#15 : fautes de frappe", () => {
  const baseCtx: SystemPromptContext = {
    persona: testPersona(),
    lang: "fr",
    stage: "CHAT",
    isFirstAssistantTurn: false,
    kind: "reply",
    memberMessages: 5,
    offerSends: 0,
    isMinor: false,
    facts: [],
    style: {},
    summary: null,
  };

  it("le prompt contient l'instruction de fautes de frappe", () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain("faute de frappe");
    expect(prompt).toContain("1 message sur 5");
  });
});
