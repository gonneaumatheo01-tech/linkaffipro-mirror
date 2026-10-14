/**
 * Phase 13 : corps exact envoyé à Link Affi (ordre du contrat, même après un passage par jsonb), signature vérifiable
 * par Link Affi, décisions après un essai (nouvel essai, abandon après 24 h, arrêt du passage).
 */
import { describe, expect, it } from "vitest";
import {
  buildLinkaffiEvent,
  serializeLinkaffiEvent,
  signLinkaffiBody,
  verifyLinkaffiSignature,
} from "@linkaffipro/core";
import {
  attemptOutcome,
  isGlobalFailure,
  isPastRetryWindow,
  linkaffiBodyFromRow,
  SCRUBBED_LINKAFFI_MEMBER,
  scrubLinkaffiBody,
  UNDELIVERABLE_MESSAGES,
  undeliverableReason,
} from "./body";

const OCCURRED = new Date("2026-10-14T10:00:00.000Z");

/** Ce que renvoie PostgreSQL pour une colonne jsonb : clés réordonnées (par longueur puis ordre binaire). */
function jsonbOrder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonbOrder);
  if (!v || typeof v !== "object") return v;
  const keys = Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(keys.map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]));
}

describe("corps d'un événement relu en base", () => {
  const built = buildLinkaffiEvent({
    type: "offer_clicked",
    sourceId: "click1",
    occurredAt: OCCURRED,
    campaignKey: "paulTG01",
    channel: { id: "cA", title: "Canal Roulette 🎰" },
    member: { telegramUserId: 9007199254740993n, username: "nora", firstName: "Nora" },
    data: { subId: "Ab12Cd34Ef56", offerCampaignKey: "47eb8mwc" },
  });

  it("reconstruit le corps exactement dans l'ordre du contrat", () => {
    const row = {
      eventId: built.eventId,
      type: built.type,
      occurredAt: OCCURRED,
      campaignKey: "paulTG01",
      body: jsonbOrder(JSON.parse(serializeLinkaffiEvent(built))),
    };
    const raw = serializeLinkaffiEvent(linkaffiBodyFromRow(row));
    expect(raw).toBe(serializeLinkaffiEvent(built));
    expect(Object.keys(JSON.parse(raw))).toEqual([
      "eventId",
      "type",
      "occurredAt",
      "campaignKey",
      "channel",
      "member",
      "data",
    ]);
    expect(raw).toBe(
      '{"eventId":"lap_offer_clicked_click1","type":"offer_clicked","occurredAt":"2026-10-14T10:00:00.000Z",' +
        '"campaignKey":"paulTG01","channel":{"id":"cA","title":"Canal Roulette 🎰"},' +
        '"member":{"telegramUserId":"9007199254740993","username":"nora","firstName":"Nora","languageCode":null},' +
        '"data":{"subId":"Ab12Cd34Ef56","offerCampaignKey":"47eb8mwc"}}',
    );
  });

  it("corps signé : Link Affi vérifie la signature sur le corps brut reçu", () => {
    const raw = serializeLinkaffiEvent(
      linkaffiBodyFromRow({ ...built, occurredAt: OCCURRED, body: built }),
    );
    const sig = signLinkaffiBody(raw, "lap_whsec_test");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyLinkaffiSignature(raw, "lap_whsec_test", sig)).toBe(true);
    expect(verifyLinkaffiSignature(raw, "autre-secret", sig)).toBe(false);
    expect(verifyLinkaffiSignature(raw.replace("Nora", "Nina"), "lap_whsec_test", sig)).toBe(false);
  });

  it("identifiant, type, date et campagne viennent de la ligne ; corps abîmé : valeurs vides lisibles", () => {
    const b = linkaffiBodyFromRow({
      eventId: "lap_left_ms1",
      type: "left",
      occurredAt: OCCURRED,
      campaignKey: "paulTG01",
      body: null,
    });
    expect(b).toEqual({
      eventId: "lap_left_ms1",
      type: "left",
      occurredAt: OCCURRED.toISOString(),
      campaignKey: "paulTG01",
      channel: { id: "", title: "" },
      member: { telegramUserId: "", username: null, firstName: null, languageCode: null },
      data: {},
    });
  });
});

