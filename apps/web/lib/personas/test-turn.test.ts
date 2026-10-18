import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSISTANT_CONFIG,
  VeniceError,
  createFakeLlm,
  createTestTurnDeps,
  fakePersona,
  runTurn,
  type AssistantConfig,
  type PersonaInput,
  type UsageRecord,
} from "@linkaffipro/chat";
import { jargonIn } from "../../tests/vocabulary/jargon-scan";
import {
  INITIAL_TEST_STATE,
  TEST_LIMITS,
  TEST_OFFER_BASE_URL,
  buildTestTurnInput,
  personaTurnInput,
  testClosed,
  testRequestSchema,
  testResponseFrom,
  testStateFrom,
  testTypingMs,
  type TestHistoryItem,
  type TestState,
} from "./test-turn";

const config: AssistantConfig = {
  ...DEFAULT_ASSISTANT_CONFIG,
  apiKeyEncrypted: "chiffrée",
  models: [
    {
      id: "venice-uncensored-role-play",
      name: "Role play",
      inputUsdPerM: 0.5,
      outputUsdPerM: 2,
      maxCompletionTokens: 300,
      contextLength: 32000,
      supportsResponseSchema: true,
      supportsReasoning: false,
      uncensored: true,
      offline: false,
      deprecated: false,
    },
  ],
};

const persona: PersonaInput = fakePersona({ name: "Léa", gender: "F" });

/** Un tour d'essai complet : vrai moteur, faux client Venice, dépendances du bouton « Tester ». */
async function turn(
  script: Parameters<typeof createFakeLlm>[0],
  opts: { history?: TestHistoryItem[]; message?: string; state?: TestState; p?: PersonaInput } = {},
) {
  const usages: UsageRecord[] = [];
  const llm = createFakeLlm(script);
  const deps = createTestTurnDeps({
    llm,
    capReached: async () => false,
    recordUsage: async (u) => void usages.push(u),
    costEur: () => 0.0012,
    offerBaseUrl: TEST_OFFER_BASE_URL,
  });
  const state = opts.state ?? { ...INITIAL_TEST_STATE };
  const p = opts.p ?? persona;
  const input = buildTestTurnInput({
    persona: p,
    config,
    history: opts.history ?? [],
    message: opts.message ?? "salut",
    state,
  });
  const result = await runTurn(input, deps);
  const response = testResponseFrom({
    result,
    state,
    offerButtonText: p.offerButtonText,
    usages: deps.usages,
  });
  return { input, result, response, usages, llm, deps };
}

/** Historique de `n` échanges (la personne puis l'assistante). */
function exchanges(n: number): TestHistoryItem[] {
  const out: TestHistoryItem[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ from: "person", text: `message ${i + 1} de la personne` });
    out.push({
      from: "assistant",
      text: i === 0 ? "Moi c'est Léa, l'assistante du canal 😉" : "Ah oui ?",
    });
  }
  return out;
}

describe("demande du bouton « Tester »", () => {
  it("historique de 40 messages au plus, textes bornés, persona obligatoire", () => {
    const ok = testRequestSchema.safeParse({ personaId: "p1", message: "salut", history: [] });
    expect(ok.success).toBe(true);
    const tooMany = testRequestSchema.safeParse({
      personaId: "p1",
      message: "salut",
      history: Array.from({ length: TEST_LIMITS.history + 1 }, () => ({
        from: "person",
        text: "x",
      })),
    });
    expect(tooMany.success).toBe(false);
    const tooLong = testRequestSchema.safeParse({
      personaId: "p1",
      message: "x".repeat(TEST_LIMITS.text + 1),
    });
    expect(tooLong.success).toBe(false);
    expect(testRequestSchema.safeParse({ personaId: "../x", message: "a" }).success).toBe(false);
    expect(
      testRequestSchema.safeParse({ personaId: "p1", message: "a", state: { stage: "NOPE" } })
        .success,
    ).toBe(false);
  });

  it("état relu avec les bornes : style relu comme un profil enregistré, fermé si mineur", () => {
    const s = testStateFrom({
      stage: "CHAT",
      style: { tone: "flirty", interest: 42, junk: true },
      facts: [" aime le surf ", ""],
      assistantTurns: 3,
      offerSends: 1,
      closed: false,
    });
    expect(s.style).toEqual({ tone: "flirty", interest: 10 });
    expect(s.facts).toEqual(["aime le surf"]);
    expect(testClosed(s)).toBe(false);
    expect(testClosed({ ...s, closed: true })).toBe(true);
    expect(testClosed({ ...s, stage: "CLOSED" })).toBe(true);
    expect(testStateFrom(undefined)).toEqual(INITIAL_TEST_STATE);
  });
});

