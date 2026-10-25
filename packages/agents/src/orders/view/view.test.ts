/**
 * Phase 33, chantier C — annuaire des agents et vues en lecture seule (plan à blanc, programmé, paris, aperçu des
 * matchs, matchs par bookmaker, fait, pourquoi). Base en mémoire, faux fournisseur de cotes, aucun réseau.
 */
import { describe, expect, it, vi } from "vitest";
import eventsFixture from "../../../fixtures/odds/events.json";
import { createBossKit, type BossKit } from "../../boss/testing";
import { voiceCheck } from "../../boss/voice";
import { saveSecret } from "../../human/secrets";
import { createFakeOddsProvider } from "../../providers/fake-odds";
import { ODDS_SECRET_KEY } from "../../providers/odds-registry";
import { allowedNumbers, inventedNumbers } from "../../rules/report-numbers";
import { agentCard, findAgent } from "../agents-dict";
import { viewDone } from "./done";
import { viewMatches } from "./matches";
import { viewPlan } from "./plan";
import { viewScheduled } from "./scheduled";
import { previewSportsPicks, viewSportsChannel } from "./sports";
import { whyNothing, type WhyCause } from "./why";
import type { ViewResult } from "./common";

vi.mock("../../missions/lifecycle", async (orig) => ({ ...(await orig<Record<string, unknown>>()), continueMission: vi.fn(async () => undefined) }));

const DAY = 86_400_000;
/** Le 24 octobre 2026 à 10 h de Paris (ancre des fixtures de cotes). */
async function kitAt24() {
  const kit = await createBossKit();
  kit.advance(DAY);
  return kit;
}
/** Contenu de la base (les tables vides créées par une simple lecture du faux client ne comptent pas). */
const snapshot = (kit: BossKit) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(kit.prisma._tables).filter(([, rows]) => rows.length).sort(([a], [b]) => a.localeCompare(b))),
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  );

/** Lignes de Kevin : 8 au plus (sauf détail), voix contrôlée, aucun chiffre absent des faits. */
function expectGoodLines(r: ViewResult) {
  expect(r.lines.length).toBeGreaterThan(0);
  const v = voiceCheck(r.lines.join("\n"), { allowLong: true, allowList: true });
  expect(v.problems, r.lines.join("\n")).toEqual([]);
  const allowed = allowedNumbers(r.facts);
  for (const l of r.lines) {
    // Les heures (« 15 h »), les dates (« 27/10 ») et les numéros d'ordre ou de post sont écrits par le code.
    const cleaned = l.replace(/\d{1,2} h( \d{2})?/g, "").replace(/\d{2}\/\d{2}/g, "").replace(/n°\d+/g, "").replace(/« ok \d+ »/g, "");
    expect(inventedNumbers(cleaned, allowed), l).toEqual([]);
  }
}

/** Le canal de Léa en posts texte seulement (aucune vidéo source nécessaire). */
async function textOnly(kit: BossKit) {
  await kit.prisma.channelAgentPlan.updateMany({ where: { channelId: kit.ids.chLea }, data: { mix: { text: 1 } } as never });
}

async function realTeams(kit: BossKit) {
  for (const teamKey of ["dating", "casino", "sports"]) await kit.prisma.agentTeamConfig.create({ data: { teamKey, simulation: false } as never });
}

