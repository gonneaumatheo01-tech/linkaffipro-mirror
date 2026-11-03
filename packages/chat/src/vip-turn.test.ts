// Gérant du VIP (Paris sportifs) sur un tour complet : jamais de « je reviens » ni de silence, passage à l'équipe au
// dernier essai, lien annoncé = lien envoyé (bon bookmaker), accès au VIP seulement avec son lien, aucun emoji. Les autres
// personas gardent leur comportement. Sans réseau.
import { describe, expect, it } from "vitest";
import { MAX_TURN_ATTEMPTS, RETRY_LATER_MS, runTurn, VIP_RETRY_LATER_MS } from "./engine";
import {
  createFakeLlm,
  createFakeSender,
  createFakeTurnDeps,
  fakeConversation,
  fakePersona,
  fakeSettings,
  type FakeLlmScript,
  type FakeTurnDepsOptions,
} from "./fake";
import { fixedText } from "./texts";
import { VIP_SCRIPT_LINK, VIP_SCRIPT_PITCH } from "./vip";
import type { HistoryMessage, PersonaInput, TurnInput } from "./turn-types";
import { VeniceError } from "./types";

const START = new Date("2026-11-02T16:00:00.000Z");

const BOOKS = [
  { bookmakerKey: "celsiuscasino", label: "Celsius Casino", priority: 1, hasInviteLink: true },
  { bookmakerKey: "betportal", label: "Betportal", priority: 2, hasInviteLink: true },
  { bookmakerKey: "sportaza", label: "Sportaza", priority: 3, hasInviteLink: true },
];

const VIP_LINKS = {
  celsiuscasino: "https://t.me/+vipCelsius",
  betportal: "https://t.me/+vipBetportal",
  sportaza: "https://t.me/+vipSportaza",
};

const mehdi = (over: Partial<PersonaInput> = {}): PersonaInput =>
  fakePersona({
    name: "Mehdi",
    gender: "M",
    universe: "sports",
    personality: "relax et direct",
    tone: "langage jeune",
    offerPitch: "Le groupe VIP est gratuit pour les joueurs de nos bookmakers partenaires.",
    channelTitle: "Pronos VIP",
    vipManager: true,
    minExchangesBeforeOffer: 1,
    requireInterest: false,
    maxOfferSends: 3,
    bookmakers: BOOKS,
    ...over,
  });

const vars = { name: "Mehdi", gender: "M" as const, vipManager: true };

function setup(script: FakeLlmScript, opts: Omit<FakeTurnDepsOptions, "llm"> = {}) {
  const llm = createFakeLlm(script);
  const deps = createFakeTurnDeps({
    llm,
    startAt: START,
    vipLinks: VIP_LINKS,
    sender: createFakeSender({ capabilities: { canSendButtons: false } }),
    ...opts,
  });
  return { llm, deps };
}

const out = (text: string): HistoryMessage => ({ direction: "OUT", author: "ASSISTANT", text });
const inn = (text: string): HistoryMessage => ({ direction: "IN", author: "MEMBER", text });

const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  kind: "reply",
  persona: mehdi(),
  settings: fakeSettings(),
  conversation: fakeConversation({ memberMessages: 4, assistantTurns: 3, stage: "PROPOSAL" }),
  history: [inn("c pr le vip"), out("tu connais Celsius Casino ? t'as déjà un compte dessus ?")],
  inbound: [{ id: "in-1", text: "oui j'ai déjà un compte dessus" }],
  ...over,
});

const texts = (deps: ReturnType<typeof setup>["deps"]) => deps.sender.messages().map((m) => m.text);

