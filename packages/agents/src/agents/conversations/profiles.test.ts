import { describe, expect, it } from "vitest";
import { aggregateProfiles, dropStageOf, median, mostFrequentStage, topReplyHours, type ProfileInput } from "./profiles";

const H = 3_600_000;
const now = new Date("2026-10-23T12:00:00Z");
const start = new Date(now.getTime() - 30 * 24 * H);
const t = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * H);

function conv(id: string, over: Partial<ProfileInput["conversations"][number]> = {}) {
  return {
    id,
    botId: "b1",
    personaId: "p1",
    source: "tk",
    stage: "CHAT",
    status: "BOT",
    createdAt: t(100),
    convertedAt: null,
    lastInboundAt: t(99),
    lastAssistantAt: t(99),
    ...over,
  };
}
const msg = (conversationId: string, direction: "IN" | "OUT", hoursAgo: number, over: { author?: string; isCommand?: boolean } = {}) => ({
  conversationId,
  direction,
  author: over.author ?? (direction === "IN" ? "MEMBER" : "ASSISTANT"),
  isCommand: over.isCommand ?? false,
  createdAt: t(hoursAgo),
});

describe("chiffres par profil", () => {
  const input: ProfileInput = {
    start,
    end: now,
    conversations: [
      conv("c1"),
      conv("c2", { stage: "LINK_SENT", convertedAt: t(10) }),
      conv("c3", { stage: "CLOSED", status: "CLOSED" }),
      conv("c4", { botId: "b2", personaId: null, source: null }),
    ],
    messages: [
      // c1 : /start, accueil, réponse 10 min après.
      msg("c1", "IN", 100, { isCommand: true }),
      msg("c1", "OUT", 99.9),
      { ...msg("c1", "IN", 99.9), createdAt: new Date(t(99.9).getTime() + 600_000) },
      // c2 : 3 messages avant le lien.
      msg("c2", "OUT", 90),
      msg("c2", "IN", 89),
      msg("c2", "IN", 88),
      msg("c2", "IN", 87),
      msg("c2", "IN", 50),
      // c3 : jamais répondu.
      msg("c3", "OUT", 90),
    ],
    events: [{ conversationId: "c3", type: "stage_changed", fromStage: "WELCOME", toStage: "CLOSED", createdAt: t(80) }],
    links: [
      { botId: "b1", personaId: "p1", source: "tk", conversationId: "c2", sentAt: t(60), firstOpenedAt: t(59) },
      { botId: "b1", personaId: "p1", source: "tk", conversationId: "c2", sentAt: t(55), firstOpenedAt: null },
    ],
    players: [
      { botId: "b1", personaId: "p1", source: "tk", registeredAt: t(20), ftdAt: t(10) },
      { botId: "b1", personaId: "p1", source: "tk", registeredAt: t(24 * 40), ftdAt: null },
    ],
    costs: [
      { botId: "b1", personaId: "p1", source: "tk", costEur: 0.3 },
      { botId: "b1", personaId: "p1", source: "tk", costEur: 0.2 },
    ],
    bots: { b1: { label: "@lea_bot", kind: "BOT" }, b2: { label: "Léa compte", kind: "ACCOUNT" } },
    personaNames: { p1: "Léa" },
    minConversations: 3,
  };

  it("exactement les champs attendus, par bot × persona × source", () => {
    const [p, other] = aggregateProfiles(input, now);
    expect(p).toEqual({
      key: "b1:p1:tk",
      botId: "b1",
      botLabel: "@lea_bot",
      kind: "BOT",
      personaId: "p1",
      personaName: "Léa",
      source: "tk",
      conversations: 3,
      replyRate: 2 / 3,
      medianMessagesBeforeLink: 3,
      dropStage: "WELCOME",
      medianReplyDelaySec: 2100,
      replyHours: expect.any(Array),
      linksSent: 2,
      clicks: 1,
      registrations: 1,
      ftds: 1,
      aiCostEur: 0.5,
      costPerRegistrationEur: 0.5,
      enoughData: true,
    });
    expect(other).toMatchObject({ key: "b2:-:-", kind: "ACCOUNT", botLabel: "Léa compte", conversations: 1, replyRate: 0, enoughData: false });
  });

  it("délai médian, heures de réponse et seuil de données", () => {
    expect(median([600, 3600, 7200])).toBe(3600);
    expect(median([])).toBeNull();
    // 19 h Paris (17:00 UTC, été) deux fois, 9 h une fois.
    expect(topReplyHours([new Date("2026-10-20T17:00:00Z"), new Date("2026-10-21T17:30:00Z"), new Date("2026-10-21T07:00:00Z")])).toEqual([19, 9]);
    expect(aggregateProfiles({ ...input, minConversations: 30 }, now)[0]!.enoughData).toBe(false);
  });

  it("décrochage : étape quittée pour « Fermée », jamais une conversation encore active ou convertie", () => {
    expect(dropStageOf(conv("x", { stage: "CLOSED" }), [{ conversationId: "x", type: "stage_changed", fromStage: "PROPOSAL", toStage: "CLOSED", createdAt: t(5) }], now)).toBe("PROPOSAL");
    expect(dropStageOf(conv("x", { lastInboundAt: t(1) }), [], now)).toBeNull();
    expect(dropStageOf(conv("x", { convertedAt: t(1) }), [], now)).toBeNull();
    expect(mostFrequentStage(["CHAT", "WELCOME", "CHAT", "WELCOME"])).toBe("WELCOME");
  });
});
