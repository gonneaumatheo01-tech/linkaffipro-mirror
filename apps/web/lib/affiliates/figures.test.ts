import { describe, expect, it } from "vitest";
import { computeAffiliateViews, emptyFigures, sumFigures, type FigureRows } from "./figures";
import type { AffiliateCampaignRef } from "./scope";

const t = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour));
const within = { start: t(10, 0), end: t(17, 0) };

function ref(over: Partial<AffiliateCampaignRef> & { inviteLinkId: string }): AffiliateCampaignRef {
  return {
    campaignKey: "k1",
    campaignName: "Casino VIP",
    affiliateId: "aff-paul",
    affiliateName: "Paul",
    channelId: "ch1",
    channelTitle: "Casino VIP",
    isActive: true,
    attributionDays: null,
    createdAt: t(1),
    ...over,
  };
}

const paulCasino = ref({ inviteLinkId: "L1", campaignKey: "k1", channelId: "ch1" });
const paulFoot = ref({
  inviteLinkId: "L2",
  campaignKey: "k2",
  campaignName: "Pronos",
  channelId: "ch2",
  channelTitle: "Pronos Foot",
});
const sarah = ref({
  inviteLinkId: "L3",
  campaignKey: "k3",
  campaignName: "Sarah VIP",
  affiliateId: "aff-sarah",
  affiliateName: "Sarah",
  channelId: "ch1",
});
const m = (key: string | null, link: string | null = null) => ({
  linkaffiCampaignKey: key,
  affiliateInviteLinkId: link,
});

function rows(over: Partial<FigureRows> = {}): FigureRows {
  return {
    campaigns: [paulCasino, paulFoot, sarah],
    memberships: [],
    present: [],
    offerClicks: [],
    players: [],
    playerEvents: [],
    clicks: {},
    ...over,
  };
}

