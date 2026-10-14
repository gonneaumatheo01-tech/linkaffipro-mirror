import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {} }));
vi.mock("@/lib/dashboard/campaign-scope", () => ({ campaignScope: vi.fn() }));

import { buildWhere, filtersToQuery, groupLanguages, parseMemberFilters, toRow } from "./query";

describe("filtre « Campagne » de la liste des membres", () => {
  it("lit campaignId dans l'adresse et le conserve dans les liens (export, tri, pages)", () => {
    const f = parseMemberFilters({ campaignId: "c1", page: "2" });
    expect(f.campaignId).toBe("c1");
    expect(filtersToQuery(f)).toBe("?campaignId=c1&page=2");
  });
  it("ne garde que les membres arrivés par un lien d'entrée de la campagne", () => {
    const f = parseMemberFilters({ campaignId: "c1" });
    const w = buildWhere(f, {
      channelIds: [],
      inviteLinkIds: ["il1", "il2"],
      trackingLinkIds: [],
      affiliateCampaignIds: [],
    });
    expect(w.AND).toEqual([{ memberships: { some: { inviteLinkId: { in: ["il1", "il2"] } } } }]);
  });
  it("campagne sans lien d'entrée : aucun membre", () => {
    const f = parseMemberFilters({ campaignId: "c1" });
    const w = buildWhere(f, {
      channelIds: [],
      inviteLinkIds: [],
      trackingLinkIds: [],
      affiliateCampaignIds: [],
    });
    expect(w.AND).toEqual([{ id: { in: [] } }]);
  });
  it("sans campagne : rien n'est ajouté", () => {
    expect(buildWhere(parseMemberFilters({}))).toEqual({});
  });
});

describe("filtres en langage courant de la liste des membres", () => {
  // 10 oct. 2026, 12 h à Paris (heure d'été : UTC+2).
  const now = new Date("2026-10-10T10:00:00Z");

  it("« ont déposé » : un compte joueur avec un dépôt (même règle que le niveau de dépense)", () => {
    expect(buildWhere(parseMemberFilters({ deposited: "1" }), null, now).AND).toEqual([
      { players: { some: { OR: [{ depositCount: { gt: 0 } }, { depositTotal: { gt: 0 } }] } } },
    ]);
  });
  it("« premier dépôt » : jours de Paris, borne de fin exclue", () => {
    expect(buildWhere(parseMemberFilters({ ftd: "today" }), null, now).AND).toEqual([
      {
        players: {
          some: {
            ftdAt: { gte: new Date("2026-10-09T22:00:00Z"), lt: new Date("2026-10-10T22:00:00Z") },
          },
        },
      },
    ]);
    expect(buildWhere(parseMemberFilters({ ftd: "7d" }), null, now).AND).toEqual([
      {
        players: {
          some: {
            ftdAt: { gte: new Date("2026-10-03T22:00:00Z"), lt: new Date("2026-10-10T22:00:00Z") },
          },
        },
      },
    ]);
  });
  it("« rien fait depuis N jours » : même règle que les groupes de membres", () => {
    expect(buildWhere(parseMemberFilters({ inactive: "7" }), null, now).AND).toEqual([
      { lastSeenAt: { lt: new Date("2026-10-03T10:00:00Z") } },
    ]);
  });
  it("univers, canal et statut portent sur une même adhésion", () => {
    expect(
      buildWhere(
        parseMemberFilters({ universe: "SPORTS", status: "APPROVED", channelId: "ch1" }),
        null,
        now,
      ).AND,
    ).toEqual([
      {
        memberships: {
          some: { channelId: "ch1", status: "APPROVED", channel: { vertical: "SPORTS" } },
        },
      },
    ]);
  });
});

describe("filtre « Affilié » (phase 13)", () => {
  it("membres amenés par cet affilié Link Affi (premier affilié gagne)", () => {
    expect(buildWhere(parseMemberFilters({ affiliateId: "aff-paul" })).AND).toEqual([
      { linkaffiAffiliateId: "aff-paul" },
    ]);
  });
});

describe("langues proposées dans les filtres", () => {
  it("regroupe par code de base, de la plus fréquente à la moins fréquente", () => {
    expect(
      groupLanguages([
        { code: "fr", count: 10 },
        { code: "en", count: 3 },
        { code: "fr-FR", count: 2 },
        { code: "pt-br", count: 3 },
        { code: " ", count: 9 },
      ]),
    ).toEqual([
      { code: "fr", count: 12 },
      { code: "en", count: 3 },
      { code: "pt", count: 3 },
    ]);
  });
});

describe("ligne de la liste : d'où vient un membre d'affilié", () => {
  const thresholds = { regular: 3, vip: 1000, whale: 5000 } as never;
  const member = (inviteLink: Record<string, unknown>) =>
    ({
      id: "m1",
      telegramUserId: 42n,
      firstName: "Nora",
      lastName: null,
      username: "nora",
      languageCode: "fr",
      anonymizedAt: null,
      tags: [],
      firstSeenAt: new Date("2026-10-01T10:00:00Z"),
      lastSeenAt: null,
      players: [],
      _count: { clicks: 0 },
      memberships: [
        {
          requestedAt: new Date("2026-10-01T10:00:00Z"),
          status: "APPROVED",
          channel: { title: "Casino VIP", vertical: "CASINO" },
          inviteLink,
        },
      ],
    }) as never;

  it("lien d'affilié Link Affi : type du lien et affilié dans l'origine, « Affilié Paul » comme source", () => {
    const row = toRow(
      member({
        name: "Paul — Casino VIP",
        kind: "LINKAFFI",
        adName: null,
        adPlatform: null,
        linkaffiAffiliateId: "demo-aff-paul",
        linkaffiAffiliateName: "Paul",
        campaign: null,
      }),
      thresholds,
    );
    expect(row.origin).toMatchObject({
      kind: "LINKAFFI",
      affiliateName: "Paul",
      affiliateId: "demo-aff-paul",
      linkName: "Paul — Casino VIP",
    });
    expect(row.source).toBe("Affilié Paul");
  });

  it("lien de pub : inchangé (nom de la pub, sinon nom du lien)", () => {
    const row = toRow(
      member({
        name: "TT — Vidéo 1",
        kind: "AD_ENTRY",
        adName: "Vidéo 1",
        adPlatform: "TIKTOK",
        linkaffiAffiliateId: null,
        linkaffiAffiliateName: null,
        campaign: null,
      }),
      thresholds,
    );
    expect(row.origin).toMatchObject({ kind: "AD_ENTRY", affiliateName: null });
    expect(row.source).toBe("Vidéo 1");
  });
});
