import { describe, expect, it } from "vitest";
import { RETRY_LATER_MS, runTurn, summarizeAfterTurn } from "./engine";
import {
  createFakeLlm,
  createFakeSender,
  createFakeTurnDeps,
  createTestTurnDeps,
  fakeConversation,
  fakePersona,
  fakeSettings,
  type FakeLlmScript,
  type FakeTurnDepsOptions,
} from "./fake";
import { fixedText } from "./texts";
import type { TurnInput } from "./turn-types";
import { VeniceError, type UsageRecord } from "./types";

const START = new Date("2026-10-18T12:00:00.000Z"); // 14 h à Paris

function setup(script: FakeLlmScript, opts: Omit<FakeTurnDepsOptions, "llm"> = {}) {
  const llm = createFakeLlm(script);
  const deps = createFakeTurnDeps({ llm, startAt: START, ...opts });
  return { llm, deps };
}

const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  kind: "reply",
  persona: fakePersona(),
  settings: fakeSettings(),
  conversation: fakeConversation(),
  history: [],
  inbound: [{ id: "in-1", text: "Salut, ça va ?" }],
  ...over,
});

const offerReady = { send_offer: true, stage: "PROPOSAL" as const, style_update: { interest: 8 } };
const systemOf = (req: { messages: { role: string; content: string }[] } | undefined) =>
  req?.messages[0]?.content ?? "";

describe("runTurn : réponse simple", () => {
  it("envoie les messages dans l'ordre avec « écrit… » et les délais, sans lien, et renvoie tout pour la persistance", async () => {
    const { llm, deps } = setup([
      {
        messages: ["Coucou toi 😊", "Moi ça va super, et toi ta journée ?"],
        style_update: { language: "fr", interest: 4, tone: "chatty" },
        memory_facts: ["Habite à Lyon", "habite a lyon"],
        note_interne: "Personne bavarde.",
      },
    ]);
    const r = await runTurn(input(), deps);

    expect(r.outcome).toBe("replied");
    expect(llm.calls).toBe(1);
    expect(llm.requests[0]).toMatchObject({
      model: "venice-uncensored-role-play",
      temperature: 0.85,
      maxTokens: 400,
      reasoning: false,
      jsonSchema: { name: "assistant_turn" },
    });
    expect(deps.sender.messages().map((m) => m.text)).toEqual([
      "Coucou toi 😊",
      "Moi ça va super, et toi ta journée ?",
    ]);
    expect(deps.sender.messages().every((m) => m.kind === "text" && !m.buttons)).toBe(true);
    // « écrit… » pendant l'appel puis avant chaque message ; minuterie arrêtée
    const kinds = deps.sender.log.map((e) => e.kind);
    expect(kinds).toEqual(["typing", "typing", "text", "typing", "text"]);
    expect(deps.timers.active()).toBe(0);
    // délais : 1000 + 25 × longueur ; pause 1,5 s (aléa 0,5) entre les deux
    expect(deps.sleeps).toEqual([1000 + 25 * 12, 1500, 1000 + 25 * 36]);

    expect(r.sent).toHaveLength(2);
    expect(r.sent[0]).toMatchObject({
      index: 0,
      telegramMessageId: 1000,
      offerSubId: null,
      fixedKey: null,
    });
    expect(r.offerSent).toBeNull();
    expect(deps.offerLinks).toHaveLength(0);
    expect(r.model).toBe("venice-uncensored-role-play");
    expect(r.note).toBe("Personne bavarde.");
    expect(r.facts).toEqual(["Habite à Lyon"]);
    expect(r.style).toMatchObject({ language: "fr", interest: 4, tone: "chatty" });
    expect(r.newStage).toBe("CHAT");
    expect(r.stageChanges).toEqual([]);
    expect(r.followUpCount).toBe(0);
    expect(r.nextFollowUpAt).toEqual(new Date(deps.now().getTime() + 24 * 3_600_000));
    expect(r.inboundUsed).toEqual([{ id: "in-1", text: "Salut, ça va ?" }]);
    expect(deps.usages).toEqual([
      expect.objectContaining({
        purpose: "REPLY",
        model: "venice-uncensored-role-play",
        ok: true,
        error: null,
        attempt: 1,
        inputTokens: 800,
        outputTokens: 120,
      }),
    ]);
    expect(deps.usages[0]?.costEur).toBeCloseTo((920 / 1_000_000) * 0.92);
  });

  it("modèle et température de la persona prioritaires ; raisonnement coupé si le modèle raisonne", async () => {
    const { llm, deps } = setup([{ messages: ["ok 🙂"] }]);
    await runTurn(
      input({
        persona: fakePersona({ model: "qwen-3", temperature: 0.4 }),
        settings: fakeSettings({ modelSupportsReasoning: (id) => id === "qwen-3" }),
      }),
      deps,
    );
    expect(llm.requests[0]).toMatchObject({ model: "qwen-3", temperature: 0.4, reasoning: true });
  });
});

