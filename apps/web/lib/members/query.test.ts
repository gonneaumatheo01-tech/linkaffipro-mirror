import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {} }));
vi.mock("@/lib/dashboard/campaign-scope", () => ({ campaignScope: vi.fn() }));

import { buildWhere, filtersToQuery, parseMemberFilters } from "./query";

describe("filtre « Campagne » de la liste des membres", () => {
  it("lit campaignId dans l'adresse et le conserve dans les liens (export, tri, pages)", () => {
    const f = parseMemberFilters({ campaignId: "c1", page: "2" });
    expect(f.campaignId).toBe("c1");
    expect(filtersToQuery(f)).toBe("?campaignId=c1&page=2");
  });
  it("ne garde que les membres arrivés par un lien d'entrée de la campagne", () => {
    const f = parseMemberFilters({ campaignId: "c1" });
    const w = buildWhere(f, { channelIds: [], inviteLinkIds: ["il1", "il2"], trackingLinkIds: [], affiliateCampaignIds: [] });
    expect(w.AND).toEqual([{ memberships: { some: { inviteLinkId: { in: ["il1", "il2"] } } } }]);
  });
  it("campagne sans lien d'entrée : aucun membre", () => {
    const f = parseMemberFilters({ campaignId: "c1" });
    const w = buildWhere(f, { channelIds: [], inviteLinkIds: [], trackingLinkIds: [], affiliateCampaignIds: [] });
    expect(w.AND).toEqual([{ id: { in: [] } }]);
  });
  it("sans campagne : rien n'est ajouté", () => {
    expect(buildWhere(parseMemberFilters({}))).toEqual({});
  });
});
