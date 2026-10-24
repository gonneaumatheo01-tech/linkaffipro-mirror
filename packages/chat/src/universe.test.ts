// Casino et Paris sportifs (phase 25) : identité imposée, fiche d'informations, chiffres hors fiche, promesses, lien
// VIP, passage à un humain. Sans réseau (faux client du modèle, faux envoi).
import { describe, expect, it } from "vitest";
import { runTurn } from "./engine";
import { createFakeLlm, createFakeTurnDeps, fakeConversation, fakePersona, fakeSettings, type FakeLlmScript } from "./fake";
import { detectHandoff, detectHandoffIn } from "./handoff";
import { asksForOfferAccess } from "./offer-request";
import { buildSystemPrompt, previewSystemPrompt } from "./prompt";
import { hasForbiddenPromise } from "./promises";
import { checkTurnOutput, turnOutputJsonSchema } from "./schema";
import { fixedText } from "./texts";
import { personaIdentity, personaIllusion, type PersonaInput, type TurnInput } from "./turn-types";
import { validateTurnOutput } from "./validate";
import { fakeOutput } from "./fake";

const START = new Date("2026-10-24T12:00:00.000Z");

const casino = (over: Partial<PersonaInput> = {}): PersonaInput =>
  fakePersona({
    name: "Jade",
    universe: "casino",
    personality: "accueillante",
    tone: "clair",
    offerPitch: "Casino en ligne, bonus de bienvenue sur le premier dépôt.",
    offerButtonText: "Découvrir l'app",
    channelTitle: "Casino VIP",
    faq: [
      { q: "Quel est le bonus ?", a: "100 % du premier dépôt jusqu'à 200 €." },
      { q: "Dépôt minimum ?", a: "20 €." },
    ],
    ...over,
  });

function setup(script: FakeLlmScript) {
  const llm = createFakeLlm(script);
  const deps = createFakeTurnDeps({ llm, startAt: START });
  return { llm, deps };
}

const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  kind: "reply",
  persona: casino(),
  settings: fakeSettings(),
  conversation: fakeConversation(),
  history: [],
  inbound: [{ id: "in-1", text: "Salut, c'est quoi le bonus ?" }],
  ...over,
});

const systemOf = (req: { messages: { role: string; content: string }[] } | undefined) =>
  req?.messages[0]?.content ?? "";

describe("identité imposée", () => {
  it("casino / sports réglés GIRL : traités en ASSISTANT, illusion ignorée", () => {
    for (const universe of ["casino", "sports"]) {
      const p = { identity: "GIRL" as const, illusion: true, universe };
      expect(personaIdentity(p)).toBe("ASSISTANT");
      expect(personaIllusion(p)).toBe(false);
    }
    expect(personaIdentity({ identity: "GIRL", universe: "dating" })).toBe("GIRL");
    expect(personaIdentity({ identity: "GIRL" })).toBe("GIRL");
  });

  it("prompt : assistante du canal, jamais « fille » ni illusion, même réglée GIRL", () => {
    const p = previewSystemPrompt(casino({ identity: "GIRL", illusion: true }));
    expect(p).toContain("l'assistante du canal « Casino VIP »");
    expect(p).toContain("une IA");
    expect(p).not.toContain("une fille sur Telegram");
    expect(p).not.toContain("ON NE DOIT PAS POUVOIR LE DEVINER");
    expect(p).not.toContain("CONVERSION");
  });

  it("validation : un déni d'être une IA est refusé", () => {
    const v = validateTurnOutput(fakeOutput({ messages: ["non je suis une vraie fille"] }), {
      personaName: "Jade",
      offerPitch: "",
      memberTexts: [],
      turnInboundTexts: ["t'es un bot ?"],
      isFirstAssistantMessage: false,
      identity: personaIdentity({ identity: "GIRL", universe: "casino" }),
      universe: "casino",
    });
    expect(v.ok).toBe(false);
  });

  it("Rencontres inchangé : même prompt et même schéma qu'avant pour une persona sans univers", () => {
    const base = fakePersona();
    expect(previewSystemPrompt({ ...base, universe: "dating" })).toBe(previewSystemPrompt(base));
    expect(turnOutputJsonSchema().schema).not.toHaveProperty("properties.handoff");
    expect(turnOutputJsonSchema("dating").schema).not.toHaveProperty("properties.handoff");
    expect(turnOutputJsonSchema("casino").schema).toHaveProperty("properties.handoff");
  });
});

