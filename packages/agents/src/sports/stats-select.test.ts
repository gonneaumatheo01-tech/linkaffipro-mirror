import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApiFootballClient, memoryStore } from "../providers/apifootball";
import { bestStatsPick, poissonOver, rankStatsPicks, statsEntitiesOf, teamSamples, type StatsMatch, type TeamSample } from "./stats-select";
import { apiFootballLeagues, apiFootballResult, daysBetween, statsMatches } from "./stats-source";
import { statsReasoningSentences } from "./format";

const samples = (forVals: number[], againstVals: number[], base = 100): TeamSample[] =>
  forVals.map((f, i) => ({ fixtureId: base + i, at: new Date(Date.UTC(2026, 9, 20 - i)), for: f, against: againstVals[i]! }));

const NOW = new Date("2026-10-28T09:00:00Z");
const match = (over: Partial<StatsMatch> = {}): StatsMatch => ({
  eventId: "apifootball:9001",
  leagueId: "EPL",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  kickoffAt: new Date("2026-10-28T20:00:00Z"),
  home: samples([7, 6, 8, 5, 7], [2, 3, 3, 4, 2], 100),
  away: samples([5, 4, 6, 6, 5], [4, 5, 3, 6, 4], 200),
  ...over,
});
const opts = { entities: ["all", "away"] as const, minOdds: 1.5, maxOdds: 3.5, targetBookmaker: "celsius" };

describe("sélection « tirs cadrés » sur statistiques (pure)", () => {
  it("lit les marchés « tirs cadrés, plus de » d'une catégorie", () => {
    expect(statsEntitiesOf(["shots_onGoal-all-game-ou-over", "shots_onGoal-away-game-ou-over", "corners-all-game-ou-over", "shots_onGoal-home-game-ou-under"])).toEqual(["all", "away"]);
    expect(statsEntitiesOf(["points-all-game-ou-over"])).toEqual([]);
  });

  it("Poisson : P(X > 0,5) = 1 − e^−λ", () => {
    expect(poissonOver(2, 0.5)).toBeCloseTo(1 - Math.exp(-2), 6);
    expect(poissonOver(0, 3.5)).toBe(0);
  });

  it("propose la ligne la plus probable dont la cote estimée reste dans la fourchette, avec un raisonnement chiffré", () => {
    const c = bestStatsPick(match(), opts)!;
    expect(c).not.toBeNull();
    expect(c.marketId).toMatch(/^shots_onGoal-(all|away)-game-ou-over$/);
    expect(c.selectionLabel).toMatch(/^Plus de \d+,5$/);
    const r = c.reasoning;
    expect(r.source).toBe("stats");
    expect(r.estimatedOdds).toBeGreaterThanOrEqual(1.5);
    expect(r.estimatedOdds).toBeLessThanOrEqual(3.5);
    expect(r.averages.home).toEqual({ for: 6.6, against: 2.8, matches: 5 });
    expect(r.averages.away).toEqual({ for: 5.2, against: 4.4, matches: 5 });
    expect(r.expected).toEqual({ home: 5.5, away: 4, total: 9.5 });
    expect(r.hitRate.n).toBeGreaterThan(0);
    // Sans fourchette, une ligne plus sûre (cote estimée sous 1,50) passerait devant : la fourchette l'écarte.
    const tooSafe = bestStatsPick(match(), { ...opts, minOdds: 1.01, maxOdds: 100 })!;
    expect(tooSafe.reasoning.probability).toBeGreaterThan(r.probability);
    expect(tooSafe.reasoning.estimatedOdds).toBeLessThan(1.5);
  });

  it("exige au moins 3 matchs connus par équipe", () => {
    expect(bestStatsPick(match({ away: samples([5, 4], [4, 5]) }), opts)).toBeNull();
  });

  it("classe : un pari par match, doublons 48 h et coups d'envoi trop proches écartés", () => {
    const soon = match({ eventId: "apifootball:9002", kickoffAt: new Date("2026-10-28T09:20:00Z") });
    const dup = match({ eventId: "apifootball:9003" });
    const first = bestStatsPick(dup, opts)!;
    const r = rankStatsPicks({
      matches: [match(), soon, dup],
      ...opts,
      minMinutesBeforeKickoff: 30,
      recent: [{ eventId: "apifootball:9003", marketId: first.marketId, selectionLabel: first.selectionLabel, line: first.line, at: new Date("2026-10-27T10:00:00Z") }],
      now: NOW,
    });
    expect(r.candidates.map((c) => c.match.eventId)).toEqual(["apifootball:9001"]);
    expect(r.rejected).toEqual({ "coup d'envoi trop proche": 1, "pari identique dans les 48 h": 1 });
  });

  it("échantillons d'une équipe : ses tirs cadrés et ceux de l'adversaire, du plus récent au plus ancien", () => {
    const fx = (id: number, d: string, home: number, away: number) => ({ fixtureId: id, kickoffAt: new Date(d), home: { id: home }, away: { id: away } });
    const shots = new Map<number, Record<string, number>>([
      [1, { "42": 7, "9": 2 }],
      [2, { "42": 4, "8": 5 }],
    ]);
    expect(teamSamples(42, [fx(2, "2026-10-01T00:00:00Z", 8, 42), fx(1, "2026-10-10T00:00:00Z", 42, 9), fx(3, "2026-10-05T00:00:00Z", 42, 7)], shots)).toEqual([
      { fixtureId: 1, at: new Date("2026-10-10T00:00:00Z"), for: 7, against: 2 },
      { fixtureId: 2, at: new Date("2026-10-01T00:00:00Z"), for: 4, against: 5 },
    ]);
  });

  it("phrases du post : chiffres du raisonnement seulement", () => {
    const c = bestStatsPick(match(), opts)!;
    const lines = statsReasoningSentences("Arsenal", "Chelsea", c.reasoning);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toContain("Arsenal");
    expect(lines.join(" ")).toContain(String(c.line).replace(".", ","));
  });
});