describe("runTurn : premier message et lien", () => {
  it("premier message : présentation, jamais de lien même si le modèle le propose, étape WELCOME", async () => {
    const { deps } = setup([
      {
        messages: ["Coucou ! Moi c'est Léa, l'assistante du canal 😉", "Tu vas bien ?"],
        ...offerReady,
      },
    ]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({
          stage: "WELCOME",
          isFirstAssistantTurn: true,
          memberMessages: 9,
        }),
        persona: fakePersona({ minExchangesBeforeOffer: 1 }),
        inbound: [{ text: "/start tiktok" }],
      }),
      deps,
    );
    expect(r.outcome).toBe("replied");
    expect(deps.offerLinks).toHaveLength(0);
    expect(r.offerSent).toBeNull();
    expect(deps.sender.messages().some((m) => m.kind === "media" || m.buttons)).toBe(false);
    expect(r.newStage).toBe("WELCOME");
    expect(r.nextFollowUpAt).toBeNull(); // pas de relance après la seule présentation
  });

  it("le lien part quand les règles le permettent : un seul lien, bouton sur le DERNIER message, LINK_SENT", async () => {
    const { deps } = setup([
      {
        messages: [
          "Je connais une app qui pourrait te plaire 😉",
          "Je te mets le lien juste en dessous",
        ],
        ...offerReady,
      },
    ]);
    const r = await runTurn(input(), deps);
    expect(deps.offerLinks).toHaveLength(1);
    const sent = deps.sender.messages();
    expect(sent[0]?.buttons).toBeUndefined();
    expect(sent[1]?.buttons).toEqual([
      [{ text: "Découvrir l'app", url: "https://go.goolink.eu/a/TEST00000001" }],
    ]);
    expect(r.offerSent).toEqual({
      subId: "TEST00000001",
      url: "https://go.goolink.eu/a/TEST00000001",
    });
    expect(r.sent[1]?.offerSubId).toBe("TEST00000001");
    expect(r.sent[0]?.offerSubId).toBeNull();
    expect(r.newStage).toBe("LINK_SENT");
    expect(r.stageChanges).toEqual([{ from: "CHAT", to: "LINK_SENT" }]);
    expect(r.events).toEqual([
      { type: "stage_changed", payload: { fromStage: "CHAT", toStage: "LINK_SENT" } },
      { type: "offer_sent", payload: { subId: "TEST00000001", offerSends: 1 } },
    ]);
  });

  it("visuel de l'offre : photo + légende + bouton", async () => {
    const { deps } = setup([
      { messages: ["Regarde, c'est l'app dont je te parlais 😉"], ...offerReady },
    ]);
    await runTurn(input({ persona: fakePersona({ offerMediaAssetId: "media-1" }) }), deps);
    expect(deps.sender.messages()).toEqual([
      expect.objectContaining({
        kind: "media",
        mediaAssetId: "media-1",
        text: "Regarde, c'est l'app dont je te parlais 😉",
        buttons: [[{ text: "Découvrir l'app", url: "https://go.goolink.eu/a/TEST00000001" }]],
      }),
    ]);
  });

  it("aucun lien : trop tôt, intérêt trop bas, nombre d'envois atteint, offre absente", async () => {
    const cases: Partial<TurnInput>[] = [
      { conversation: fakeConversation({ memberMessages: 2 }) },
      { conversation: fakeConversation({ offerSends: 2 }) },
      { persona: fakePersona({ hasOffer: false }) },
    ];
    for (const c of cases) {
      const { deps } = setup([{ messages: ["Tu veux voir l'app ? 😉"], ...offerReady }]);
      const r = await runTurn(input(c), deps);
      expect(deps.offerLinks).toHaveLength(0);
      expect(r.offerSent).toBeNull();
    }
    const { deps } = setup([
      { messages: ["Tu veux voir l'app ? 😉"], send_offer: true, style_update: { interest: 3 } },
    ]);
    expect((await runTurn(input(), deps)).offerSent).toBeNull();
    expect(deps.offerLinks).toHaveLength(0);
  });

  it("un sub-ID par envoi : deux envois = deux appels à createOfferLink, deux sub-ID différents", async () => {
    const { deps } = setup([
      { messages: ["Voilà l'app 😉"], ...offerReady },
      { messages: ["Je te le remets juste en dessous"], ...offerReady },
    ]);
    const first = await runTurn(input(), deps);
    const second = await runTurn(
      input({ conversation: fakeConversation({ stage: "LINK_SENT", offerSends: 1 }) }),
      deps,
    );
    expect(deps.offerLinks.map((l) => l.subId)).toEqual(["TEST00000001", "TEST00000002"]);
    expect(first.offerSent?.subId).not.toBe(second.offerSent?.subId);
    expect(second.events).toContainEqual({
      type: "offer_sent",
      payload: { subId: "TEST00000002", offerSends: 2 },
    });
  });

  it("lien impossible à créer : message envoyé sans bouton", async () => {
    const { deps } = setup([{ messages: ["Voilà l'app 😉"], ...offerReady }], {
      offerBaseUrl: null,
    });
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("replied");
    expect(r.offerSent).toBeNull();
    expect(deps.sender.messages()[0]?.buttons).toBeUndefined();
  });
});

