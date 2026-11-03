// Simulation de bout en bout : messages écrits à l'avance, refus du site compris. Affiche chaque tour et vérifie que
// les règles tiennent (pas de photo trop tôt, pas de lien direct, cadeaux seulement après deux échanges).
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
import type { HistoryMessage } from "./turn-types";

const PHOTOS = [1, 2, 3, 4, 5].map((slot) => ({
  slot,
  assetId: `asset-${slot}`,
  description: `photo ${slot}`,
}));

const SCRIPT = [
  "j'ai trop envie de toi la",
  "grave, montre moi",
  "ptn t'es bonne",
  "j'adore, continue",
  "mmmh",
  "ptn",
  "t'as plus rien a montrer ?",
  "envoie la suite",
  "non je veux te parler ici moi",
  "pourquoi ?",
  "ok vas y montre",
  "ptn",
  "encore",
  "bon",
];

const TEXTE: Record<FlirtAction, string> = {
  photo: "attends, juste une",
  lien: "viens on continue la bas",
  rien: "mdr t'es chaud toi",
};

/** Modèle simulé : il lit les actions permises dans le prompt, et force une action interdite au 2e tour. */
function modele() {
  return createFakeLlm((req, index) => {
    const system = req.messages.find((m) => m.role === "system")?.content ?? "";
    const permises = (/Actions permises : ([^\n]+)/.exec(system)?.[1] ?? "rien").toLowerCase();
    const force: FlirtAction | null = index === 1 ? "photo" : null;
    const action: FlirtAction =
      force ?? (permises.includes("photo") ? "photo" : permises.includes("lien") ? "lien" : "rien");
    return fakeOutput({ messages: [TEXTE[action]], action });
  });
}

describe("anciennes conversations (série de photos) : silence total", () => {
  it("plusieurs messages sur une conversation PHOTOS → aucune réponse, aucun appel modèle", async () => {
    let modelCalls = 0;
    const llm = createFakeLlm(() => { modelCalls++; return fakeOutput({ messages: ["oui"], action: "rien" }); });
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({ stage: "CHAT", assistantTurns: 5, memberMessages: 5 });
    conv.flirt = { step: "PHOTOS", teases: 100 };
    const persona = fakePersona({ identity: "GIRL", illusion: true, hasOffer: true, flirtPhotos: PHOTOS });

    for (const texte of SCRIPT.slice(0, 5)) {
      const res = await runTurn(
        { kind: "reply", persona, settings: fakeSettings(), conversation: conv, history: [], inbound: [{ text: texte }] },
        deps,
      );
      expect(res.outcome).toBe("aborted");
      expect(res.sent).toHaveLength(0);
      expect(res.offerSent).toBeNull();
    }
    expect(modelCalls).toBe(0);
  });
});

describe("simulation de la série de photos (conversations en cours)", () => {
  it("moins de 18 ans : plus de photo ni de lien", async () => {
    const deps = createFakeTurnDeps({ llm: modele() });
    const conv = fakeConversation({ stage: "CHAT", assistantTurns: 0, memberMessages: 0 });
    conv.flirt = { step: "NONE", teases: 0 };
    const persona = fakePersona({
      identity: "GIRL",
      illusion: true,
      hasOffer: true,
      flirtPhotos: PHOTOS,
    });
    const res = await runTurn(
      {
        kind: "reply",
        persona,
        settings: fakeSettings(),
        conversation: conv,
        history: [],
        inbound: [{ text: "j'ai 16 ans et j'ai envie de toi" }],
      },
      deps,
    );
    console.log(`1. LUI  j'ai 16 ans et j'ai envie de toi`);
    console.log(`   ELLE ${res.sent.map((p) => p.text).join(" / ")}   [${res.outcome}]`);
    expect(res.outcome).toBe("minor");
    expect(res.sent.some((p) => p.mediaAssetId)).toBe(false);
    expect(res.offerSent).toBeNull();
  });
});

// ------------------------------------------------------------------
// Tunnel scripté (7 messages, zéro appel IA, puis silence)
// ------------------------------------------------------------------

