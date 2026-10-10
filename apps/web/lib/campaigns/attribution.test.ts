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
} from "./attribution";

const scope = { channelIds: ["ch1"], inviteLinkIds: ["il1"], trackingLinkIds: ["tl1"], affiliateCampaignIds: ["aff1"] };
const members = new Set(["m1"]);

describe("rattachement des joueurs à une campagne", () => {
  it("compte un joueur de la bonne campagne Link Affi même sans clic", () => {
    expect(isCampaignPlayer({ affiliateCampaignId: "aff1", memberId: null, click: null }, scope, members)).toBe(true);
  });
  it("exclut un joueur d'une autre campagne Link Affi sans lien avec nos membres", () => {
    expect(isCampaignPlayer({ affiliateCampaignId: "aff2", memberId: "m9", click: { trackingLinkId: "tl9" } }, scope, members)).toBe(false);
  });
  it("compte un joueur d'une autre campagne Link Affi s'il vient d'un membre arrivé par nos liens", () => {
    expect(isCampaignPlayer({ affiliateCampaignId: "aff2", memberId: "m1", click: null }, scope, members)).toBe(true);
  });
  it("compte un joueur dont le clic vient d'un lien de la campagne", () => {
    expect(isCampaignPlayer({ affiliateCampaignId: "aff2", memberId: null, click: { trackingLinkId: "tl1" } }, scope, members)).toBe(true);
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
});

describe("conditions Prisma d'une campagne", () => {
  it("membres : arrivés par un lien d'entrée, rien si la campagne n'a pas de lien", () => {
    expect(campaignMemberWhere(scope)).toEqual({ memberships: { some: { inviteLinkId: { in: ["il1"] } } } });
    expect(campaignMemberWhere({ inviteLinkIds: [] })).toEqual({ id: { in: [] } });
  });
  it("joueurs : clic OU membre OU campagne Link Affi", () => {
    const w = campaignPlayerWhere(scope) as { OR: unknown[] };
    expect(w.OR).toHaveLength(3);
    expect(w.OR[2]).toEqual({ affiliateCampaignId: { in: ["aff1"] } });
    expect(campaignPlayerWhere({ channelIds: [], inviteLinkIds: [], trackingLinkIds: [], affiliateCampaignIds: [] })).toEqual({ id: { in: [] } });
  });
  it("clics d'offre : avec sub-ID, hors robots", () => {
    const w = campaignOfferClickWhere(scope) as { isBot: boolean; subId: unknown; OR: unknown[] };
    expect(w.isBot).toBe(false);
    expect(w.subId).toEqual({ not: null });
    expect(w.OR).toHaveLength(3);
  });
  it("messages : canaux de la campagne ou boutons vers ses offres", () => {
    const w = campaignPostWhere("c1", scope) as { OR: unknown[] };
    expect(w.OR).toContainEqual({ channelId: { in: ["ch1"] } });
    expect(w.OR).toContainEqual({ trackingLinks: { some: { campaignId: "c1" } } });
    expect(w.OR).toContainEqual({ trackingLinks: { some: { affiliateCampaignId: { in: ["aff1"] } } } });
  });
  it("envois : segment visant la campagne ou un de ses canaux", () => {
    const w = campaignBroadcastWhere("c1", scope) as { OR: unknown[] };
    expect(w.OR).toHaveLength(2);
    expect(w.OR[0]).toEqual({ segment: { path: ["campaignIds"], array_contains: ["c1"] } });
  });
});

describe("périmètre d'une campagne", () => {
  it("réunit les liens directs et ceux des pubs précises, sans doublon", () => {
    const s = scopeFromCampaign({
      channelIds: ["ch1", 3, ""],
      affiliateCampaignIds: ["aff1"],
      inviteLinks: [{ id: "il1" }],
      trackingLinks: [{ id: "tl1" }],
      adSets: [{ ads: [{ inviteLinkId: "il1", trackingLinkId: "tl2" }, { inviteLinkId: null, trackingLinkId: null }] }],
    });
    expect(s).toEqual({ channelIds: ["ch1"], inviteLinkIds: ["il1"], trackingLinkIds: ["tl1", "tl2"], affiliateCampaignIds: ["aff1"] });
  });
});