describe("runTurn : mineurs", () => {
  it("âge déclaré : arrêt poli avant tout appel, aucun lien, conversation fermée", async () => {
    const { llm, deps } = setup([{ messages: ["x"], ...offerReady }]);
    const r = await runTurn(input({ inbound: [{ text: "salut" }, { text: "j'ai 16 ans" }] }), deps);
    expect(llm.calls).toBe(0);
    expect(r.outcome).toBe("minor");
    expect(deps.sender.messages()).toEqual([
      expect.objectContaining({ kind: "text", text: fixedText("fr", "minorStop") }),
    ]);
    expect(deps.sender.messages()[0]?.buttons).toBeUndefined();
    expect(deps.offerLinks).toHaveLength(0);
    expect(r.newStage).toBe("CLOSED");
    expect(r.closeReason).toBe("MINOR");
    expect(r.nextFollowUpAt).toBeNull();
    expect(r.events).toEqual([
      { type: "minor", payload: { source: "code", age: 16 } },
      { type: "stage_changed", payload: { fromStage: "CHAT", toStage: "CLOSED" } },
    ]);
    expect(deps.usages).toHaveLength(0);
  });

  it("soupçon du modèle (minor_suspected) : même arrêt, même si le modèle proposait le lien", async () => {
    const { deps } = setup([
      { messages: ["Tu veux le lien ?"], ...offerReady, minor_suspected: true },
    ]);
    const r = await runTurn(input({ inbound: [{ text: "je suis en 3e au collège" }] }), deps);
    expect(r.outcome).toBe("minor");
    expect(deps.offerLinks).toHaveLength(0);
    expect(deps.sender.messages().map((m) => m.text)).toEqual([fixedText("fr", "minorStop")]);
    expect(r.events[0]).toEqual({ type: "minor", payload: { source: "model", age: null } });
  });

  it("langue de la personne pour l'arrêt", async () => {
    const { deps } = setup([]);
    await runTurn(
      input({
        conversation: fakeConversation({ memberLanguageCode: "en" }),
        inbound: [{ text: "I'm 15" }],
      }),
      deps,
    );
    expect(deps.sender.messages()[0]?.text).toBe(fixedText("en", "minorStop"));
  });

  it("conversation déjà marquée mineure ou fermée : rien du tout", async () => {
    const { llm, deps } = setup([{ messages: ["x"] }]);
    expect(
      (await runTurn(input({ conversation: fakeConversation({ isMinor: true }) }), deps)).outcome,
    ).toBe("aborted");
    expect(
      (await runTurn(input({ conversation: fakeConversation({ stage: "CLOSED" }) }), deps)).outcome,
    ).toBe("aborted");
    expect(llm.calls).toBe(0);
    expect(deps.sender.log).toHaveLength(0);
  });
});

describe("runTurn : plafond", () => {
  it("plafond € atteint : aucun appel, aucun message, événement cap_reached", async () => {
    const { llm, deps } = setup([{ messages: ["x"] }], { capReached: true });
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("skipped_cap");
    expect(llm.calls).toBe(0);
    expect(deps.sender.log).toHaveLength(0);
    expect(r.events).toEqual([{ type: "cap_reached", payload: {} }]);
  });

  it("plafond vérifié avant CHAQUE appel (atteint avant le nouvel essai : rien n'est envoyé)", async () => {
    let checks = 0;
    const { llm, deps } = setup([{ messages: ["**gras**"] }, { messages: ["ok"] }], {
      capReached: () => ++checks > 2,
    });
    const r = await runTurn(input(), deps);
    expect(llm.calls).toBe(1);
    expect(r.outcome).toBe("skipped_cap");
    expect(deps.sender.messages()).toHaveLength(0);
  });
});