describe("annuaire des agents", () => {
  it("retrouve un agent par son nom, en français courant, avec des fautes", () => {
    const key = (t: string) => {
      const r = findAgent(t);
      return r.status === "found" ? r.agent.key : r.status;
    };
    expect(key("l'agent Rédaction")).toBe("redaction");
    expect(key("celui qui écrit")).toBe("redaction");
    expect(key("le correcteur")).toBe("controle");
    expect(key("celui des heures")).toBe("horaires");
    expect(key("l'agent des paris")).toBe("cotes");
    expect(key("l'agent Horaires")).toBe("horaires");
    expect(key("Grand Chef")).toBe("grand-chef");
    expect(key("le chef casino")).toBe("chef-casino");
    expect(key("l'agent redaktion")).toBe("redaction");
    expect(key("le corecteur")).toBe("controle");
    expect(key("conversation")).toBe("conversation");
    expect(key("conversations")).toBe("conversations");
    expect(key("l'agent Média IA")).toBe("media-ia");
  });

  it("plusieurs candidats → liste ; inconnu → noms connus ; emplacements réservés", () => {
    const amb = findAgent("l'agent des vidéos");
    expect(amb.status).toBe("ambiguous");
    if (amb.status === "ambiguous") expect(amb.candidates.map((c) => c.key).sort()).toEqual(["media-ia", "mediatheque"]);
    const unk = findAgent("le boulanger");
    expect(unk.status).toBe("unknown");
    if (unk.status === "unknown") expect(unk.known).toContain("Rédaction");
    // Phase 28 : le Monteur est là ; phase 29 : les Analystes aussi ; le QA global arrive avec la phase 30.
    const m = findAgent("le monteur");
    expect(m.status === "found" && m.agent.available && m.agent.key === "montage-monteur").toBe(true);
    const a = findAgent("les analystes");
    expect(a.status === "found" && a.agent.available && a.agent.key === "chef-analystes").toBe(true);
    const q = findAgent("le qa global");
    expect(q.status === "found" && q.agent.available === false && q.agent.arrives === "phase 30").toBe(true);
  });

  it("fiche : ce qu'il a écrit ce matin, ce qu'il conseille, ce qu'on peut lui demander", async () => {
    const kit = await createBossKit();
    const m = await kit.prisma.agentMission.create({ data: { teamKey: "dating", channelId: kit.ids.chLea, status: "DONE", planDay: "2026-10-23", payload: { text: "<b>Coucou</b> toi, tu viens ?" } } as never });
    await kit.prisma.agentRun.create({ data: { missionId: m.id, agentKey: "redaction", status: "OK", startedAt: new Date("2026-10-23T07:30:00Z"), outputSummary: "légende écrite" } as never });
    const card = await agentCard(kit.deps, "redaction", { day: "2026-10-23", slot: "matin" });
    expect(card.lines.join("\n")).toContain("Coucou toi, tu viens ?");
    expect(card.lines.join("\n")).toMatch(/1 passage réussi/);
    expectGoodLines(card);

    await kit.prisma.channelAgentPlan.updateMany({ where: { channelId: kit.ids.chLea }, data: { suggestedWindows: [{ day: 2, start: "19:00", end: "22:00", score: 0.8, posts: 6 }] } as never });
    const h = await agentCard(kit.deps, "horaires", {});
    expect(h.lines.join("\n")).toContain("Léa en privé : plutôt le mardi entre 19:00 et 22:00.");
    expectGoodLines(h);
    const later = await agentCard(kit.deps, "qa");
    expect(later.lines[0]).toContain("pas encore là");
  });
});

