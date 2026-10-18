import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, jargonIn, primaryButtonCount, visibleText } from "../categories/page-checks";

// Réglages → Bots (rendu serveur, base simulée) : colonne « Mode » (phase 17) et formulaire du mode dans le détail.
const m = vi.hoisted(() => ({
  user: { id: "u1", role: "ADMIN" as "ADMIN" | "MANAGER" },
  bots: [] as Array<Record<string, unknown>>,
  personas: [
    { id: "p1", name: "Léa", isActive: true },
    { id: "p2", name: "Hugo", isActive: false },
  ],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings/bots",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => m.user) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    bot: { findMany: vi.fn(async () => m.bots) },
    persona: { findMany: vi.fn(async () => m.personas) },
  },
}));
vi.mock("@/lib/status/queries", () => ({
  liveWebhook: vi.fn(async () => ({
    url: "https://app.linkaffipro.com/api/telegram/x",
    pending: 0,
    lastError: null,
    lastErrorAt: null,
    fetchError: null,
  })),
}));
vi.mock("./actions", () => ({
  addBotAction: vi.fn(),
  resyncWebhookAction: vi.fn(),
  setBotModeAction: vi.fn(),
  toggleBotAction: vi.fn(),
}));

import BotsPage from "./page";
import { BotModeForm, botModeSummary } from "@/components/settings/bot-mode-form";

function bot(over: Record<string, unknown>) {
  return {
    id: "b1",
    name: "Casino",
    username: "casino_bot",
    vertical: "CASINO",
    isActive: true,
    lastError: null,
    lastWebhookAt: new Date("2026-10-18T10:00:00Z"),
    mode: "STANDARD",
    personaId: null,
    persona: null,
    _count: { channelAdmins: 2, memberStates: 10 },
    ...over,
  };
}

async function render(): Promise<string> {
  return renderToStaticMarkup(await BotsPage({ searchParams: Promise.resolve({}) } as never));
}

beforeEach(() => {
  m.user = { id: "u1", role: "ADMIN" };
  m.bots = [
    bot({}),
    bot({
      id: "b2",
      name: "Léa",
      username: "lea_bot",
      vertical: "DATING",
      mode: "ASSISTANT",
      personaId: "p1",
      persona: { name: "Léa", isActive: true },
    }),
  ];
});

describe("Réglages → Bots : mode des bots", () => {
  it("colonne « Mode » : bot normal ou assistant de conversation (avec sa persona), un seul bouton orange", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(1);
    const text = visibleText(html);
    expect(text).toContain("Mode");
    expect(text).toContain("Bot normal");
    expect(text).toContain("Assistant de conversation");
    expect(text).toContain("Léa");
    expect(jargonIn(text)).toEqual([]);
    expect(text).not.toMatch(/dating|entonnoir/i);
  });

  it("résumé du mode en mots simples", () => {
    expect(botModeSummary("STANDARD", null)).toBe("Bot normal");
    expect(botModeSummary("ASSISTANT", { name: "Léa", isActive: true })).toBe(
      "Assistant de conversation · Léa",
    );
    expect(botModeSummary("ASSISTANT", { name: "Hugo", isActive: false })).toBe(
      "Assistant de conversation · Hugo (désactivée)",
    );
    expect(botModeSummary("ASSISTANT", null)).toBe(
      "Assistant de conversation · aucune persona liée",
    );
  });

  it("formulaire du détail : mode, persona liée, bouton secondaire (jamais orange)", () => {
    const html = renderToStaticMarkup(
      createElement(BotModeForm, {
        bot: { id: "b2", mode: "ASSISTANT", personaId: "p1" },
        personas: m.personas,
        action: vi.fn(),
      }),
    );
    expect(html).toContain('name="mode"');
    expect(html).toContain('name="personaId"');
    expect(html).toContain('name="botId"');
    expect(primaryButtonCount(html)).toBe(0);
    const text = visibleText(html);
    expect(text).toContain("Bot normal");
    expect(text).toContain("Assistant de conversation");
    expect(text).toContain("Persona liée");
    expect(text).toContain("Hugo (désactivée)");
    expect(text).toContain("Enregistrer le mode");
    expect(html).toMatch(/<option value="ASSISTANT" selected="">/);
    expect(html).toMatch(/<option value="p1" selected="">/);
    expect(jargonIn(text)).toEqual([]);
  });
});