describe("runTurn : contrôle, nouvel essai unique, repli sûr", () => {
  it("réponse refusée → un seul nouvel essai avec la consigne de correction, puis envoi", async () => {
    const { llm, deps } = setup([
      { messages: ["**Coucou** va sur www.app.fr"] },
      { messages: ["Coucou 😊"] },
    ]);
    const r = await runTurn(input(), deps);
    expect(llm.calls).toBe(2);
    expect(systemOf(llm.requests[0])).not.toContain("NOUVEL ESSAI");
    expect(systemOf(llm.requests[1])).toContain("NOUVEL ESSAI");
    expect(systemOf(llm.requests[1])).toContain("Texte brut seulement");
    expect(systemOf(llm.requests[1])).toContain("Aucun lien, aucune adresse de site");
    expect(r.outcome).toBe("replied");
    expect(deps.sender.messages().map((m) => m.text)).toEqual(["Coucou 😊"]);
    expect(r.rejected).toEqual(["markdown", "link"]);
    expect(deps.usages.map((u) => [u.attempt, u.ok, u.error?.split(" ")[0] ?? null])).toEqual([
      [1, false, "rejected:markdown,link"],
      [2, true, null],
    ]);
  });

  it("JSON illisible puis réponse correcte", async () => {
    const { deps } = setup(["Salut !", { messages: ["Salut 😊"] }]);
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("replied");
    expect(r.rejected).toEqual(["invalid_output"]);
  });

  it("deux refus au premier message → présentation fixe, jamais de lien", async () => {
    const { llm, deps } = setup([
      { messages: ["Salut"], ...offerReady },
      { messages: ["Hello"], ...offerReady },
    ]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({ stage: "WELCOME", isFirstAssistantTurn: true }),
        inbound: [{ text: "/start" }],
      }),
      deps,
    );
    expect(llm.calls).toBe(2);
    expect(r.outcome).toBe("replied");
    expect(deps.sender.messages()).toEqual([
      expect.objectContaining({
        kind: "text",
        text: "Moi c'est Léa, l'assistante du canal 😉 Comment tu vas ?",
      }),
    ]);
    expect(deps.sender.messages()[0]?.buttons).toBeUndefined();
    expect(r.sent[0]?.fixedKey).toBe("intro");
    expect(r.model).toBeNull();
    expect(r.events).toContainEqual({
      type: "ai_failed",
      payload: {
        code: "invalid_output",
        attempts: 2,
        neutral: false,
        final: false,
        fallback: "intro",
      },
    });
  });

  it("question « es-tu un bot ? » et deux dénis → aveu fixe", async () => {
    const { deps } = setup([
      { messages: ["Non je suis une vraie fille 😘"] },
      { messages: ["Mais non voyons, pas un bot"] },
    ]);
    const r = await runTurn(input({ inbound: [{ text: "t'es un bot ?" }] }), deps);
    // 2e réponse : « pas un bot » contient le mot « bot » mais n'est pas un aveu, et reste un déni
    expect(r.rejected).toEqual([
      "denies_assistant",
      "missing_assistant_admission",
      "denies_assistant",
      "missing_assistant_admission",
    ]);
    expect(deps.sender.messages().map((m) => m.text)).toEqual([
      fixedText("fr", "isAssistant", { name: "Léa", gender: "F" }),
    ]);
    expect(r.sent[0]?.fixedKey).toBe("isAssistant");
  });

  it("premier message ET question « vraie personne ou bot ? » : l'aveu fixe (qui vaut aussi présentation)", async () => {
    const { deps } = setup([{ messages: ["**Coucou**"] }, { messages: ["**Coucou**"] }]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({ stage: "WELCOME", isFirstAssistantTurn: true }),
        inbound: [{ text: "t'es une vraie personne ou un bot ?" }],
      }),
      deps,
    );
    const text = fixedText("fr", "isAssistant", { name: "Léa", gender: "F" });
    expect(deps.sender.messages().map((m) => m.text)).toEqual([text]);
    expect(text).toContain("Léa");
    expect(text).toContain("assistante");
    expect(r.sent[0]?.fixedKey).toBe("isAssistant");
  });

  it("« t'es une IA ? » → « Je suis Léa, pas une IA 😉 » est refusé (déni), jamais envoyé", async () => {
    const denial = { messages: ["Je suis Léa, pas une IA 😉 Et toi tu fais quoi ce soir ?"] };
    const { deps } = setup([denial, denial]);
    const r = await runTurn(input({ inbound: [{ text: "t'es une IA ?" }] }), deps);
    expect(r.rejected).toContain("denies_assistant");
    expect(r.rejected).toContain("missing_assistant_admission");
    expect(deps.sender.messages().map((m) => m.text)).toEqual([
      fixedText("fr", "isAssistant", { name: "Léa", gender: "F" }),
    ]);
  });

  it("« t'es une personne ? » → « Bien sûr que oui 😘 » est refusé (aveu manquant)", async () => {
    const { deps } = setup([
      { messages: ["Bien sûr que oui 😘"] },
      { messages: ["Oui, je suis Léa, l'assistante virtuelle du canal : une IA 😊"] },
    ]);
    const r = await runTurn(input({ inbound: [{ text: "t'es une personne ?" }] }), deps);
    expect(r.rejected).toEqual(["missing_assistant_admission"]);
    expect(deps.sender.messages().map((m) => m.text)).toEqual([
      "Oui, je suis Léa, l'assistante virtuelle du canal : une IA 😊",
    ]);
  });

  it("deux refus ailleurs → « je reviens vers toi » et nouvel essai dans 5 min", async () => {
    const { deps } = setup([
      { messages: ["3000 filles t'attendent"] },
      { messages: ["9000 filles t'attendent"] },
    ]);
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("failed");
    expect(r.retryAt).toEqual(new Date(deps.now().getTime() + RETRY_LATER_MS));
    expect(r.neutralSent).toBe(true);
    expect(deps.sender.messages().map((m) => m.text)).toEqual([fixedText("fr", "retryLater")]);
    expect(r.events).toContainEqual(
      expect.objectContaining({
        type: "ai_failed",
        payload: expect.objectContaining({ code: "invalid_output" }),
      }),
    );
  });
});