describe("plan joué à blanc", () => {
  it("donne ce que ferait le Grand Chef sans rien écrire", async () => {
    const kit = await createBossKit();
    const before = snapshot(kit);
    const r = await viewPlan(kit.deps, { all: true, day: "2026-10-24", days: 2 });
    expect(snapshot(kit)).toBe(before);
    const lea = r.entries.find((e) => e.channelId === kit.ids.chLea && e.day === "2026-10-24")!;
    expect(lea).toMatchObject({ perDay: 3, toCreate: 3, prepared: false, persona: "Léa", format: "1 vidéo, 2 photos, 1 texte", teamKey: "dating" });
    const casino = r.entries.find((e) => e.channelId === kit.ids.casino)!;
    expect(casino.perDay).toBe(4);
    expect(r.entries.filter((e) => e.channelId === kit.ids.chLea)).toHaveLength(2);
    expect(r.lines.join("\n")).toMatch(/Pas encore préparé : le Grand Chef en lancera 3/);
    expectGoodLines({ ...r, lines: r.lines.slice(0, 8) });
  });

  it("plan d'une équipe et d'un jour déjà préparé ; équipe en pause", async () => {
    const kit = await createBossKit();
    await kit.prisma.agentMission.create({ data: { teamKey: "casino", channelId: kit.ids.casino, planDay: "2026-10-23", status: "PENDING", createdBy: "GRAND_CHEF" } as never });
    await kit.prisma.agentTeamConfig.create({ data: { teamKey: "casino", paused: true } as never });
    const r = await viewPlan(kit.deps, { teamKey: "casino" });
    expect(r.entries.map((e) => e.channelId)).toEqual([kit.ids.casino]);
    expect(r.entries[0]).toMatchObject({ created: 1, prepared: true, toCreate: 0, blocked: "équipe en pause" });
    expect(r.lines.join("\n")).toContain("Rien ne partira : équipe en pause.");
  });

  it("montre les dérogations d'un ordre en cours (canal Test traité comme un canal paris)", async () => {
    const kit = await createBossKit();
    const order = await kit.prisma.teamOrder.create({ data: { number: 12, requestText: "x", kind: "PROGRAM", teamKey: "sports", status: "RUNNING" } as never });
    await kit.prisma.channelPlanOverride.create({ data: { channelId: kit.ids.test, orderId: order.id, teamKey: "sports", fromDay: "2026-10-23", toDay: "2026-10-25", picksPerDay: 2, betCategoryId: kit.ids.corners, isTest: true, closedAt: null } as never });
    const r = await viewPlan(kit.deps, { channelId: kit.ids.test });
    expect(r.entries[0]).toMatchObject({ source: "ordre", teamKey: "sports", perDay: 2, categories: ["Corners"], overrides: [{ ordre: 12, jusquau: "2026-10-25", equipe: "Paris sportifs" }] });
    expect(r.lines.join("\n")).toContain("C'est l'ordre n°12 qui le demande jusqu'au 25/10");
    expectGoodLines(r);
    // Après la période, plus rien.
    const after = await viewPlan(kit.deps, { channelId: kit.ids.test, day: "2026-10-26" });
    expect(after.entries[0]).toMatchObject({ source: "aucun", overrides: [] });
  });
});

describe("programmé et fait", () => {
  it("liste les posts du jour avec l'heure, l'état et le texte, filtrés par moment", async () => {
    const kit = await createBossKit();
    const m1 = await kit.prisma.agentMission.create({ data: { teamKey: "dating", channelId: kit.ids.chLea, planDay: "2026-10-23", status: "DONE", payload: { text: "Bonsoir" } } as never });
    const post = await kit.prisma.post.create({ data: { channelId: kit.ids.chLea, status: "SCHEDULED", scheduledAt: new Date("2026-10-23T19:00:00Z"), text: "Ce soir je suis là", agentMissionId: m1.id, mediaAssetIds: ["asset1"] } as never });
    await kit.prisma.agentMission.update({ where: { id: m1.id }, data: { postId: post.id } as never });
    await kit.prisma.agentMission.create({ data: { teamKey: "dating", channelId: kit.ids.chLea, planDay: "2026-10-23", status: "WAITING_VALIDATION", scheduledFor: new Date("2026-10-23T08:30:00Z"), payload: { text: "Le matin" } } as never });
    const evening = await viewScheduled(kit.deps, { personaId: kit.ids.lea, slot: "soir", withMedia: true });
    expect(evening.items).toHaveLength(1);
    expect(evening.lines.join("\n")).toContain("21 h · programmé à 21 h : « Ce soir je suis là » (avec média)");
    expect(evening.mediaAssetIds).toEqual(["asset1"]);
    expectGoodLines(evening);
    const all = await viewScheduled(kit.deps, { channelId: kit.ids.chLea });
    expect(all.items.map((i) => i.state)).toEqual(["attend ta validation", "programmé à 21 h"]);
  });

  it("ce qui est parti, ce qui attend (boutons existants) et ce qui a raté", async () => {
    const kit = await createBossKit();
    const m = await kit.prisma.agentMission.create({ data: { teamKey: "casino", channelId: kit.ids.casino, planDay: "2026-10-23", status: "DONE" } as never });
    const p = await kit.prisma.post.create({ data: { channelId: kit.ids.casino, status: "SENT", sentAt: new Date("2026-10-23T07:00:00Z"), text: "Roulette du matin", agentMissionId: m.id } as never });
    await kit.prisma.agentMission.update({ where: { id: m.id }, data: { postId: p.id } as never });
    await kit.prisma.postInsight.create({ data: { postId: p.id, channelId: kit.ids.casino, sentAt: p.sentAt, views1h: 230, format: "TEXT", hourParis: 9, weekdayParis: 5 } as never });
    const w = await kit.prisma.agentMission.create({ data: { teamKey: "casino", channelId: kit.ids.casino, planDay: "2026-10-23", status: "WAITING_VALIDATION" } as never });
    await kit.prisma.agentValidation.create({ data: { missionId: w.id, teamKey: "casino", previewText: "x", reason: "nouveau thème" } as never });
    await kit.prisma.agentMission.create({ data: { teamKey: "casino", channelId: kit.ids.casino, planDay: "2026-10-23", status: "FAILED", lastError: "fetch failed", steps: [{ agent: "redaction", status: "FAILED" }] } as never });
    const r = await viewDone(kit.deps, { channelId: kit.ids.casino });
    const text = r.lines.join("\n");
    expect(text).toContain("1 post parti aujourd'hui");
    expect(text).toContain("230 vues à 1 h");
    expect(text).toContain("1 attend ta validation (n°1)");
    expect(text).toContain("Raté sur Casino VIP à l'étape Rédaction : problème de réseau avec le fournisseur.");
    expect(r.buttons?.[0]?.map((b) => b.callbackData)).toEqual([expect.stringMatching(/^agv:.+:ok$/), expect.stringMatching(/:edit$/), expect.stringMatching(/:no$/)]);
    expectGoodLines(r);
  });
});

