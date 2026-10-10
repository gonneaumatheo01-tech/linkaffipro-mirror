import { beforeEach, describe, expect, it, vi } from "vitest";

// Export CSV des messages : mêmes filtres que la liste, dont la campagne (base et session simulées).
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(async (_args: unknown) => [] as unknown[]),
  campaignScope: vi.fn(async (_id: string) => ({
    channelIds: ["ch1"],
    inviteLinkIds: [],
    trackingLinkIds: [],
    affiliateCampaignIds: ["aff1"],
  })),
}));

vi.mock("@linkaffipro/db", () => ({ prisma: { post: { findMany: mocks.findMany } } }));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: "MANAGER" })),
}));
vi.mock("@/lib/dashboard/campaign-scope", () => ({ campaignScope: mocks.campaignScope }));

import { GET } from "./route";

function whereOf(): Record<string, unknown> {
  return (mocks.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
}

beforeEach(() => {
  mocks.findMany.mockClear();
  mocks.campaignScope.mockClear();
});

describe("export CSV des messages", () => {
  it("sans filtre : tous les messages (hors modèles)", async () => {
    const res = await GET(new Request("http://localhost/messages/export"));
    expect(res.status).toBe(200);
    expect(whereOf()).toEqual({ isTemplate: false });
    expect(mocks.campaignScope).not.toHaveBeenCalled();
  });
  it("filtre campagne (campaignId) : périmètre de la campagne, comme la liste", async () => {
    await GET(new Request("http://localhost/messages/export?campaignId=c1&status=SENT"));
    expect(mocks.campaignScope).toHaveBeenCalledWith("c1");
    const where = whereOf() as { status: string; AND: Array<{ OR: unknown[] }> };
    expect(where.status).toBe("SENT");
    expect(where.AND[0]!.OR).toEqual([
      { trackingLinks: { some: { campaignId: "c1" } } },
      { channelId: { in: ["ch1"] } },
      { trackingLinks: { some: { affiliateCampaignId: { in: ["aff1"] } } } },
    ]);
  });
  it("ancien nom du paramètre (campaign) accepté", async () => {
    await GET(new Request("http://localhost/messages/export?campaign=c1"));
    expect(mocks.campaignScope).toHaveBeenCalledWith("c1");
    expect(whereOf().AND).toHaveLength(1);
  });
});
