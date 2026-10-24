import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  h1Count,
  jargonIn,
  primaryButtonCount,
  visibleText,
} from "../../settings/categories/page-checks";
import type { ConversationDetail } from "@/lib/conversations/detail";
import { conversationActions } from "@/lib/conversations/rules";
import { toThreadMessage } from "@/lib/conversations/thread";

// Fiche d'une conversation rendue côté serveur (base simulée) : un titre, « Envoyer » seul bouton orange, fil (bulles
// de la personne, de l'assistante, de l'équipe avec son prénom, média décrit, lien de l'offre ouvert ou non), boutons
// de reprise en main selon l'état, explication quand plus rien ne peut partir (/stop), faits retenus et résultats.
const m = vi.hoisted(() => ({ detail: null as unknown }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", name: "Marie", role: "MANAGER" })),
}));
vi.mock("@/lib/conversations/detail", () => ({
  loadConversationDetail: vi.fn(async () => m.detail),
}));
vi.mock("./actions", () => ({
  takeOverAction: vi.fn(),
  releaseAction: vi.fn(),
  closeAction: vi.fn(),
  blockAction: vi.fn(),
  clearNeedsHumanAction: vi.fn(),
  sendTeamMessageAction: vi.fn(),
}));

import ConversationPage from "./page";

const AT = new Date("2026-10-18T10:00:00Z");
const persona = { name: "Léa", gender: "F" };
const messages = [
  toThreadMessage(
    {
      id: "a",
      direction: "IN",
      author: "MEMBER",
      text: "/start",
      media: null,
      meta: { command: "start", source: "tk01" },
      createdAt: AT,
      teamUser: null,
      outboundMessage: null,
    },
    persona,
  ),
  toThreadMessage(
    {
      id: "b",
      direction: "OUT",
      author: "ASSISTANT",
      text: "Moi c'est Léa, l'assistante du canal 😉 Tu veux découvrir l'app ?",
      media: null,
      meta: { offerSubId: "AbCdEf123456", rejected: ["markdown"] },
      createdAt: new Date(AT.getTime() + 60_000),
      teamUser: null,
      outboundMessage: { status: "SENT", error: null },
    },
    persona,
  ),
  toThreadMessage(
    {
      id: "c",
      direction: "IN",
      author: "MEMBER",
      text: "",
      media: { kind: "voice" },
      meta: {},
      createdAt: new Date(AT.getTime() + 120_000),
      teamUser: null,
      outboundMessage: null,
    },
    persona,
  ),
  toThreadMessage(
    {
      id: "d",
      direction: "OUT",
      author: "TEAM",
      text: "Bonjour, ici l'équipe",
      media: null,
      meta: {},
      createdAt: new Date(AT.getTime() + 180_000),
      teamUser: { name: "Marie" },
      outboundMessage: { status: "QUEUED", error: null },
    },
    persona,
  ),
];

function detail(over: Partial<ConversationDetail> = {}): ConversationDetail {
  const base = {
    id: "clconversation0001",
    createdAt: AT,
    stage: "LINK_SENT" as const,
    status: "HUMAN" as const,
    source: "tk01",
    language: "fr",
    summary: null,
    facts: ["S'appelle Jean", "Habite à Lyon"],
    closedReason: null,
    closedAt: null,
    stoppedAt: null,
    isMinor: false,
    convertedAt: null,
    needsHumanAt: null,
    needsHumanReason: null,
    takenOverAt: AT,
    takenOverBy: { id: "u1", name: "Marie" },
    memberMessages: 4,
    member: {
      id: "m1",
      firstName: "Jean",
      lastName: null,
      username: "jean_m",
      languageCode: "fr",
      anonymizedAt: null,
    },
    bot: { id: "b1", username: "lea_bot", name: "Léa", isActive: true, mode: "ASSISTANT" },
    persona: { id: "clpersona0001", name: "Léa", gender: "F", isActive: true },
    memberBlocked: false,
    costEur: 0.0042,
    links: [{ subId: "AbCdEf123456", sentAt: AT, firstOpenedAt: AT, opens: 1 }],
    players: [
      {
        id: "p1",
        registeredAt: AT,
        ftdAt: null,
        ftdAmount: null,
        currency: "EUR",
        offerName: "App Rencontres FR",
      },
    ],
    messages,
    truncated: false,
    offers: { AbCdEf123456: { openedAt: AT.toISOString(), opens: 1 } },
    stateKey: "k",
    cursor: messages.at(-1)!.at,
    resets: 0,
    replyBlock: null,
    ...over,
  };
  return {
    ...base,
    actions:
      over.actions ??
      conversationActions({
        status: base.status,
        stoppedAt: base.stoppedAt,
        isMinor: base.isMinor,
        closedReason: base.closedReason,
        memberBlocked: base.memberBlocked,
        botActive: true,
      }),
  } as ConversationDetail;
}

async function render(): Promise<string> {
  return renderToStaticMarkup(
    await ConversationPage({
      params: Promise.resolve({ id: "clconversation0001" }),
      searchParams: Promise.resolve({}),
    } as never),
  );
}

beforeEach(() => {
  m.detail = detail();
});