describe("paris sportifs", () => {
  it("plan du jour du canal paris et paris déjà choisis", async () => {
    const kit = await createBossKit();
    await kit.prisma.betCategory.update({ where: { id: kit.ids.tirs }, data: { channelIds: [kit.ids.sports] } as never });
    await kit.prisma.bettingPick.create({ data: { categoryId: kit.ids.tirs, eventId: "e1", homeTeam: "Arsenal", awayTeam: "Chelsea", league: "EPL", kickoffAt: new Date("2026-10-23T19:00:00Z"), marketId: "m", marketLabel: "Tirs cadrés", selectionLabel: "Plus de 8,5 tirs cadrés", bookmaker: "bet365", odds: 1.85, status: "PUBLISHED", createdAt: new Date("2026-10-23T08:00:00Z") } as never });
    const r = await viewSportsChannel(kit.deps, kit.ids.sports);
    const text = r.lines.join("\n");
    expect(text).toContain("Paris Foot aujourd'hui : 2 paris (Tirs cadrés), choisis aux passages de 10 h, 15 h, 18 h ; prochain passage à 10 h.");
    expect(text).toContain("Arsenal - Chelsea (21 h) · Plus de 8,5 tirs cadrés à 1,85 · publié");
    expectGoodLines(r);
  });

  it("aperçu à blanc : candidats sans pari ni mission créés (cotes d'essai)", async () => {
    const kit = await kitAt24();
    await kit.prisma.betCategory.update({ where: { id: kit.ids.tirs }, data: { channelIds: [kit.ids.sports], marketTypes: ["shots_onGoal-all-game-ou-over", "shots_onGoal-all-game-ou-under", "corners-all-game-ou-over", "corners-all-game-ou-under"], bookmakers: ["sportaza"], minOdds: 1.3, maxOdds: 4 } as never });
    const deps = { ...kit.deps, providers: { odds: createFakeOddsProvider({ now: kit.deps.now }) } };
    const r = await previewSportsPicks(deps, kit.ids.sports);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.length).toBeLessThanOrEqual(5);
    expect(kit.tables("bettingPick")).toHaveLength(0);
    expect(kit.tables("agentMission")).toHaveLength(0);
    expect(r.lines[0]).toBe("Si je choisissais maintenant, sans rien publier :");
    expect(r.lines.at(-1)).toBe("Cotes d'essai : rien de payé.");
    expectGoodLines(r);
  });

  it("aperçu avec le vrai fournisseur : l'appel de cotes est compté et la réponse le dit", async () => {
    const kit = await kitAt24();
    await kit.prisma.betCategory.update({ where: { id: kit.ids.tirs }, data: { channelIds: [kit.ids.sports], marketTypes: ["shots_onGoal-all-game-ou-over", "shots_onGoal-all-game-ou-under"] } as never });
    await saveSecret(kit.deps, ODDS_SECRET_KEY, "cle-test-1234", { userId: null, via: "TELEGRAM" });
    const urls: string[] = [];
    const fetch = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ success: true, data: (eventsFixture as { data: unknown[] }).data }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;
    const r = await previewSportsPicks({ ...kit.deps, fetch }, kit.ids.sports);
    expect(urls.length).toBeGreaterThan(0);
    expect(r.calls).toBeGreaterThan(0);
    const usage = kit.tables("agentUsage").find((u) => u.provider === "odds");
    expect(usage?.calls).toBe(r.calls);
    expect(r.lines.at(-1)).toMatch(/^Ça a compté \d+ appels? de cotes sur le forfait du mois \(\d+ sur 2000\)\.$/);
    expect(kit.tables("bettingPick")).toHaveLength(0);
    expect(kit.tables("agentMission")).toHaveLength(0);
  });
});