describe("runTurn : pannes de l'IA", () => {
  it("429 puis réussite : nouvel essai après 2 s sur le même modèle", async () => {
    const { llm, deps } = setup([
      new VeniceError("rate_limit", "trop de requêtes", { status: 429 }),
      { messages: ["ok 🙂"] },
    ]);
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("replied");
    expect(llm.requests.map((q) => q.model)).toEqual([
      "venice-uncensored-role-play",
      "venice-uncensored-role-play",
    ]);
    expect(deps.sleeps[0]).toBe(2000);
    expect(deps.usages.map((u) => [u.ok, u.error, u.inputTokens])).toEqual([
      [false, "rate_limit", 0],
      [true, null, 800],
    ]);
  });

  it("deux pannes passagères → modèle de repli", async () => {
    const { llm, deps } = setup([
      new VeniceError("server", "503", { status: 503 }),
      new VeniceError("timeout", "délai dépassé"),
      { messages: ["ok 🙂"] },
    ]);
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("replied");
    expect(llm.requests.map((q) => q.model)).toEqual([
      "venice-uncensored-role-play",
      "venice-uncensored-role-play",
      "venice-uncensored-1-2",
    ]);
    expect(r.model).toBe("venice-uncensored-1-2");
  });

  it("modèle inconnu → modèle de repli directement (sans attendre)", async () => {
    const { llm, deps } = setup([
      new VeniceError("bad_model", "inconnu", { status: 404 }),
      { messages: ["ok 🙂"] },
    ]);
    await runTurn(input(), deps);
    expect(llm.requests.map((q) => q.model)).toEqual([
      "venice-uncensored-role-play",
      "venice-uncensored-1-2",
    ]);
    expect(deps.sleeps[0]).not.toBe(2000);
  });

  it("tout échoue → « je reviens vers toi » une fois par heure au plus, nouvel essai dans 5 min, ai_failed", async () => {
    const fail = () => new VeniceError("server", "500", { status: 500 });
    const { llm, deps } = setup([fail(), fail(), fail()]);
    const r = await runTurn(input(), deps);
    expect(llm.calls).toBe(3);
    expect(r.outcome).toBe("failed");
    expect(r.neutralSent).toBe(true);
    expect(deps.sender.messages().map((m) => m.text)).toEqual([fixedText("fr", "retryLater")]);
    expect(r.retryAt).toEqual(new Date(deps.now().getTime() + RETRY_LATER_MS));
    expect(r.events).toEqual([
      {
        type: "ai_failed",
        payload: { code: "server", attempts: 3, neutral: true, final: false, pass: 1 },
      },
    ]);
    expect(r.retryCount).toBe(1);
    expect(deps.usages).toHaveLength(3);

    const again = setup([fail(), fail(), fail()]);
    const r2 = await runTurn(
      input({
        conversation: fakeConversation({ lastNeutralAt: new Date(START.getTime() - 30 * 60_000) }),
      }),
      again.deps,
    );
    expect(r2.neutralSent).toBe(false);
    expect(again.deps.sender.messages()).toHaveLength(0);
    expect(r2.retryAt).toBeDefined();
  });

  it("panne longue : « je reviens vers toi » une seule fois tant que la personne n'a pas réécrit, 3 passages au plus puis échec définitif", async () => {
    const fail = () => new VeniceError("server", "500", { status: 500 });
    const lastInboundAt = new Date(START.getTime() - 60_000);
    // 1er passage : message neutre, nouvel essai dans 5 min
    const p1 = setup([fail(), fail(), fail()]);
    const r1 = await runTurn(
      input({ conversation: fakeConversation({ lastInboundAt }), retryCount: 0 }),
      p1.deps,
    );
    expect(r1.neutralSent).toBe(true);
    expect(r1.retryCount).toBe(1);
    const neutralAt = p1.deps.now();
    // 2e passage plus d'une heure après : la personne n'a pas réécrit → aucun nouveau message neutre
    const p2 = setup([fail(), fail(), fail()], {
      startAt: new Date(neutralAt.getTime() + 66 * 60_000),
    });
    const r2 = await runTurn(
      input({
        conversation: fakeConversation({ lastInboundAt, lastNeutralAt: neutralAt }),
        retryCount: r1.retryCount,
      }),
      p2.deps,
    );
    expect(r2.neutralSent).toBe(false);
    expect(p2.deps.sender.messages()).toHaveLength(0);
    expect(r2.retryAt).toBeDefined();
    expect(r2.retryCount).toBe(2);
    // 3e passage : échec définitif, ni message ni nouvel essai
    const p3 = setup([fail(), fail(), fail()], {
      startAt: new Date(neutralAt.getTime() + 126 * 60_000),
    });
    const r3 = await runTurn(
      input({
        conversation: fakeConversation({ lastInboundAt, lastNeutralAt: neutralAt }),
        retryCount: r2.retryCount,
      }),
      p3.deps,
    );
    expect(r3.outcome).toBe("failed");
    expect(r3.retryAt).toBeUndefined();
    expect(r3.retryCount).toBeUndefined();
    expect(p3.deps.sender.messages()).toHaveLength(0);
    expect(r3.events).toEqual([
      {
        type: "ai_failed",
        payload: { code: "server", attempts: 3, neutral: false, final: true, pass: 3 },
      },
    ]);
  });

  it("la personne a réécrit depuis le message neutre (et plus d'une heure a passé) : un nouveau message neutre est permis", async () => {
    const fail = () => new VeniceError("timeout", "délai");
    const { deps } = setup([fail(), fail(), fail()]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({
          lastNeutralAt: new Date(START.getTime() - 2 * 3_600_000),
          lastInboundAt: new Date(START.getTime() - 60_000),
        }),
      }),
      deps,
    );
    expect(r.neutralSent).toBe(true);
  });

  it.each(["bad_request", "content_policy", "bad_model"] as const)(
    "%s sur les deux modèles : échec définitif tout de suite, sans message ni nouvel essai",
    async (code) => {
      const err = () => new VeniceError(code, code, { status: 400 });
      const { llm, deps } = setup([err(), err()]);
      const r = await runTurn(input(), deps);
      expect(llm.calls).toBe(2);
      expect(r.outcome).toBe("failed");
      expect(r.retryAt).toBeUndefined();
      expect(deps.sender.messages()).toHaveLength(0);
      expect(r.events).toEqual([
        { type: "ai_failed", payload: { code, attempts: 2, neutral: false, final: true, pass: 1 } },
      ]);
    },
  );

  it("panne au premier message : présentation fixe (jamais « je reviens vers toi » en premier), sans lien ni nouvel essai", async () => {
    const fail = () => new VeniceError("server", "503", { status: 503 });
    const { deps } = setup([fail(), fail(), fail()]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({ stage: "WELCOME", isFirstAssistantTurn: true }),
        inbound: [{ text: "/start tk01" }],
      }),
      deps,
    );
    expect(r.outcome).toBe("replied");
    expect(deps.sender.messages().map((m) => m.text)).toEqual([
      fixedText("fr", "intro", { name: "Léa", gender: "F" }),
    ]);
    expect(deps.sender.messages()[0]?.buttons).toBeUndefined();
    expect(r.sent[0]?.fixedKey).toBe("intro");
    expect(r.neutralSent).toBe(false);
    expect(r.retryAt).toBeUndefined();
    expect(r.newStage).toBe("WELCOME");
    expect(r.events).toContainEqual({
      type: "ai_failed",
      payload: { code: "server", attempts: 3, neutral: false, final: false, fallback: "intro" },
    });
  });

  it.each(["auth", "balance", "no_key"] as const)(
    "%s → aucun message, aucun nouvel essai, ai_failed",
    async (code) => {
      const { llm, deps } = setup([new VeniceError(code, code), { messages: ["ok"] }]);
      const r = await runTurn(input(), deps);
      expect(llm.calls).toBe(1);
      expect(r.outcome).toBe("failed");
      expect(r.retryAt).toBeUndefined();
      expect(deps.sender.messages()).toHaveLength(0);
      expect(r.events).toEqual([
        { type: "ai_failed", payload: { code, attempts: 1, neutral: false, final: true } },
      ]);
      expect(deps.usages).toEqual([
        expect.objectContaining({ ok: false, error: code, costEur: 0 }),
      ]);
    },
  );
});

