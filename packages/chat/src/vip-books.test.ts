// Paris sportifs VIP (phase 36) : bookmakers de la persona dans l'ordre (Celsius → Bet Portal → Sportaza), lien
// d'inscription du bookmaker choisi, lien du canal VIP après un dépôt confirmé. Sans réseau.
import { describe, expect, it } from "vitest";
import { pickBook, runTurn, VIP_BUTTON_TEXT } from "./engine";
import {
  createFakeLlm,
  createFakeSender,
  createFakeTurnDeps,
  fakeConversation,
  fakeOutput,
  fakePersona,
  fakeSettings,
  type FakeLlmScript,
  type FakeTurnDepsOptions,
} from "./fake";
import { buildSystemPrompt } from "./prompt";
import { checkTurnOutput } from "./schema";
import type { PersonaInput, TurnInput } from "./turn-types";

const START = new Date("2026-10-28T12:00:00.000Z");

const BOOKS = [
  { bookmakerKey: "sportaza", label: "Sportaza", priority: 3, hasInviteLink: true },
  { bookmakerKey: "celsius", label: "Celsius Casino", priority: 1, hasInviteLink: true },
  { bookmakerKey: "betportal", label: "Bet Portal", priority: 2, hasInviteLink: true },
];

const VIP_LINKS = {
  celsius: "https://t.me/+vipCelsius",
  betportal: "https://t.me/+vipBetPortal",
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
    bookmakers: BOOKS,
    ...over,
  });

function setup(script: FakeLlmScript, opts: Omit<FakeTurnDepsOptions, "llm"> = {}) {
  const llm = createFakeLlm(script);
  const deps = createFakeTurnDeps({ llm, startAt: START, vipLinks: VIP_LINKS, ...opts });
  return { llm, deps };
}

const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  kind: "reply",
  persona: mehdi(),
  settings: fakeSettings(),
  conversation: fakeConversation({ memberMessages: 4 }),
  history: [],
  inbound: [{ id: "in-1", text: "ok ça m'intéresse" }],
  ...over,
});

const offer = { send_offer: true, stage: "PROPOSAL" as const, style_update: { interest: 8 } };
const systemOf = (req: { messages: { role: string; content: string }[] } | undefined) =>
  req?.messages[0]?.content ?? "";

describe("prompt : bookmakers partenaires", () => {
  const ctx = {
    lang: "fr" as const,
    kind: "reply" as const,
    stage: "CHAT" as const,
    style: {},
    facts: [],
    summary: null,
    isFirstAssistantTurn: false,
    memberMessages: 5,
    offerSends: 0,
  };

  it("sports : liste triée par priorité, parcours d'inscription et champs selected_book / send_vip_link", () => {
    const p = buildSystemPrompt({ ...ctx, persona: mehdi() });
    expect(p).toContain("BOOKMAKERS PARTENAIRES");
    const order = ["1. Celsius Casino", "2. Bet Portal", "3. Sportaza"].map((l) => p.indexOf(l));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(p).toContain("PARCOURS INSCRIPTION BOOKMAKER");
    expect(p).toContain('"selected_book":""');
    expect(p).toContain("send_vip_link : true UNIQUEMENT");
  });

  it("casino ou sports sans bookmakers : rien de tout ça", () => {
    for (const persona of [mehdi({ bookmakers: [] }), mehdi({ universe: "casino" })]) {
      const p = buildSystemPrompt({ ...ctx, persona });
      expect(p).not.toContain("BOOKMAKERS PARTENAIRES");
      expect(p).not.toContain("send_vip_link");
    }
  });
});

describe("sortie du modèle", () => {
  it("selected_book (nettoyé) et send_vip_link gardés ; absents = non posés", () => {
    const withBook = checkTurnOutput({
      ...fakeOutput(),
      selected_book: " celsius ",
      send_vip_link: true,
    });
    expect(withBook).toMatchObject({
      ok: true,
      value: { selected_book: "celsius", send_vip_link: true },
    });
    const plain = checkTurnOutput(fakeOutput());
    expect(plain.ok && "selected_book" in plain.value).toBe(false);
    expect(plain.ok && "send_vip_link" in plain.value).toBe(false);
  });
});

