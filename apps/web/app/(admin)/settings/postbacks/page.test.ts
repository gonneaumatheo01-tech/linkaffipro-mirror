import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { h1Count, jargonIn, primaryButtonCount, visibleText } from "../categories/page-checks";

// Réglages → Avancé → Retours du casino (postbacks) rendue côté serveur avec une base simulée.
const mocks = vi.hoisted(() => ({
  endpoints: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    postbackEndpoint: { findMany: vi.fn(async () => mocks.endpoints) },
    affiliateProgram: {
      findMany: vi.fn(async () => [{ id: "p1", name: "Casino Royal", source: "LINKAFFI" }]),
    },
    postbackLog: { findMany: vi.fn(async () => mocks.logs) },
  },
}));
vi.mock("@/lib/session", () => ({ requireAdminPage: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("./actions", () => ({
  createEndpointAction: vi.fn(),
  regenerateTokenAction: vi.fn(),
  testPostbackAction: vi.fn(),
  toggleEndpointAction: vi.fn(),
  updateEndpointAction: vi.fn(),
}));

import PostbacksPage from "./page";

async function render(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await PostbacksPage({ searchParams: Promise.resolve(sp) } as never));
}

beforeEach(() => {
  mocks.endpoints = [];
  mocks.logs = [];
});

describe("Réglages → Avancé → Retours du casino", () => {
  it("titre « Retours du casino (postbacks) » : le terme exact n'apparaît que là, et au survol", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(html).toMatch(/<h1[^>]*>Retours du casino \(postbacks\)<\/h1>/);
    expect(html).toContain('href="/settings"');
    expect(primaryButtonCount(html)).toBe(1);
    expect(html).toContain('title="postback"');
    const text = visibleText(html);
    expect(jargonIn(text.replace("Retours du casino (postbacks)", ""))).toEqual([]);
    expect(html).toContain('href="/settings/postbacks/import"');
    expect(html).toContain('href="/members/players/export"');
  });

  it("adresse : lien à copier, compteurs en mots simples ; historique des retours", async () => {
    mocks.endpoints = [
      {
        id: "e1",
        name: "Casino Royal : retours",
        token: "jeton",
        mapping: {},
        isActive: true,
        lastReceivedAt: new Date("2026-10-10T10:00:00Z"),
        program: { name: "Casino Royal" },
        _count: { logs: 2 },
      },
    ];
    mocks.logs = [
      {
        id: "l1",
        receivedAt: new Date("2026-10-10T10:00:00Z"),
        raw: { player_id: "p1", event: "ftd" },
        status: "ACCEPTED",
        message: "Premier dépôt enregistré.",
        endpoint: { name: "Casino Royal : retours", mapping: {} },
      },
    ];
    const html = await render();
    expect(html).toContain("/api/postback/jeton");
    const text = visibleText(html);
    expect(text).toContain("2 retours reçus");
    expect(text).toContain("Modifier et tester");
    expect(text).toContain("Accepté");
    expect(text).toContain("Premier dépôt enregistré.");
  });
});