describe("simulation du tunnel scripté", () => {
  it("déroulé complet T1→T7→silence (zéro appel au modèle)", async () => {
    let modelCalls = 0;
    const llm = createFakeLlm(() => {
      modelCalls++;
      return fakeOutput({ messages: ["oui bb"], action: "rien" });
    });
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({ stage: "CHAT", assistantTurns: 0, memberMessages: 0 });
    conv.flirt = { step: "NONE", teases: 0 };
    const persona = fakePersona({
      identity: "GIRL",
      illusion: true,
      hasOffer: true,
      flirtPhotos: PHOTOS,
    });
    const history: HistoryMessage[] = [];
    const resultats: { tour: number; textes: string[]; photo: boolean; lien: boolean }[] = [];

    const MESSAGES = [
      "t'es bonne bb",       // → T1 scripté (entre dans le tunnel)
      "ouais",               // → T2
      "continue",            // → T3 (photo)
      "ptn",                 // → T4
      "grave",               // → T5
      "ok",                  // → T6 (lien)
      "merci",               // → T7
      "salut ?",             // → T_DONE silence
    ];

    for (const [i, texte] of MESSAGES.entries()) {
      const res = await runTurn(
        {
          kind: "reply",
          persona,
          settings: fakeSettings(),
          conversation: conv,
          history: [...history],
          inbound: [{ text: texte }],
        },
        deps,
      );
      const asset = res.sent.find((p) => p.mediaAssetId)?.mediaAssetId ?? null;
      const textes = res.sent.map((p) => p.text);
      resultats.push({
        tour: i + 1,
        textes,
        photo: asset !== null,
        lien: res.offerSent !== null,
      });
      console.log(
        `${i + 1}. LUI  ${texte}\n   ELLE ${textes.join(" / ")}${asset ? "   [PHOTO]" : ""}${
          res.offerSent ? "   [LIEN]" : ""
        }${res.outcome === "aborted" ? "   [SILENCE]" : ""}`,
      );
      if (res.newFlirtStep) conv.flirt = { step: res.newFlirtStep, teases: res.flirtTeases ?? 0 };
      conv.facts = res.facts;
      if (res.offerSent) conv.offerSends += 1;
      for (const p of res.sent)
        history.push({ direction: "OUT", author: "ASSISTANT", text: p.text });
      history.push({ direction: "IN", author: "MEMBER", text: texte });
    }

    // Zéro appel au modèle sur tout le tunnel.
    expect(modelCalls).toBe(0);

    // Tour 1 (entrée) : texte « Salut bb ».
    expect(resultats[0]!.textes[0]).toContain("Salut bb");

    // Tour 3 : photo de chauffe (slot 3).
    expect(resultats[2]!.photo).toBe(true);

    // Tour 6 : lien d'inscription.
    expect(resultats[5]!.lien).toBe(true);
    expect(resultats[5]!.textes[0]).toContain("créer ton compte");

    // Tour 7 : dernier message du tunnel.
    expect(resultats[6]!.textes[0]).toContain("en live a cette heure ci");

    // Tour 8 : silence total (aborted).
    expect(resultats[7]!.textes).toHaveLength(0);
  });

  it("refus en plein tunnel : « pas grave tkt » puis silence", async () => {
    let modelCalls = 0;
    const llm = createFakeLlm(() => {
      modelCalls++;
      return fakeOutput({ messages: ["oui"], action: "rien" });
    });
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({ stage: "CHAT", assistantTurns: 0, memberMessages: 0 });
    conv.flirt = { step: "NONE", teases: 0 };
    const persona = fakePersona({
      identity: "GIRL",
      illusion: true,
      hasOffer: true,
      flirtPhotos: PHOTOS,
    });
    const history: HistoryMessage[] = [];

    // Tour 1 : entrée dans le tunnel.
    const r1 = await runTurn(
      { kind: "reply", persona, settings: fakeSettings(), conversation: conv, history, inbound: [{ text: "t'es bonne" }] },
      deps,
    );
    if (r1.newFlirtStep) conv.flirt = { step: r1.newFlirtStep, teases: r1.flirtTeases ?? 0 };
    history.push({ direction: "IN", author: "MEMBER", text: "t'es bonne" });
    for (const p of r1.sent) history.push({ direction: "OUT", author: "ASSISTANT", text: p.text });
    console.log(`1. LUI  t'es bonne\n   ELLE ${r1.sent.map((p) => p.text).join(" / ")}`);

    // Tour 2 : refus.
    const r2 = await runTurn(
      { kind: "reply", persona, settings: fakeSettings(), conversation: conv, history: [...history], inbound: [{ text: "non je veux pas" }] },
      deps,
    );
    console.log(`2. LUI  non je veux pas\n   ELLE ${r2.sent.map((p) => p.text).join(" / ")}`);
    expect(r2.sent[0]?.text).toBe("pas grave tkt");
    if (r2.newFlirtStep) conv.flirt = { step: r2.newFlirtStep, teases: r2.flirtTeases ?? 0 };
    history.push({ direction: "IN", author: "MEMBER", text: "non je veux pas" });
    for (const p of r2.sent) history.push({ direction: "OUT", author: "ASSISTANT", text: p.text });

    // Tour 3 : silence.
    const r3 = await runTurn(
      { kind: "reply", persona, settings: fakeSettings(), conversation: conv, history: [...history], inbound: [{ text: "allo ?" }] },
      deps,
    );
    console.log(`3. LUI  allo ?\n   ELLE [${r3.outcome}]`);
    expect(r3.outcome).toBe("aborted");
    expect(r3.sent).toHaveLength(0);

    expect(modelCalls).toBe(0);
  });

  it("FAQ « c'est payant ? » après le tunnel : réponse scriptée, puis silence", async () => {
    let modelCalls = 0;
    const llm = createFakeLlm(() => {
      modelCalls++;
      return fakeOutput({ messages: ["oui bb c'est cool"], action: "rien" });
    });
    const deps = createFakeTurnDeps({ llm });
    const conv = fakeConversation({ stage: "CHAT", assistantTurns: 12, memberMessages: 12 });
    // Simuler que le tunnel est terminé.
    conv.flirt = { step: "T_DONE", teases: 0 };
    const persona = fakePersona({
      identity: "GIRL",
      illusion: true,
      hasOffer: true,
      flirtPhotos: PHOTOS,
    });

    // Question FAQ « payant » → réponse scriptée.
    const r1 = await runTurn(
      { kind: "reply", persona, settings: fakeSettings(), conversation: conv, history: [], inbound: [{ text: "c'est payant ?" }] },
      deps,
    );
    console.log(`1. LUI  c'est payant ?\n   ELLE ${r1.sent.map((p) => p.text).join(" / ")}`);
    expect(r1.sent[0]?.text).toBe("Nonnn pas du tout");
    if (r1.newFlirtStep) conv.flirt = { step: r1.newFlirtStep, teases: r1.flirtTeases ?? 0 };

    // Message suivant : silence.
    const r2 = await runTurn(
      { kind: "reply", persona, settings: fakeSettings(), conversation: conv, history: [], inbound: [{ text: "ok merci" }] },
      deps,
    );
    console.log(`2. LUI  ok merci\n   ELLE [${r2.outcome}]`);
    expect(r2.outcome).toBe("aborted");

    // Zéro appel au modèle : tout est scripté.
    expect(modelCalls).toBe(0);
  });

  it("relance (follow_up) pendant le tunnel : silence", async () => {
    const deps = createFakeTurnDeps({ llm: modele() });
    const conv = fakeConversation({ stage: "CHAT", assistantTurns: 5, memberMessages: 5 });
    conv.flirt = { step: "T4", teases: 0 };
    const persona = fakePersona({
      identity: "GIRL",
      illusion: true,
      hasOffer: true,
      flirtPhotos: PHOTOS,
    });
    const res = await runTurn(
      { kind: "follow_up", persona, settings: fakeSettings(), conversation: conv, history: [], inbound: [] },
      deps,
    );
    expect(res.outcome).toBe("aborted");
  });
});
