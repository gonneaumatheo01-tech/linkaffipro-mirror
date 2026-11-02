// Série de photos dans un tour complet (persona fille avec photos) : lien jamais avant la chauffe, annonce jamais sans
// lien, corrections par le code sans nouvel appel, silence après le refus ferme, relance unique « t la ? » après le lien.
import { describe, expect, it } from "vitest";
import { runTurn } from "./engine";
import {
  createFakeLlm,
  createFakeSender,
  createFakeTurnDeps,
  fakeConversation,
  fakeOutput,
  fakePersona,
  fakeSettings,
} from "./fake";
import type { FlirtAction, FlirtPhase } from "./flirt";
import { ARMED_LINK_FACT } from "./pseudo";
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
    const res = await runTurn(tour("NONE", 0, "je sors du taf"), deps);
    expect(res.offerSent).toBeNull();
    expect(res.newFlirtStep).toBe("NONE");
  });
});

describe("annonce du lien sans lien : impossible", () => {
  it("pendant la série, l'annonce est retirée du texte", async () => {
    const llm = createFakeLlm([
      reponse("mmh t'aimes ça hein, attends je t'envoie le lien", "rien", { send_offer: true }),
    ]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("PHOTOS", 100, "ptn t'es bonne"), deps);
    expect(res.offerSent).toBeNull();
    expect(res.sent.map((p) => p.text).join(" ")).not.toMatch(/lien/);
    expect(res.sent.length).toBeGreaterThan(0);
    expect(llm.calls).toBe(1);
  });

  it("une réponse qui n'est qu'une annonce est refaite", async () => {
    const llm = createFakeLlm([
      reponse("attends je t'envoie le lien", "rien"),
      reponse("mmh continue de parler comme ça", "rien"),
    ]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("PHOTOS", 100, "ptn t'es bonne"), deps);
    expect(llm.calls).toBe(2);
    expect(res.rejected).toContain("link_announce");
    expect(res.sent.map((p) => p.text)).toEqual(["mmh continue de parler comme ça"]);
    expect(res.offerSent).toBeNull();
  });

  it("après un refus, une annonce ne repropose jamais le lien", async () => {
    const llm = createFakeLlm([
      reponse("dommage, bon tiens je te mets le lien quand meme", "rien"),
    ]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("REFUSED", 300, "ok"), deps);
    expect(res.offerSent).toBeNull();
    expect(res.sent.map((p) => p.text).join(" ")).not.toMatch(/lien/);
  });
});

describe("corrigé par le code, sans nouvel appel", () => {
  it("action lien non permise : ramenée à rien", async () => {
    const llm = createFakeLlm([reponse("mmh", "lien")]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("PHOTOS", 100, "j'adore"), deps);
    expect(llm.calls).toBe(1);
    expect(res.rejected).toContain("action_interdite");
    expect(res.offerSent).toBeNull();
    expect(res.sent).toHaveLength(1);
  });

  it("texte qui refuse pendant que la photo part : la photo ne part pas", async () => {
    const llm = createFakeLlm([reponse("nan pas maintenant 😏", "photo")]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("PHOTOS", 1, "montre moi"), deps);
    expect(llm.calls).toBe(1);
    expect(res.rejected).toContain("contradiction");
    expect(res.sent.some((p) => p.mediaAssetId)).toBe(false);
    expect(res.flirtTeases).toBe(2);
  });

  it("« non plus » n'est pas un refus : la photo part", async () => {
    const llm = createFakeLlm([reponse("merci t'es pas mal non plus 😏 / tiens", "photo")]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("NONE", 0, "mmh t'es bonne"), deps);
    expect(res.rejected).not.toContain("contradiction");
    expect(res.sent.some((p) => p.mediaAssetId)).toBe(true);
  });

  it("photo non permise : le texte l'annonce, la réponse est refaite", async () => {
    const llm = createFakeLlm([reponse("tiens", "photo"), reponse("mmh doucement", "rien")]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("PHOTOS", 100, "ok"), deps);
    expect(llm.calls).toBe(2);
    expect(res.sent.some((p) => p.mediaAssetId)).toBe(false);
  });

  it("lien armé : il part même si le modèle choisit rien", async () => {
    const llm = createFakeLlm([reponse("viens la bas jsuis plus coquine", "rien")]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("OFFER", 301, "mmh", { facts: [ARMED_LINK_FACT] }), deps);
    expect(llm.calls).toBe(1);
    expect(res.offerSent).not.toBeNull();
    expect(res.newFlirtStep).toBe("LINKED");
    expect(res.facts).not.toContain(ARMED_LINK_FACT);
  });
});

