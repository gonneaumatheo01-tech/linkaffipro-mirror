import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  h1Count,
  jargonIn,
  primaryButtonCount,
  visibleText,
} from "../../settings/categories/page-checks";
import { aggregateConversationStats } from "@/lib/conversations/stats";

// Chiffres des conversations rendus côté serveur (base simulée) : un titre, aucun bouton orange, sélecteur de période
// commun, cinq cartes, parcours en barres (jamais le mot « entonnoir »), tableaux par persona et par source, export.
const m = vi.hoisted(() => ({
  any: true,
  activation: "all" as "off" | "all",
  role: "ADMIN" as "ADMIN" | "MANAGER",
  periods: [] as unknown[],
  universes: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", name: "Marie", role: m.role })),
}));
vi.mock("@/lib/assistant/config", () => ({
  loadAssistantConfig: vi.fn(async () => ({ activation: m.activation, monthlyCapEur: 30 })),
}));
vi.mock("@/lib/assistant/usage", () => ({ monthCostEur: vi.fn(async () => 6) }));
vi.mock("@/lib/conversations/stats-queries", () => ({
  hasAnyConversation: vi.fn(async () => m.any),
  loadConversationStats: vi.fn(async (period: unknown, opts?: { universe?: string }) => {
    m.periods.push(period);
    m.universes.push(opts?.universe ?? "");
    return aggregateConversationStats({
      conversations: [
        {
          personaId: "p1",
          source: "tk01",
          stage: "CONVERTED",
          replied: true,
          reached: ["CHAT", "LINK_SENT", "CONVERTED"],
          converted: true,
        },
        {
          personaId: "p1",
          source: null,
          stage: "WELCOME",
          replied: false,
          reached: [],
          converted: false,
        },
      ],
      linksSent: [{ personaId: "p1", source: "tk01" }],
      linksOpened: [{ personaId: "p1", source: "tk01" }],
      players: [{ personaId: "p1", source: "tk01", registered: true, ftd: true }],
      costs: [{ personaId: "p1", source: "tk01", costEur: 0.42 }],
      personaNames: { p1: "Léa" },
    });
  }),
}));

import ConversationsStatsPage from "./page";

async function render(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(
    await ConversationsStatsPage({ searchParams: Promise.resolve(sp) } as never),
  );
}

beforeEach(() => {
  m.any = true;
  m.activation = "all";
  m.role = "ADMIN";
  m.periods = [];
  m.universes = [];
});

describe("Conversations → Chiffres", () => {
  it("un titre, aucun bouton orange, cartes, parcours, tableaux, export", async () => {
    const html = await render({ range: "30d" });
    expect(h1Count(html)).toBe(1);
    expect(primaryButtonCount(html)).toBe(0);
    expect(html).toContain('name="range"');
    expect(html).toContain('href="/conversations/stats/export?range=30d"');
    const text = visibleText(html);
    for (const t of [
      "Conversations",
      "Taux de réponse",
      "50 %",
      "Liens ouverts",
      "Inscriptions",
      "Coût de l'IA ce mois-ci",
      "sur 30 € de plafond (20 %)",
      "Parcours, étape par étape",
      "Accueil",
      "Discussion",
      "Lien envoyé",
      "Inscrit",
      "Par persona",
      "Léa",
      "Par source",
      "tk01",
      "Sans source",
    ])
      expect(text).toContain(t);
    expect(jargonIn(text)).toEqual([]);
    expect(text).not.toMatch(/entonnoir|dating/i);
    expect(m.periods).toHaveLength(1);
  });

  it("comparaison : la période précédente est aussi lue", async () => {
    await render({ range: "7d", compare: "1" });
    expect(m.periods).toHaveLength(2);
  });

  it("aucune conversation : explication, lien des réglages pour un administrateur si désactivée", async () => {
    m.any = false;
    m.activation = "off";
    const html = await render();
    expect(visibleText(html)).toContain("Pas encore de conversation");
    expect(html).toContain('href="/settings/assistant"');
    m.role = "MANAGER";
    expect(await render()).not.toContain('href="/settings/assistant"');
  });

  it("filtre Univers : Tous, Rencontres, Casino, Paris sportifs ; gardé dans l'export", async () => {
    const html = await render({ range: "7d", universe: "casino" });
    const text = visibleText(html);
    for (const t of ["Univers", "Tous", "Rencontres", "Casino", "Paris sportifs"])
      expect(text).toContain(t);
    expect(m.universes).toEqual(["casino"]);
    expect(html).toContain('href="/conversations/stats/export?range=7d&amp;universe=casino"');
    expect(html).toContain('href="/conversations/stats?range=7d&amp;universe=sports"');
    await render({ universe: "poker" });
    expect(m.universes.at(-1)).toBe("");
  });
});
