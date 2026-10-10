import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Page Messages rendue côté serveur avec une base simulée : filtre Campagne du calendrier, thème des modèles.
const mocks = vi.hoisted(() => ({
  listCalendarPosts: vi.fn(async (_opts: unknown) => [] as unknown[]),
  listPosts: vi.fn(async (_opts: unknown) => ({ rows: [] as unknown[], total: 0, pages: 1 })),
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    channel: { findMany: vi.fn(async () => [{ id: "ch1", title: "Mediatheque" }]) },
    messageCategory: {
      findMany: vi.fn(async () => [{ id: "cat1", name: "Promo", color: "#000000" }]),
    },
  },
}));
vi.mock("@/lib/dashboard/campaign-scope", () => ({ campaignScope: vi.fn() }));
vi.mock("@/lib/campaigns/queries", () => ({
  listCampaignOptions: vi.fn(async () => [{ id: "c1", name: "TT-casino" }]),
}));
vi.mock("@/lib/posts/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/posts/queries")>()),
  listCalendarPosts: mocks.listCalendarPosts,
  listPosts: mocks.listPosts,
}));
vi.mock("@/components/admin/remember-filters", () => ({ RememberFilters: () => null }));

import MessagesPage from "./page";

async function render(sp: Record<string, string>): Promise<string> {
  const el = await MessagesPage({ searchParams: Promise.resolve(sp) } as never);
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  mocks.listCalendarPosts.mockClear();
  mocks.listPosts.mockClear();
});

describe("page Messages : filtre Campagne sur le calendrier", () => {
  it("le calendrier applique la campagne choisie (paramètre campaignId)", async () => {
    const html = await render({ campaignId: "c1" });
    expect(mocks.listCalendarPosts).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c1" }),
    );
    expect(html).toMatch(/<select[^>]*name="campaignId"/);
    expect(html).toContain("TT-casino");
    // La navigation de semaine garde le filtre.
    expect(html).toMatch(/Semaine précédente/);
    expect(html).toMatch(/href="\/messages\?view=calendar&amp;week=[0-9-]+&amp;campaignId=c1"/);
  });
  it("l'ancien paramètre « campaign » reste accepté", async () => {
    await render({ view: "calendar", campaign: "c1" });
    expect(mocks.listCalendarPosts).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c1" }),
    );
  });
  it("liste : le lien d'export transmet campaignId", async () => {
    const html = await render({ view: "list", campaignId: "c1" });
    expect(mocks.listPosts).toHaveBeenCalledWith(
      expect.objectContaining({ filters: expect.objectContaining({ campaignId: "c1" }) }),
    );
    expect(html).toMatch(/href="\/messages\/export\?campaignId=c1"/);
    expect(html).toMatch(/<select[^>]*name="campaignId"/);
  });
});

describe("page Messages : vue Modèles par thème", () => {
  it("filtre « Thème » à la place de « Catégorie »", async () => {
    const html = await render({ view: "templates", theme: "bonus" });
    expect(mocks.listPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        view: "templates",
        filters: expect.objectContaining({ theme: "bonus" }),
      }),
    );
    expect(html).toMatch(/<select[^>]*name="theme"/);
    expect(html).toContain("Preuve de gains");
    expect(html).not.toContain("Toutes les catégories");
  });
  it("aucun modèle : pas de renvoi vers une commande technique", async () => {
    const html = await render({ view: "templates" });
    expect(html).toContain("Aucun modèle");
    expect(html).not.toContain("pnpm");
    expect(html).not.toContain("seed:templates");
  });
});