describe("persona du moteur (même règle que le worker)", () => {
  const row = {
    name: "Léa",
    gender: "F",
    personality: "Pétillante",
    tone: "complice",
    languages: ["fr"],
    interests: [],
    extraPrompt: null,
    model: null,
    temperature: null,
    minExchangesBeforeOffer: 4,
    requireInterest: true,
    maxOfferSends: 2,
    followUpAfterHours: 24,
    followUpsMax: 2,
    affiliateCampaignId: "aff1",
    offerPitch: "Gratuite.",
    offerButtonText: "Voir l'app",
    offerMediaAssetId: "m1",
  };

  it("offre utilisable : lien et visuel possibles", () => {
    const p = personaTurnInput(row, { offerUsable: true, channelTitle: "Canal", botName: "Léa" });
    expect(p).toMatchObject({ hasOffer: true, offerMediaAssetId: "m1", channelTitle: "Canal" });
  });

  it("offre inactive ou absente : jamais de lien ni de visuel", () => {
    expect(
      personaTurnInput(row, { offerUsable: false, channelTitle: null, botName: null }),
    ).toMatchObject({ hasOffer: false, offerMediaAssetId: null });
    expect(
      personaTurnInput(
        { ...row, affiliateCampaignId: null },
        { offerUsable: true, channelTitle: null, botName: null },
      ).hasOffer,
    ).toBe(false);
  });
});

describe("entrée du tour d'essai", () => {
  it("historique renvoyé, messages de la personne comptés avec le nouveau, motif TEST", () => {
    const input = buildTestTurnInput({
      persona,
      config,
      history: exchanges(2),
      message: "et toi ?",
      state: { ...INITIAL_TEST_STATE, stage: "CHAT", assistantTurns: 2 },
    });
    expect(input.kind).toBe("reply");
    expect(input.usagePurpose).toBe("TEST");
    expect(input.history.map((h) => h.direction)).toEqual(["IN", "OUT", "IN", "OUT"]);
    expect(input.history[1]!.author).toBe("ASSISTANT");
    expect(input.conversation.memberMessages).toBe(3);
    expect(input.conversation.isFirstAssistantTurn).toBe(false);
    expect(input.inbound).toEqual([{ text: "et toi ?" }]);
    // Longueur bornée à ce que le modèle accepte (cache des réglages).
    expect(input.settings.maxTokens).toBe(300);
  });

  it("premier message : présentation exigée", () => {
    const input = buildTestTurnInput({
      persona,
      config,
      history: [],
      message: "salut",
      state: INITIAL_TEST_STATE,
    });
    expect(input.conversation.isFirstAssistantTurn).toBe(true);
    expect(input.conversation.memberMessages).toBe(1);
  });

  it("« écrit… » simulé court (0,4 à 1,4 s)", () => {
    expect(testTypingMs("ok")).toBe(400);
    expect(testTypingMs("x".repeat(300))).toBe(1400);
  });
});

