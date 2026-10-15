import { describe, expect, it } from "vitest";
import {
  attributePlayers,
  buildCampaignIndex,
  campaignBroadcastWhere,
  campaignMemberWhere,
  campaignOfferClickWhere,
  campaignPlayerWhere,
  campaignPostWhere,
  campaignsOfMember,
  campaignsOfOfferClick,
  campaignsOfPlayer,
  isCampaignPlayer,
  jsonIds,
  landingAdByInviteLink,
  landingLinkCampaignFixes,
  scopeFromCampaign,
  type CampaignScope,
} from "./campaign-attribution";

const scope: CampaignScope = {
  channelIds: ["ch1"],
  inviteLinkIds: ["il1"],
  trackingLinkIds: ["tl1"],
  affiliateCampaignIds: ["aff1"],
};
const members = new Set(["m1"]);

describe("rattachement d'un joueur à une campagne (en mémoire)", () => {
  it("compte un joueur de la bonne offre Link Affi s'il n'a aucun clic", () => {
    expect(
      isCampaignPlayer(
        { affiliateCampaignId: "aff1", memberId: null, click: null },
        scope,
        members,
      ),
    ).toBe(true);
    expect(isCampaignPlayer({ affiliateCampaignId: "aff1", clickId: null }, scope, members)).toBe(
      true,
    );
  });
  it("ne compte pas par l'offre un joueur dont le clic vient d'ailleurs (offre partagée)", () => {
    expect(
      isCampaignPlayer(
        { affiliateCampaignId: "aff1", clickId: "c9", click: { trackingLinkId: "tl9" } },
        scope,
        members,
      ),
    ).toBe(false);
    expect(isCampaignPlayer({ affiliateCampaignId: "aff1", clickId: "c9" }, scope, members)).toBe(
      false,
    );
  });
  it("compte par l'offre un joueur venu d'un ancien bouton Offre sans campagne (comme son clic)", () => {
    expect(
      isCampaignPlayer(
        {
          affiliateCampaignId: "aff1",
          clickId: "c8",
          click: { trackingLinkId: "tl-ancien", trackingLink: { campaignId: null } },
        },
        scope,
        members,
      ),
    ).toBe(true);
    // Bouton rattaché à une autre campagne : pas par l'offre.
    expect(
      isCampaignPlayer(
        {
          affiliateCampaignId: "aff1",
          clickId: "c8",
          click: { trackingLinkId: "tl-autre", trackingLink: { campaignId: "AUTRE" } },
        },
        scope,
        members,
      ),
    ).toBe(false);
  });
  it("exclut un joueur d'une autre offre sans lien avec nos membres", () => {
    expect(
      isCampaignPlayer(
        { affiliateCampaignId: "aff2", memberId: "m9", click: { trackingLinkId: "tl9" } },
        scope,
        members,
      ),
    ).toBe(false);
  });
  it("compte un joueur d'une autre offre s'il vient d'un membre arrivé par nos liens", () => {
    expect(
      isCampaignPlayer(
        { affiliateCampaignId: "aff2", memberId: "m1", click: null },
        scope,
        members,
      ),
    ).toBe(true);
  });
  it("compte un joueur dont le clic vient d'un lien de la campagne", () => {
    expect(
      isCampaignPlayer(
        { affiliateCampaignId: "aff2", memberId: null, click: { trackingLinkId: "tl1" } },
        scope,
        members,
      ),
    ).toBe(true);
  });
  it("filtre une liste", () => {
    const kept = attributePlayers(
      [
        { id: "a", affiliateCampaignId: "aff1" },
        { id: "b", affiliateCampaignId: "aff2" },
        { id: "c", affiliateCampaignId: "aff2", memberId: "m1" },
        { id: "d", affiliateCampaignId: "aff1", clickId: "x", click: { trackingLinkId: "tl9" } },
      ],
      scope,
      ["m1"],
    );
    expect(kept.map((p) => p.id)).toEqual(["a", "c"]);
  });
});

