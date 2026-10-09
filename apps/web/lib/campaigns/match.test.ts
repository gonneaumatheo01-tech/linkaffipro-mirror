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

import { buildCampaignName, nameSimilarity, nameTokens, rankByName, suggestAffiliateCampaign } from "./match";

describe("convention de nommage", () => {
  it("génère TT-casinoX-FR-canalA-2026-10", () => {
    expect(buildCampaignName({ platform: "TIKTOK", program: "casinoX", language: "fr", channel: "Canal A", date: new Date(2026, 9, 9) })).toBe("TT-casinoX-FR-canalA-2026-10");
  });
  it("retombe sur l'univers et omet les segments vides", () => {
    expect(buildCampaignName({ platform: "META", program: "CASINO", language: "", channel: "", date: new Date(2026, 0, 1) })).toBe("META-casino-2026-01");
    expect(buildCampaignName({ date: new Date(2026, 11, 31) })).toBe("2026-12");
  });
  it("découpe les noms en jetons utiles", () => {
    expect(nameTokens("TT-casinoX-FR-canalA-2026-10")).toEqual(["tt", "casino", "fr", "canal", "2026", "10"]);
    expect(nameTokens("Offre de la Campagne")).toEqual([]);
  });
});

describe("liaison suggérée pub ↔ campagne Link Affi", () => {
  const affil = [
    { id: "a1", name: "CasinoX FR" },
    { id: "a2", name: "SportsBet DE" },
    { id: "a3", name: "Dating Latino" },
  ];
  it("trouve la campagne la plus proche par jetons communs", () => {
    const s = suggestAffiliateCampaign("TT-casinoX-FR-canalA-2026-10", affil);
    expect(s?.candidate.id).toBe("a1");
    expect(s!.score).toBeGreaterThanOrEqual(0.34);
  });
  it("ne propose rien quand rien ne ressemble", () => {
    expect(suggestAffiliateCampaign("META-poker-IT-2026-10", affil)).toBeNull();
    expect(nameSimilarity("", "x")).toBe(0);
  });
  it("noms identiques à la casse et aux accents près : score 1", () => {
    expect(nameSimilarity("Casino X FR", "casino x fr")).toBe(1);
  });
  it("classe les candidats", () => {
    const r = rankByName("sportsbet de canal", affil);
    expect(r[0]?.candidate.id).toBe("a2");
    expect(r.every((x) => x.score > 0)).toBe(true);
  });
});