describe("matchs chez un bookmaker", () => {
  const fake = (kit: BossKit, books?: string[]) => {
    const p = createFakeOddsProvider({ now: kit.deps.now });
    if (books) p.listBookmakers = async () => books;
    return p;
  };

  it("bookmaker couvert par le fournisseur : matchs par ligue avec le nombre de marchés", async () => {
    const kit = await kitAt24();
    const r = await viewMatches({ ...kit.deps, providers: { odds: fake(kit) } }, { bookmaker: "Bet365", day: "2026-10-25", sport: "foot" });
    expect(r.via).toBe("provider");
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.every((m) => m.markets > 0)).toBe(true);
    expect(r.lines[0]).toMatch(/^\d+ matchs? chez bet365 demain :$/);
    expectGoodLines(r);
  });

  it("bookmaker ni couvert ni adapté : Kevin le dit sans deviner", async () => {
    const kit = await kitAt24();
    const provider = fake(kit);
    const calls = provider.calls.length;
    const r = await viewMatches({ ...kit.deps, providers: { odds: provider } }, { bookmaker: "5Gringos", day: "2026-10-25", sport: "foot" });
    expect(r.via).toBe("not_covered");
    expect(provider.calls.slice(calls)).toEqual(["listBookmakers"]);
    expect(r.lines[0]).toContain("5Gringos n'est pas chez mon fournisseur de cotes");
    expectGoodLines(r);
  });

  it("Sportaza hors du fournisseur, lecture du site pas validée : propose de tester la connexion", async () => {
    const kit = await kitAt24();
    const provider = fake(kit, ["bet365", "unibet", "pinnacle", "williamhill"]);
    const r = await viewMatches({ ...kit.deps, providers: { odds: provider } }, { bookmaker: "sportaza", slot: "soir" });
    expect(r.via).toBe("site_not_validated");
    expect(provider.calls).not.toContain("listEvents");
    expect(r.lines.join("\n")).toContain("Je teste la connexion à Sportaza ?");
    expectGoodLines(r);
  });

  it("sans fournisseur : le dit", async () => {
    const kit = await kitAt24();
    const r = await viewMatches(kit.deps, { bookmaker: "bet365" });
    expect(r.via).toBe("no_provider");
  });
});