describe("conditions Prisma d'une campagne", () => {
  it("membres : arrivés par un lien d'entrée, rien si la campagne n'a pas de lien", () => {
    expect(campaignMemberWhere(scope)).toEqual({
      memberships: { some: { inviteLinkId: { in: ["il1"] } } },
    });
    expect(campaignMemberWhere({ inviteLinkIds: [] })).toEqual({ id: { in: [] } });
  });
  it("joueurs : clic OU membre OU offre Link Affi (sans clic, ou clic sur un bouton sans campagne)", () => {
    const w = campaignPlayerWhere(scope) as { OR: unknown[] };
    expect(w.OR).toHaveLength(3);
    expect(w.OR[0]).toEqual({ click: { trackingLinkId: { in: ["tl1"] } } });
    expect(w.OR[2]).toEqual({
      affiliateCampaignId: { in: ["aff1"] },
      OR: [{ clickId: null }, { click: { trackingLink: { campaignId: null } } }],
    });
    expect(
      campaignPlayerWhere({
        channelIds: [],
        inviteLinkIds: [],
        trackingLinkIds: [],
        affiliateCampaignIds: [],
      }),
    ).toEqual({ id: { in: [] } });
  });
  it("clics d'offre : avec sub-ID, hors robots ; par l'offre seulement si le lien n'appartient à aucune campagne", () => {
    const w = campaignOfferClickWhere(scope) as { isBot: boolean; subId: unknown; OR: unknown[] };
    expect(w.isBot).toBe(false);
    expect(w.subId).toEqual({ not: null });
    expect(w.OR).toHaveLength(3);
    expect(w.OR).toContainEqual({
      trackingLink: { campaignId: null, affiliateCampaignId: { in: ["aff1"] } },
    });
  });
  it("messages : canaux de la campagne ou boutons vers ses offres", () => {
    const w = campaignPostWhere("c1", scope) as { OR: unknown[] };
    expect(w.OR).toContainEqual({ channelId: { in: ["ch1"] } });
    expect(w.OR).toContainEqual({ trackingLinks: { some: { campaignId: "c1" } } });
    expect(w.OR).toContainEqual({
      trackingLinks: { some: { affiliateCampaignId: { in: ["aff1"] } } },
    });
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
      adSets: [
        {
          ads: [
            { inviteLinkId: "il1", trackingLinkId: "tl2" },
            { inviteLinkId: null, trackingLinkId: null },
          ],
        },
      ],
    });
    expect(s).toEqual({
      channelIds: ["ch1"],
      inviteLinkIds: ["il1"],
      trackingLinkIds: ["tl1", "tl2"],
      affiliateCampaignIds: ["aff1"],
    });
  });
  it("lit les identifiants d'une colonne JSON", () => {
    expect(jsonIds(["a", "", 2, "b"])).toEqual(["a", "b"]);
    expect(jsonIds(null)).toEqual([]);
  });
});

describe("deux campagnes qui partagent la même offre Link Affi", () => {
  // TT-casinoX et FB-casinoX promeuvent toutes deux l'offre « aff1 » ; chacune a son lien traqué et son lien d'entrée.
  const tt: CampaignScope = {
    channelIds: ["ch1"],
    inviteLinkIds: ["il-tt"],
    trackingLinkIds: ["tl-tt"],
    affiliateCampaignIds: ["aff1"],
  };
  const fb: CampaignScope = {
    channelIds: ["ch1"],
    inviteLinkIds: ["il-fb"],
    trackingLinkIds: ["tl-fb"],
    affiliateCampaignIds: ["aff1"],
  };
  const index = buildCampaignIndex([
    { id: "TT", vertical: "CASINO", scope: tt },
    { id: "FB", vertical: "CASINO", scope: fb },
  ]);

  it("un joueur venu par le lien de TT ne compte que dans TT", () => {
    const p = { affiliateCampaignId: "aff1", clickId: "c1", click: { trackingLinkId: "tl-tt" } };
    expect(isCampaignPlayer(p, tt, [])).toBe(true);
    expect(isCampaignPlayer(p, fb, [])).toBe(false);
    expect(
      campaignsOfPlayer(index, {
        affiliateCampaignId: "aff1",
        clickId: "c1",
        clickTrackingLinkId: "tl-tt",
        clickTrackingLinkCampaignId: "TT",
        memberInviteLinkIds: [],
      }),
    ).toEqual(["TT"]);
  });
  it("un joueur dont le membre est arrivé par le lien d'entrée de FB ne compte que dans FB", () => {
    expect(
      campaignsOfPlayer(index, {
        affiliateCampaignId: "aff1",
        clickId: "c2",
        clickTrackingLinkId: "tl-fb",
        clickTrackingLinkCampaignId: "FB",
        memberInviteLinkIds: ["il-fb"],
      }),
    ).toEqual(["FB"]);
  });
  it("un joueur sans clic de l'offre partagée compte dans chacune (impossible de trancher)", () => {
    expect(
      campaignsOfPlayer(index, {
        affiliateCampaignId: "aff1",
        clickId: null,
        clickTrackingLinkId: null,
        clickTrackingLinkCampaignId: null,
        memberInviteLinkIds: [],
      }),
    ).toEqual(["TT", "FB"]);
  });
  it("un joueur venu d'un ancien bouton Offre sans campagne compte dans chaque campagne de l'offre, comme son clic", () => {
    const viaOldButton = {
      affiliateCampaignId: "aff1",
      clickId: "c3",
      clickTrackingLinkId: "tl-ancien",
      clickTrackingLinkCampaignId: null,
      memberInviteLinkIds: [],
    };
    expect(campaignsOfPlayer(index, viaOldButton)).toEqual(["TT", "FB"]);
    expect(
      campaignsOfOfferClick(index, {
        trackingLinkId: "tl-ancien",
        trackingLinkCampaignId: null,
        trackingLinkAffiliateCampaignId: "aff1",
        memberInviteLinkIds: [],
      }),
    ).toEqual(campaignsOfPlayer(index, viaOldButton));
    // Bouton d'une autre campagne (hors TT et FB) : ni le clic ni le joueur ne comptent par l'offre.
    expect(
      campaignsOfPlayer(index, {
        ...viaOldButton,
        clickTrackingLinkId: "tl-x",
        clickTrackingLinkCampaignId: "AUTRE",
      }),
    ).toEqual([]);
  });
  it("un joueur d'une autre offre n'appartient à aucune campagne", () => {
    expect(
      campaignsOfPlayer(index, {
        affiliateCampaignId: "aff2",
        clickId: null,
        clickTrackingLinkId: null,
        clickTrackingLinkCampaignId: null,
        memberInviteLinkIds: [],
      }),
    ).toEqual([]);
  });
  it("clics d'offre : le lien d'une campagne ne compte que pour elle ; un bouton sans campagne compte pour l'offre", () => {
    expect(
      campaignsOfOfferClick(index, {
        trackingLinkId: "tl-tt",
        trackingLinkCampaignId: "TT",
        trackingLinkAffiliateCampaignId: "aff1",
        memberInviteLinkIds: [],
      }),
    ).toEqual(["TT"]);
    expect(
      campaignsOfOfferClick(index, {
        trackingLinkId: "tl-bouton",
        trackingLinkCampaignId: null,
        trackingLinkAffiliateCampaignId: "aff1",
        memberInviteLinkIds: ["il-fb"],
      }),
    ).toEqual(["FB", "TT"]);
    expect(
      campaignsOfOfferClick(index, {
        trackingLinkId: "tl-x",
        trackingLinkCampaignId: "AUTRE",
        trackingLinkAffiliateCampaignId: "aff1",
        memberInviteLinkIds: [],
      }),
    ).toEqual([]);
  });
  it("rattachements en mémoire par lien d'entrée et lien traqué", () => {
    expect(index.byInvite.get("il-tt")).toEqual(["TT"]);
    expect(index.byTracking.get("tl-fb")).toEqual(["FB"]);
    expect(index.byOffer.get("aff1")).toEqual(["TT", "FB"]);
    expect(index.vertical.get("FB")).toBe("CASINO");
  });
});

