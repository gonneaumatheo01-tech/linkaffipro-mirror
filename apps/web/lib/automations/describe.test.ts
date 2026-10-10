import { describe, expect, it } from "vitest";
import { describeConditions } from "./describe";

const names = {
  channels: { c1: "Casino VIP", c2: "Foot" },
  campaigns: { k1: "Octobre" },
  categories: { g1: "Bonus" },
};

describe("filtres du départ en français", () => {
  it("tous les filtres, au singulier et au pluriel", () => {
    expect(
      describeConditions(
        {
          channelIds: ["c1", "c2"],
          campaignIds: ["k1"],
          languages: ["fr"],
          spendLevels: ["VIP"],
          inactiveDays: 7,
          categoryIds: ["g1"],
        },
        names,
      ),
    ).toBe(
      "canaux : Casino VIP, Foot · campagne : Octobre · langue : fr · niveau : VIP · rien fait depuis 7 jours · catégorie : Bonus",
    );
  });

  it("sans filtre, filtres illisibles, éléments supprimés", () => {
    expect(describeConditions({}, names)).toBe("tous les membres");
    expect(describeConditions({ spendLevels: ["???"] }, names)).toBe("filtres à corriger");
    expect(describeConditions({ channelIds: ["zz"], inactiveDays: 1 }, names)).toBe(
      "canal : canal supprimé · rien fait depuis 1 jour",
    );
  });
});