describe("gérant du VIP : jamais de « je reviens » ni de silence", () => {
  const waiting = { messages: ["attends je reviens 2 sec"] };

  it("réponse refusée deux fois : rien ne part, nouvel essai 45 s plus tard", async () => {
    const { deps } = setup([waiting, waiting]);
    const r = await runTurn(input(), deps);
    expect(r.rejected).toContain("waiting_phrase");
    expect(texts(deps)).toEqual([]);
    expect(r.neutralSent).toBe(false);
    expect(r.retryAt?.getTime()).toBe(START.getTime() + VIP_RETRY_LATER_MS);
    expect(r.retryCount).toBe(1);
    expect(r.events).toContainEqual(expect.objectContaining({ type: "ai_failed" }));
  });

  it("phrase qui fait patienter refusée puis corrigée : seule la bonne réponse part", async () => {
    const { llm, deps } = setup([
      waiting,
      { messages: ["ok top, du coup tu connais Betportal ? t'as déjà un compte là-bas ?"] },
    ]);
    const r = await runTurn(input(), deps);
    expect(texts(deps)).toEqual(["ok top, du coup tu connais Betportal ? t'as déjà un compte là-bas ?"]);
    expect(llm.requests[1]?.messages[0]?.content).toContain("Ne fais jamais patienter");
    expect(r.outcome).toBe("replied");
  });

  it("dernier passage : l'équipe prend le relais (texte fixe sans emoji, conversation à traiter)", async () => {
    const { deps } = setup([waiting, waiting]);
    const r = await runTurn(input({ retryCount: MAX_TURN_ATTEMPTS - 1 }), deps);
    const handoff = fixedText("fr", "handoff", vars);
    expect(handoff).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(texts(deps)).toEqual([handoff]);
    expect(r.needsHuman).toEqual({ reason: "off_faq", source: "check" });
    expect(r.retryAt).toBeUndefined();
  });

  it("panne définitive (clé refusée) : l'équipe prend le relais au lieu du silence", async () => {
    const { deps } = setup([new VeniceError("auth", "clé refusée", { status: 401 })]);
    const r = await runTurn(input(), deps);
    expect(texts(deps)).toEqual([fixedText("fr", "handoff", vars)]);
    expect(r.needsHuman).toEqual({ reason: "off_faq", source: "check" });
  });

  it("deuxième passage à l'équipe d'affilée : une autre phrase", async () => {
    const { deps } = setup([
      { messages: ["je sais pas"], handoff: { needed: true, reason: "off_faq" } },
    ]);
    const r = await runTurn(
      input({
        history: [inn("tu vends des bennes ?"), out(fixedText("fr", "handoff", vars))],
        inbound: [{ id: "in-1", text: "je t'ai envoyé 9800 € en 2019" }],
      }),
      deps,
    );
    expect(texts(deps)).toEqual([fixedText("fr", "handoffAgain", vars)]);
    expect(r.needsHuman?.reason).toBe("off_faq");
  });

  it("emojis retirés de ses messages", async () => {
    const { deps } = setup([{ messages: ["yo frero 😉 du coup tu connais Betportal ? 🔥"] }]);
    await runTurn(input(), deps);
    expect(texts(deps)).toEqual(["yo frero du coup tu connais Betportal ?"]);
  });
});