describe("le lien part seul, l'app n'est jamais décrite", () => {
  const sansBoutons = () => createFakeSender({ capabilities: { canSendButtons: false } });

  it("compte réel, lien vendu au tour d'avant : seule l'adresse part, le texte du modèle est laissé", async () => {
    const llm = createFakeLlm([
      reponse("c'est une appli pour parler, tiens 😏", "lien", { send_offer: true }),
    ]);
    const sender = sansBoutons();
    const deps = createFakeTurnDeps({ llm, sender });
    const res = await runTurn(tour("OFFER", 301, "vas y", { facts: [ARMED_LINK_FACT] }), deps);
    expect(res.offerSent).not.toBeNull();
    expect(sender.messages().map((m) => m.text)).toEqual([res.offerSent?.url]);
    expect(sender.messages()[0]?.offerSubId).toBe(res.offerSent?.subId);
    expect(res.newFlirtStep).toBe("LINKED");
    expect(res.facts).not.toContain(ARMED_LINK_FACT);
  });

  it("bot avec boutons : le bouton part sous une flèche, jamais dans un message vide", async () => {
    const llm = createFakeLlm([reponse("tiens", "lien", { send_offer: true })]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("OFFER", 301, "vas y", { facts: [ARMED_LINK_FACT] }), deps);
    const sent = deps.sender.messages();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe("👇");
    expect(sent[0]?.buttons?.[0]?.[0]?.url).toBe(res.offerSent?.url);
  });

  it("compte réel, lien avec une phrase : la phrase d'abord, puis l'adresse seule, jamais un message vide", async () => {
    const llm = createFakeLlm([reponse("mmh viens", "lien", { send_offer: true })]);
    const sender = sansBoutons();
    const deps = createFakeTurnDeps({ llm, sender });
    const res = await runTurn(tour("OFFER", 301, "envoie la suite"), deps);
    expect(res.offerSent).not.toBeNull();
    const texts = sender.messages().map((m) => m.text);
    expect(texts).toEqual(["mmh viens", res.offerSent?.url]);
    expect(sender.messages()[1]?.offerSubId).toBe(res.offerSent?.subId);
  });
});

