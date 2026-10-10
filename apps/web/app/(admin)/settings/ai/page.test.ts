import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, jargonIn, primaryButtonCount, visibleText } from "../categories/page-checks";

// Réglages → IA rendue côté serveur (configuration et usage simulés), pour un administrateur et un manager.
const mocks = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "MANAGER",
  state: {
    hasKey: false,
    keyHint: null as string | null,
    verifiedAt: null as string | null,
    lastError: null as string | null,
    defaultModel: "claude-haiku-5-5",
    qualityModel: "claude-sonnet-5-5",
    monthlyCapEur: 20,
    perUserDailyLimit: 50,
    riskNotice: { casino: "Jouer comporte des risques.", sports: "Parier comporte des risques." },
  },
  history: [] as Array<Record<string, unknown>>,
  costEur: 5,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: mocks.role })),
}));
vi.mock("@/lib/ai/config", () => ({ loadAiConfigState: vi.fn(async () => mocks.state) }));
vi.mock("@/lib/ai/usage", () => ({
  monthUsage: vi.fn(async () => ({
    count: 3,
    costEur: mocks.costEur,
    byUser: [{ userId: "u1", name: "Léa", count: 3, costEur: mocks.costEur }],
  })),
  recentSuggestions: vi.fn(async () => mocks.history),
}));
vi.mock("./actions", () => ({
  removeAiKeyAction: vi.fn(),
  saveAiSettingsAction: vi.fn(),
  verifyAiKeyAction: vi.fn(),
}));

import AiSettingsPage from "./page";

async function render(): Promise<string> {
  return renderToStaticMarkup(await AiSettingsPage({ searchParams: Promise.resolve({}) } as never));
}

beforeEach(() => {
  mocks.role = "ADMIN";
  mocks.state.hasKey = false;
  mocks.history = [];
  mocks.costEur = 5;
});

describe("Réglages → IA", () => {
  it("administrateur : un titre, un seul bouton orange, mêmes champs qu'avant, modèles dans « Avancé »", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(html).toContain('href="/settings"');
    expect(primaryButtonCount(html)).toBe(1);
    for (const name of [
      "apiKey",
      "defaultModel",
      "qualityModel",
      "monthlyCapEur",
      "perUserDailyLimit",
      "riskCasino",
      "riskSports",
    ])
      expect(html).toContain(`name="${name}"`);
    expect(visibleText(html)).toContain("Avancé : modèles et mention des risques");
    expect(visibleText(html)).toContain("Aucune clé");
    expect(html).toContain('aria-valuenow="25"');
  });

  it("historique : 5 colonnes au plus, mots du client", async () => {
    mocks.history = [
      {
        id: "h1",
        kind: "improve",
        context: { surface: "broadcast", vertical: "DATING" },
        model: "claude-haiku-5-5",
        costEur: 0.0012,
        usedIndex: 0,
        createdAt: new Date("2026-10-10T10:00:00Z"),
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
        user: { name: "Léa" },
      },
    ];
    const html = await render();
    const headers = [...html.matchAll(/<th\b/g)].length;
    // Deux tableaux : usage par personne (3 colonnes) et historique (5 colonnes).
    expect(headers).toBe(8);
    const text = visibleText(html);
    expect(text).toContain("Améliorer");
    expect(text).toContain("Version 1");
    expect(jargonIn(text)).toEqual([]);
  });

  it("coût du mois au centime, jamais 4 décimales ; « moins de 0,01 € » sous le centime", async () => {
    const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
    let text = plain(visibleText(await render()));
    expect(text).toContain("5,00 €");
    expect(text).not.toMatch(/\d,\d{4} €/);

    mocks.costEur = 0.0042;
    text = plain(visibleText(await render()));
    expect(text).toMatch(/moins de\s*0,01 €/);
    expect(text).not.toMatch(/\d,\d{4} €/);
  });

  it("manager : lecture seule, aucun champ ni bouton orange", async () => {
    mocks.role = "MANAGER";
    const html = await render();
    expect(html).not.toContain('name="apiKey"');
    expect(primaryButtonCount(html)).toBe(0);
    expect(visibleText(html)).toContain("Lecture seule");
  });
});
