import { describe, expect, it } from "vitest";
import {
  affiliateLabel,
  affiliateMembershipWhere,
  affiliateNameMap,
  affiliateOptions,
  affiliatePlayerWhere,
  attributionState,
  broughtBySentence,
  campaignLabel,
  linksByKey,
  playerCampaignKey,
  resolveCampaignLink,
  type AffiliateCampaignRef,
} from "./scope";

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));

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
    createdAt: day(1),
    ...over,
  };
}

describe("noms affichés", () => {
  it("affilié : nom, sinon identifiant, sinon inconnu ; campagne : nom, sinon clé", () => {
    expect(affiliateLabel("aff-1", " Paul ")).toBe("Paul");
    expect(affiliateLabel("aff-1", null)).toBe("Affilié aff-1");
    expect(affiliateLabel(null, "")).toBe("Affilié inconnu");
    expect(campaignLabel({ campaignName: "  ", campaignKey: "abc" })).toBe("abc");
    expect(campaignLabel({ campaignName: "Été", campaignKey: "abc" })).toBe("Été");
  });

  it("phrase de la fiche membre", () => {
    expect(
      broughtBySentence({
        affiliateLabel: "Paul",
        campaignLabel: "Casino VIP",
        attributedAtText: "12 oct. 2026",
      }),
    ).toBe("Amené par Paul · campagne Casino VIP · le 12 oct. 2026");
    expect(
      broughtBySentence({ affiliateLabel: "Paul", campaignLabel: null, attributedAtText: null }),
    ).toBe("Amené par Paul");
  });
});

describe("affiliés connus", () => {
  it("un par identifiant, nom le plus récent non vide, triés par nom ; liens sans affilié ignorés", () => {
    const opts = affiliateOptions([
      { affiliateId: "aff-paul", affiliateName: "Paul D.", createdAt: day(1) },
      { affiliateId: "aff-paul", affiliateName: "Paul", createdAt: day(5) },
      { affiliateId: "aff-paul", affiliateName: "", createdAt: day(9) },
      { affiliateId: "aff-zoe", affiliateName: "Ambre", createdAt: day(2) },
      { affiliateId: null, affiliateName: "Sans identifiant", createdAt: day(3) },
    ]);
    expect(opts).toEqual([
      { id: "aff-zoe", name: "Ambre", campaigns: 1 },
      { id: "aff-paul", name: "Paul", campaigns: 3 },
    ]);
    expect(affiliateNameMap(opts)).toEqual({ "aff-zoe": "Ambre", "aff-paul": "Paul" });
  });
});

describe("rattachement d'un clic ou d'un joueur à une campagne", () => {
  const a = ref({ inviteLinkId: "L1", campaignKey: "k1", channelId: "ch1", createdAt: day(1) });
  const b = ref({ inviteLinkId: "L2", campaignKey: "k1", channelId: "ch2", createdAt: day(3) });
  const c = ref({ inviteLinkId: "L3", campaignKey: "k2", createdAt: day(2) });
  const byKey = linksByKey([b, c, a]);

  it("liens regroupés par clé, du plus ancien au plus récent", () => {
    expect(byKey.get("k1")!.map((l) => l.inviteLinkId)).toEqual(["L1", "L2"]);
  });

  it("le lien du membre s'il porte cette clé, sinon le plus ancien ; clé inconnue : rien", () => {
    expect(resolveCampaignLink(byKey, "k1", "L2")!.inviteLinkId).toBe("L2");
    expect(resolveCampaignLink(byKey, "k1", "L3")!.inviteLinkId).toBe("L1");
    expect(resolveCampaignLink(byKey, "k1")!.inviteLinkId).toBe("L1");
    expect(resolveCampaignLink(byKey, "inconnue")).toBeNull();
    expect(resolveCampaignLink(byKey, null)).toBeNull();
  });

  it("clé d'un joueur : celle du clic (paramètre tg) d'abord, sinon celle du membre, si elle est connue", () => {
    const known = new Set(["k1", "k2"]);
    expect(
      playerCampaignKey(
        { click: { linkaffiTelegramCampaignKey: "k2" }, member: { linkaffiCampaignKey: "k1" } },
        known,
      ),
    ).toBe("k2");
    expect(
      playerCampaignKey(
        { click: { linkaffiTelegramCampaignKey: null }, member: { linkaffiCampaignKey: "k1" } },
        known,
      ),
    ).toBe("k1");
    expect(
      playerCampaignKey(
        { click: { linkaffiTelegramCampaignKey: "zz" }, member: { linkaffiCampaignKey: "yy" } },
        known,
      ),
    ).toBeNull();
    expect(playerCampaignKey({ click: null, member: null }, known)).toBeNull();
  });
});

describe("clauses de filtre", () => {
  it("joueurs : clic portant la clé, ou membre rattaché ; aucune clé : aucun joueur", () => {
    expect(affiliatePlayerWhere(["k1"])).toEqual({
      OR: [
        { click: { linkaffiTelegramCampaignKey: { in: ["k1"] } } },
        { member: { linkaffiCampaignKey: { in: ["k1"] } } },
      ],
    });
    expect(affiliatePlayerWhere([])).toEqual({ id: { in: [] } });
  });

  it("demandes : membres de chaque campagne dans le canal de la campagne ; aucune campagne : aucune", () => {
    expect(
      affiliateMembershipWhere([
        { campaignKey: "k1", channelId: "ch1" },
        { campaignKey: "k2", channelId: "ch2" },
      ]),
    ).toEqual({
      OR: [
        { channelId: "ch1", member: { linkaffiCampaignKey: "k1" } },
        { channelId: "ch2", member: { linkaffiCampaignKey: "k2" } },
      ],
    });
    expect(affiliateMembershipWhere([])).toEqual({ id: { in: [] } });
  });
});

describe("état de l'attribution", () => {
  const now = day(10);
  it("aucune, à vie, jusqu'à une date, terminée", () => {
    expect(
      attributionState({ linkaffiCampaignKey: null, affiliateAttributionEndsAt: null }, now),
    ).toEqual({
      kind: "none",
    });
    expect(
      attributionState({ linkaffiCampaignKey: "k", affiliateAttributionEndsAt: null }, now),
    ).toEqual({
      kind: "lifetime",
    });
    expect(
      attributionState({ linkaffiCampaignKey: "k", affiliateAttributionEndsAt: day(12) }, now).kind,
    ).toBe("until");
    expect(
      attributionState({ linkaffiCampaignKey: "k", affiliateAttributionEndsAt: day(9) }, now).kind,
    ).toBe("ended");
  });
});