type Recorded = { responses: Record<string, unknown> };
const recorded = JSON.parse(readFileSync(fileURLToPath(new URL("../../fixtures/apifootball/responses.json", import.meta.url)), "utf8")) as Recorded;
const replayFetch = (async (url: string | URL) => {
  const u = new URL(String(url));
  const body = recorded.responses[`${u.pathname}${u.search}`] ?? { errors: [], response: [] };
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

describe("source API-Football (réponses enregistrées)", () => {
  it("ligues de la catégorie → identifiants API-Football ; jours couverts", () => {
    expect([...apiFootballLeagues(["EPL", "FR_LIGUE_1", "INCONNUE"]).entries()]).toEqual([
      [39, "EPL"],
      [61, "FR_LIGUE_1"],
    ]);
    expect(daysBetween(new Date("2026-10-28T09:30:00Z"), new Date("2026-10-30T09:00:00Z"))).toEqual(["2026-10-28", "2026-10-29", "2026-10-30"]);
  });

  it("matchs à venir des ligues de la catégorie, avec 5 matchs connus par équipe, puis un pari", async () => {
    const client = createApiFootballClient({ apiKey: "k", store: memoryStore(), fetch: replayFetch, now: () => NOW });
    const matches = await statsMatches(client, { leagues: ["EPL", "FR_LIGUE_1"] }, { from: new Date("2026-10-28T09:30:00Z"), to: new Date("2026-10-29T09:00:00Z") });
    expect(matches.map((m) => `${m.eventId} ${m.homeTeam}-${m.awayTeam} ${m.home.length}/${m.away.length}`)).toEqual([
      "apifootball:9002 Lyon-Lens 5/5",
      "apifootball:9001 Arsenal-Chelsea 5/5",
    ]);
    const ranked = rankStatsPicks({ matches, ...opts, minMinutesBeforeKickoff: 30, recent: [], now: NOW });
    expect(ranked.candidates.length).toBeGreaterThan(0);
  });

  it("résultat : tirs cadrés de chaque équipe d'un match terminé", async () => {
    const client = createApiFootballClient({ apiKey: "k", store: memoryStore(), fetch: replayFetch, now: () => NOW });
    const r = await apiFootballResult(client, "apifootball:9001");
    expect(r).toMatchObject({ finalized: true, cancelled: false });
    expect(r!.stats).toEqual({ "game.home.shots_onGoal": 6, "game.away.shots_onGoal": 0 });
    expect(await apiFootballResult(client, "sgo:abc")).toBeNull();
  });
});
