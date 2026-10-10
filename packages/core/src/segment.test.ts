import { describe, expect, it } from "vitest";
import {
  buildMemberWhere,
  describeSegment,
  isEmptySegment,
  matchesSpendLevels,
  parseSegment,
  withReachableBy,
} from "./segment";

describe("segments", () => {
  it("lit un segment JSON en ignorant l'invalide", () => {
    expect(
      parseSegment({ channelIds: ["a", "", 3], inactiveDays: "7", tags: [], spendLevels: ["VIP"] }),
    ).toEqual({ channelIds: ["a"], inactiveDays: 7, spendLevels: ["VIP"] });
    expect(parseSegment(null)).toEqual({});
    expect(isEmptySegment(parseSegment({ inactiveDays: 0 }))).toBe(true);
  });

  it("exclut toujours les anonymisés", () => {
    expect(buildMemberWhere({})).toEqual({ anonymizedAt: null });
  });

  it("combine canaux, statuts, liens et campagnes dans une seule adhésion", () => {
    const w = buildMemberWhere({
      channelIds: ["c1"],
      membershipStatuses: ["APPROVED"],
      inviteLinkIds: ["l1"],
      campaignIds: ["p1"],
    }) as { AND: unknown[] };
    expect(w.AND[1]).toEqual({
      memberships: {
        some: {
          channelId: { in: ["c1"] },
          status: { in: ["APPROVED"] },
          inviteLinkId: { in: ["l1"] },
          inviteLink: { campaignId: { in: ["p1"] } },
        },
      },
    });
  });

  it("gère langues, inactivité, catégories cliquées et étiquettes", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const w = buildMemberWhere(
      {
        languages: ["FR", "en"],
        inactiveDays: 7,
        clickedCategoryIds: ["cat"],
        tags: ["vip", "test"],
      },
      now,
    ) as { AND: Record<string, unknown>[] };
    expect(w.AND[1]).toEqual({
      OR: [{ languageCode: { startsWith: "fr" } }, { languageCode: { startsWith: "en" } }],
    });
    expect(w.AND[2]).toEqual({ lastSeenAt: { lt: new Date("2026-10-02T12:00:00Z") } });
    expect(w.AND[3]).toEqual({ clicks: { some: { post: { categoryId: { in: ["cat"] } } } } });
    expect(w.AND[4]).toEqual({
      OR: [{ tags: { array_contains: ["vip"] } }, { tags: { array_contains: ["test"] } }],
    });
  });

  it("ajoute la condition de joignabilité par bot", () => {
    expect(withReachableBy({ anonymizedAt: null }, "b1")).toEqual({
      AND: [{ anonymizedAt: null }, { botStates: { some: { botId: "b1", canDm: true } } }],
    });
  });

  it("filtre le niveau de dépense après requête", () => {
    expect(matchesSpendLevels("VIP", {})).toBe(true);
    expect(matchesSpendLevels("VIP", { spendLevels: ["VIP", "REGULIER"] })).toBe(true);
    expect(matchesSpendLevels("AUCUN", { spendLevels: ["VIP"] })).toBe(false);
  });

  it("décrit un segment en français", () => {
    expect(describeSegment({})).toBe("tous les membres joignables");
    expect(
      describeSegment({ channelIds: ["c1"], inactiveDays: 3 }, { channels: { c1: "Test" } }),
    ).toBe("canaux : Test · inactifs depuis 3 j");
    // « Campagne » = la nôtre (page Campagnes), jamais « pub ».
    expect(describeSegment({ campaignIds: ["k1"] }, { campaigns: { k1: "TT casino" } })).toBe(
      "campagnes : TT casino",
    );
  });
});
