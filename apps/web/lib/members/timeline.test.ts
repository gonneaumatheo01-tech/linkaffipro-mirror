import { describe, expect, it } from "vitest";
import { buildTimeline } from "./timeline";

describe("chronologie d'un membre", () => {
  it("fusionne les sources et trie du plus récent au plus ancien", () => {
    const t = buildTimeline({
      memberships: [{ id: "m1", channelTitle: "Casino FR", status: "APPROVED", requestedAt: new Date("2026-10-01T10:00:00Z"), approvedAt: new Date("2026-10-01T10:05:00Z"), joinedAt: new Date("2026-10-01T10:06:00Z"), sourceName: "TT-video-1" }],
      outbound: [{ kind: "WELCOME", status: "SENT", queuedAt: new Date("2026-10-01T10:00:01Z"), sentAt: new Date("2026-10-01T10:00:02Z"), botUsername: "casinobot" }],
      clicks: [
        { createdAt: new Date("2026-10-02T09:00:00Z"), subId: "AbCdEfGhIjKl", kind: "OFFER", label: "Bonus", postId: "p1" },
        { createdAt: new Date("2026-10-02T09:00:01Z"), isBot: true },
      ],
      playerEvents: [{ type: "FTD", occurredAt: new Date("2026-10-02T12:00:00Z"), amount: 20, currency: "EUR", campaignName: "Celsius" }],
      events: [{ type: "member.start", occurredAt: new Date("2026-09-30T08:00:00Z") }],
    });
    expect(t.map((e) => e.title)).toEqual([
      "Premier dépôt (Celsius)",
      "Clic offre — Bonus",
      "Entré dans Casino FR",
      "Accepté dans Casino FR",
      "Message d'accueil (@casinobot)",
      "Demande d'adhésion à Casino FR",
      "A démarré le bot (/start)",
    ]);
    expect(t[0]?.detail).toBe("20,00 EUR");
    expect(t[1]?.detail).toBe("sub-ID AbCdEfGhIjKl");
    expect(t[1]?.href).toBe("/messages/p1");
    expect(t[5]?.detail).toBe("Accepté · via TT-video-1");
  });
  it("ignore les clics de robots et accepte des entrées vides", () => {
    expect(buildTimeline({})).toEqual([]);
    expect(buildTimeline({ clicks: [{ createdAt: new Date(), isBot: true }] })).toEqual([]);
  });
});
