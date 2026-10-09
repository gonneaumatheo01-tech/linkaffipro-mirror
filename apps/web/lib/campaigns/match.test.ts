import { describe, expect, it } from "vitest";
import { levelKey, matchByName, matchRow, normalizeName } from "./match";

const tree = [{ id: "c1", name: "TT Casino FR", adSets: [{ id: "s1", name: "Groupe A", ads: [{ id: "a1", name: "Vidéo 3" }] }] }];

describe("correspondance de noms", () => {
  it("ignore casse, accents et espaces", () => {
    expect(normalizeName("  TT  Casino  FR ")).toBe("tt casino fr");
    expect(matchByName("tt casino fr", tree)?.id).toBe("c1");
    expect(matchByName("video 3", tree[0]!.adSets[0]!.ads)?.id).toBe("a1");
    expect(matchByName("inconnu", tree)).toBeNull();
  });
  it("résout une ligne complète", () => {
    const m = matchRow({ campaign: "TT Casino FR", adset: "groupe a", ad: "Vidéo 3" }, tree);
    expect(m.campaign).toEqual({ name: "TT Casino FR", id: "c1", status: "existing" });
    expect(m.adset?.id).toBe("s1");
    expect(m.ad?.id).toBe("a1");
  });
  it("propose la création pour l'inconnu et un groupe implicite sans adset", () => {
    const m = matchRow({ campaign: "Nouvelle", adset: "", ad: "Pub X" }, tree);
    expect(m.campaign.status).toBe("create");
    expect(m.adset).toEqual({ name: "Nouvelle", id: null, status: "create" });
    expect(m.ad?.status).toBe("create");
  });
  it("calcule la clé de niveau", () => {
    expect(levelKey({ adId: "a" })).toBe("ad:a");
    expect(levelKey({ adSetId: "s" })).toBe("adset:s");
    expect(levelKey({ campaignId: "c" })).toBe("campaign:c");
    expect(() => levelKey({})).toThrow();
  });
});
