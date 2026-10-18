import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, jargonIn, primaryButtonCount, visibleText } from "../categories/page-checks";

// Réglages → IA de conversation rendue côté serveur (réglages et dépense simulés). Page réservée aux administrateurs :
// `requireAdminPage` redirige un manager avant tout rendu.
const mocks = vi.hoisted(() => ({
  state: {
    hasKey: false,
    keyHint: null as string | null,
    activation: "off" as "off" | "team" | "all",
    defaultModel: "venice-uncensored-role-play",
    fallbackModel: "venice-uncensored-1-2",
    temperature: 0.85,
    maxTokens: 400,
    monthlyCapEur: 30,
    perConversationDailyLimit: 60,
    models: [] as Array<Record<string, unknown>>,
    modelsFetchedAt: null as string | null,
    verifiedAt: null as string | null,
    lastError: null as string | null,
  },
  usage: { costEur: 6, calls: 12, failed: 1, conversations: 4 },
  requireAdminPage: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ requireAdminPage: mocks.requireAdminPage }));
vi.mock("@/lib/assistant/config", () => ({
  loadAssistantConfigState: vi.fn(async () => mocks.state),
}));
vi.mock("@/lib/assistant/usage", () => ({ monthUsage: vi.fn(async () => mocks.usage) }));
vi.mock("./actions", () => ({
  removeAssistantKeyAction: vi.fn(),
  saveAssistantSettingsAction: vi.fn(),
  verifyAssistantKeyAction: vi.fn(),
}));

import AssistantSettingsPage from "./page";

async function render(): Promise<string> {
  return renderToStaticMarkup(
    await AssistantSettingsPage({ searchParams: Promise.resolve({}) } as never),
  );
}

beforeEach(() => {
  mocks.state.hasKey = false;
  mocks.state.keyHint = null;
  mocks.state.activation = "off";
  mocks.state.models = [];
  mocks.state.defaultModel = "venice-uncensored-role-play";
  mocks.usage = { costEur: 6, calls: 12, failed: 1, conversations: 4 };
  mocks.requireAdminPage.mockClear();
});

describe("Réglages → IA de conversation", () => {
  it("réservée aux administrateurs (vérifié avant le rendu)", async () => {
    await render();
    expect(mocks.requireAdminPage).toHaveBeenCalledTimes(1);
  });

  it("un titre, un seul bouton orange, tous les champs ; désactivé par défaut", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(html).toContain('href="/settings"');
    expect(primaryButtonCount(html)).toBe(1);
    for (const name of [
      "apiKey",
      "activation",
      "defaultModel",
      "fallbackModel",
      "temperature",
      "maxTokens",
      "monthlyCapEur",
      "perConversationDailyLimit",
    ])
      expect(html).toContain(`name="${name}"`);
    const text = visibleText(html);
    expect(text).toContain("IA de conversation");
    expect(text).toContain("Aucune clé Venice enregistrée");
    expect(text).toContain("Seulement l'équipe (essai)");
    expect(text).toContain("Avancé : modèles, créativité et longueur");
    expect(text).toContain("Créer la clé Venice");
    // Plafond : 6 € sur 30 € → 20 %.
    expect(html).toContain('aria-valuenow="20"');
    expect(text).toContain("12 appels à l'IA, dont 1 en échec");
    expect(jargonIn(text)).toEqual([]);
    expect(text).not.toMatch(/dating|entonnoir/i);
  });

  it("la clé n'est jamais dans la page : seulement son indice", async () => {
    mocks.state.hasKey = true;
    mocks.state.keyHint = "VENI…WXYZ";
    const html = await render();
    expect(html).toContain("VENI…WXYZ");
    expect(html).not.toMatch(/apiKeyEncrypted/);
    expect(html).not.toMatch(/name="apiKey"[^>]*value=/);
    expect(visibleText(html)).toContain("Retirer la clé");
    expect(visibleText(html)).toContain("Guide : créer une nouvelle clé Venice");
  });

  it("modèles : liste du cache avec les prix, valeur actuelle gardée si absente", async () => {
    mocks.state.models = [
      {
        id: "venice-uncensored-1-2",
        name: "Venice Uncensored",
        inputUsdPerM: 0.2,
        outputUsdPerM: 0.9,
        maxCompletionTokens: 4096,
        contextLength: 32768,
        supportsResponseSchema: true,
        supportsReasoning: false,
        uncensored: true,
        offline: false,
        deprecated: false,
      },
    ];
    mocks.state.defaultModel = "ancien-modele";
    const text = visibleText(await render());
    expect(text).toContain("ancien-modele — modèle actuel, absent de la liste");
    expect(text).toMatch(
      /Venice Uncensored \(venice-uncensored-1-2\) — lu 0,20\s\$ · écrit 0,90\s\$/,
    );
  });

  it("activation « Tout le monde » : pastille verte dans l'en-tête", async () => {
    mocks.state.hasKey = true;
    mocks.state.activation = "all";
    const text = visibleText(await render());
    expect(text).toContain("Actif pour tout le monde");
  });
});
