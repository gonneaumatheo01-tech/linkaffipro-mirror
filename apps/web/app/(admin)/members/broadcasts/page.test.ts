import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Page « Écrire à un groupe » rendue côté serveur (liste simulée) : le filtre Campagne arrive jusqu'à la liste et à
// l'export ; sous-navigation Membres et bouton principal.
const mocks = vi.hoisted(() => ({
  listBroadcasts: vi.fn(async (..._args: unknown[]) => ({ rows: [], total: 0, pages: 1, page: 1 })),
}));

vi.mock("@/lib/broadcasts/queries", () => ({
  listBroadcasts: mocks.listBroadcasts,
  progressOf: () => ({ done: 0, pct: 0 }),
}));
vi.mock("@/lib/broadcasts/results", () => ({
  clicksByBroadcast: vi.fn(async () => new Map()),
  loadGroupNames: vi.fn(async () => ({})),
}));
vi.mock("@/lib/campaigns/queries", () => ({
  listCampaignOptions: vi.fn(async () => [{ id: "c1", name: "TT-casino" }]),
}));
vi.mock("@/components/admin/remember-filters", () => ({ RememberFilters: () => null }));

import BroadcastsPage from "./page";

async function render(sp: Record<string, string>): Promise<string> {
  return renderToStaticMarkup(await BroadcastsPage({ searchParams: Promise.resolve(sp) } as never));
}

describe("page « Écrire à un groupe » : filtre Campagne", () => {
  it("transmis à la liste et au lien d'export (campaignId)", async () => {
    const html = await render({ status: "SENT", campaignId: "c1" });
    expect(mocks.listBroadcasts).toHaveBeenLastCalledWith(1, "SENT", "c1");
    expect(html).toContain('href="/members/broadcasts/export?status=SENT&amp;campaignId=c1"');
  });
  it("ancien nom « campaign » accepté", async () => {
    const html = await render({ campaign: "c1" });
    expect(mocks.listBroadcasts).toHaveBeenLastCalledWith(1, undefined, "c1");
    expect(html).toContain('href="/members/broadcasts/export?campaignId=c1"');
  });
  it("sans filtre : export de tous les envois", async () => {
    const html = await render({});
    expect(html).toContain('href="/members/broadcasts/export"');
  });
  it("sous-navigation Membres, un seul bouton principal « Écrire à un groupe », sans jargon", async () => {
    const html = await render({});
    expect(html).toContain('aria-label="Rubriques Membres"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Écrire à un groupe<\/a>/);
    expect(html).toContain('href="/members/broadcasts/new"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toMatch(/segment/i);
    expect(html).toContain("Aucun message à un groupe pour l&#x27;instant");
  });
});
