import { beforeEach, describe, expect, it, vi } from "vitest";

// Export CSV des envois : filtres statut et campagne, comme la liste (base et session simulées).
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(async (_args: unknown) => [] as unknown[]),
  campaignScope: vi.fn(async (_id: string) => ({
    channelIds: ["ch1", "ch2"],
    inviteLinkIds: [],
    trackingLinkIds: [],
    affiliateCampaignIds: [],
  })),
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    broadcast: { findMany: mocks.findMany },
    trackingLink: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", role: "MANAGER" })),
}));
vi.mock("@/lib/dashboard/campaign-scope", () => ({ campaignScope: mocks.campaignScope }));
vi.mock("@/lib/campaigns/queries", () => ({ listCampaignOptions: vi.fn(async () => []) }));

import { GET } from "./route";

function whereOf(): Record<string, unknown> {
  return (mocks.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
}

const CAMPAIGN_OR = [
  { segment: { path: ["campaignIds"], array_contains: ["c1"] } },
  { segment: { path: ["channelIds"], array_contains: ["ch1"] } },
  { segment: { path: ["channelIds"], array_contains: ["ch2"] } },
];

beforeEach(() => {
  mocks.findMany.mockClear();
  mocks.campaignScope.mockClear();
});

describe("export CSV des envois", () => {
  it("sans filtre : tous les envois", async () => {
    const res = await GET(new Request("http://localhost/members/broadcasts/export"));
    expect(res.status).toBe(200);
    expect(whereOf()).toEqual({});
    expect(mocks.campaignScope).not.toHaveBeenCalled();
  });
  it("filtre campagne : segment visant la campagne ou un de ses canaux", async () => {
    await GET(new Request("http://localhost/members/broadcasts/export?campaignId=c1"));
    expect(mocks.campaignScope).toHaveBeenCalledWith("c1");
    expect(whereOf()).toEqual({ OR: CAMPAIGN_OR });
  });
  it("statut et campagne se combinent", async () => {
    await GET(new Request("http://localhost/members/broadcasts/export?status=SENT&campaignId=c1"));
    expect(whereOf()).toEqual({ status: "SENT", OR: CAMPAIGN_OR });
  });
  it("statut inconnu ignoré ; ancien nom « campaign » accepté", async () => {
    await GET(new Request("http://localhost/members/broadcasts/export?status=PIRATE&campaign=c1"));
    expect(whereOf()).toEqual({ OR: CAMPAIGN_OR });
  });
});
