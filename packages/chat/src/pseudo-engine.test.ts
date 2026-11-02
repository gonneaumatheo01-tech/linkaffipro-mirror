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
import type { FlirtAction } from "./flirt";
import { ARMED_LINK_FACT } from "./pseudo";

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
  it("pseudo après le lien → message de fin, stage CONVERTED, closeReason PSEUDO", async () => {
    const llm = createFakeLlm(() =>
      fakeOutput({
        messages: ["ah cool tu t'es inscrit !"],
        action: "rien",
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
    conv.flirt = { step: "LINKED", teases: 0 };

    const res = await runTurn(
      {
        kind: "reply",
        persona: girlPersona(),
        settings: fakeSettings(),
        conversation: conv,
        history: [],
        inbound: [{ text: "mon pseudo c'est darknight42" }],
      },
      deps,
    );

    expect(res.outcome).toBe("replied");
    expect(res.sent.map((s) => s.text)).toEqual(["bon bah on se parle là-bas 😊"]);
    expect(res.newStage).toBe("CONVERTED");
    expect(res.closeReason).toBe("PSEUDO");
    expect(res.nextFollowUpAt).toBeNull();
    expect(res.facts).toContain("pseudo: darknight42");
  });

  it("pseudo AVANT le lien → lien forcé + message de fin", async () => {
    const llm = createFakeLlm(() =>
      fakeOutput({
        messages: ["ah trop bien !"],
        action: "rien",
        memory_facts: ["pseudo: max_le_bg"],
      }),
    );
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({
      stage: "CHAT",
      offerSends: 0,
      facts: [],
      assistantTurns: 5,
      memberMessages: 5,
    });
    conv.flirt = { step: "OFFER", teases: 300 };

    const res = await runTurn(
      {
        kind: "reply",
        persona: girlPersona(),
        settings: fakeSettings(),
        conversation: conv,
        history: [],
        inbound: [{ text: "mon pseudo c'est max_le_bg" }],
      },
      deps,
    );

    expect(res.outcome).toBe("replied");
    expect(res.sent.map((s) => s.text)).toEqual(["bon bah on se parle là-bas 😊"]);
    expect(res.offerSent).not.toBeNull();
    expect(res.newStage).toBe("CONVERTED");
    expect(res.closeReason).toBe("PSEUDO");
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

describe("lien annoncé mais pas parti → lien armé au tour suivant", () => {
  // Changé volontairement (tâche 6) : une annonce quand la série en est à l'app fait partir le lien dans le même tour.
  it("le lien annoncé quand la série en est à l'app part dans le même tour", async () => {
    const llm = createFakeLlm(() =>
      fakeOutput({
        messages: ["attends je t'envoie le lien"],
        action: "rien" as FlirtAction,
      }),
    );
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({
      stage: "CHAT",
      offerSends: 0,
      facts: [],
      assistantTurns: 5,
      memberMessages: 5,
    });
    conv.flirt = { step: "OFFER", teases: 300 };

    const res = await runTurn(
      {
        kind: "reply",
        persona: girlPersona(),
        settings: fakeSettings(),
        conversation: conv,
        history: [],
        inbound: [{ text: "ok cool" }],
      },
      deps,
    );

    expect(res.outcome).toBe("replied");
    expect(res.offerSent).not.toBeNull();
    expect(res.facts).not.toContain(ARMED_LINK_FACT);
    expect(res.newFlirtStep).toBe("LINKED");
  });

  it("tour suivant : le lien armé part", async () => {
    const llm = createFakeLlm(() =>
      fakeOutput({
        messages: ["regarde ça"],
        action: "rien" as FlirtAction,
      }),
    );
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({
      stage: "CHAT",
      offerSends: 0,
      facts: [ARMED_LINK_FACT],
      assistantTurns: 6,
      memberMessages: 6,
    });
    conv.flirt = { step: "OFFER", teases: 300 };

    const res = await runTurn(
      {
        kind: "reply",
        persona: girlPersona(),
        settings: fakeSettings(),
        conversation: conv,
        history: [],
        inbound: [{ text: "ah ok" }],
      },
      deps,
    );

    expect(res.outcome).toBe("replied");
    expect(res.offerSent).not.toBeNull();
    expect(res.facts).not.toContain(ARMED_LINK_FACT);
    expect(res.newFlirtStep).toBe("LINKED");
  });

  it("pas d'armement si le lien part normalement", async () => {
    const llm = createFakeLlm(() =>
      fakeOutput({
        messages: ["viens on continue la bas"],
        action: "lien" as FlirtAction,
      }),
    );
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({
      stage: "CHAT",
      offerSends: 0,
      facts: [],
      assistantTurns: 5,
      memberMessages: 5,
    });
    conv.flirt = { step: "OFFER", teases: 300 };

    const res = await runTurn(
      {
        kind: "reply",
        persona: girlPersona(),
        settings: fakeSettings(),
        conversation: conv,
        history: [],
        inbound: [{ text: "t'as plus rien a montrer ?" }],
      },
      deps,
    );

    expect(res.outcome).toBe("replied");
    expect(res.offerSent).not.toBeNull();
    expect(res.facts).not.toContain(ARMED_LINK_FACT);
  });

  // Changé volontairement (tâche 6) : le tour qui suit la photo 3 vend l'app sans lien et arme le lien.
  it("tour de vente sans lien : le lien est armé pour le tour suivant", async () => {
    const llm = createFakeLlm(() =>
      fakeOutput({
        messages: ["mdr tkt"],
        action: "rien" as FlirtAction,
      }),
    );
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({
      stage: "CHAT",
      offerSends: 0,
      facts: [],
      assistantTurns: 5,
      memberMessages: 5,
    });
    conv.flirt = { step: "OFFER", teases: 300 };

    const res = await runTurn(
      {
        kind: "reply",
        persona: girlPersona(),
        settings: fakeSettings(),
        conversation: conv,
        history: [],
        inbound: [{ text: "ok cool" }],
      },
      deps,
    );

    expect(res.outcome).toBe("replied");
    expect(res.offerSent).toBeNull();
    expect(res.facts).toContain(ARMED_LINK_FACT);
    expect(res.newFlirtStep).toBe("OFFER");
  });
});
