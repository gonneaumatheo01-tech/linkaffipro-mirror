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

const PHOTOS = [1, 2, 3, 4, 5].map((slot) => ({
  slot,
  assetId: `asset-${slot}`,
  description: `photo ${slot}`,
}));

const girlPersona = (over: Record<string, unknown> = {}) =>
  fakePersona({ identity: "GIRL", illusion: true, hasOffer: true, flirtPhotos: PHOTOS, ...over });

// ─────────────────────────────────────────────────
//  TÂCHE 1 : pseudo donné → fin de conversation
// ─────────────────────────────────────────────────

describe("pseudo donné → fin de conversation", () => {
  // Les anciennes phases LINKED et OFFER sont désormais silencieuses (le tunnel scripté remplace la série).
  // Le pseudo n'est plus détecté sur ces phases : la conversation est muette.
  it("pseudo sur ancienne phase LINKED → silence (le tunnel remplace)", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({ stage: "LINK_SENT", offerSends: 1, facts: [], assistantTurns: 8, memberMessages: 8 });
    conv.flirt = { step: "LINKED", teases: 0 };

    const res = await runTurn(
      { kind: "reply", persona: girlPersona(), settings: fakeSettings(), conversation: conv, history: [], inbound: [{ text: "mon pseudo c'est darknight42" }] },
      deps,
    );
    expect(res.outcome).toBe("aborted");
    expect(res.sent).toHaveLength(0);
    expect(llm.calls).toBe(0);
  });

  it("pseudo sur ancienne phase OFFER → silence", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({ stage: "CHAT", offerSends: 0, facts: [], assistantTurns: 5, memberMessages: 5 });
    conv.flirt = { step: "OFFER", teases: 300 };

    const res = await runTurn(
      { kind: "reply", persona: girlPersona(), settings: fakeSettings(), conversation: conv, history: [], inbound: [{ text: "mon pseudo c'est max_le_bg" }] },
      deps,
    );
    expect(res.outcome).toBe("aborted");
    expect(res.sent).toHaveLength(0);
    expect(llm.calls).toBe(0);
  });

  it("tour suivant après pseudo → aborté, plus de réponse", async () => {
    const llm = createFakeLlm(() => fakeOutput({ messages: ["coucou !"] }));
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({
      stage: "CONVERTED",
      offerSends: 1,
      facts: ["pseudo: darknight42"],
      assistantTurns: 9,
      memberMessages: 9,
    });

    const res = await runTurn(
      {
        kind: "reply",
        persona: girlPersona(),
        settings: fakeSettings(),
        conversation: conv,
        history: [],
        inbound: [{ text: "hey t'es la ?" }],
      },
      deps,
    );

    expect(res.outcome).toBe("aborted");
    expect(res.sent).toHaveLength(0);
  });

  it("persona non GIRL → pseudo ignoré, conversation continue", async () => {
    const llm = createFakeLlm(() =>
      fakeOutput({
        messages: ["merci !"],
        memory_facts: ["pseudo: darknight42"],
      }),
    );
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({
      stage: "LINK_SENT",
      offerSends: 1,
      facts: [],
      assistantTurns: 8,
      memberMessages: 8,
    });

    const res = await runTurn(
      {
        kind: "reply",
        persona: fakePersona({ identity: "ASSISTANT", hasOffer: true }),
        settings: fakeSettings(),
        conversation: conv,
        history: [],
        inbound: [{ text: "mon pseudo c'est darknight42" }],
      },
      deps,
    );

    expect(res.outcome).toBe("replied");
    expect(res.sent.map((s) => s.text)).not.toEqual(["bon bah on se parle là-bas 😊"]);
    expect(res.closeReason).toBeNull();
  });
});

// ─────────────────────────────────────────────────
//  TÂCHE 4 : lien annoncé mais pas parti → lien armé
// ─────────────────────────────────────────────────

// « lien annoncé mais pas parti → lien armé » : testait des comportements de l'ancienne série (OFFER).
// Ces phases sont désormais silencieuses (le tunnel scripté remplace la série). Le lien part au T6 du tunnel,
// sans modèle. La couverture de l'armement du lien reste dans les tests unitaires de decideFlirt (flirt.test.ts).
