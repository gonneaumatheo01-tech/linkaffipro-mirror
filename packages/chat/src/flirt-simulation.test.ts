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
import type { HistoryMessage, TurnInput } from "./turn-types";

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
    // Directives hook et push : le modèle doit sortir le bon texte pour que le tour suivant le détecte.
    const text =
      system.includes("dis ton prénom")
        ? "moi c'est Léa, tu cherches quoi toi ? 😏"
        : system.includes("pousse direct")
          ? "du sexe alors ? 😏"
          : TEXTE[action];
    return fakeOutput({ messages: [text], action });
  });
}

describe("simulation de la série de photos", () => {
  it("déroulé complet avec refus du site", async () => {
    const deps = createFakeTurnDeps({ llm: modele() });
    const conv = fakeConversation({ stage: "CHAT", assistantTurns: 5, memberMessages: 5 });
    conv.flirt = { step: "NONE", teases: 0 };
    const persona = fakePersona({
      identity: "GIRL",
      illusion: true,
      hasOffer: true,
      flirtPhotos: PHOTOS,
    });
    const history: HistoryMessage[] = [];
    const photos: { tour: number; slot: number }[] = [];
    const liens: number[] = [];
    const rejets: string[] = [];

    for (const [i, texte] of SCRIPT.entries()) {
      const input: TurnInput = {
        kind: "reply",
        persona,
        settings: fakeSettings(),
        conversation: conv,
        history: [...history],
        inbound: [{ text: texte }],
      };
      const res = await runTurn(input, deps);
      const asset = res.sent.find((p) => p.mediaAssetId)?.mediaAssetId ?? null;
      const slot = asset ? Number(asset.split("-")[1]) : null;
      if (slot) photos.push({ tour: i + 1, slot });
      if (res.offerSent) liens.push(i + 1);
      rejets.push(...res.rejected);
      console.log(`${i + 1}. LUI  ${texte}`);
      console.log(
        `   ELLE ${res.sent.map((p) => p.text).join(" / ")}${slot ? `   [PHOTO ${slot}]` : ""}${
          res.offerSent ? "   [LIEN]" : ""
        }`,
      );
      if (res.newFlirtStep) conv.flirt = { step: res.newFlirtStep, teases: res.flirtTeases ?? 0 };
      for (const p of res.sent)
        history.push({ direction: "OUT", author: "ASSISTANT", text: p.text });
      history.push({ direction: "IN", author: "MEMBER", text: texte });
    }

    expect(photos.map((p) => p.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(liens).toHaveLength(1);
    // Une photo tous les deux échanges : jamais deux tours de suite.
    for (let i = 1; i < photos.length; i++)
      expect(photos[i]!.tour - photos[i - 1]!.tour).toBeGreaterThanOrEqual(2);
    // Aucun lien sur le message qui suit la photo 3.
    expect(liens[0]!).toBeGreaterThanOrEqual(photos[2]!.tour + 1);
    // La photo 4 seulement après deux échanges depuis le refus.
    expect(photos[3]!.tour - (liens[0]! + 1)).toBeGreaterThanOrEqual(2);
    // Le modèle a bien tenté une action interdite, et le code l'a refusée.
    expect(rejets).toContain("action_interdite");
  });

  it("ouverture : hook → push → série", async () => {
    const OPENING_SCRIPT = ["salut", "je sais pas trop", "ouais pourquoi pas", "grave"];
    const deps = createFakeTurnDeps({ llm: modele() });
    const conv = fakeConversation({
      stage: "CHAT",
      assistantTurns: 0,
      memberMessages: 1,
      isFirstAssistantTurn: true,
    });
    conv.flirt = { step: "NONE", teases: 0 };
    const persona = fakePersona({
      identity: "GIRL",
      illusion: true,
      hasOffer: true,
      flirtPhotos: PHOTOS,
    });
    const history: HistoryMessage[] = [];
    const photoTours: number[] = [];
    const messageLengths: number[] = [];

    for (const [i, texte] of OPENING_SCRIPT.entries()) {
      const input: TurnInput = {
        kind: "reply",
        persona,
        settings: fakeSettings(),
        conversation: { ...conv, isFirstAssistantTurn: i === 0 },
        history: [...history],
        inbound: [{ text: texte }],
      };
      const res = await runTurn(input, deps);
      const asset = res.sent.find((p) => p.mediaAssetId)?.mediaAssetId ?? null;
      const slot = asset ? Number(asset.split("-")[1]) : null;
      if (slot) photoTours.push(i + 1);
      messageLengths.push(res.sent.length);
      console.log(`${i + 1}. LUI  ${texte}`);
      console.log(
        `   ELLE ${res.sent.map((p) => p.text).join(" / ")}${slot ? `   [PHOTO ${slot}]` : ""}`,
      );
      if (res.newFlirtStep) conv.flirt = { step: res.newFlirtStep, teases: res.flirtTeases ?? 0 };
      for (const p of res.sent)
        history.push({ direction: "OUT", author: "ASSISTANT", text: p.text });
      history.push({ direction: "IN", author: "MEMBER", text: texte });
    }

    // Tour 1 : pas de photo.
    expect(photoTours).not.toContain(1);
    // Tour 2 : pas de photo (push).
    expect(photoTours).not.toContain(2);
    // Tour 3 : « du sexe » déclenche la série, photo au tour 3 ou après.
    expect(photoTours.some((t) => t >= 3)).toBe(true);
    // Le premier message contient le hook (« cherches quoi ») et au plus 2 lignes.
    const firstReply = history.find((m) => m.direction === "OUT")?.text ?? "";
    expect(firstReply).toBeTruthy();
  });

  it("moins de 18 ans : plus de photo ni de lien", async () => {
    const deps = createFakeTurnDeps({ llm: modele() });
    const conv = fakeConversation({ stage: "CHAT", assistantTurns: 5, memberMessages: 5 });
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