describe("photo reçue : « t'es mignon hihi »", () => {
  const avecPhoto = (inp: TurnInput, text = ""): TurnInput => ({
    ...inp,
    inbound: [{ text, media: { kind: "photo" } }],
  });

  it("photo seule : la réaction part, sans appel au modèle, la série n'avance pas", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(avecPhoto(tour("PHOTOS", 100, "")), deps);
    expect(llm.calls).toBe(0);
    expect(res.sent.map((p) => p.text)).toEqual(["t'es mignon hihi"]);
    expect(res.sent[0]?.fixedKey).toBe("photoReaction");
    expect(res.outcome).toBe("replied");
    expect(res.newFlirtStep).toBeUndefined();
  });

  it("photo seule pendant que le lien est armé : le lien reste armé pour le tour suivant", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(
      avecPhoto(tour("OFFER", 301, "", { facts: [ARMED_LINK_FACT] })),
      deps,
    );
    expect(res.sent.map((p) => p.text)).toEqual(["t'es mignon hihi"]);
    expect(res.offerSent).toBeNull();
    expect(res.facts).toContain(ARMED_LINK_FACT);
  });

  it("photo avec des mots : la réaction d'abord, puis la réponse du modèle", async () => {
    const llm = createFakeLlm([reponse("mdrr t'es fou toi", "rien")]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(avecPhoto(tour("PHOTOS", 100, ""), "regarde moi"), deps);
    expect(llm.calls).toBe(1);
    expect(res.sent.map((p) => p.text)).toEqual(["t'es mignon hihi", "mdrr t'es fou toi"]);
  });

  it("le modèle a déjà réagi : pas de doublon", async () => {
    const llm = createFakeLlm([reponse("t'es mignon hihi", "rien")]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(avecPhoto(tour("PHOTOS", 100, ""), "et moi ?"), deps);
    expect(res.sent.map((p) => p.text)).toEqual(["t'es mignon hihi"]);
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

describe("silence dur après le refus ferme", () => {
  it("la dernière ligne (WRAP) part sans relance prévue", async () => {
    const llm = createFakeLlm([reponse("bon jcontinue la bas moi", "rien")]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("WRAP", 500, "mdr"), deps);
    expect(res.outcome).toBe("replied");
    expect(res.newFlirtStep).toBe("DONE");
    expect(res.nextFollowUpAt).toBeNull();
  });

  it("ensuite plus aucune réponse, même s'il insiste, et aucun appel au modèle", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    for (const text of ["allo ?", "réponds", "t'es la ?"]) {
      const res = await runTurn(tour("DONE", 500, text), deps);
      expect(res.outcome).toBe("aborted");
      expect(res.sent).toHaveLength(0);
      expect(res.nextFollowUpAt).toBeNull();
    }
    expect(llm.calls).toBe(0);
  });

  it("aucune relance en WRAP ni en DONE", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    for (const step of ["WRAP", "DONE"] as const) {
      const res = await runTurn(tour(step, 500, null), deps);
      expect(res.outcome).toBe("aborted");
      expect(res.sent).toHaveLength(0);
    }
    expect(llm.calls).toBe(0);
  });
});

describe("relance unique après le lien", () => {
  it("le lien part : une relance est prévue 1 à 2 h après", async () => {
    const llm = createFakeLlm([reponse("viens on continue la bas", "lien")]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(tour("OFFER", 301, "envoie la suite"), deps);
    expect(res.offerSent).not.toBeNull();
    const delay = res.nextFollowUpAt!.getTime() - deps.now().getTime();
    expect(delay).toBeGreaterThanOrEqual(55 * 60_000);
    expect(delay).toBeLessThanOrEqual(2 * 3_600_000);
  });

  it("la relance : « t la ? », texte fixe, sans appel au modèle, puis plus rien", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm });
    const res = await runTurn(
      tour("LINKED", 300, null, { offerSends: 1, stage: "LINK_SENT" }),
      deps,
    );
    expect(res.outcome).toBe("replied");
    expect(res.sent.map((p) => p.text)).toEqual(["t la ?"]);
    expect(res.sent[0]!.fixedKey).toBe("linkNudge");
    expect(res.offerSent).toBeNull();
    expect(res.followUpCount).toBe(1);
    expect(res.nextFollowUpAt).toBeNull();
    const again = await runTurn(
      tour("LINKED", 300, null, { offerSends: 1, stage: "FOLLOW_UP", followUpCount: 1 }),
      deps,
    );
    expect(again.outcome).toBe("aborted");
    expect(again.sent).toHaveLength(0);
    expect(llm.calls).toBe(0);
  });

  it("il écrit pendant la préparation de la relance : elle n'a plus lieu d'être", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm, beforeSend: [{ newInbound: [{ text: "ouais" }] }] });
    const res = await runTurn(tour("LINKED", 300, null, { offerSends: 1 }), deps);
    expect(res.outcome).toBe("aborted");
    expect(res.sent).toHaveLength(0);
    expect(res.deferredInbound.map((m) => m.text)).toEqual(["ouais"]);
  });
});
