import { describe, expect, it } from "vitest";
import { buildTimeline, paginateTimeline, type TimelineEntry } from "./timeline";

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
      "Clic sur une offre — Bonus",
      "Entré dans Casino FR",
      "Accepté dans Casino FR",
      "Message d'accueil (@casinobot)",
      "Demande pour rejoindre Casino FR",
      "A démarré le bot (/start)",
    ]);
    expect(t[0]?.detail).toBe("20,00 €");
    expect(t[1]?.detail).toBe("identifiant de suivi AbCdEfGhIjKl");
    expect(t[1]?.href).toBe("/messages/p1");
    expect(t[5]?.detail).toBe("Accepté · via TT-video-1");
  });
  it("écrit les montants comme les cartes de la fiche (« 26,34 € », vrai signe moins « −12,96 € »)", () => {
    const t = buildTimeline({
      playerEvents: [
        { type: "DEPOSIT", occurredAt: new Date("2026-10-03T10:00:00Z"), amount: 26.34, currency: "EUR" },
        { type: "NGR", occurredAt: new Date("2026-10-02T10:00:00Z"), amount: -12.96, currency: null },
        { type: "DEPOSIT", occurredAt: new Date("2026-10-01T10:00:00Z"), amount: 1234.5, currency: "USD" },
        { type: "REGISTRATION", occurredAt: new Date("2026-09-30T10:00:00Z"), amount: null },
        { type: "DEPOSIT", occurredAt: new Date("2026-09-29T10:00:00Z"), amount: 5, currency: "pas une devise" },
      ],
    });
    expect(t.map((e) => e.detail)).toEqual(["26,34 €", "−12,96 €", "1 234,50 $US", undefined, "5,00 pas une devise"]);
  });
  it("ne répète pas « Offre » quand le bouton s'appelle « Offre — … » ou « Offre »", () => {
    const at = new Date("2026-10-02T09:00:00Z");
    const titles = buildTimeline({
      clicks: [
        { createdAt: at, kind: "OFFER", label: "Offre — Casino Bienvenue TikTok" },
        { createdAt: at, kind: "OFFER", label: "offre : Bonus 200 %" },
        { createdAt: at, kind: "OFFER", label: "Offre" },
        { createdAt: at, kind: "OFFER", label: "Offres spéciales" },
        { createdAt: at, kind: "OFFER", label: null },
        { createdAt: at, kind: "LINK", label: "Offre — Site" },
      ],
    }).map((e) => e.title);
    expect(titles).toEqual([
      "Clic sur une offre — Casino Bienvenue TikTok",
      "Clic sur une offre — Bonus 200 %",
      "Clic sur une offre",
      "Clic sur une offre — Offres spéciales",
      "Clic sur une offre",
      "Clic — Offre — Site",
    ]);
  });
  it("ignore les clics de robots et accepte des entrées vides", () => {
    expect(buildTimeline({})).toEqual([]);
    expect(buildTimeline({ clicks: [{ createdAt: new Date(), isBot: true }] })).toEqual([]);
  });
});

describe("paginateTimeline", () => {
  const entries: TimelineEntry[] = Array.from({ length: 120 }, (_, i) => ({ at: new Date(2026, 0, 1, 0, 0, 120 - i), kind: "event", title: `e${i}` }));

  it("découpe par page de taille fixe et compte les pages", () => {
    const p1 = paginateTimeline(entries, 1, 50);
    expect(p1.entries).toHaveLength(50);
    expect(p1.total).toBe(120);
    expect(p1.pages).toBe(3);
    expect(p1.entries[0]!.title).toBe("e0");
    const p3 = paginateTimeline(entries, 3, 50);
    expect(p3.entries).toHaveLength(20);
    expect(p3.entries[0]!.title).toBe("e100");
  });

  it("ramène une page hors bornes à la première ou à la dernière", () => {
    expect(paginateTimeline(entries, 0, 50).page).toBe(1);
    expect(paginateTimeline(entries, 99, 50).page).toBe(3);
    expect(paginateTimeline([], 5, 50)).toEqual({ entries: [], total: 0, pages: 1, page: 1 });
  });
  it("message privé parti avec une note (emojis normaux à la place des emojis animés, média non envoyé) : la note est montrée", () => {
    const at = new Date("2026-10-11T10:00:00Z");
    const t = buildTimeline({
      outbound: [
        {
          kind: "BROADCAST",
          status: "SENT",
          queuedAt: at,
          sentAt: at,
          botUsername: "casinobot",
          error: "Envoyé avec les emojis normaux : Telegram a refusé les emojis animés.",
        },
        {
          kind: "WELCOME",
          status: "SENT",
          queuedAt: at,
          sentAt: at,
          error: "Telegram a affiché les emojis normaux à la place des emojis animés.",
        },
        { kind: "ACCEPTED", status: "SENT", queuedAt: at, sentAt: at, error: null },
        { kind: "TEST", status: "FAILED", queuedAt: at, error: "chat introuvable" },
      ],
    });
    expect(t.map((e) => e.detail)).toEqual([
      "Envoyé avec les emojis normaux : Telegram a refusé les emojis animés",
      "envoyé · Telegram a affiché les emojis normaux à la place des emojis animés",
      "envoyé",
      "échec",
    ]);
  });
});