describe("pourquoi rien n'est sorti", () => {
  type Setup = (kit: BossKit) => Promise<{ channelId: string; slot?: "matin" | "soir" }>;
  const CASES: Array<[WhyCause, Setup, RegExp]> = [
    ["canal_pause", async (k) => ({ channelId: k.ids.chEmma }), /Je les relance sur Emma Rencontres \?/],
    [
      "equipe_pause",
      async (k) => {
        await k.prisma.agentTeamConfig.updateMany({ where: { teamKey: "casino" }, data: { paused: true, pausedReason: "pause demandée" } as never });
        return { channelId: k.ids.casino };
      },
      /Je relance l'équipe Casino \?/,
    ],
    [
      "pour_de_faux",
      async (k) => {
        await k.prisma.agentTeamConfig.updateMany({ where: { teamKey: "dating" }, data: { simulation: true } as never });
        return { channelId: k.ids.chLea };
      },
      /Tu veux la passer en vrai \?/,
    ],
    ["plan_desactive", async (k) => ({ channelId: k.ids.casino2 }), /Tu veux que je lui règle un plan \?/],
    [
      "quota",
      async (k) => {
        await k.prisma.channelAgentPlan.updateMany({ where: { channelId: k.ids.casino }, data: { postsPerDay: 0 } as never });
        return { channelId: k.ids.casino };
      },
      /Tu veux que je le remonte \?/,
    ],
    [
      "hors_fenetre",
      async (k) => {
        await k.prisma.channelAgentPlan.updateMany({ where: { channelId: k.ids.casino }, data: { windowStart: "14:00", windowEnd: "22:00" } as never });
        return { channelId: k.ids.casino, slot: "matin" };
      },
      /La fenêtre de Casino VIP va de 14 h à 22 h/,
    ],
    [
      "budget",
      async (k) => {
        await k.prisma.agentMission.create({ data: { teamKey: "casino", channelId: k.ids.casino, planDay: "2026-10-23", status: "BLOCKED_BUDGET", lastError: "Plafond mensuel IA atteint" } as never });
        return { channelId: k.ids.casino };
      },
      /monte le plafond/,
    ],
    ["stock_vide", async (k) => ({ channelId: k.ids.chLea }), /Tu m'envoies quelques vidéos \?/],
    [
      "aucune_cote",
      async (k) => {
        await k.prisma.betCategory.update({ where: { id: k.ids.tirs }, data: { channelIds: [k.ids.sports] } as never });
        await k.prisma.agentMission.create({ data: { teamKey: "sports", kind: "BET", channelId: k.ids.sports, planDay: "2026-10-23", status: "DONE", payload: { noPick: true, noPickReason: "aucun pari intéressant" } } as never });
        return { channelId: k.ids.sports };
      },
      /aucun pari ne passait les critères/,
    ],
    [
      "validation",
      async (k) => {
        await textOnly(k);
        const m = await k.prisma.agentMission.create({ data: { teamKey: "dating", channelId: k.ids.chLea, planDay: "2026-10-23", status: "WAITING_VALIDATION" } as never });
        await k.prisma.agentValidation.create({ data: { missionId: m.id, teamKey: "dating", previewText: "x", reason: "nouveau thème" } as never });
        return { channelId: k.ids.chLea };
      },
      /Je le publie \? Réponds « ok 1 »/,
    ],
    [
      "echec",
      async (k) => {
        await textOnly(k);
        await k.prisma.agentMission.create({ data: { teamKey: "dating", channelId: k.ids.chLea, planDay: "2026-10-23", status: "FAILED", lastError: "timeout", steps: [{ agent: "controle", status: "FAILED" }] } as never });
        return { channelId: k.ids.chLea };
      },
      /à l'étape Contrôle qualité : le fournisseur a mis trop de temps à répondre/,
    ],
  ];

  for (const [cause, setup, re] of CASES)
    it(`trouve la cause « ${cause} » et le moyen de la lever`, async () => {
      const kit = await createBossKit();
      await realTeams(kit);
      const { channelId, slot } = await setup(kit);
      const before = snapshot(kit);
      const r = await whyNothing(kit.deps, { channelId, slot });
      expect(snapshot(kit)).toBe(before);
      expect(r.cause).toBe(cause);
      expect(r.lines.join("\n")).toMatch(re);
      expect(r.lines.length).toBeLessThanOrEqual(2);
      expectGoodLines(r);
    });

  it("rien de bloqué : dit quand part le prochain", async () => {
    const kit = await createBossKit();
    await realTeams(kit);
    await textOnly(kit);
    await kit.prisma.agentMission.create({ data: { teamKey: "dating", channelId: kit.ids.chLea, planDay: "2026-10-23", status: "DONE", scheduledFor: new Date("2026-10-23T16:00:00Z") } as never });
    const r = await whyNothing(kit.deps, { channelId: kit.ids.chLea });
    expect(r.cause).toBe("a_venir");
    expect(r.lines[0]).toBe("Rien de bloqué sur Léa en privé : le prochain part à 18 h.");
  });
});
