import { describe, expect, it } from "vitest";
import { collectAffiliateCampaignIds, isOurPlayer, ngrDeltaEvent, ourPlayerWhere } from "./attribution-scope";

describe("périmètre « nos joueurs »", () => {
  it("construit la condition : clic rattaché, ou campagne Link Affi rattachée à une de nos campagnes", () => {
    expect(ourPlayerWhere([])).toEqual({ OR: [{ clickId: { not: null } }] });
    expect(ourPlayerWhere(["a", "a", "b"])).toEqual({ OR: [{ clickId: { not: null } }, { affiliateCampaignId: { in: ["a", "b"] } }] });
  });
  it("lit les identifiants depuis le JSON des campagnes, en ignorant les valeurs invalides", () => {
    expect(collectAffiliateCampaignIds([{ affiliateCampaignIds: ["x", 3, ""] }, { affiliateCampaignIds: null }, { affiliateCampaignIds: ["y", "x"] }])).toEqual(["x", "y"]);
  });
  it("exclut les joueurs d'un autre affilié", () => {
    const ids = new Set(["camp1"]);
    expect(isOurPlayer({ clickId: "c", affiliateCampaignId: null }, ids)).toBe(true);
    expect(isOurPlayer({ clickId: null, affiliateCampaignId: "camp1" }, ids)).toBe(true);
    expect(isOurPlayer({ clickId: null, affiliateCampaignId: "autre" }, ids)).toBe(false);
    expect(isOurPlayer({ clickId: null, affiliateCampaignId: null }, ids)).toBe(false);
  });
  it("NGR : un événement daté par variation, rien si inchangé", () => {
    const now = new Date("2026-10-10T10:00:00Z");
    expect(ngrDeltaEvent(10, 10, null, now)).toBeNull();
    expect(ngrDeltaEvent(10, 25.5, new Date("2026-10-01T00:00:00Z"), now)).toEqual({ amount: 15.5, occurredAt: new Date("2026-10-01T00:00:00Z") });
    expect(ngrDeltaEvent(10, 4, null, now)).toEqual({ amount: -6, occurredAt: now });
  });
});
