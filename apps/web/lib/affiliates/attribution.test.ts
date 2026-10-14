import { describe, expect, it } from "vitest";
import {
  attributionSnapshot,
  attributionToCampaign,
  NO_AFFILIATE,
  parseReason,
  REASON_MAX,
} from "./attribution";

describe("motif d'une correction d'affilié", () => {
  it("obligatoire : vide ou trop court refusé, avec une phrase claire", () => {
    for (const v of [undefined, null, "", "  ", "ok", 12]) {
      const r = parseReason(v);
      expect(r.ok, String(v)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/motif/);
    }
  });
  it("espaces en trop retirés ; 500 caractères au plus", () => {
    expect(parseReason("  Erreur   de\n lien  ")).toEqual({ ok: true, reason: "Erreur de lien" });
    expect(parseReason("x".repeat(REASON_MAX)).ok).toBe(true);
    expect(parseReason("x".repeat(REASON_MAX + 1)).ok).toBe(false);
  });
});

describe("rattachement choisi par un administrateur", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  it("clé, affilié et lien de la campagne, à la date du changement, pour sa durée", () => {
    expect(
      attributionToCampaign(
        {
          id: "L1",
          linkaffiCampaignKey: "k1",
          linkaffiAffiliateId: "aff-paul",
          attributionDays: 30,
        },
        now,
      ),
    ).toEqual({
      linkaffiCampaignKey: "k1",
      linkaffiAffiliateId: "aff-paul",
      affiliateAttributedAt: now,
      affiliateAttributionEndsAt: new Date("2026-11-13T10:00:00Z"),
      affiliateInviteLinkId: "L1",
    });
    expect(
      attributionToCampaign(
        { id: "L1", linkaffiCampaignKey: "k1", linkaffiAffiliateId: null, attributionDays: null },
        now,
      ).affiliateAttributionEndsAt,
    ).toBeNull();
  });

  it("retrait : tous les champs vidés ; instantané du journal en texte", () => {
    expect(Object.values(NO_AFFILIATE).every((v) => v === null)).toBe(true);
    expect(
      attributionSnapshot({
        linkaffiCampaignKey: "k1",
        linkaffiAffiliateId: "aff",
        affiliateAttributedAt: now,
        affiliateAttributionEndsAt: null,
        affiliateInviteLinkId: "L1",
      }),
    ).toEqual({
      campaignKey: "k1",
      affiliateId: "aff",
      inviteLinkId: "L1",
      attributedAt: "2026-10-14T10:00:00.000Z",
      endsAt: null,
    });
  });
});