describe("après un essai", () => {
  const created = new Date("2026-10-14T10:00:00Z");

  it("réponse 2xx : envoyé", () => {
    expect(attemptOutcome({ ok: true, status: 200, error: null }, 1, created, created)).toEqual({
      status: "SENT",
    });
  });

  it("échec : nouvel essai à attente croissante (30 s, 1 min, 2 min…)", () => {
    const fail = { ok: false, status: 500, error: "Réponse 500" };
    const at = (attempts: number, now: Date) => attemptOutcome(fail, attempts, created, now);
    expect(at(1, created)).toEqual({
      status: "PENDING",
      nextAttemptAt: new Date(created.getTime() + 30_000),
    });
    expect(at(2, created)).toEqual({
      status: "PENDING",
      nextAttemptAt: new Date(created.getTime() + 60_000),
    });
    // Plus tard : toutes les 2 heures.
    const later = new Date(created.getTime() + 10 * 3_600_000);
    expect(at(12, later)).toEqual({
      status: "PENDING",
      nextAttemptAt: new Date(later.getTime() + 2 * 3_600_000),
    });
  });

  it("le prochain essai tomberait après 24 h : abandon", () => {
    const now = new Date(created.getTime() + 23 * 3_600_000);
    expect(
      attemptOutcome({ ok: false, status: null, error: "injoignable" }, 15, created, now),
    ).toEqual({ status: "FAILED" });
    expect(isPastRetryWindow(created, new Date(created.getTime() + 24 * 3_600_000 + 1))).toBe(true);
    expect(isPastRetryWindow(created, new Date(created.getTime() + 3_600_000))).toBe(false);
  });

  it("échec qui touche tous les événements : le passage s'arrête ; refus propre à un événement : il continue", () => {
    for (const s of [null, 500, 502, 503, 401, 403, 404, 429])
      expect(isGlobalFailure(s)).toBe(true);
    for (const s of [400, 409, 422]) expect(isGlobalFailure(s)).toBe(false);
  });
});

describe("membre supprimé ou affilié retiré avant l'envoi", () => {
  const attached = { anonymizedAt: null, linkaffiCampaignKey: "paulTG01" };

  it("membre toujours rattaché à cette campagne : l'événement part", () => {
    expect(undeliverableReason("m1", attached, "paulTG01")).toBeNull();
    // Attribution terminée depuis : l'événement a été émis pendant l'attribution, il part quand même.
    const ended = { ...attached, affiliateAttributionEndsAt: new Date(0) };
    expect(undeliverableReason("m1", ended, "paulTG01")).toBeNull();
  });

  it("membre supprimé (à sa demande ou par la purge) ou introuvable : jamais envoyé", () => {
    expect(undeliverableReason("m1", { ...attached, anonymizedAt: new Date() }, "paulTG01")).toBe(
      "member_deleted",
    );
    expect(undeliverableReason("m1", null, "paulTG01")).toBe("member_deleted");
  });

  it("affilié retiré ou changé par un administrateur : plus envoyé à l'ancien affilié", () => {
    expect(
      undeliverableReason("m1", { anonymizedAt: null, linkaffiCampaignKey: null }, "paulTG01"),
    ).toBe("affiliate_changed");
    expect(
      undeliverableReason(
        "m1",
        { anonymizedAt: null, linkaffiCampaignKey: "marcTG01" },
        "paulTG01",
      ),
    ).toBe("affiliate_changed");
  });

  it("raisons lisibles, en français, sans mot technique", () => {
    for (const m of Object.values(UNDELIVERABLE_MESSAGES)) {
      expect(m).toMatch(/Link Affi/);
      expect(m).not.toMatch(/webhook|HMAC|sub-?id|anonymi/i);
    }
  });

  it("corps effacé : plus aucune donnée personnelle, le reste du corps gardé", () => {
    const built = buildLinkaffiEvent({
      type: "joined",
      sourceId: "ms1",
      occurredAt: OCCURRED,
      campaignKey: "paulTG01",
      channel: { id: "cA", title: "Canal Roulette" },
      member: {
        telegramUserId: 1791988535075n,
        username: "alice_real",
        firstName: "Alice",
        languageCode: "fr",
      },
    });
    const scrubbed = scrubLinkaffiBody(JSON.parse(serializeLinkaffiEvent(built)));
    expect(scrubbed).toEqual({ ...built, member: SCRUBBED_LINKAFFI_MEMBER });
    expect(JSON.stringify(scrubbed)).not.toMatch(/Alice|alice_real|1791988535075/);
    expect(SCRUBBED_LINKAFFI_MEMBER).toEqual({
      telegramUserId: "0",
      username: null,
      firstName: null,
      languageCode: null,
    });
    // Corps illisible : seulement le membre effacé.
    expect(scrubLinkaffiBody(null)).toEqual({ member: SCRUBBED_LINKAFFI_MEMBER });
  });
});