describe("fiche d'informations", () => {
  it("le prompt reçoit la fiche d'informations et la fiche de l'offre", () => {
    const p = previewSystemPrompt(casino());
    expect(p).toContain("FICHE D'INFORMATIONS");
    expect(p).toContain("Quel est le bonus ?");
    expect(p).toContain("100 % du premier dépôt jusqu'à 200 €.");
    expect(p).toContain("bonus de bienvenue sur le premier dépôt");
    expect(p).toContain("reason : off_faq");
  });

  it("fiche vide : rien de précis à affirmer", () => {
    expect(previewSystemPrompt(casino({ faq: [] }))).toContain("tu ne peux rien affirmer de précis");
  });

  it("Paris sportifs : vocabulaire du groupe VIP et des pronostics", () => {
    const p = buildSystemPrompt({
      persona: casino({ universe: "sports" }),
      lang: "fr",
      kind: "reply",
      stage: "CHAT",
      style: {},
      facts: [],
      summary: null,
      isFirstAssistantTurn: false,
      memberMessages: 5,
      offerSends: 0,
    });
    expect(p).toContain("Paris sportifs");
    expect(p).toContain("un pronostic n'est jamais sûr");
    expect(p).toContain("🏆 Groupe VIP pronostics");
  });

  const ctx = {
    personaName: "Jade",
    offerPitch: "Bonus de bienvenue.",
    memberTexts: ["le bonus c'est 500 € ?"],
    turnInboundTexts: [],
    isFirstAssistantMessage: false,
    universe: "casino",
    faqTexts: ["Quel est le bonus ?", "100 % du premier dépôt jusqu'à 200 €."],
  };

  it("chiffre ou montant de la fiche : permis", () => {
    const v = validateTurnOutput(fakeOutput({ messages: ["c'est 100 % jusqu'à 200 € 🎁"] }), ctx);
    expect(v.ok).toBe(true);
  });

  it("chiffre hors fiche refusé, même écrit par la personne", () => {
    const v = validateTurnOutput(fakeOutput({ messages: ["oui 500 € de bonus"] }), ctx);
    expect(v).toMatchObject({ ok: false, codes: ["invented_number"] });
    const v2 = validateTurnOutput(fakeOutput({ messages: ["retrait en 48 h"] }), ctx);
    expect(v2).toMatchObject({ ok: false, codes: ["invented_number"] });
  });

  it("promesse de gain refusée (6 langues), avertissement honnête permis", () => {
    for (const t of [
      "c'est un gain garanti",
      "sûr à 100 % ce prono",
      "de l'argent facile",
      "guaranteed win tonight",
      "dinero fácil",
      "ganho garantido",
      "leichtes Geld",
      "vincita garantita",
    ])
      expect(hasForbiddenPromise(t), t).toBe(true);
    expect(hasForbiddenPromise("parier n'est jamais sans risque")).toBe(false);
    expect(hasForbiddenPromise("un pari sur le PSG")).toBe(false);
    const v = validateTurnOutput(fakeOutput({ messages: ["argent facile avec nous"] }), ctx);
    expect(v).toMatchObject({ ok: false, codes: ["promise"] });
    // Rencontres : pas de contrôle des promesses de gain (comportement d'avant).
    const d = validateTurnOutput(fakeOutput({ messages: ["argent facile"] }), { ...ctx, universe: null, faqTexts: [] });
    expect(d.ok).toBe(true);
  });

  it("chiffre hors fiche refusé deux fois → réponse neutre et passage à l'équipe (off_faq)", async () => {
    const { llm, deps } = setup([{ messages: ["retrait en 48 h"] }, { messages: ["retrait en 72 h"] }]);
    const r = await runTurn(input({ inbound: [{ id: "in-1", text: "délai de retrait ?" }] }), deps);
    expect(llm.calls).toBe(2);
    expect(systemOf(llm.requests[1])).toContain("fiche d'informations et de la fiche de l'offre");
    expect(deps.sender.messages().map((m) => m.text)).toEqual([fixedText("fr", "handoff")]);
    expect(r.needsHuman).toEqual({ reason: "off_faq", source: "check" });
    expect(r.nextFollowUpAt).toBeNull();
  });
});