describe("Conversations → fiche d'une conversation", () => {
  it("un titre, « Envoyer » seul bouton orange, le fil complet sans repère interne", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(1);
    expect(html).toContain('role="log"');
    expect(html).toContain('name="text"');
    const text = visibleText(html);
    for (const t of [
      "Jean",
      "La personne a appuyé sur Démarrer · source « tk01 »",
      "Léa (assistante)",
      "Lien de l'offre envoyé",
      "Ouvert le",
      "[message vocal]",
      "Équipe · Marie",
      "Envoi en cours…",
      "Rendre à l'assistante",
      "Fermer",
      "Bloquer",
      "Envoyer",
      "S'appelle Jean",
      "App Rencontres FR",
      "moins de 0,01",
      "Fiche du membre",
    ])
      expect(text).toContain(t);
    expect(text).not.toContain("Prendre la main");
    expect(text).not.toMatch(/markdown|AbCdEf123456/);
    expect(html).toContain('href="/members/m1"');
    expect(jargonIn(text)).toEqual([]);
  });

  it("l'assistante répond : « Prendre la main », et l'envoi prend la main (dit sous le champ)", async () => {
    m.detail = detail({ status: "BOT", takenOverAt: null, takenOverBy: null });
    const text = visibleText(await render());
    expect(text).toContain("Prendre la main");
    expect(text).not.toContain("Rendre à l'assistante");
    expect(text).toContain("En envoyant, vous prenez la main");
  });

  it("/stop : plus aucun bouton ni zone d'écriture, la raison à la place", async () => {
    m.detail = detail({
      status: "CLOSED",
      stage: "CLOSED",
      closedReason: "STOP",
      stoppedAt: AT,
      closedAt: AT,
    });
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain(
      "Cette personne a demandé l'arrêt (/stop) : plus aucun message ne peut lui être envoyé.",
    );
    expect(html).not.toContain('name="text"');
    expect(text).not.toMatch(/Prendre la main|Rendre à l'assistante|Bloquer|Envoyer/);
    expect(primaryButtonCount(html)).toBe(0);
  });

  it("l'assistante répond vraiment : pastille accordée et phrase « C'est l'assistante qui répond »", async () => {
    m.detail = detail({ status: "BOT", takenOverAt: null, takenOverBy: null });
    const text = visibleText(await render());
    expect(text).toContain("L'assistante répond");
    expect(text).not.toContain("L'assistant répond");
    expect(text).toContain("C'est l'assistante qui répond.");
    expect(text).not.toContain("Personne ne répond");
  });

  it("essai réservé à l'équipe, personne hors équipe : jamais « C'est l'assistante qui répond »", async () => {
    m.detail = detail({
      status: "BOT",
      takenOverAt: null,
      takenOverBy: null,
      replyBlock: "team_only",
    });
    const html = await render();
    const text = visibleText(html);
    expect(text).not.toContain("C'est l'assistante qui répond");
    expect(text).not.toContain("L'assistante répond");
    expect(text).toContain("Personne ne répond");
    expect(text).toContain(
      "Personne ne répond pour l'instant : l'essai est limité aux comptes de l'équipe",
    );
    expect(text).toContain("Prenez la main pour lui répondre vous-même.");
    expect(html).toMatch(/title="L&#x27;essai est limité aux comptes de l&#x27;équipe/);
  });

  it("persona désactivée ou bot repassé en bot normal : la raison à la place de « l'assistante répond »", async () => {
    for (const [block, reason] of [
      ["persona_inactive", "la persona de cette conversation est désactivée"],
      ["not_assistant_bot", "ce bot n'est plus en mode assistant"],
      ["activation_off", "l'assistant de conversation est désactivé"],
    ] as const) {
      m.detail = detail({ status: "BOT", takenOverAt: null, takenOverBy: null, replyBlock: block });
      const text = visibleText(await render());
      expect(text).toContain(`Personne ne répond pour l'instant : ${reason}`);
      expect(text).not.toContain("C'est l'assistante qui répond");
    }
  });

  it("l'équipe a la main et personne ne répondrait ensuite : prévenu avant de rendre la main", async () => {
    m.detail = detail({ replyBlock: "persona_inactive" });
    const text = visibleText(await render());
    expect(text).toContain(
      "En rendant la main, personne ne répondra : la persona de cette conversation est désactivée",
    );
    m.detail = detail({ replyBlock: null });
    expect(visibleText(await render())).not.toContain("En rendant la main");
  });

  it("persona masculine : « Rendre à l'assistant »", async () => {
    m.detail = detail({
      persona: { id: "clpersona0002", name: "Hugo", gender: "M", isActive: true },
    });
    expect(visibleText(await render())).toContain("Rendre à l'assistant ");
  });

  it("à traiter : bandeau « À traiter : <motif> », depuis quand, « Marquer comme traitée » (pas orange)", async () => {
    m.detail = detail({ needsHumanAt: AT, needsHumanReason: "hors_fiche", status: "BOT" });
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain("À traiter : Question hors fiche");
    expect(text).toContain("Depuis le");
    expect(text).toContain("Marquer comme traitée");
    expect(text).toContain("Prenez la main ou écrivez à cette personne");
    expect(primaryButtonCount(html)).toBe(1);
    expect(jargonIn(text)).toEqual([]);
    m.detail = detail({ needsHumanAt: AT, needsHumanReason: "nouveau_motif" });
    expect(visibleText(await render())).toContain("À traiter : À reprendre par l'équipe");
    m.detail = detail();
    expect(visibleText(await render())).not.toContain("Marquer comme traitée");
  });
});