describe("runTurn : reprise par l'équipe et messages regroupés", () => {
  it("reprise humaine avant l'envoi : rien n'est envoyé", async () => {
    const { deps } = setup([{ messages: ["Coucou 😊"] }], { beforeSend: [{ abort: true }] });
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("aborted");
    expect(deps.sender.messages()).toHaveLength(0);
    expect(deps.usages).toHaveLength(1);
  });

  it("messages arrivés pendant la préparation : regroupés et réponse refaite UNE fois", async () => {
    const { llm, deps } = setup(
      [
        { messages: ["Coucou 😊"] },
        { messages: ["Ah Lyon, j'adore cette ville !"] },
        { messages: ["jamais"] },
      ],
      {
        beforeSend: [
          { newInbound: [{ id: "in-2", text: "je suis à Lyon" }] },
          { newInbound: [{ id: "in-3", text: "et toi ?" }] },
        ],
      },
    );
    const r = await runTurn(input(), deps);
    expect(llm.calls).toBe(2);
    expect(llm.requests[1]?.messages.at(-1)).toEqual({
      role: "user",
      content: "Salut, ça va ?\nje suis à Lyon",
    });
    expect(deps.sender.messages().map((m) => m.text)).toEqual(["Ah Lyon, j'adore cette ville !"]);
    expect(r.inboundUsed.map((m) => m.id)).toEqual(["in-1", "in-2"]);
    expect(r.deferredInbound.map((m) => m.id)).toEqual(["in-3"]);
    expect(deps.beforeSendCalls()).toBe(2);
  });

  it("âge déclaré dans un message arrivé pendant la préparation : arrêt mineur", async () => {
    const { llm, deps } = setup([{ messages: ["Coucou 😊"] }], {
      beforeSend: [{ newInbound: [{ text: "au fait j'ai 15 ans" }] }],
    });
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("minor");
    expect(llm.calls).toBe(1);
    expect(deps.sender.messages().map((m) => m.text)).toEqual([fixedText("fr", "minorStop")]);
  });
});

describe("runTurn : âge déclaré après la régénération", () => {
  it("âge déclaré dans un message arrivé après la régénération : arrêt mineur, aucun lien", async () => {
    const { llm, deps } = setup(
      [
        { messages: ["Tu veux voir l'app ? 😉"], ...offerReady },
        { messages: ["Je te mets le lien juste en dessous"], ...offerReady },
      ],
      {
        beforeSend: [
          { newInbound: [{ id: "in-2", text: "ça a l'air cool" }] },
          { newInbound: [{ id: "in-3", text: "au fait j'ai 16 ans" }] },
        ],
      },
    );
    const r = await runTurn(input(), deps);
    expect(llm.calls).toBe(2);
    expect(r.outcome).toBe("minor");
    expect(r.closeReason).toBe("MINOR");
    expect(r.offerSent).toBeNull();
    expect(deps.offerLinks).toHaveLength(0);
    expect(deps.sender.messages().map((m) => m.text)).toEqual([fixedText("fr", "minorStop")]);
    expect(deps.sender.messages()[0]?.buttons).toBeUndefined();
    expect(r.inboundUsed.map((m) => m.id)).toEqual(["in-1", "in-2", "in-3"]);
    expect(r.deferredInbound).toEqual([]);
    expect(r.events[0]).toEqual({ type: "minor", payload: { source: "code", age: 16 } });
  });

  it("âge déclaré pendant une panne : arrêt mineur, jamais « je reviens vers toi »", async () => {
    const fail = () => new VeniceError("server", "500");
    const { deps } = setup([fail(), fail(), fail()], {
      beforeSend: [{ newInbound: [{ id: "in-2", text: "j'ai 15 ans" }] }],
    });
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("minor");
    expect(r.neutralSent).toBe(false);
    expect(r.retryAt).toBeUndefined();
    expect(deps.sender.messages().map((m) => m.text)).toEqual([fixedText("fr", "minorStop")]);
  });
});

