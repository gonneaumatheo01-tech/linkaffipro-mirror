import { describe, expect, it } from "vitest";
import { NONE_KEY } from "./labels";
import {
  aggregateConversationStats,
  capShare,
  costPerRegistration,
  journeySteps,
  parseStatsUniverse,
  reachedStage,
  statsParams,
  universeKeyOf,
  replyRate,
  type StatsConversation,
} from "./stats";

const conv = (over: Partial<StatsConversation> = {}): StatsConversation => ({
  personaId: "p1",
  source: "tk01",
  stage: "WELCOME",
  replied: false,
  reached: [],
  converted: false,
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

  it("inscription rattachée pendant une fermeture : comptée à l'étape « Inscrit »", () => {
    // /stop (ou « Fermer ») après l'ouverture du lien, inscription le lendemain : l'étape reste « Fermée », aucun
    // passage vers « Inscrit » n'est écrit, seule `convertedAt` est remplie.
    const closed = conv({
      replied: true,
      stage: "CLOSED",
      reached: ["CHAT", "PROPOSAL", "LINK_SENT", "CLOSED"],
      converted: true,
    });
    expect(reachedStage(closed, "CONVERTED")).toBe(true);
    // Rouverte après un déblocage : l'étape d'avant la fermeture revient, l'inscription reste comptée.
    expect(reachedStage({ ...closed, stage: "LINK_SENT" }, "CONVERTED")).toBe(true);
    expect(
      reachedStage(conv({ stage: "CLOSED", reached: ["LINK_SENT", "CLOSED"] }), "CONVERTED"),
    ).toBe(false);
    const steps = journeySteps([closed, conv({ stage: "CONVERTED", converted: true })]);
    expect(steps.find((s) => s.stage === "CONVERTED")?.count).toBe(2);
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

describe("univers et « encore à traiter » (phase 25)", () => {
  const input = {
    conversations: [
      conv({ personaId: "p1", replied: true, needsHuman: true }),
      conv({ personaId: "p1" }),
      conv({ personaId: "p2", source: "fb01", needsHuman: true }),
      conv({ personaId: "p3", source: null }),
      conv({ personaId: null, source: null }),
    ],
    linksSent: [
      { personaId: "p1", source: "tk01" },
      { personaId: "p2", source: "fb01" },
    ],
    linksOpened: [],
    players: [{ personaId: "p2", source: "fb01", registered: true, ftd: false }],
    costs: [
      { personaId: "p1", source: "tk01", costEur: 0.2 },
      { personaId: "p3", source: null, costEur: 0.1 },
    ],
    personaNames: { p1: "Léa", p2: "Max", p3: "Tom" },
    personaUniverses: { p1: "dating", p2: "casino", p3: "sports" },
  };

  it("par univers : ordre fixe Rencontres, Casino, Paris sportifs, « Sans univers » en dernier", () => {
    const stats = aggregateConversationStats(input);
    expect(stats.byUniverse.map((r) => [r.key, r.label, r.conversations, r.toHandle])).toEqual([
      ["dating", "Rencontres", 2, 1],
      ["casino", "Casino", 1, 1],
      ["sports", "Paris sportifs", 1, 0],
      [NONE_KEY, "Sans univers", 1, 0],
    ]);
    expect(stats.total.toHandle).toBe(2);
  });

  it("filtre par univers : tout le reste est écarté, total et parcours compris", () => {
    const casino = aggregateConversationStats(input, { universe: "casino" });
    expect(casino.total).toMatchObject({
      conversations: 1,
      linksSent: 1,
      registrations: 1,
      costEur: 0,
      toHandle: 1,
    });
    expect(casino.byPersona.map((r) => r.label)).toEqual(["Max"]);
    expect(casino.journey[0]?.count).toBe(1);
    const sports = aggregateConversationStats(input, { universe: "sports" });
    expect(sports.total).toMatchObject({ conversations: 1, costEur: 0.1, linksSent: 0 });
  });

  it("univers inconnu ou persona absente : « Sans univers »", () => {
    expect(universeKeyOf({ personaId: "px", source: null }, { px: "poker" })).toBe(NONE_KEY);
    expect(universeKeyOf({ personaId: null, source: null }, {})).toBe(NONE_KEY);
    expect(universeKeyOf({ personaId: "p1", source: null }, { p1: "dating" })).toBe("dating");
  });

  it("paramètre d'adresse : lecture tolérante, gardé avec la période", () => {
    expect(parseStatsUniverse("Casino")).toBe("casino");
    expect(parseStatsUniverse(["sports", "dating"])).toBe("sports");
    expect(parseStatsUniverse("poker")).toBe("");
    expect(parseStatsUniverse(undefined)).toBe("");
    expect(statsParams({ range: "7d" }, "dating").toString()).toBe("range=7d&universe=dating");
    expect(statsParams({ range: "7d" }, "").toString()).toBe("range=7d");
  });
});
