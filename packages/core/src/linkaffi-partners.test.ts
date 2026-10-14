import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  affiliateAttributionDecision,
  affiliateAttributionEndsAt,
  buildLinkaffiEvent,
  generateIntegrationApiKey,
  generateWebhookSecret,
  hashIntegrationApiKey,
  integrationApiKeyPrefix,
  isAffiliateAttributionActive,
  isLinkaffiCampaignKey,
  isLinkaffiQueueStuck,
  linkaffiEventId,
  linkaffiInviteLinkName,
  nextLinkaffiAttemptAt,
  serializeLinkaffiEvent,
  signLinkaffiBody,
  verifyLinkaffiSignature,
  withTelegramCampaignParam,
} from "./linkaffi-partners";

const at = new Date("2026-10-14T10:00:00.000Z");

describe("événements envoyés à Link Affi", () => {
  const body = buildLinkaffiEvent({
    type: "offer_clicked",
    sourceId: "click1",
    occurredAt: at,
    campaignKey: "aB3dE5",
    channel: { id: "ch1", title: "Zone Interdite 🔞" },
    member: { telegramUserId: 9007199254740993n, username: "paul", firstName: "Paul" },
    data: { subId: "AbCdEf123456", offerCampaignKey: "casino1" },
  });

  it("suit exactement le contrat (champs, ordre, identifiant Telegram en chaîne sans perte)", () => {
    expect(Object.keys(body)).toEqual([
      "eventId",
      "type",
      "occurredAt",
      "campaignKey",
      "channel",
      "member",
      "data",
    ]);
    expect(body).toEqual({
      eventId: "lap_offer_clicked_click1",
      type: "offer_clicked",
      occurredAt: "2026-10-14T10:00:00.000Z",
      campaignKey: "aB3dE5",
      channel: { id: "ch1", title: "Zone Interdite 🔞" },
      member: {
        telegramUserId: "9007199254740993",
        username: "paul",
        firstName: "Paul",
        languageCode: null,
      },
      data: { subId: "AbCdEf123456", offerCampaignKey: "casino1" },
    });
  });

  it("identifiant stable : le même fait donne le même identifiant, deux faits différents deux identifiants", () => {
    expect(linkaffiEventId("join_requested", "m1")).toBe(linkaffiEventId("join_requested", "m1"));
    expect(linkaffiEventId("join_requested", "m1")).not.toBe(
      linkaffiEventId("join_approved", "m1"),
    );
  });

  it("signature HMAC-SHA256 du corps brut, vérifiée à temps constant", () => {
    const raw = serializeLinkaffiEvent(body);
    const secret = "lap_whsec_test";
    const sig = signLinkaffiBody(raw, secret);
    expect(sig).toBe(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
    expect(verifyLinkaffiSignature(raw, secret, sig)).toBe(true);
    expect(verifyLinkaffiSignature(raw + " ", secret, sig)).toBe(false);
    expect(verifyLinkaffiSignature(raw, "autre", sig)).toBe(false);
    expect(verifyLinkaffiSignature(raw, secret, null)).toBe(false);
    expect(verifyLinkaffiSignature(raw, secret, "sha256=abc")).toBe(false);
  });
});

describe("clés de l'intégration", () => {
  it("clé d'API et secret aléatoires, empreinte stable, début seulement à l'écran", () => {
    const k1 = generateIntegrationApiKey();
    const k2 = generateIntegrationApiKey();
    expect(k1).toMatch(/^lap_live_[0-9A-Za-z]{40}$/);
    expect(k1).not.toBe(k2);
    expect(hashIntegrationApiKey(k1)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIntegrationApiKey(` ${k1} `)).toBe(hashIntegrationApiKey(k1));
    expect(integrationApiKeyPrefix(k1)).toBe(`${k1.slice(0, 13)}…`);
    expect(generateWebhookSecret()).toMatch(/^lap_whsec_[0-9A-Za-z]{40}$/);
  });
  it("clé de campagne Link Affi", () => {
    expect(isLinkaffiCampaignKey("aB3dE5")).toBe(true);
    expect(isLinkaffiCampaignKey("a b")).toBe(false);
    expect(isLinkaffiCampaignKey("")).toBe(false);
    expect(isLinkaffiCampaignKey(12)).toBe(false);
  });
});

describe("offres : paramètre tg", () => {
  it("ajoute tg au lien Link Affi sans toucher au sub_id", () => {
    expect(
      withTelegramCampaignParam("https://linkaffi.me/go/casino1?sub_id=AbCdEf123456", "aB3dE5"),
    ).toBe("https://linkaffi.me/go/casino1?sub_id=AbCdEf123456&tg=aB3dE5");
    expect(withTelegramCampaignParam("https://linkaffi.me/go/casino1?sub_id=X&tg=old", "new")).toBe(
      "https://linkaffi.me/go/casino1?sub_id=X&tg=new",
    );
    expect(withTelegramCampaignParam("pas une url?x=1", "k")).toBe("pas une url?x=1&tg=k");
  });
});

describe("attribution des membres", () => {
  it("premier affilié gagne ; jamais un membre déjà dans le canal ; seulement par un lien d'affilié", () => {
    expect(
      affiliateAttributionDecision({
        isAffiliateLink: true,
        memberAffiliateId: null,
        alreadyInChannel: false,
      }),
    ).toEqual({
      attribute: true,
    });
    expect(
      affiliateAttributionDecision({
        isAffiliateLink: true,
        memberAffiliateId: "a1",
        alreadyInChannel: false,
      }),
    ).toEqual({
      attribute: false,
      reason: "already_attributed",
    });
    expect(
      affiliateAttributionDecision({
        isAffiliateLink: true,
        memberAffiliateId: null,
        alreadyInChannel: true,
      }),
    ).toEqual({
      attribute: false,
      reason: "already_member",
    });
    expect(
      affiliateAttributionDecision({
        isAffiliateLink: false,
        memberAffiliateId: null,
        alreadyInChannel: false,
      }),
    ).toMatchObject({
      attribute: false,
    });
  });
  it("à vie par défaut, ou pendant la durée de la campagne", () => {
    expect(affiliateAttributionEndsAt(at, null)).toBeNull();
    expect(affiliateAttributionEndsAt(at, 30)?.toISOString()).toBe("2026-11-13T10:00:00.000Z");
    const ends = affiliateAttributionEndsAt(at, 1)!;
    expect(
      isAffiliateAttributionActive(
        { linkaffiCampaignKey: "k", affiliateAttributionEndsAt: null },
        at,
      ),
    ).toBe(true);
    expect(
      isAffiliateAttributionActive(
        { linkaffiCampaignKey: "k", affiliateAttributionEndsAt: ends },
        at,
      ),
    ).toBe(true);
    expect(
      isAffiliateAttributionActive(
        { linkaffiCampaignKey: "k", affiliateAttributionEndsAt: ends },
        ends,
      ),
    ).toBe(false);
    expect(
      isAffiliateAttributionActive(
        { linkaffiCampaignKey: null, affiliateAttributionEndsAt: null },
        at,
      ),
    ).toBe(false);
  });
  it("nom du lien Telegram : 32 unités Telegram au plus, sans couper un emoji", () => {
    const n = linkaffiInviteLinkName("Paul · Zone Interdite 🔞 campagne d'automne");
    expect(n.length).toBeLessThanOrEqual(32);
    expect(n.startsWith("Paul · Zone Interdite 🔞")).toBe(true);
    const e = linkaffiInviteLinkName("🔞".repeat(40));
    expect(e).toBe("🔞".repeat(16));
    expect(linkaffiInviteLinkName("  ")).toBe("Campagne Link Affi");
  });
});

describe("envoi : nouvelles tentatives pendant 24 h", () => {
  it("attente croissante puis toutes les 2 h, abandon après 24 h", () => {
    expect(nextLinkaffiAttemptAt(1, at, at)?.getTime()).toBe(at.getTime() + 30_000);
    expect(nextLinkaffiAttemptAt(2, at, at)?.getTime()).toBe(at.getTime() + 60_000);
    expect(nextLinkaffiAttemptAt(20, at, at)?.getTime()).toBe(at.getTime() + 2 * 3_600_000);
    const late = new Date(at.getTime() + 23 * 3_600_000);
    expect(nextLinkaffiAttemptAt(20, at, late)).toBeNull();
  });
  it("file bloquée au-delà d'une heure", () => {
    expect(isLinkaffiQueueStuck(null, at)).toBe(false);
    expect(isLinkaffiQueueStuck(new Date(at.getTime() - 59 * 60_000), at)).toBe(false);
    expect(isLinkaffiQueueStuck(new Date(at.getTime() - 61 * 60_000), at)).toBe(true);
  });
});