describe("gérant du VIP : lien annoncé = lien envoyé", () => {
  const afterBetportal = {
    history: [
      inn("oui j'ai déjà un compte sur celsius"),
      out("ok top, du coup tu connais Betportal ? t'as déjà un compte là-bas ?"),
    ],
    inbound: [{ id: "in-2", text: "non j'ai pas de compte" }],
  };

  it("annonce sans send_offer : le lien part quand même, pour le bookmaker dont il parlait", async () => {
    const { deps } = setup([{ messages: ["parfait bg je t'envoie le lien d'inscription"] }]);
    const r = await runTurn(input(afterBetportal), deps);
    expect(deps.offerBookKeys).toEqual(["betportal"]);
    // Le texte du script remplace le sien : l'envoi du lien est toujours dit avec les mots du client.
    expect(texts(deps)).toEqual([VIP_SCRIPT_LINK, deps.offerLinks[0]!.url]);
    expect(r.offerSent?.bookmakerKey).toBe("betportal");
    expect(r.events).toContainEqual({
      type: "offer_sent",
      payload: expect.objectContaining({ bookmakerKey: "betportal" }),
    });
  });

  it("bookmaker nommé juste après l'annonce : il prime sur la clé du modèle", async () => {
    const { deps } = setup([
      {
        messages: ["t'as déjà Celsius, du coup je t'envoie le lien Betportal"],
        send_offer: true,
        stage: "PROPOSAL",
        selected_book: "celsiuscasino",
      },
    ]);
    const r = await runTurn(input(afterBetportal), deps);
    expect(deps.offerBookKeys).toEqual(["betportal"]);
    expect(r.offerSent?.bookmakerKey).toBe("betportal");
  });

  it("clé du modèle gardée quand le texte ne nomme pas le bookmaker du lien", async () => {
    const { deps } = setup([
      {
        messages: ["t'as déjà Celsius, je t'envoie le lien alors"],
        send_offer: true,
        stage: "PROPOSAL",
        selected_book: "betportal",
      },
    ]);
    await runTurn(input(afterBetportal), deps);
    expect(deps.offerBookKeys).toEqual(["betportal"]);
  });

  it("lien annoncé au premier message (interdit) : refusé, réponse corrigée sans lien", async () => {
    const { deps } = setup([
      { messages: ["yo frero je t'envoie le lien du vip direct"] },
      { messages: ["yo le vip c'est gratuit, tu connais Celsius Casino ? t'as un compte dessus ?"] },
    ]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({ memberMessages: 1, assistantTurns: 0, isFirstAssistantTurn: true, stage: "WELCOME" }),
        history: [],
        inbound: [{ id: "in-1", text: "salut tu peux m'ajouter à ton vip" }],
      }),
      deps,
    );
    expect(r.rejected).toContain("vip_access_not_allowed");
    // Premier message qui parle du VIP : le script du client, mot pour mot.
    expect(texts(deps)).toEqual([VIP_SCRIPT_PITCH]);
    expect(deps.offerLinks).toHaveLength(0);
  });

  it("lien d'inscription annoncé quand il ne peut pas partir : refusé puis corrigé", async () => {
    const { deps } = setup([
      { messages: ["je te renvoie le lien"] },
      { messages: ["le lien est plus haut frero, tu t'inscris et tu me dis quand c'est bon"] },
    ]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({ memberMessages: 9, assistantTurns: 8, offerSends: 3, stage: "LINK_SENT" }),
        inbound: [{ id: "in-1", text: "renvoie le lien" }],
      }),
      deps,
    );
    expect(r.rejected).toContain("link_not_allowed");
    expect(deps.offerLinks).toHaveLength(0);
    expect(texts(deps)).toEqual(["le lien est plus haut frero, tu t'inscris et tu me dis quand c'est bon"]);
  });

  it("lien impossible à créer : rien ne part, nouvel essai ; au dernier passage, l'équipe", async () => {
    const reply = { messages: ["parfait bg je t'envoie le lien d'inscription"], send_offer: true, stage: "PROPOSAL" as const, selected_book: "betportal" };
    const first = setup([reply], { offerBaseUrl: null });
    const r1 = await runTurn(input(afterBetportal), first.deps);
    expect(texts(first.deps)).toEqual([]);
    expect(r1.retryAt?.getTime()).toBe(START.getTime() + VIP_RETRY_LATER_MS);

    const last = setup([reply], { offerBaseUrl: null });
    const r2 = await runTurn(input({ ...afterBetportal, retryCount: MAX_TURN_ATTEMPTS - 1 }), last.deps);
    expect(texts(last.deps)).toEqual([fixedText("fr", "handoff", vars)]);
    expect(r2.offerSent).toBeNull();
    expect(r2.needsHuman?.reason).toBe("off_faq");
  });
});

