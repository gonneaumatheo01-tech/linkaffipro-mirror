import { describe, expect, it, vi } from "vitest";

vi.mock("@linkaffipro/db", () => ({ prisma: {} }));

import { eventsQuery, eventsWhere, parseEventFilters, VISIBLE_EVENT_WHERE } from "./events";
import { eventLabel } from "./event-labels";
import { actionLabel, journalWhere } from "./query";

describe("Journal → vue « Événements »", () => {
  it("lit les filtres et les garde dans les liens (pagination, export)", () => {
    const f = parseEventFilters({
      view: "events",
      type: "telegram.",
      channelId: "c1",
      botId: "b1",
      from: "2026-10-01",
      to: "2026-10-09",
      page: "2",
    });
    expect(f).toEqual({
      type: "telegram.",
      channelId: "c1",
      botId: "b1",
      from: "2026-10-01",
      to: "2026-10-09",
      page: 2,
    });
    expect(eventsQuery(f)).toBe(
      "view=events&type=telegram.&channelId=c1&botId=b1&from=2026-10-01&to=2026-10-09",
    );
  });

  it("filtre par famille (préfixe) ou type exact, canal, bot et période en heure de Paris", () => {
    const w = eventsWhere({
      type: "telegram.",
      channelId: "c1",
      botId: "b1",
      from: "2026-10-01",
      to: "2026-10-09",
    });
    expect(w.AND).toContainEqual(VISIBLE_EVENT_WHERE);
    expect(w.AND).toContainEqual({ type: { startsWith: "telegram." } });
    expect(w.AND).toContainEqual({ channelId: "c1" });
    expect(w.AND).toContainEqual({ botId: "b1" });
    expect(w.AND).toContainEqual({
      occurredAt: { gte: new Date("2026-09-30T22:00:00Z"), lt: new Date("2026-10-09T22:00:00Z") },
    });
    expect(
      eventsWhere({ type: "member.start", channelId: "", botId: "", from: "", to: "" }).AND,
    ).toContainEqual({ type: "member.start" });
  });

  it("n'affiche jamais les événements joueurs sans membre (autres affiliés Link Affi)", () => {
    expect(VISIBLE_EVENT_WHERE).toEqual({
      NOT: { type: { startsWith: "player." }, memberId: null },
    });
  });

  it("libellés en français, jamais le code brut seul", () => {
    expect(eventLabel("telegram.chat_join_request")).toBe("Demande d'adhésion reçue");
    expect(eventLabel("telegram.something_new")).toBe("Mise à jour Telegram");
    expect(eventLabel("player.ftd")).toBe("Premier dépôt");
    expect(eventLabel("membership.approved")).toBe("Demande acceptée");
    expect(eventLabel("foo.bar")).toBe("Autre événement");
  });
});

describe("Journal → actions de l'équipe", () => {
  it("vocabulaire : « Campagne » pour les nôtres, « Campagne pub » pour la structure TikTok / Meta", () => {
    expect(actionLabel("campaign.created")).toBe("Campagne");
    expect(actionLabel("adset.created")).toBe("Campagne pub");
    expect(actionLabel("ad.created")).toBe("Campagne pub");
    expect(actionLabel("adcost.saved")).toBe("Campagne pub");
    expect(actionLabel("import.costs")).toBe("Campagne pub");
  });

  it("dates du filtre en heure de Paris, y compris en hiver", () => {
    expect(
      journalWhere({ userId: "", action: "", from: "2026-11-02", to: "2026-11-02" }).createdAt,
    ).toEqual({ gte: new Date("2026-11-01T23:00:00Z"), lt: new Date("2026-11-02T23:00:00Z") });
    expect(journalWhere({ userId: "", action: "", from: "2026-10-01", to: "" }).createdAt).toEqual({
      gte: new Date("2026-09-30T22:00:00Z"),
    });
  });
});
