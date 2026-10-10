import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLinks, h1Count, jargonIn, primaryButtonCount, visibleText } from "./page-checks";

// Réglages → Catégories de messages rendue côté serveur avec une base simulée.
const mocks = vi.hoisted(() => ({
  categories: [] as Array<Record<string, unknown>>,
  rules: [] as Array<{ conditions: unknown }>,
  broadcasts: [] as Array<{ segment: unknown }>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    messageCategory: { findMany: vi.fn(async () => mocks.categories) },
    automationRule: { findMany: vi.fn(async () => mocks.rules) },
    broadcast: { findMany: vi.fn(async () => mocks.broadcasts) },
  },
}));
vi.mock("@/lib/session", () => ({ requireAdminPage: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("./actions", () => ({
  createCategoryAction: vi.fn(),
  updateCategoryAction: vi.fn(),
  deleteCategoryAction: vi.fn(),
}));

import CategoriesPage from "./page";

async function render(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await CategoriesPage({ searchParams: Promise.resolve(sp) } as never));
}

const cat = (id: string, name: string, posts: number, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  slug: id,
  color: "#64748b",
  vertical: null,
  sortOrder: 0,
  isActive: true,
  _count: { posts },
  ...extra,
});

beforeEach(() => {
  mocks.categories = [];
  mocks.rules = [];
  mocks.broadcasts = [];
});

describe("Réglages → Catégories de messages", () => {
  it("socle : un titre, retour vers Réglages, un seul bouton orange, onglets du groupe", async () => {
    const html = await render();
    expect(h1Count(html)).toBe(1);
    expect(html).toContain('href="/settings"');
    expect(primaryButtonCount(html)).toBe(1);
    expect(html).toContain('aria-label="Catégories et étiquettes"');
    expect(currentLinks(html)).toEqual(["/settings/categories"]);
    expect(html).toContain('href="/settings/tags"');
    expect(html).toContain("Aucune catégorie pour l&#x27;instant");
  });

  it("liste : utilisation en mots simples, univers et état, sans jargon", async () => {
    mocks.categories = [
      cat("c1", "Bonus", 3, { vertical: "DATING" }),
      cat("c2", "Jackpot", 0, { isActive: false }),
    ];
    mocks.rules = [{ conditions: { categoryIds: ["c1"] } }];
    mocks.broadcasts = [{ segment: { clickedCategoryIds: ["c1"] } }];
    const html = await render();
    const text = visibleText(html);
    expect(text).toContain(
      "3 messages · 1 relance automatique · 1 message à un groupe pas encore parti",
    );
    expect(text).toContain("Pas encore utilisée");
    expect(text).toContain("Rencontres");
    expect(text).toContain("Inactive");
    expect(jargonIn(text)).toEqual([]);
    expect(html).not.toContain("dark:");
  });
});