describe("runTurn : échecs d'envoi", () => {
  it("bot bloqué au premier message : le tour s'arrête, conversation à fermer", async () => {
    const sender = createFakeSender({
      results: [
        {
          ok: false,
          blocked: true,
          unreachable: false,
          error: "Forbidden: bot was blocked by the user",
        },
      ],
    });
    const { deps } = setup([{ messages: ["Un", "Deux"] }], { sender });
    const r = await runTurn(input(), deps);
    expect(sender.messages()).toHaveLength(1);
    expect(r.outcome).toBe("failed");
    expect(r.closeReason).toBe("BLOCKED");
    expect(r.nextFollowUpAt).toBeNull();
  });

  it("échec sur le dernier message porteur du lien : lien non compté comme envoyé", async () => {
    const sender = createFakeSender({
      results: [
        undefined,
        { ok: false, blocked: false, unreachable: true, error: "chat not found" },
      ],
    });
    const { deps } = setup(
      [{ messages: ["Voilà l'app", "Je te mets le lien en dessous"], ...offerReady }],
      { sender },
    );
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("replied");
    expect(r.sent).toHaveLength(1);
    expect(r.offerSent).toBeNull();
    expect(r.unsentOfferSubId).toBe("TEST00000001");
    expect(r.closeReason).toBe("UNREACHABLE");
    expect(r.events.some((e) => e.type === "offer_sent")).toBe(false);
  });
});

describe("runTurn : relances et résumé", () => {
  it("relance : un message doux, purpose FOLLOW_UP, étape FOLLOW_UP, compteur + 1, 2e relance 24 h plus tard au moins", async () => {
    const { llm, deps } = setup([{ messages: ["Hey, tu as pu regarder ? 😊"], ...offerReady }]);
    const r = await runTurn(
      input({
        kind: "follow_up",
        inbound: [{ text: "ne doit pas être lu" }],
        conversation: fakeConversation({
          stage: "LINK_SENT",
          offerSends: 1,
          lastAssistantAt: new Date(START.getTime() - 24 * 3_600_000),
        }),
        persona: fakePersona({ followUpAfterHours: 6 }),
      }),
      deps,
    );
    expect(systemOf(llm.requests[0])).toContain("RELANCE N° 1");
    expect(llm.requests[0]?.messages.some((m) => m.content.includes("ne doit pas être lu"))).toBe(
      false,
    );
    expect(r.outcome).toBe("replied");
    expect(deps.offerLinks).toHaveLength(0);
    expect(r.newStage).toBe("FOLLOW_UP");
    expect(r.followUpCount).toBe(1);
    expect(r.nextFollowUpAt).toEqual(new Date(deps.now().getTime() + 24 * 3_600_000));
    expect(deps.usages[0]?.purpose).toBe("FOLLOW_UP");
  });

  it("relance : pas de message neutre en cas de panne", async () => {
    const fail = () => new VeniceError("server", "500");
    const { deps } = setup([fail(), fail(), fail()]);
    const r = await runTurn(input({ kind: "follow_up", inbound: [] }), deps);
    expect(r.outcome).toBe("failed");
    expect(deps.sender.messages()).toHaveLength(0);
  });

  it("2e relance envoyée : plus aucune relance prévue", async () => {
    const { deps } = setup([{ messages: ["Je te laisse tranquille, belle soirée 😊"] }]);
    const r = await runTurn(
      input({
        kind: "follow_up",
        inbound: [],
        conversation: fakeConversation({ stage: "FOLLOW_UP", followUpCount: 1 }),
      }),
      deps,
    );
    expect(r.followUpCount).toBe(2);
    expect(r.nextFollowUpAt).toBeNull();
  });

  it("résumé roulant demandé : appel SUMMARY au modèle de repli après les envois ; un échec est sans conséquence", async () => {
    const history = [
      { direction: "IN" as const, author: "MEMBER" as const, text: "je m'appelle Marc" },
    ];
    const ok = setup([{ messages: ["Top 😊"] }, "Il s'appelle Marc."]);
    const r = await runTurn(input({ needsSummary: true, summaryMessages: history }), ok.deps);
    expect(ok.llm.requests[1]?.model).toBe("venice-uncensored-1-2");
    expect(r.summary).toBe("Il s'appelle Marc.");
    expect(ok.deps.usages.map((u) => u.purpose)).toEqual(["REPLY", "SUMMARY"]);

    const ko = setup([{ messages: ["Top 😊"] }, new VeniceError("server", "500")]);
    const r2 = await runTurn(input({ needsSummary: true, summaryMessages: history }), ko.deps);
    expect(r2.outcome).toBe("replied");
    expect(r2.summary).toBeUndefined();
    expect(ko.deps.usages.map((u) => [u.purpose, u.ok])).toEqual([
      ["REPLY", true],
      ["SUMMARY", false],
    ]);
  });

  it("bouton « Tester » (createTestTurnDeps) : vrai plafond vérifié avant chaque appel, vrai prix, coût écrit en TEST", async () => {
    const llm = createFakeLlm([{ messages: ["**gras**"] }, { messages: ["Coucou 😊"] }], {
      costUsd: 0.01,
    });
    const written: UsageRecord[] = [];
    let capCalls = 0;
    const deps = createTestTurnDeps({
      llm,
      capReached: async () => {
        capCalls++;
        return false;
      },
      recordUsage: async (u) => {
        written.push(u);
      },
      costEur: (_model, _usage, costUsd) => (costUsd ?? 0) * 2,
    });
    const r = await runTurn(input(), deps);
    expect(r.outcome).toBe("replied");
    expect(capCalls).toBe(3); // avant le tour, puis avant chacun des deux appels
    expect(written.map((u) => [u.purpose, u.costEur])).toEqual([
      ["TEST", 0.02],
      ["TEST", 0.02],
    ]);
    expect(deps.usages).toEqual(written);

    const capped = createTestTurnDeps({
      llm: createFakeLlm([{ messages: ["x"] }]),
      capReached: async () => true,
      recordUsage: async () => {},
      costEur: () => 0,
    });
    expect((await runTurn(input(), capped)).outcome).toBe("skipped_cap");
  });

  it("bouton « Tester » : coût compté en TEST", async () => {
    const { deps } = setup([{ messages: ["Coucou"] }]);
    await runTurn(input({ usagePurpose: "TEST" }), deps);
    expect(deps.usages[0]?.purpose).toBe("TEST");
  });
});