describe("gérant du VIP : accès au VIP", () => {
  const linked = fakeConversation({
    memberMessages: 6,
    assistantTurns: 5,
    offerSends: 1,
    stage: "LINK_SENT",
    lastOfferBookKey: "betportal",
  });
  const askedDeposit = [
    inn("non j'ai pas de compte"),
    out("parfait bg je t'envoie le lien d'inscription"),
    out("tu t'inscris, tu fais ton premier dépôt et tu me dis quand c'est bon"),
  ];

  it("« c'est bon » après sa demande de dépôt + accès annoncé sans send_vip_link : le lien du VIP part", async () => {
    const { deps } = setup([{ messages: ["gg frero voilà l'accès au vip"] }]);
    const r = await runTurn(
      input({ conversation: linked, history: askedDeposit, inbound: [{ id: "in-3", text: "c'est bon" }] }),
      deps,
    );
    expect(texts(deps)).toEqual(["gg frero voilà l'accès au vip", VIP_LINKS.betportal]);
    expect(r.vipLinkSent).toEqual({ url: VIP_LINKS.betportal, bookmakerKey: "betportal" });
  });

  it("dépôt sur un autre bookmaker que le dernier lien : son canal VIP à lui", async () => {
    const { deps } = setup([
      { messages: ["top c'est validé, voilà ton accès au vip"], send_vip_link: true },
    ]);
    const r = await runTurn(
      input({
        conversation: linked,
        history: askedDeposit,
        inbound: [{ id: "in-3", text: "j'avais Celsius mais finalement j'ai déposé sur Sportaza" }],
      }),
      deps,
    );
    expect(r.vipLinkSent?.bookmakerKey).toBe("sportaza");
  });

  it("accès annoncé sans dépôt confirmé : refusé, réponse corrigée", async () => {
    const { deps } = setup([
      { messages: ["je t'ajoute au vip"] },
      { messages: ["t'as pu faire ton premier dépôt sur Betportal ?"] },
    ]);
    const r = await runTurn(
      input({ conversation: linked, history: askedDeposit, inbound: [{ id: "in-3", text: "et après ?" }] }),
      deps,
    );
    expect(r.rejected).toContain("vip_access_not_allowed");
    expect(r.vipLinkSent).toBeNull();
    expect(texts(deps)).toEqual(["t'as pu faire ton premier dépôt sur Betportal ?"]);
  });

  it("« c'est bon je suis inscrit » : pas un dépôt, l'accès annoncé est refusé", async () => {
    const { deps } = setup([
      { messages: ["gg voilà l'accès au vip"] },
      { messages: ["top bg, il te reste le premier dépôt et tu me dis"] },
    ]);
    const r = await runTurn(
      input({ conversation: linked, history: askedDeposit, inbound: [{ id: "in-3", text: "c'est bon je suis inscrit" }] }),
      deps,
    );
    expect(r.rejected).toContain("vip_access_not_allowed");
    expect(r.vipLinkSent).toBeNull();
  });
});

describe("les autres personas ne changent pas", () => {
  it("Léa (Rencontres) : « je reviens » gardé après deux refus, nouvel essai à 5 min", async () => {
    const llm = createFakeLlm(["", ""]);
    const deps = createFakeTurnDeps({ llm, startAt: START });
    const r = await runTurn(
      {
        kind: "reply",
        persona: fakePersona(),
        settings: fakeSettings(),
        conversation: fakeConversation(),
        history: [],
        inbound: [{ id: "in-1", text: "coucou" }],
      },
      deps,
    );
    expect(deps.sender.messages().map((m) => m.text)).toEqual([fixedText("fr", "retryLater")]);
    expect(r.retryAt?.getTime()).toBe(START.getTime() + RETRY_LATER_MS);
  });

  it("assistant Paris sportifs sans gérant du VIP : panne définitive toujours silencieuse", async () => {
    const llm = createFakeLlm([new VeniceError("auth", "clé refusée", { status: 401 })]);
    const deps = createFakeTurnDeps({ llm, startAt: START });
    const r = await runTurn(input({ persona: mehdi({ vipManager: false }) }), deps);
    expect(deps.sender.messages()).toEqual([]);
    expect(r.needsHuman ?? null).toBeNull();
  });
});