describe("lien VIP", () => {
  it("demande d'accès repérée (6 langues)", () => {
    for (const t of ["je veux le vip", "comment je m'inscris ?", "send me the link", "quiero registrarme", "wie kann ich mich anmelden", "come mi iscrivo"])
      expect(asksForOfferAccess(t), t).toBe(true);
    expect(asksForOfferAccess("salut ça va")).toBe(false);
  });

  it("jamais au premier message, même si la personne demande le VIP", async () => {
    const { llm, deps } = setup([{ messages: ["Moi c'est Jade, l'assistante du canal 😉 je t'envoie ça juste après"], send_offer: true, stage: "PROPOSAL", style_update: { interest: 9 } }]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({ isFirstAssistantTurn: true, assistantTurns: 0, memberMessages: 1, stage: "WELCOME" }),
        inbound: [{ id: "in-1", text: "je veux l'accès vip" }],
      }),
      deps,
    );
    expect(systemOf(llm.requests[0])).toContain("Premier message : pas encore de lien");
    expect(r.offerSent).toBeNull();
    expect(deps.offerLinks).toHaveLength(0);
  });

  it("demande d'accès : lien envoyé avant le nombre d'échanges, bouton de l'univers", async () => {
    const { llm, deps } = setup([{ messages: ["je te mets le lien juste en dessous"], send_offer: true, stage: "PROPOSAL", style_update: { interest: 3 } }]);
    const r = await runTurn(
      input({ conversation: fakeConversation({ memberMessages: 1 }), inbound: [{ id: "in-1", text: "je veux le vip" }] }),
      deps,
    );
    expect(systemOf(llm.requests[0])).toContain("envoie le lien maintenant");
    expect(r.offerSent).not.toBeNull();
    expect(deps.sender.messages().at(-1)?.buttons?.[0]?.[0]?.text).toBe("🎁 Accès VIP et bonus");
  });

  it("sans demande : règles du parcours (trop tôt)", async () => {
    const { deps } = setup([{ messages: ["avec plaisir"], send_offer: true, stage: "PROPOSAL", style_update: { interest: 9 } }]);
    const r = await runTurn(input({ conversation: fakeConversation({ memberMessages: 1 }), inbound: [{ id: "in-1", text: "merci" }] }), deps);
    expect(r.offerSent).toBeNull();
  });
});