describe("runTurn : corrections après relecture", () => {
  it("relance en préparation et la personne écrit : rien ne part, ses messages sont rendus pour un vrai tour", async () => {
    const { llm, deps } = setup(
      [{ messages: ["Hey, tu as pu regarder ? 😊"] }, { messages: ["jamais"] }],
      {
        beforeSend: [
          { newInbound: [{ id: "in-9", text: "attends, t'es un bot ou une vraie personne ?" }] },
        ],
      },
    );
    const r = await runTurn(
      input({
        kind: "follow_up",
        inbound: [],
        conversation: fakeConversation({ stage: "LINK_SENT", offerSends: 1 }),
      }),
      deps,
    );
    expect(r.outcome).toBe("aborted");
    expect(llm.calls).toBe(1);
    expect(deps.sender.messages()).toHaveLength(0);
    expect(r.deferredInbound.map((m) => m.id)).toEqual(["in-9"]);
    expect(r.inboundUsed).toEqual([]);
  });

  it("« arrête de m'écrire » au milieu d'un message : réponse polie, aucune relance programmée", async () => {
    const { deps } = setup([
      { messages: ["D'accord, je te laisse tranquille. Tu peux taper /stop 🙏"] },
    ]);
    const r = await runTurn(
      input({
        inbound: [{ id: "in-1", text: "arrête de m'écrire, j'en ai marre" }],
        conversation: fakeConversation({ stage: "CHAT" }),
      }),
      deps,
    );
    expect(r.outcome).toBe("replied");
    expect(r.nextFollowUpAt).toBeNull();
  });

  it("textes fixes annoncés à l'envoi : arrêt mineur et « je reviens vers toi » (pas un tour de réponse)", async () => {
    const minor = setup([{ messages: ["jamais"] }]);
    await runTurn(input({ inbound: [{ id: "in-1", text: "j'ai 15 ans" }] }), minor.deps);
    expect(minor.deps.sender.fixedKeys()).toEqual(["minorStop"]);
    const reply = setup([{ messages: ["Coucou 😊", "Et toi ?"] }]);
    await runTurn(input(), reply.deps);
    expect(reply.deps.sender.fixedKeys()).toEqual([null, null]);
  });

  it("résumé laissé à l'appelant (deferSummary) : aucun appel dans le tour, summarizeAfterTurn le fait ensuite", async () => {
    const history = [
      { direction: "IN" as const, author: "MEMBER" as const, text: "je m'appelle Marc" },
    ];
    const { llm, deps } = setup([{ messages: ["Top 😊"] }, "Il s'appelle Marc."]);
    const turn = input({ needsSummary: true, summaryMessages: history, deferSummary: true });
    const r = await runTurn(turn, deps);
    expect(llm.calls).toBe(1);
    expect(r.summary).toBeUndefined();
    expect(await summarizeAfterTurn(turn, deps)).toBe("Il s'appelle Marc.");
    expect(deps.usages.map((u) => u.purpose)).toEqual(["REPLY", "SUMMARY"]);
  });

  it("question « bot ? » restée sans aveu dans l'historique : l'aveu est encore exigé", async () => {
    const { llm, deps } = setup([
      { messages: ["Haha devine 😏"] },
      { messages: ["Je suis Léa, l'assistante virtuelle du canal : une IA 😊"] },
    ]);
    const r = await runTurn(
      input({
        history: [
          { direction: "IN", author: "MEMBER", text: "t'es un bot ?" },
          { direction: "OUT", author: "TEAM", text: "On en parle plus tard 😉" },
        ],
        inbound: [{ id: "in-2", text: "sûr ?" }],
        conversation: fakeConversation({ stage: "CHAT" }),
      }),
      deps,
    );
    expect(llm.calls).toBe(2);
    expect(r.rejected).toContain("missing_assistant_admission");
    expect(deps.sender.messages().map((m) => m.text)).toEqual([
      "Je suis Léa, l'assistante virtuelle du canal : une IA 😊",
    ]);
  });

  it("messages énormes en rafale : chaque message coupé, 10 messages du tour au plus envoyés au modèle", async () => {
    const big = "a".repeat(4000);
    const { llm, deps } = setup([{ messages: ["Waouh, beaucoup de a 😄"] }]);
    await runTurn(
      input({
        inbound: Array.from({ length: 15 }, (_, i) => ({ id: `in-${i}`, text: `${i} ${big}` })),
        conversation: fakeConversation({ stage: "CHAT" }),
      }),
      deps,
    );
    const user = llm.requests[0]!.messages.filter((m) => m.role === "user");
    const total = user.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThan(5000);
    expect(user.at(-1)!.content).toContain("plus anciens non repris");
  });
});
