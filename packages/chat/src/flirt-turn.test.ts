// Série de photos dans un tour complet (persona fille avec photos) : lien jamais avant la chauffe, annonce jamais sans
// lien, corrections par le code sans nouvel appel, silence après le refus ferme, relance unique « t la ? » après le lien.
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
import type { FlirtAction, FlirtPhase } from "./flirt";
import type { TurnInput } from "./turn-types";

const PHOTOS = [1, 2, 3, 4, 5].map((slot) => ({
  slot,
  assetId: `asset-${slot}`,
  description: `photo ${slot}`,
}));

const girl = () =>
  fakePersona({ identity: "GIRL", illusion: true, hasOffer: true, flirtPhotos: PHOTOS });

function tour(
  step: FlirtPhase,
  teases: number,
  text: string | null,
  over: Partial<TurnInput["conversation"]> = {},
): TurnInput {
  const conversation = fakeConversation({
    stage: "CHAT",
    assistantTurns: 10,
    memberMessages: 10,
    ...over,
  });
  conversation.flirt = { step, teases };
  return {
    kind: text === null ? "follow_up" : "reply",
    persona: girl(),
    settings: fakeSettings(),
    conversation,
    history: [],
    inbound: text === null ? [] : [{ text }],
  };
}

const reponse = (text: string, action: FlirtAction, over: Record<string, unknown> = {}) =>
  fakeOutput({ messages: [text], action, ...over });

describe("pas de lien avant la chauffe", () => {
  it("en discussion tiède, le lien ne part pas même si le modèle le propose", async () => {
    const llm = createFakeLlm([
      reponse("ah cool et tu fais quoi ce soir", "rien", { send_offer: true }),
    ]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("NONE", 0, "je sors du taf", { assistantTurns: 0, memberMessages: 0 }), deps);
    expect(res.offerSent).toBeNull();
    expect(res.newFlirtStep).toBe("NONE");
  });

  it("conversation existante en NONE (Léa a déjà répondu) : silence total", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("NONE", 0, "je sors du taf"), deps);
    expect(res.outcome).toBe("aborted");
    expect(res.sent).toHaveLength(0);
    expect(llm.calls).toBe(0);
  });
});

describe("anciennes phases de la série : silence total (le tunnel remplace)", () => {
  it.each(["PHOTOS", "OFFER", "LINKED", "REFUSED", "WRAP", "DONE"] as const)(
    "phase %s → aborted, rien envoyé, aucun appel au modèle",
    async (step) => {
      const llm = createFakeLlm([]);
      const deps = createFakeTurnDeps({ llm });
      const res = await runTurn(tour(step, 300, "ptn t'es bonne"), deps);
      expect(res.outcome).toBe("aborted");
      expect(res.sent).toHaveLength(0);
      expect(res.offerSent).toBeNull();
      expect(llm.calls).toBe(0);
    },
  );

  it("relance sur une ancienne phase : silence aussi", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    for (const step of ["PHOTOS", "OFFER", "LINKED", "REFUSED", "WRAP"] as const) {
      const res = await runTurn(tour(step, 300, null), deps);
      expect(res.outcome).toBe("aborted");
    }
    expect(llm.calls).toBe(0);
  });
});

// Les describe « corrigé par le code » et « le lien n'est jamais balancé » testaient des comportements de l'ancienne
// série de photos (PHOTOS, OFFER). Ces phases sont désormais silencieuses (le tunnel scripté remplace la série).
// La couverture de ces comportements reste dans les tests unitaires de decideFlirt (flirt.test.ts).

describe("photo reçue : « t'es mignon hihi »", () => {
  const avecPhoto = (inp: TurnInput, text = ""): TurnInput => ({
    ...inp,
    inbound: [{ text, media: { kind: "photo" } }],
  });

  it("photo pendant une ancienne phase : silence (anciennes conversations ne répondent plus)", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(avecPhoto(tour("PHOTOS", 100, "")), deps);
    expect(res.outcome).toBe("aborted");
    expect(res.sent).toHaveLength(0);
    expect(llm.calls).toBe(0);
  });

  it("photo pendant le tunnel : « t'es mignon hihi », sans appel au modèle", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(avecPhoto(tour("T4", 0, "")), deps);
    expect(llm.calls).toBe(0);
    expect(res.sent.map((p) => p.text)).toEqual(["t'es mignon hihi"]);
    expect(res.sent[0]?.fixedKey).toBe("photoReaction");
    expect(res.outcome).toBe("replied");
  });

  it("fille sans série de photos : rien ne change, le modèle répond", async () => {
    const llm = createFakeLlm([reponse("oh c'est quoi ça", "rien")]);
    const deps = createFakeTurnDeps({ llm });
    const inp = avecPhoto(tour("NONE", 0, ""));
    const res = await runTurn(
      { ...inp, persona: fakePersona({ identity: "GIRL", illusion: true, hasOffer: true }) },
      deps,
    );
    expect(llm.calls).toBe(1);
    expect(res.sent.map((p) => p.text)).toEqual(["oh c'est quoi ça"]);
  });
});

// « silence dur après le refus ferme » et « relance unique après le lien » : ces phases (WRAP, DONE, LINKED, OFFER) sont
// désormais silencieuses dès l'entrée (le tunnel scripté remplace la série). La couverture de WRAP → DONE et du nudge
// reste dans les tests unitaires de decideFlirt et dans le bloc « anciennes phases » ci-dessus.