describe("choix du bookmaker", () => {
  it("clé connue gardée ; inconnue ou absente : le premier de la liste seulement si un lien part", () => {
    expect(pickBook(mehdi(), "betportal", false)).toBe("betportal");
    expect(pickBook(mehdi(), "winamax", true)).toBe("celsius");
    expect(pickBook(mehdi(), "", true)).toBe("celsius");
    expect(pickBook(mehdi(), undefined, false)).toBeNull();
    expect(pickBook(mehdi({ bookmakers: [] }), "celsius", true)).toBeNull();
  });

  it("lien d'inscription du bookmaker choisi par le modèle", async () => {
    const { llm, deps } = setup([
      {
        messages: ["ok frero je te mets le lien Bet Portal juste en dessous"],
        ...offer,
        selected_book: "betportal",
      },
    ]);
    const r = await runTurn(input(), deps);
    expect(systemOf(llm.requests[0])).toContain("Mets selected_book à la clé du bookmaker choisi");
    expect(deps.offerBookKeys).toEqual(["betportal"]);
    expect(r.offerSent).toMatchObject({ subId: "TEST00000001", bookmakerKey: "betportal" });
    expect(r.vipLinkSent).toBeNull();
  });

  it("lien demandé sans bookmaker : Celsius, le premier de la liste", async () => {
    const { deps } = setup([{ messages: ["je te mets le lien juste en dessous"], ...offer }]);
    const r = await runTurn(input(), deps);
    expect(deps.offerBookKeys).toEqual(["celsius"]);
    expect(r.offerSent?.bookmakerKey).toBe("celsius");
  });

  it("persona sans bookmakers (dating, casino) : lien habituel, sans clé", async () => {
    const { deps } = setup([
      { messages: ["je te mets le lien juste en dessous"], ...offer, selected_book: "celsius" },
    ]);
    const r = await runTurn(input({ persona: mehdi({ bookmakers: null }) }), deps);
    expect(deps.offerBookKeys).toEqual([null]);
    expect(r.offerSent).not.toBeNull();
    expect(r.offerSent?.bookmakerKey).toBeUndefined();
  });
});

describe("lien du canal VIP", () => {
  const deposited = (over: Partial<TurnInput> = {}) =>
    input({
      conversation: fakeConversation({ memberMessages: 6, offerSends: 1, stage: "LINK_SENT" }),
      inbound: [{ id: "in-2", text: "c bon j'ai déposé sur celsius" }],
      ...over,
    });
  const vipReply = {
    messages: ["gg frero 🔥 voilà l'accès au canal VIP"],
    selected_book: "celsius",
    send_vip_link: true,
  };

  it("dépôt confirmé : bouton du canal VIP du bookmaker, conversion signalée", async () => {
    const { deps } = setup([vipReply]);
    const r = await runTurn(deposited(), deps);
    expect(deps.sender.messages().at(-1)?.buttons).toEqual([
      [{ text: VIP_BUTTON_TEXT, url: VIP_LINKS.celsius }],
    ]);
    expect(r.vipLinkSent).toEqual({ url: VIP_LINKS.celsius, bookmakerKey: "celsius" });
    expect(deps.offerLinks).toHaveLength(0);
  });

  it("aucun lien d'inscription envoyé avant : pas de lien VIP", async () => {
    const { deps } = setup([vipReply]);
    const r = await runTurn(
      deposited({ conversation: fakeConversation({ memberMessages: 6, offerSends: 0 }) }),
      deps,
    );
    expect(r.vipLinkSent).toBeNull();
    expect(deps.sender.messages().at(-1)?.buttons).toBeUndefined();
  });

  it("bookmaker inconnu ou sans lien VIP : rien", async () => {
    for (const vipLinks of [VIP_LINKS, {}]) {
      const { deps } = setup(
        [{ ...vipReply, selected_book: vipLinks === VIP_LINKS ? "winamax" : "celsius" }],
        { vipLinks },
      );
      const r = await runTurn(deposited(), deps);
      expect(r.vipLinkSent).toBeNull();
      expect(deps.sender.messages().at(-1)?.buttons).toBeUndefined();
    }
  });

  it("échec de l'envoi : lien VIP non compté (pas de conversion)", async () => {
    const sender = createFakeSender({
      results: [{ ok: false, blocked: false, unreachable: true, error: "chat not found" }],
    });
    const { deps } = setup([vipReply], { sender });
    const r = await runTurn(deposited(), deps);
    expect(r.sent).toHaveLength(0);
    expect(r.vipLinkSent).toBeNull();
  });

  it("sans boutons (aperçu « Tester ») : l'adresse du canal VIP à la fin du texte", async () => {
    const sender = createFakeSender({ capabilities: { canSendButtons: false } });
    const { deps } = setup([vipReply], { sender });
    const r = await runTurn(deposited(), deps);
    expect(sender.messages().at(-1)?.text).toBe(
      `gg frero 🔥 voilà l'accès au canal VIP\n\n${VIP_LINKS.celsius}`,
    );
    expect(r.vipLinkSent?.bookmakerKey).toBe("celsius");
  });
});
