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
  it("mode : pastille « Assistant de conversation » (avec sa persona) sous le nom, un seul bouton orange", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(1);
    const text = visibleText(html);
    expect(text).toContain("Assistant de conversation");
    expect(text).toContain("Léa");
    expect(jargonIn(text)).toEqual([]);
    expect(text).not.toMatch(/dating|entonnoir/i);
  });

  it("tableau : 5 colonnes au plus (règle du design), plus de colonne « Mode »", async () => {
    const html = await render();
    const headers = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((x) =>
      visibleText(x[1] ?? ""),
    );
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.length).toBeLessThanOrEqual(5);
    expect(headers).not.toContain("Mode");
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

  it("bot normal qui gère des canaux : « Assistant de conversation » désactivé, avec l'explication", () => {
    const html = renderToStaticMarkup(
      createElement(BotModeForm, {
        bot: { id: "b1", mode: "STANDARD", personaId: null, channelCount: 2 },
        personas: m.personas,
        action: vi.fn(),
      }),
    );
    expect(html).toMatch(/<option value="ASSISTANT" disabled="">/);
    expect(html).toContain('aria-describedby="bot-mode-refusal-b1"');
    const text = visibleText(html);
    expect(text).toContain(
      "Ce bot gère 2 canaux : il ne peut pas devenir l'assistante. Créez un bot dédié dans @BotFather (voir le guide) et ajoutez-le ici.",
    );
    expect(jargonIn(text)).toEqual([]);
    expect(primaryButtonCount(html)).toBe(0);
  });

  it("bot normal sans canal, ou déjà assistant : le choix reste possible", () => {
    for (const bot of [
      { id: "b3", mode: "STANDARD", personaId: null, channelCount: 0 },
      { id: "b2", mode: "ASSISTANT", personaId: "p1", channelCount: 2 },
    ]) {
      const html = renderToStaticMarkup(
        createElement(BotModeForm, { bot, personas: m.personas, action: vi.fn() }),
      );
      expect(html).not.toMatch(/<option value="ASSISTANT"[^>]*disabled/);
      expect(visibleText(html)).not.toContain("il ne peut pas devenir l'assistante");
    }
  });
});