describe("passage à un humain", () => {
  it("motifs repérés par le code (6 langues)", () => {
    expect(detectHandoff("je veux être remboursé")).toBe("money");
    expect(detectHandoff("mon retrait est bloqué depuis 3 jours")).toBe("money");
    expect(detectHandoff("can you lend me 50")).toBe("money");
    expect(detectHandoff("c'est une arnaque votre truc")).toBe("complaint");
    expect(detectHandoff("mi conto bloccato")).toBe("complaint");
    expect(detectHandoff("ta gueule connard")).toBe("insult");
    expect(detectHandoff("vaffanculo")).toBe("insult");
    expect(detectHandoff("t'es prêt pour le match ?")).toBeNull();
    expect(detectHandoffIn(["connard", "rembourse moi"])).toBe("money");
  });

  for (const [text, reason] of [
    ["rembourse moi mon dépôt", "money"],
    ["vous êtes des escrocs", "complaint"],
    ["fdp", "insult"],
  ] as const)
    it(`${reason} : réponse neutre fixe sans appel au modèle, sans lien ni relance`, async () => {
      const { llm, deps } = setup([]);
      const r = await runTurn(input({ inbound: [{ id: "in-1", text }] }), deps);
      expect(llm.calls).toBe(0);
      expect(deps.sender.messages().map((m) => m.text)).toEqual([fixedText("fr", "handoff")]);
      expect(r.outcome).toBe("replied");
      expect(r.needsHuman).toEqual({ reason, source: "code" });
      expect(r.events).toContainEqual({ type: "needs_human", payload: { reason, source: "code" } });
      expect(r.nextFollowUpAt).toBeNull();
      expect(r.offerSent).toBeNull();
    });

  it("mineur déclaré : arrêt habituel et conversation signalée à l'équipe", async () => {
    const { llm, deps } = setup([]);
    const r = await runTurn(input({ inbound: [{ id: "in-1", text: "j'ai 16 ans" }] }), deps);
    expect(llm.calls).toBe(0);
    expect(r.outcome).toBe("minor");
    expect(r.needsHuman).toEqual({ reason: "minor", source: "code" });
  });

  it("question hors fiche (sortie du modèle) : réponse neutre, motif off_faq", async () => {
    const { deps } = setup([{ messages: ["euh je sais pas"], handoff: { needed: true, reason: "off_faq" } }]);
    const r = await runTurn(input({ inbound: [{ id: "in-1", text: "vous acceptez la crypto ?" }] }), deps);
    expect(deps.sender.messages().map((m) => m.text)).toEqual([fixedText("fr", "handoff")]);
    expect(r.needsHuman).toEqual({ reason: "off_faq", source: "model" });
    expect(r.events.some((e) => e.type === "needs_human")).toBe(true);
  });

  it("motif « minor » du modèle : arrêt mineur", async () => {
    const { deps } = setup([{ messages: ["ok"], handoff: { needed: true, reason: "minor" } }]);
    const r = await runTurn(input({ inbound: [{ id: "in-1", text: "je suis au lycée" }] }), deps);
    expect(r.outcome).toBe("minor");
    expect(r.needsHuman).toEqual({ reason: "minor", source: "model" });
  });

  it("reprise par l'équipe pendant la préparation : rien ne part", async () => {
    const llm = createFakeLlm([]);
    const deps = createFakeTurnDeps({ llm, startAt: START, beforeSend: [{ abort: true }] });
    const r = await runTurn(input({ inbound: [{ id: "in-1", text: "rembourse moi" }] }), deps);
    expect(r.outcome).toBe("aborted");
    expect(deps.sender.messages()).toHaveLength(0);
  });

  it("textes neutres en 6 langues, sans lien", () => {
    for (const l of ["fr", "en", "es", "pt", "de", "it"]) expect(fixedText(l, "handoff")).toMatch(/\S/);
  });

  it("sortie : motif inconnu → off_faq ; handoff mal formé → refus", () => {
    const base = JSON.parse(JSON.stringify(fakeOutput()));
    const ok = checkTurnOutput({ ...base, handoff: { needed: true, reason: "???" } });
    expect(ok.ok && ok.value.handoff).toEqual({ needed: true, reason: "off_faq" });
    expect(checkTurnOutput({ ...base, handoff: "oui" }).ok).toBe(false);
    const none = checkTurnOutput(base);
    expect(none.ok && none.value.handoff).toBeUndefined();
  });

  it("Rencontres : aucun passage à un humain (comportement d'avant)", async () => {
    const llm = createFakeLlm([{ messages: ["oh non 😕 raconte"] }]);
    const deps = createFakeTurnDeps({ llm, startAt: START });
    const r = await runTurn(input({ persona: fakePersona(), inbound: [{ id: "in-1", text: "rembourse moi" }] }), deps);
    expect(llm.calls).toBe(1);
    expect(r.needsHuman ?? null).toBeNull();
  });
});
