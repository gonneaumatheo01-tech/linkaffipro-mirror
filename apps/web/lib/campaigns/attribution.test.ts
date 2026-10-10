import { describe, expect, it } from "vitest";
import {
  attributePlayers,
  campaignBroadcastWhere,
  campaignMemberWhere,
  campaignOfferClickWhere,
  campaignPlayerWhere,
  campaignPostWhere,
  isCampaignPlayer,
  scopeFromCampaign,
  type CampaignScope,
} from "./attribution";

// Les règles détaillées sont testées dans packages/core/src/campaign-attribution.test.ts ; ici : la réexportation
// garde les mêmes noms et la même règle pour le site.
const scope: CampaignScope = {
  channelIds: ["ch1"],
  inviteLinkIds: ["il1"],
  trackingLinkIds: ["tl1"],
  affiliateCampaignIds: ["aff1"],
};

describe("rattachement des joueurs à une campagne (réexporté depuis le cœur)", () => {
  it("compte un joueur de la bonne offre Link Affi sans clic, pas celui qu'un clic rattache ailleurs", () => {
    expect(
      isCampaignPlayer({ affiliateCampaignId: "aff1", memberId: null, click: null }, scope, []),
    ).toBe(true);
    expect(
      isCampaignPlayer(
        { affiliateCampaignId: "aff1", clickId: "c9", click: { trackingLinkId: "tl9" } },
        scope,
        [],
      ),
    ).toBe(false);
  });
  it("filtre une liste", () => {
    const kept = attributePlayers(
      [
        { id: "a", affiliateCampaignId: "aff1" },
        { id: "b", affiliateCampaignId: "aff2" },
        { id: "c", affiliateCampaignId: "aff2", memberId: "m1" },
      ],
      scope,
      ["m1"],
    );
    expect(kept.map((p) => p.id)).toEqual(["a", "c"]);
  });
  it("deux campagnes avec la même offre : le joueur venu par le lien de l'une n'entre pas dans l'autre", () => {
    const other: CampaignScope = { ...scope, inviteLinkIds: ["il2"], trackingLinkIds: ["tl2"] };
    const p = { affiliateCampaignId: "aff1", clickId: "c1", click: { trackingLinkId: "tl1" } };
    expect(isCampaignPlayer(p, scope, [])).toBe(true);
    expect(isCampaignPlayer(p, other, [])).toBe(false);
  });
});

describe("conditions Prisma d'une campagne", () => {
  it("membres, joueurs, clics, messages et envois", () => {
    expect(campaignMemberWhere(scope)).toEqual({
      memberships: { some: { inviteLinkId: { in: ["il1"] } } },
    });
    expect((campaignPlayerWhere(scope) as { OR: unknown[] }).OR).toContainEqual({
      affiliateCampaignId: { in: ["aff1"] },
      OR: [{ clickId: null }, { click: { trackingLink: { campaignId: null } } }],
    });
    expect((campaignOfferClickWhere(scope) as { OR: unknown[] }).OR).toContainEqual({
      trackingLink: { campaignId: null, affiliateCampaignId: { in: ["aff1"] } },
    });
    expect((campaignPostWhere("c1", scope) as { OR: unknown[] }).OR).toContainEqual({
      channelId: { in: ["ch1"] },
    });
    expect((campaignBroadcastWhere("c1", scope) as { OR: unknown[] }).OR).toHaveLength(2);
  });
  it("périmètre : liens directs et liens des pubs, sans doublon", () => {
    const s = scopeFromCampaign({
      channelIds: ["ch1"],
      affiliateCampaignIds: ["aff1"],
      inviteLinks: [{ id: "il1" }],
      trackingLinks: [{ id: "tl1" }],
      adSets: [{ ads: [{ inviteLinkId: "il1", trackingLinkId: "tl2" }] }],
    });
    expect(s).toEqual({
      channelIds: ["ch1"],
      inviteLinkIds: ["il1"],
      trackingLinkIds: ["tl1", "tl2"],
      affiliateCampaignIds: ["aff1"],
    });
  });
});
