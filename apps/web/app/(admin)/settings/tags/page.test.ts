import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  currentLinks,
  h1Count,
  jargonIn,
  primaryButtonCount,
  visibleText,
} from "../categories/page-checks";

// Réglages → Étiquettes de membres rendue côté serveur avec une base simulée.
const mocks = vi.hoisted(() => ({
  registry: [] as Array<{ name: string; color: string }>,
  count: 0,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    setting: { findUnique: vi.fn(async () => ({ value: mocks.registry })) },
    member: { count: vi.fn(async () => mocks.count) },
  },
}));
vi.mock("@/lib/session", () => ({ requireAdminPage: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("./actions", () => ({
  createTagAction: vi.fn(),
  updateTagAction: vi.fn(),
  deleteTagAction: vi.fn(),
}));

import TagsPage from "./page";

async function render(): Promise<string> {
  return renderToStaticMarkup(await TagsPage({ searchParams: Promise.resolve({}) } as never));
}

beforeEach(() => {
  mocks.registry = [];
  mocks.count = 0;
});

describe("Réglages → Étiquettes de membres", () => {
  it("socle : un titre, retour vers Réglages, un seul bouton orange, onglet actif du groupe", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(html).toContain('href="/settings"');
    expect(primaryButtonCount(html)).toBe(1);
    expect(currentLinks(html)).toEqual(["/settings/tags"]);
    expect(html).toContain('href="/settings/categories"');
    expect(html).toContain("Aucune étiquette pour l&#x27;instant");
  });

  it("liste : étiquette, couleur et nombre de membres, sans jargon", async () => {
    mocks.registry = [{ name: "VIP", color: "orange" }];
    mocks.count = 8;
    const text = visibleText(await render());
    expect(text).toContain("VIP");
    expect(text).toContain("Orange");
    expect(text).toContain("8 membres");
    expect(jargonIn(text)).toEqual([]);
  });
});