describe("pages d'atterrissage : pub figée sur le lien (phase 15, D9)", () => {
  it("chaque lien compte pour la pub pour laquelle il a été créé, jamais d'après la pub actuelle de sa source", () => {
    const map = landingAdByInviteLink([
      // Lien actuel de tk01 (pub Y) et ancien lien de tk01 (créé pour la pub X) : chacun garde sa pub.
      { id: "l-y", landingAdId: "adY" },
      { id: "l-x", landingAdId: "adX" },
      // Page supprimée (landingPageId vidé) : le lien garde sa pub.
      { id: "l-page-supprimee", landingAdId: "adX" },
      // Pub supprimée (landingAdId vidé) ou source sans pub : aucune pub.
      { id: "l-sans-pub", landingAdId: null },
    ]);
    expect(Object.fromEntries(map)).toEqual({
      "l-y": "adY",
      "l-x": "adX",
      "l-page-supprimee": "adX",
    });
  });

  it("campagne du lien actuel : celle de sa pub figée ; lien sans pub (pub supprimée) jamais retiré de sa campagne", () => {
    expect(
      landingLinkCampaignFixes([
        // Déjà juste : rien.
        { id: "l1", landingAdId: "ad1", campaignId: "C1", adCampaignId: "C1" },
        // Campagne manquante ou différente de celle de la pub : corrigée.
        { id: "l2", landingAdId: "ad1", campaignId: null, adCampaignId: "C1" },
        { id: "l3", landingAdId: "ad2", campaignId: "C1", adCampaignId: "C2" },
        // Pub supprimée : le lien garde sa campagne (ses demandes restent dans la campagne, comme un lien direct).
        { id: "l4", landingAdId: null, campaignId: "C1", adCampaignId: null },
        // Lien sans pub ni campagne : rien.
        { id: "l5", landingAdId: null, campaignId: null, adCampaignId: null },
      ]),
    ).toEqual([
      { id: "l2", campaignId: "C1" },
      { id: "l3", campaignId: "C2" },
    ]);
  });

  it("une demande par le lien d'une source reliée compte une seule fois pour la campagne", () => {
    const index = buildCampaignIndex([
      {
        id: "C1",
        scope: scopeFromCampaign({
          channelIds: [],
          affiliateCampaignIds: [],
          // Lien de la page rattaché à la campagne (InviteLink.campaignId) ET pub de la campagne.
          inviteLinks: [{ id: "l1" }],
          trackingLinks: [],
          adSets: [{ ads: [{ inviteLinkId: "l-pub", trackingLinkId: null }] }],
        }),
      },
    ]);
    expect(campaignsOfMember(index, ["l1", "l1", "l-pub"])).toEqual(["C1"]);
  });
});
