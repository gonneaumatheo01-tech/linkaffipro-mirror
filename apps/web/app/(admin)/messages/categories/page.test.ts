import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Page « Comparer par catégorie » rendue côté serveur avec une base simulée : états vides avec les catégories du client.
const mocks = vi.hoisted(() => ({
  categories: [] as Array<{ id: string; name: string; color: string }>,
  posts: [] as Array<{ categoryId: string | null; stats: null }>,
  role: "ADMIN" as "ADMIN" | "MANAGER",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@linkaffipro/db", () => ({
  prisma: {
    channel: { findMany: vi.fn(async () => []) },
    messageCategory: { findMany: vi.fn(async () => mocks.categories) },
    post: { findMany: vi.fn(async () => mocks.posts) },
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: mocks.role })),
}));

import CategoryComparisonPage from "./page";

async function render(sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(
    await CategoryComparisonPage({ searchParams: Promise.resolve(sp) } as never),
  );
}

const sent = (categoryId: string | null) => ({ categoryId, stats: null });

beforeEach(() => {
  mocks.categories = [];
  mocks.posts = [];
  mocks.role = "ADMIN";
});

describe("comparaison par catégorie : états vides", () => {
  it("aucune catégorie : invite à créer la première, lien vers Réglages → Catégories", async () => {
    mocks.posts = [sent(null), sent(null)];
    const html = await render();
    expect(html).toContain(
      "Créez votre première catégorie (par exemple Bonus ou Rappel) pour comparer vos messages",
    );
    expect(html).toContain('href="/settings/categories"');
    // Pas de tableau réduit à une seule ligne « Sans catégorie ».
    expect(html).not.toContain("<table");
  });
  it("aucune catégorie, côté manager (Réglages réservés aux admins) : création depuis Nouveau message", async () => {
    mocks.role = "MANAGER";
    const html = await render();
    expect(html).toContain("Créez votre première catégorie");
    expect(html).not.toContain('href="/settings/categories"');
    expect(html).toContain('href="/messages/new"');
    expect(html).toContain("+ Nouvelle catégorie");
  });
  it("des messages envoyés sans catégorie : phrase d'explication", async () => {
    mocks.categories = [{ id: "c1", name: "Promo", color: "#16a34a" }];
    mocks.posts = [sent("c1"), sent(null), sent(null)];
    const html = await render();
    expect(html).toContain("<table");
    expect(html).toContain("Sans catégorie");
    expect(html).toMatch(/2 messages envoyés sur la période n&#x27;ont pas de catégorie/);
  });
  it("tous les messages ont une catégorie : pas d'explication", async () => {
    mocks.categories = [{ id: "c1", name: "Promo", color: "#16a34a" }];
    mocks.posts = [sent("c1")];
    const html = await render();
    expect(html).not.toContain("pas de catégorie");
  });
  it("des catégories mais aucun message envoyé : état vide habituel", async () => {
    mocks.categories = [{ id: "c1", name: "Promo", color: "#16a34a" }];
    const html = await render();
    expect(html).toContain("Aucun message envoyé sur la période");
    expect(html).toContain('href="/messages/new"');
  });
  it("filtré sur un canal sans envoi : phrase adaptée et retour à tous les canaux", async () => {
    mocks.categories = [{ id: "c1", name: "Promo", color: "#16a34a" }];
    const html = await render({ range: "7d", channel: "ch1" });
    expect(html).toContain("Aucun message envoyé dans ce canal sur la période");
    expect(html).toContain("Changez de période ou de canal.");
    expect(html).toContain('href="/messages/categories?range=7d&amp;measure=');
    expect(html).toContain("Tous les canaux");
    expect(html).not.toContain("Donnez une catégorie");
  });
});
