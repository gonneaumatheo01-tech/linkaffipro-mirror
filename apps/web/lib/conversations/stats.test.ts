import { describe, expect, it } from "vitest";
import { NONE_KEY } from "./labels";
import {
  aggregateConversationStats,
  capShare,
  costPerRegistration,
  journeySteps,
  reachedStage,
  replyRate,
  type StatsConversation,
} from "./stats";

const conv = (over: Partial<StatsConversation> = {}): StatsConversation => ({
  personaId: "p1",
  source: "tk01",
  stage: "WELCOME",
  replied: false,
  reached: [],
  ...over,
});

describe("chiffres par persona et par source", () => {
  const stats = aggregateConversationStats({
    conversations: [
      conv({ replied: true, stage: "LINK_SENT", reached: ["CHAT", "PROPOSAL", "LINK_SENT"] }),
      conv({ replied: true, stage: "CONVERTED", reached: ["CHAT", "LINK_SENT", "CONVERTED"] }),
      conv({ source: null }),
      conv({ personaId: "p2", source: "fb01", replied: true, stage: "CHAT", reached: ["CHAT"] }),
      conv({ personaId: null, source: null, stage: "CLOSED", reached: ["CLOSED"] }),
    ],
    linksSent: [
      { personaId: "p1", source: "tk01" },
      { personaId: "p1", source: "tk01" },
      { personaId: "p2", source: "fb01" },
    ],
    linksOpened: [{ personaId: "p1", source: "tk01" }],
    players: [
      { personaId: "p1", source: "tk01", registered: true, ftd: true },
      { personaId: "p1", source: "tk01", registered: false, ftd: true },
    ],
    costs: [
      { personaId: "p1", source: "tk01", costEur: 0.5 },
      { personaId: "p1", source: null, costEur: 0.25 },
      { personaId: "p2", source: "fb01", costEur: 0.12345 },
    ],
    personaNames: { p1: "Léa", p2: "Hugo" },
  });

  it("total : conversations commencées, réponses, liens, inscriptions, premiers dépôts, coût", () => {
    expect(stats.total).toMatchObject({
      conversations: 5,
      replies: 3,
      linksSent: 3,
      linksOpened: 1,
      registrations: 1,
      ftds: 2,
      costEur: 0.8735,
      replyRate: 0.6,
      costPerRegistration: 0.8735,
    });
  });

  it("par persona : le plus de conversations d'abord, « Sans persona » en dernier", () => {
    expect(
      stats.byPersona.map((r) => [r.label, r.conversations, r.linksSent, r.registrations]),
    ).toEqual([
      ["Léa", 3, 2, 1],
      ["Hugo", 1, 1, 0],
      ["Sans persona", 1, 0, 0],
    ]);
    expect(stats.byPersona[0]!.costEur).toBe(0.75);
    expect(stats.byPersona.at(-1)!.key).toBe(NONE_KEY);
  });

  it("par source : « Sans source » pour Démarrer seul (et le coût des conversations sans source)", () => {
    const bySource = Object.fromEntries(stats.bySource.map((r) => [r.label, r]));
    expect(bySource.tk01).toMatchObject({
      conversations: 2,
      replies: 2,
      linksOpened: 1,
      registrations: 1,
      ftds: 2,
    });
    expect(bySource["Sans source"]).toMatchObject({ conversations: 2, costEur: 0.25 });
    expect(bySource.fb01).toMatchObject({ conversations: 1, costEur: 0.1235 });
    expect(stats.bySource.at(-1)!.label).toBe("Sans source");
  });

  it("parcours : Accueil = toutes, puis chaque étape atteinte (étape actuelle ou passage enregistré)", () => {
    expect(stats.journey.map((s) => [s.stage, s.count])).toEqual([
      ["WELCOME", 5],
      ["CHAT", 3],
      ["PROPOSAL", 1],
      ["LINK_SENT", 2],
      ["FOLLOW_UP", 0],
      ["CONVERTED", 1],
    ]);
    expect(stats.journey[1]!.share).toBe(0.6);
  });
});

describe("règles des chiffres", () => {
  it("taux de réponse et coût par inscription : rien sans base", () => {
    expect(replyRate({ conversations: 0, replies: 0 })).toBeNull();
    expect(replyRate({ conversations: 4, replies: 1 })).toBe(0.25);
    expect(costPerRegistration({ costEur: 1, registrations: 0 })).toBeNull();
    expect(costPerRegistration({ costEur: 1, registrations: 3 })).toBe(0.3333);
  });

  it("étape atteinte", () => {
    expect(reachedStage(conv(), "WELCOME")).toBe(true);
    expect(reachedStage(conv({ stage: "FOLLOW_UP" }), "FOLLOW_UP")).toBe(true);
    expect(reachedStage(conv({ stage: "CLOSED", reached: ["CHAT", "CLOSED"] }), "CHAT")).toBe(true);
    expect(reachedStage(conv({ stage: "CHAT" }), "LINK_SENT")).toBe(false);
  });

  it("période sans conversation : parcours à zéro, sans part", () => {
    expect(journeySteps([]).every((s) => s.count === 0 && s.share === null)).toBe(true);
    const empty = aggregateConversationStats({
      conversations: [],
      linksSent: [],
      linksOpened: [],
      players: [],
      costs: [],
      personaNames: {},
    });
    expect(empty.byPersona).toEqual([]);
    expect(empty.total.replyRate).toBeNull();
  });

  it("part du plafond du mois", () => {
    expect(capShare(6, 30)).toBe(0.2);
    expect(capShare(45, 30)).toBe(1);
    expect(capShare(1, 0)).toBeNull();
  });
});