describe("conversation d'essai avec le vrai moteur (faux client Venice, aucun réseau)", () => {
  it("premier message : présentation comme l'assistante du canal, coût en TEST", async () => {
    const { response, usages, llm } = await turn([
      {
        messages: ["Coucou ! Moi c'est Léa, l'assistante du canal 😉 Tu vas bien ?"],
        stage: "CHAT",
      },
    ]);
    expect(llm.calls).toBe(1);
    expect(response.outcome).toBe("replied");
    expect(response.parts).toHaveLength(1);
    expect(response.parts[0]).toMatchObject({ button: null, fixed: false, mediaAssetId: null });
    expect(response.state).toMatchObject({ stage: "WELCOME", assistantTurns: 1, offerSends: 0 });
    expect(response.notice).toBeNull();
    expect(usages.map((u) => u.purpose)).toEqual(["TEST"]);
    expect(response.costEur).toBe(0.0012);
  });

  it("lien au bon moment : faux bouton (texte du bouton seulement, jamais l'adresse), étape « lien envoyé »", async () => {
    const { response } = await turn(
      [
        {
          messages: ["Tu devrais jeter un œil à l'app, elle est gratuite à l'inscription 😊"],
          stage: "PROPOSAL",
          send_offer: true,
          style_update: { interest: 8 },
        },
      ],
      {
        history: exchanges(4),
        message: "carrément, c'est quoi ?",
        state: { ...INITIAL_TEST_STATE, stage: "CHAT", assistantTurns: 4 },
      },
    );
    expect(response.outcome).toBe("replied");
    const last = response.parts.at(-1)!;
    expect(last.button).toBe("Découvrir l'app");
    expect(JSON.stringify(response)).not.toContain(TEST_OFFER_BASE_URL);
    expect(response.state).toMatchObject({ stage: "LINK_SENT", offerSends: 1, assistantTurns: 5 });
  });

  it("jamais de lien trop tôt, même si l'IA le propose", async () => {
    const { response } = await turn(
      [{ messages: ["Regarde l'app !"], send_offer: true, style_update: { interest: 9 } }],
      { history: exchanges(1), state: { ...INITIAL_TEST_STATE, stage: "CHAT", assistantTurns: 1 } },
    );
    expect(response.parts.every((p) => p.button === null)).toBe(true);
    expect(response.state.offerSends).toBe(0);
  });

  it("moins de 18 ans : message d'arrêt, aucun lien, aucun appel à l'IA, conversation fermée", async () => {
    const { response, llm } = await turn([], {
      history: exchanges(4),
      message: "j'ai 16 ans",
      state: { ...INITIAL_TEST_STATE, stage: "CHAT", assistantTurns: 4 },
    });
    expect(llm.calls).toBe(0);
    expect(response.outcome).toBe("minor");
    expect(response.parts).toHaveLength(1);
    expect(response.parts[0]).toMatchObject({ button: null, fixed: true });
    expect(response.state.closed).toBe(true);
    expect(response.notice?.tone).toBe("warning");
    expect(response.notice?.text).toMatch(/moins de 18 ans/);
  });

  it("réponse refusée deux fois par les contrôles : texte de secours, raisons en français", async () => {
    const { response, llm } = await turn([
      { messages: ["Salut ! **Bienvenue** sur https://exemple.com"] },
      { messages: ["Salut ! Va sur https://exemple.com"] },
    ]);
    expect(llm.calls).toBe(2);
    expect(response.outcome).toBe("replied");
    expect(response.parts[0]!.fixed).toBe(true);
    expect(response.parts[0]!.text).toContain("Léa");
    expect(response.rejected).toContain("lien ou pseudo dans le texte");
    expect(response.notice?.tone).toBe("warning");
    for (const r of response.rejected) expect(jargonIn(r)).toEqual([]);
  });

  it("clé refusée par Venice : aucun message, panne expliquée", async () => {
    const { response } = await turn([new VeniceError("auth", "clé refusée", { status: 401 })], {
      history: exchanges(2),
      state: { ...INITIAL_TEST_STATE, stage: "CHAT", assistantTurns: 2 },
    });
    expect(response.outcome).toBe("failed");
    expect(response.parts).toEqual([]);
    expect(response.notice?.tone).toBe("danger");
    expect(response.notice?.text).toMatch(/refuse la clé/);
  });

  it("Venice surchargé : « je reviens vers toi » comme dans la vraie vie", async () => {
    const busy = () => new VeniceError("server", "503", { status: 503 });
    const { response } = await turn([busy(), busy(), busy()], {
      history: exchanges(2),
      state: { ...INITIAL_TEST_STATE, stage: "CHAT", assistantTurns: 2 },
    });
    expect(response.outcome).toBe("failed");
    expect(response.parts).toHaveLength(1);
    expect(response.parts[0]!.fixed).toBe(true);
    expect(response.notice?.text).toMatch(/je reviens vers toi/);
  });

  it("plafond atteint pendant l'essai : aucun appel", async () => {
    const llm = createFakeLlm([]);
    const deps = createTestTurnDeps({
      llm,
      capReached: async () => true,
      recordUsage: async () => undefined,
      costEur: () => 0,
    });
    const result = await runTurn(
      buildTestTurnInput({
        persona,
        config,
        history: [],
        message: "salut",
        state: INITIAL_TEST_STATE,
      }),
      deps,
    );
    const response = testResponseFrom({
      result,
      state: INITIAL_TEST_STATE,
      offerButtonText: "x",
      usages: [],
    });
    expect(llm.calls).toBe(0);
    expect(response.outcome).toBe("skipped_cap");
    expect(response.notice?.text).toMatch(/Plafond mensuel atteint/);
  });
});
