import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  h1Count,
  jargonIn,
  primaryButtonCount,
  visibleText,
} from "../settings/categories/page-checks";
import type { InboxListRow } from "@/lib/conversations/inbox";

// Boîte de réception rendue côté serveur (base simulée) : un titre, aucun bouton orange quand il y a des conversations,
// 5 colonnes, nom de la personne (jamais son identifiant Telegram), dernier message en extrait, pastilles et filtres,
// export ; état vide « l'assistante est désactivée » avec le lien des réglages pour un administrateur seulement.
const m = vi.hoisted(() => ({
  user: { id: "u1", name: "Marie", role: "ADMIN" as "ADMIN" | "MANAGER" },
  rows: [] as unknown[],
  counts: { all: 0, unread: 0, human: 0 },
  activation: "all" as "off" | "team" | "all",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/conversations",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@/lib/assistant/config", () => ({
  loadAssistantConfig: vi.fn(async () => ({ activation: m.activation })),
}));
vi.mock("@/lib/conversations/inbox", () => ({
  listConversations: vi.fn(async () => ({
    rows: m.rows,
    total: m.rows.length,
    pages: 1,
    page: 1,
  })),
  inboxCounts: vi.fn(async () => m.counts),
  loadInboxOptions: vi.fn(async () => ({
    personas: [{ id: "clpersona0001", name: "Léa" }],
    sources: ["tk01"],
    hasNoSource: true,
    hasNoPersona: false,
  })),
}));

import ConversationsInboxPage from "./page";

const NOW = new Date();
const row = (over: Partial<InboxListRow> = {}): InboxListRow => ({
  id: "clconversation0001",
  createdAt: NOW,
  stage: "LINK_SENT",
  status: "HUMAN",
  source: "tk01",
  personaId: "clpersona0001",
  personaName: "Léa",
  personaGender: "F",
  closedReason: null,
  stoppedAt: null,
  isMinor: false,
  needsHumanAt: null,
  needsHumanReason: null,
  universe: "dating",
  member: { id: "m1", firstName: null, lastName: null, username: null, anonymizedAt: null },
  last: {
    direction: "IN",
    author: "MEMBER",
    text: "",
    media: { kind: "photo" },
    meta: {},
    at: NOW,
  },
  unread: true,
  activityAt: NOW,
  replyBlock: null,
  ...over,
});

async function render(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(
    await ConversationsInboxPage({ searchParams: Promise.resolve(sp) } as never),
  );
}

beforeEach(() => {
  m.user = { id: "u1", name: "Marie", role: "ADMIN" };
  m.rows = [];
  m.counts = { all: 0, unread: 0, human: 0 };
  m.activation = "all";
});

describe("Conversations → Boîte de réception", () => {
  it("liste : un titre, pas de bouton orange, 5 colonnes, ligne vers la fiche", async () => {
    m.rows = [
      row(),
      row({
        id: "clconversation0002",
        member: {
          id: "m2",
          firstName: "Jean",
          lastName: null,
          username: "jean_m",
          anonymizedAt: null,
        },
        last: {
          direction: "OUT",
          author: "ASSISTANT",
          text: "Moi c'est Léa, l'assistante du canal 😉",
          media: null,
          meta: {},
          at: NOW,
        },
        unread: false,
        status: "BOT",
        stage: "WELCOME",
      }),
    ];
    m.counts = { all: 2, unread: 1, human: 1 };
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(0);
    expect((html.match(/<th[\s>]/g) ?? []).length).toBe(5);
    expect(html).toContain('href="/conversations/clconversation0001"');
    expect(html).toContain('href="/api/conversations/export"');
    const text = visibleText(html);
    for (const t of [
      "Boîte de réception",
      "Personne",
      "Dernier message",
      "Étape",
      "Qui répond",
      "Mis à jour",
      "Personne sans nom",
      "[photo]",
      "Jean",
      "Assistante : Moi c'est Léa",
      "Lien envoyé",
      "L'équipe a la main",
      "Non lues",
      "Sans source",
      "Exporter",
    ])
      expect(text).toContain(t);
    expect(text).not.toMatch(/\b\d{6,}\b/);
    expect(jargonIn(text)).toEqual([]);
    expect(text).not.toMatch(/dating|entonnoir/i);
  });

  it("aucune conversation, assistante désactivée : la phrase, et le lien des réglages pour un administrateur", async () => {
    m.activation = "off";
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain("Aucune conversation : l'assistante est désactivée");
    expect(html).toContain('href="/settings/assistant"');
    expect(primaryButtonCount(html)).toBe(1);
    m.user = { id: "u2", name: "Paul", role: "MANAGER" };
    const manager = await render();
    expect(visibleText(manager)).toContain("Un administrateur peut l'activer");
    expect(manager).not.toContain('href="/settings/assistant"');
  });

  it("« Qui répond » : l'assistante accordée à la persona, « Personne ne répond » quand elle ne répondra pas", async () => {
    m.activation = "team";
    m.rows = [
      row({ id: "clconversation0010", status: "BOT", unread: false }),
      row({
        id: "clconversation0011",
        status: "BOT",
        personaName: "Hugo",
        personaGender: "M",
        unread: false,
      }),
      row({ id: "clconversation0012", status: "BOT", replyBlock: "team_only" }),
    ];
    m.counts = { all: 3, unread: 1, human: 0 };
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain("L'assistante répond");
    expect(text).toContain("L'assistant répond");
    expect(text).toContain("Personne ne répond");
    expect(html).toMatch(/title="L&#x27;essai est limité aux comptes de l&#x27;équipe/);
    // Essai réservé à l'équipe : rappelé au-dessus de la liste.
    expect(text).toContain("Essai par l'équipe : l'assistante ne répond qu'aux comptes Telegram");
    m.activation = "all";
    expect(visibleText(await render())).not.toContain("Essai par l'équipe");
  });

  it("filtre « Qui répond » : sans « En pause » (jamais posé), sauf déjà choisi dans l'adresse", async () => {
    m.rows = [row()];
    m.counts = { all: 1, unread: 1, human: 1 };
    const html = await render();
    expect(html).not.toContain('value="PAUSED"');
    expect(html).toContain("L&#x27;assistante répond</option>");
    expect(await render({ status: "PAUSED" })).toContain('value="PAUSED"');
  });

  it("filtres sans résultat : retour à toute la liste", async () => {
    const text = visibleText(await render({ stage: "CONVERTED" }));
    expect(text).toContain("Aucune conversation ne correspond à ces filtres");
    expect(text).toContain("Voir toutes les conversations");
  });
});