describe("chiffres par campagne d'affilié", () => {
  it("campagnes sans activité affichées à zéro ; clics inconnus « null »", () => {
    const { affiliates, totals } = computeAffiliateViews(rows(), within);
    expect(affiliates.map((a) => [a.name, a.campaigns.length])).toEqual([
      ["Paul", 2],
      ["Sarah", 1],
    ]);
    expect(totals).toEqual(emptyFigures(null));
  });

  it("demandes, acceptés et partis à leur date dans la période, dans le canal de la campagne seulement", () => {
    const { affiliates } = computeAffiliateViews(
      rows({
        memberships: [
          // Demande et acceptation dans la période, départ après.
          {
            channelId: "ch1",
            requestedAt: t(11),
            approvedAt: t(11, 13),
            leftAt: t(20),
            member: m("k1"),
          },
          // Demande avant la période, acceptation dedans.
          {
            channelId: "ch1",
            requestedAt: t(8),
            approvedAt: t(12),
            leftAt: t(15),
            member: m("k1"),
          },
          // Membre de Paul (k1) dans un autre canal : pas pour la campagne k1.
          { channelId: "ch2", requestedAt: t(11), approvedAt: null, leftAt: null, member: m("k1") },
          // Membre de Sarah dans le même canal.
          { channelId: "ch1", requestedAt: t(12), approvedAt: null, leftAt: null, member: m("k3") },
        ],
      }),
      within,
    );
    const casino = affiliates[0]!.campaigns.find((c) => c.ref.inviteLinkId === "L1")!.figures;
    expect([casino.requests, casino.approved, casino.left]).toEqual([1, 2, 1]);
    const foot = affiliates[0]!.campaigns.find((c) => c.ref.inviteLinkId === "L2")!.figures;
    expect(foot.requests).toBe(0);
    expect(affiliates[1]!.figures.requests).toBe(1);
  });

  it("présents : en ce moment, une fois par membre et par campagne", () => {
    const { affiliates } = computeAffiliateViews(
      rows({
        present: [
          { channelId: "ch1", memberId: "a", member: m("k1") },
          { channelId: "ch1", memberId: "a", member: m("k1") },
          { channelId: "ch1", memberId: "b", member: m("k1") },
          { channelId: "ch2", memberId: "c", member: m("k1") },
        ],
      }),
      within,
    );
    expect(affiliates[0]!.figures.present).toBe(2);
  });

  it("clics d'offre : par la clé portée par le clic, dans la période ; clé inconnue ignorée", () => {
    const { affiliates, totals } = computeAffiliateViews(
      rows({
        offerClicks: [
          { linkaffiTelegramCampaignKey: "k1", createdAt: t(12), member: m("k1", "L1") },
          { linkaffiTelegramCampaignKey: "k2", createdAt: t(12), member: m("k2") },
          { linkaffiTelegramCampaignKey: "k1", createdAt: t(9), member: m("k1") },
          { linkaffiTelegramCampaignKey: "inconnue", createdAt: t(12), member: null },
        ],
      }),
      within,
    );
    expect(
      affiliates[0]!.campaigns.map((c) => [c.ref.inviteLinkId, c.figures.offerClicks]),
    ).toEqual([
      ["L1", 1],
      ["L2", 1],
    ]);
    expect(totals.offerClicks).toBe(2);
  });

  it("joueurs : inscriptions, premiers dépôts (liste), dépôts et revenu net datés", () => {
    const { affiliates, totals } = computeAffiliateViews(
      rows({
        players: [
          {
            id: "p1",
            memberId: "a",
            memberName: "Nora",
            offerName: "Casino Royal",
            registeredAt: t(11),
            ftdAt: t(12),
            ftdAmount: 50,
            click: { linkaffiTelegramCampaignKey: "k1" },
            member: m("k1", "L1"),
          },
          {
            // Joueur rattaché par son membre (clic sans clé).
            id: "p2",
            memberId: "b",
            memberName: "Léo",
            offerName: "Casino Royal",
            registeredAt: t(5),
            ftdAt: t(14),
            ftdAmount: 20,
            click: { linkaffiTelegramCampaignKey: null },
            member: m("k3", "L3"),
          },
          {
            // Hors période.
            id: "p3",
            memberId: "c",
            memberName: "Ana",
            offerName: "BetFoot",
            registeredAt: t(2),
            ftdAt: t(3),
            ftdAmount: 10,
            click: { linkaffiTelegramCampaignKey: "k2" },
            member: null,
          },
        ],
        playerEvents: [
          { playerId: "p1", type: "FTD", amount: 50, occurredAt: t(12) },
          { playerId: "p1", type: "DEPOSIT", amount: 30.5, occurredAt: t(13) },
          { playerId: "p1", type: "NGR", amount: 42.25, occurredAt: t(13) },
          { playerId: "p1", type: "NGR", amount: -2.25, occurredAt: t(14) },
          { playerId: "p1", type: "NGR", amount: 100, occurredAt: t(20) },
          { playerId: "p2", type: "REDEPOSIT", amount: 15, occurredAt: t(15) },
          { playerId: "p3", type: "NGR", amount: 7, occurredAt: t(12) },
          { playerId: "inconnu", type: "NGR", amount: 999, occurredAt: t(12) },
        ],
      }),
      within,
    );
    const casino = affiliates[0]!.campaigns[0]!;
    expect(casino.ref.inviteLinkId).toBe("L1");
    expect(casino.figures).toMatchObject({
      registrations: 1,
      ftds: 1,
      deposits: 2,
      depositAmount: 80.5,
      revenue: 40,
    });
    expect(casino.ftdList).toEqual([
      {
        playerId: "p1",
        memberId: "a",
        memberName: "Nora",
        ftdAt: t(12),
        amount: 50,
        offerName: "Casino Royal",
      },
    ]);
    expect(affiliates[1]!.figures).toMatchObject({ registrations: 0, ftds: 1, deposits: 1 });
    // Le joueur hors période compte son revenu net du jour (événement daté), pas son inscription.
    expect(affiliates[0]!.campaigns[1]!.figures).toMatchObject({
      registrations: 0,
      ftds: 0,
      revenue: 7,
    });
    expect(totals).toMatchObject({ ftds: 2, revenue: 47, depositAmount: 95.5 });
  });

  it("clics Link Affi : par clé, donnés au premier lien d'une clé sur deux canaux ; totaux sans inventer de zéro", () => {
    const twin = ref({ inviteLinkId: "L4", campaignKey: "k1", channelId: "ch2", createdAt: t(5) });
    const { affiliates, totals } = computeAffiliateViews(
      rows({ campaigns: [paulCasino, twin, sarah], clicks: { k1: 120 } }),
      within,
    );
    const paul = affiliates[0]!;
    expect(paul.campaigns.map((c) => [c.ref.inviteLinkId, c.figures.clicks])).toEqual([
      ["L1", 120],
      ["L4", null],
    ]);
    expect(paul.figures.clicks).toBe(120);
    expect(affiliates[1]!.figures.clicks).toBeNull();
    expect(totals.clicks).toBe(120);
  });

  it("filtres canal et affilié", () => {
    const byChannel = computeAffiliateViews(rows(), within, { channelId: "ch2" });
    expect(byChannel.affiliates.map((a) => a.campaigns.map((c) => c.ref.inviteLinkId))).toEqual([
      ["L2"],
    ]);
    const byAffiliate = computeAffiliateViews(rows(), within, { affiliateId: "aff-sarah" });
    expect(byAffiliate.affiliates.map((a) => a.name)).toEqual(["Sarah"]);
  });

  it("campagnes actives d'abord ; nom de l'affilié le plus récent", () => {
    const old = ref({
      inviteLinkId: "L5",
      campaignKey: "k5",
      campaignName: "Ancienne",
      isActive: false,
      createdAt: t(1),
    });
    const renamed = ref({
      inviteLinkId: "L6",
      campaignKey: "k6",
      campaignName: "Zèbre",
      affiliateName: "Paul Martin",
      createdAt: t(9),
    });
    const { affiliates } = computeAffiliateViews(rows({ campaigns: [old, renamed] }), within);
    expect(affiliates[0]!.name).toBe("Paul Martin");
    expect(affiliates[0]!.campaigns.map((c) => c.ref.inviteLinkId)).toEqual(["L6", "L5"]);
  });

  it("somme de chiffres", () => {
    const a = { ...emptyFigures(3), revenue: 0.1, depositAmount: 0.2 };
    const b = { ...emptyFigures(null), revenue: 0.2, depositAmount: 0.1, ftds: 2 };
    expect(sumFigures([a, b])).toMatchObject({
      clicks: 3,
      revenue: 0.3,
      depositAmount: 0.3,
      ftds: 2,
    });
  });
});