describe("gérant du VIP : script du client (3 novembre 2026)", () => {
  const first = (text: string, language: "fr" | "en" = "fr") => ({
    conversation: fakeConversation({
      memberMessages: 1,
      assistantTurns: 0,
      isFirstAssistantTurn: true,
      stage: "WELCOME",
      memberLanguageCode: language,
      style: { language },
    }),
    history: [],
    inbound: [{ id: "in-1", text }],
  });

  it("premier message : le texte du client mot pour mot, même si le modèle l'a dit autrement", async () => {
    const { deps } = setup([{ messages: ["yo frero t la pr le vip ?"] }]);
    const r = await runTurn(input(first("salut")), deps);
    expect(texts(deps)).toEqual([VIP_SCRIPT_PITCH]);
    expect(r.rejected).toEqual([]);
    expect(deps.offerLinks).toHaveLength(0);
  });

  it("premier message sans rapport avec le VIP : la réponse du modèle reste", async () => {
    const { deps } = setup([{ messages: ["salut, dis moi ce que tu cherches"] }]);
    await runTurn(input(first("salut c'est pour une collaboration")), deps);
    expect(texts(deps)).toEqual(["salut, dis moi ce que tu cherches"]);
  });

  it("premier message en anglais : pas de texte français imposé", async () => {
    const { deps } = setup([{ messages: ["hey, the vip is free for players of our partner books, ok for you?"] }]);
    await runTurn(input(first("hi, how do i join the vip?", "en")), deps);
    expect(texts(deps)).toEqual(["hey, the vip is free for players of our partner books, ok for you?"]);
  });

  it("« oui vasy » → la question sur le premier bookmaker, telle quelle", async () => {
    const ask = "Tu connais Celsius Casino ? t'as un compte dessus ?";
    const { deps } = setup([{ messages: [ask] }]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({ memberMessages: 2, assistantTurns: 1, stage: "WELCOME" }),
        history: [inn("salut"), out(VIP_SCRIPT_PITCH)],
        inbound: [{ id: "in-2", text: "Oui vasy" }],
      }),
      deps,
    );
    expect(texts(deps)).toEqual([ask]);
    expect(r.rejected).toEqual([]);
  });

  it("« non j'ai pas de compte » → « Ok attend je t'envoie le lien… » accepté, puis le lien de ce bookmaker", async () => {
    const { deps } = setup([
      { messages: [VIP_SCRIPT_LINK], send_offer: true, stage: "PROPOSAL", selected_book: "celsiuscasino" },
    ]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({ memberMessages: 3, assistantTurns: 2, stage: "WELCOME" }),
        history: [
          inn("salut"),
          out(VIP_SCRIPT_PITCH),
          inn("Oui vasy"),
          out("Tu connais Celsius Casino ? t'as un compte dessus ?"),
        ],
        inbound: [{ id: "in-3", text: "Non j'ai pas de compte" }],
      }),
      deps,
    );
    expect(r.rejected).toEqual([]);
    expect(deps.offerBookKeys).toEqual(["celsiuscasino"]);
    expect(texts(deps)).toEqual([VIP_SCRIPT_LINK, deps.offerLinks[0]!.url]);
  });

  it("« attend je t'envoie le lien » sans lien possible à ce message : refusé", async () => {
    const { deps } = setup([{ messages: [VIP_SCRIPT_LINK] }, { messages: [VIP_SCRIPT_LINK] }]);
    const r = await runTurn(input(first("salut je veux le vip")), deps);
    expect(r.rejected).toContain("link_not_allowed");
    expect(deps.offerLinks).toHaveLength(0);
  });

  it("dépôt confirmé après le script : « c bon c fait » donne le lien du VIP", async () => {
    const { deps } = setup([
      { messages: ["parfait frero voila l'accès au vip"], send_vip_link: true, selected_book: "celsiuscasino" },
    ]);
    const r = await runTurn(
      input({
        conversation: fakeConversation({
          memberMessages: 4,
          assistantTurns: 3,
          stage: "LINK_SENT",
          offerSends: 1,
          lastOfferBookKey: "celsiuscasino",
        }),
        history: [inn("Non j'ai pas de compte"), out(VIP_SCRIPT_LINK)],
        inbound: [{ id: "in-4", text: "C bon c fait" }],
      }),
      deps,
    );
    expect(r.rejected).toEqual([]);
    expect(r.vipLinkSent).toEqual({ url: VIP_LINKS.celsiuscasino, bookmakerKey: "celsiuscasino" });
  });
});
