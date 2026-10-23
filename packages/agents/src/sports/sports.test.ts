/** Phase 23, chantier A : règles des paris, client SportsGameOdds sur fixtures, cache et quotas, règlement, bilan. */
import { describe, expect, it } from "vitest";
import eventsFixture from "../../fixtures/odds/events.json";
import resultsFixture from "../../fixtures/odds/results.json";
import {
  checkCriteria,
  checkOddsDrift,
  consensusOf,
  impliedProbability,
  interestScore,
  isDuplicatePick,
  kickoffCheck,
  marketMatches,
  median,
  recentAverageFor,
} from "../rules/bets";
import { settleBet } from "../rules/bet-settle";
import { summarizeBets } from "../rules/bet-summary";
import { americanToDecimal, mapResult, mapSelections, type SgoEvent } from "../providers/sportsgameodds-map";
import { createSportsGameOddsProvider, verifySportsGameOddsKey } from "../providers/sportsgameodds";
import { createFakeOddsProvider, FAKE_ODDS_ANCHOR } from "../providers/fake-odds";
import { createMemoryOddsCache, withOddsCache } from "../providers/odds-cache";
import { createOddsQuota, OddsQuotaError, quotaAlertLevel } from "../providers/odds-quota";
import type { ProviderError } from "../providers/http";
import type { OddsResult, OddsSelection } from "../providers/odds";
import { createFakePrisma } from "../testing/fake-prisma";
import { rankCandidates } from "../agents/cotes/select";
import { betPostText, reasoningSentences } from "./format";
import { duePassage } from "./passage-state";
import { parseNumberList } from "./setup";
import { parseSportsSettings } from "./settings";
import { forbiddenWordsIn } from "../rules/content";
import { sportsAlwaysValidateReason } from "../orchestrator/autonomy";

const events = (eventsFixture as unknown as { data: SgoEvent[] }).data;
const results = (resultsFixture as unknown as { data: SgoEvent[] }).data;
const sel = (marketId: string, line: number | null, byBookmaker: Record<string, number>, fairOdds: number | null = null): OddsSelection => ({
  marketId,
  marketLabel: "",
  selectionLabel: "",
  line,
  byBookmaker,
  fairOdds,
});

describe("probabilité implicite et consensus", () => {
  it("1 ÷ cote, médiane", () => {
    expect(impliedProbability(2)).toBe(0.5);
    expect(impliedProbability(1)).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("probabilité corrigée de la marge, bookmaker visé exclu", () => {
    const over = sel("shots_onGoal-all-game-ou-over", 8.5, { sportaza: 2.1, a: 1.9, b: 1.9 });
    const under = sel("shots_onGoal-all-game-ou-under", 8.5, { sportaza: 1.7, a: 1.9, b: 1.9 });
    const c = consensusOf(over, [over, under], "sportaza");
    expect(c.method).toBe("median-demargined");
    expect(c.probability).toBeCloseTo(0.5, 6);
    expect(c.consensusOdds).toBe(1.9);
    expect(c.bookmakers).toBe(2);
    expect(c.marginPct).toBeCloseTo(5.26, 1);
  });

  it("cote juste du fournisseur en priorité ; sinon médiane brute", () => {
    const fair = sel("x-all-game-ou-over", 1, { a: 2, b: 2.2 }, 2.05);
    expect(consensusOf(fair, [fair]).method).toBe("fairOdds");
    const raw = sel("x-all-game-ou-over", 1, { a: 2, b: 2.5 });
    const c = consensusOf(raw, [raw]);
    expect(c.method).toBe("median-raw");
    expect(c.probability).toBeCloseTo((0.5 + 0.4) / 2, 6);
  });
});

describe("score d'intérêt", () => {
  it("cote × probabilité − 1, ajusté par la moyenne, borné", () => {
    expect(interestScore({ targetOdds: 2.1, probability: 0.5 }).score).toBeCloseTo(0.05, 6);
    const up = interestScore({ targetOdds: 2, probability: 0.5, recentAverage: 12, line: 8.5, side: "over" });
    expect(up.adjustment).toBe(0.1);
    const down = interestScore({ targetOdds: 2, probability: 0.5, recentAverage: 12, line: 8.5, side: "under" });
    expect(down.adjustment).toBe(-0.1);
    expect(interestScore({ targetOdds: 50, probability: 0.9 }).score).toBe(1);
    expect(interestScore({ targetOdds: 1.01, probability: 0.01 }).score).toBeGreaterThanOrEqual(-1);
  });

  it("moyennes récentes : 3 matchs au moins", () => {
    const s = (h: string, a: string, hv: number, av: number, d: number) => ({ homeTeam: h, awayTeam: a, at: new Date(d), values: { "game.home.shots_onGoal": hv, "game.away.shots_onGoal": av } });
    const samples = [s("A", "X", 5, 4, 1), s("Y", "A", 3, 6, 2), s("B", "Z", 2, 2, 3)];
    expect(recentAverageFor(samples, { homeTeam: "A", awayTeam: "B", statId: "shots_onGoal", entity: "all", period: "game" })).toEqual({ average: 7.33, samples: 3 });
    expect(recentAverageFor(samples, { homeTeam: "A", awayTeam: "B", statId: "shots_onGoal", entity: "home", period: "game" })).toBeNull();
  });
});

describe("critères, doublons, délai, cote", () => {
  const c = { marketTypes: ["shots_onGoal-all-game-ou-over", "points-PLAYER_ID-game-yn-yes"], leagues: ["EPL"], bookmakers: ["sportaza"], minOdds: 1.5, maxOdds: 3.5 };
  it("critères de catégorie", () => {
    expect(checkCriteria(c, { leagueId: "EPL", marketId: "shots_onGoal-all-game-ou-over", bookmaker: "sportaza", odds: 2 }).ok).toBe(true);
    expect(checkCriteria(c, { leagueId: "MLS", marketId: "shots_onGoal-all-game-ou-over", bookmaker: "sportaza", odds: 2 }).ok).toBe(false);
    expect(checkCriteria(c, { leagueId: "EPL", marketId: "corners-all-game-ou-over", bookmaker: "sportaza", odds: 2 }).ok).toBe(false);
    expect(checkCriteria(c, { leagueId: "EPL", marketId: "shots_onGoal-all-game-ou-over", bookmaker: "bet365", odds: 2 }).ok).toBe(false);
    expect(checkCriteria(c, { leagueId: "EPL", marketId: "shots_onGoal-all-game-ou-over", bookmaker: "sportaza", odds: 4 }).ok).toBe(false);
    expect(checkCriteria(c, { leagueId: "EPL", marketId: "shots_onGoal-all-game-ou-over", bookmaker: "sportaza", odds: undefined }).ok).toBe(false);
    expect(marketMatches("points-BUKAYO_SAKA_1_EPL-game-yn-yes", "points-PLAYER_ID-game-yn-yes")).toBe(true);
    expect(marketMatches("points-home-game-yn-yes", "points-PLAYER_ID-game-yn-yes")).toBe(false);
  });

  it("doublons sur 48 h", () => {
    const now = new Date("2026-10-24T10:00:00Z");
    const k = { eventId: "e", marketId: "m", selectionLabel: "Plus de 8,5", line: 8.5 };
    expect(isDuplicatePick(k, [{ ...k, at: new Date(now.getTime() - 47 * 3_600_000) }], now)).toBe(true);
    expect(isDuplicatePick(k, [{ ...k, at: new Date(now.getTime() - 49 * 3_600_000) }], now)).toBe(false);
    expect(isDuplicatePick(k, [{ ...k, line: 9.5, at: now }], now)).toBe(false);
  });

  it("délai avant le coup d'envoi : jamais à moins de N minutes, ni après", () => {
    const now = new Date("2026-10-24T10:00:00Z");
    expect(kickoffCheck(new Date("2026-10-24T11:00:00Z"), now, 30).ok).toBe(true);
    expect(kickoffCheck(new Date("2026-10-24T10:20:00Z"), now, 30).ok).toBe(false);
    expect(kickoffCheck(new Date("2026-10-24T09:59:00Z"), now, 30)).toMatchObject({ ok: false, reason: "le match a commencé" });
  });

  it("cote re-vérifiée : écart toléré, marché disparu", () => {
    expect(checkOddsDrift(2, 2.08, 5).ok).toBe(true);
    expect(checkOddsDrift(2, 2.2, 5)).toMatchObject({ ok: false, code: "drift", driftPct: 10 });
    expect(checkOddsDrift(2, 1.8, 5)).toMatchObject({ ok: false, code: "drift" });
    expect(checkOddsDrift(2, null, 5)).toMatchObject({ ok: false, code: "market_missing" });
  });
});

describe("règlement des paris", () => {
  const r = (stats: Record<string, number>, o: Partial<OddsResult> = {}): OddsResult => ({ eventId: "e", finalized: true, cancelled: false, homeScore: null, awayScore: null, marketScores: {}, stats, ...o });
  it("plus / moins, remboursé à égalité", () => {
    const res = r({ "game.home.shots_onGoal": 6, "game.away.shots_onGoal": 4 });
    expect(settleBet({ marketId: "shots_onGoal-all-game-ou-over", line: 8.5 }, res)?.outcome).toBe("WON");
    expect(settleBet({ marketId: "shots_onGoal-all-game-ou-under", line: 8.5 }, res)?.outcome).toBe("LOST");
    expect(settleBet({ marketId: "shots_onGoal-all-game-ou-over", line: 10 }, res)?.outcome).toBe("VOID");
    expect(settleBet({ marketId: "shots_onGoal-home-game-ou-over", line: 5.5 }, res)?.outcome).toBe("WON");
  });
  it("valeur finale du marché prioritaire, oui / non, 1N2, annulé, pas fini", () => {
    expect(settleBet({ marketId: "corners-all-game-ou-over", line: 9.5 }, r({}, { marketScores: { "corners-all-game-ou-over": 11 } }))?.outcome).toBe("WON");
    expect(settleBet({ marketId: "points-SAKA_1_EPL-game-yn-yes", line: null }, r({ "game.SAKA_1_EPL.points": 1 }))?.outcome).toBe("WON");
    const draw = r({ "reg.home.points": 1, "reg.away.points": 1 });
    expect(settleBet({ marketId: "points-all-reg-ml3way-draw", line: null }, draw)?.outcome).toBe("WON");
    expect(settleBet({ marketId: "points-home-reg-ml3way-home", line: null }, draw)?.outcome).toBe("LOST");
    expect(settleBet({ marketId: "points-home-game-ml-home", line: null }, r({ "game.home.points": 1, "game.away.points": 1 }))?.outcome).toBe("VOID");
    expect(settleBet({ marketId: "points-away-game-ml-away", line: null }, r({}, { homeScore: 0, awayScore: 2 }))?.outcome).toBe("WON");
    expect(settleBet({ marketId: "x-all-game-ou-over", line: 1 }, r({}, { cancelled: true, finalized: false }))?.outcome).toBe("VOID");
    expect(settleBet({ marketId: "x-all-game-ou-over", line: 1 }, r({}, { finalized: false }))).toBeNull();
    expect(settleBet({ marketId: "x-all-game-ou-over", line: 1 }, r({}))).toBeNull();
  });
  it("fixtures de résultats : statistiques et valeur finale lues", () => {
    const res = mapResult(results[0]!);
    expect(res).toMatchObject({ finalized: true, homeScore: 2, awayScore: 1 });
    expect(res.stats["game.home.shots_onGoal"]).toBe(6);
    expect(res.marketScores["shots_onGoal-all-game-ou-over"]).toBe(10);
    expect(mapResult(results[2]!).cancelled).toBe(true);
  });
});

describe("bilan", () => {
  it("taux de réussite, cote moyenne, rendement à mise constante", () => {
    const rows = summarizeBets([
      { key: "a", label: "A", status: "WON", odds: 2 },
      { key: "a", label: "A", status: "LOST", odds: 1.8 },
      { key: "a", label: "A", status: "VOID", odds: 2.2 },
      { key: "a", label: "A", status: "PUBLISHED", odds: 2 },
      { key: "a", label: "A", status: "SKIPPED", odds: 3 },
      { key: "b", label: "B", status: "LOST", odds: 2 },
    ]);
    expect(rows[0]).toMatchObject({ key: "a", published: 4, won: 1, lost: 1, void: 1, hitRate: 0.5, avgOdds: 2, roi: 0 });
    expect(rows[1]).toMatchObject({ key: "b", hitRate: 0, roi: -1 });
  });
});

describe("client SportsGameOdds (réponses enregistrées, sans réseau)", () => {
  it("cote américaine → décimale", () => {
    expect(americanToDecimal("+150")).toBe(2.5);
    expect(americanToDecimal("-110")).toBe(1.909);
    expect(americanToDecimal(100)).toBe(2);
    expect(americanToDecimal("abc")).toBeNull();
    expect(americanToDecimal("50")).toBeNull();
  });

  it("sélections : une par ligne, bookmaker indisponible ignoré, libellés français", () => {
    const psg = mapSelections(events.find((e) => e.eventID === "fake-l1-psg-lyo")!, ["shots_onGoal-all-game-ou-over"]);
    expect(psg).toHaveLength(2);
    const main = psg.find((s) => s.line === 8.5)!;
    expect(Object.keys(main.byBookmaker).sort()).toEqual(["bet365", "pinnacle", "unibet"]);
    expect(psg.find((s) => s.line === 9.5)!.byBookmaker).toEqual({ sportaza: 1.952 });
    expect(main.marketLabel).toBe("Tirs cadrés (total du match)");
    expect(main.selectionLabel).toBe("Plus de 8,5");
    const bay = mapSelections(events.find((e) => e.eventID === "fake-bun-bay-dor")!, ["shots_onGoal-all-game-ou-under"]);
    expect(bay[0]!.byBookmaker.sportaza).toBeUndefined();
  });

  function fakeFetch(pages: Array<{ status: number; body: unknown }>) {
    const urls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    const f = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      headers.push((init?.headers ?? {}) as Record<string, string>);
      const p = pages.shift() ?? { status: 200, body: { success: true, data: [] } };
      return new Response(JSON.stringify(p.body), { status: p.status });
    }) as unknown as typeof fetch;
    return { f, urls, headers };
  }

  it("pagination par curseur, clé dans l'en-tête, comptage de chaque appel", async () => {
    const { f, urls, headers } = fakeFetch([
      { status: 200, body: { success: true, data: events.slice(0, 2), nextCursor: "c2" } },
      { status: 200, body: { success: true, data: events.slice(2, 4) } },
    ]);
    let counted = 0;
    const p = createSportsGameOddsProvider({ apiKey: "cle-secrete-123", fetch: f, beforeRequest: async () => void counted++ });
    const list = await p.listEvents({ sport: "SOCCER", leagues: ["EPL", "LA_LIGA"], from: new Date("2026-10-24T00:00:00Z"), to: new Date("2026-10-26T00:00:00Z") });
    expect(list.map((e) => e.eventId)).toEqual(events.slice(0, 4).map((e) => e.eventID));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("https://api.sportsgameodds.com/v2/events?");
    expect(urls[0]).toContain("leagueID=EPL%2CLA_LIGA");
    expect(urls[1]).toContain("cursor=c2");
    expect(urls[0]).not.toContain("cle-secrete");
    expect(headers[0]!["x-api-key"]).toBe("cle-secrete-123");
    expect(counted).toBe(2);
    // Cotes du même match juste après : aucun nouvel appel.
    await p.getMarketsMany!(["fake-epl-ars-che"], ["shots_onGoal-all-game-ou-over"]);
    expect(urls).toHaveLength(2);
  });

  it("429 passager, 4xx clair sans la clé, marché inconnu = liste vide", async () => {
    const p429 = createSportsGameOddsProvider({ apiKey: "cle-secrete-123", fetch: fakeFetch([{ status: 429, body: { error: "rate" } }]).f });
    await expect(p429.getResult("x")).rejects.toMatchObject({ transient: true });
    const p400 = createSportsGameOddsProvider({ apiKey: "cle-secrete-123", fetch: fakeFetch([{ status: 400, body: { error: "bad cle-secrete-123" } }]).f });
    const err = (await p400.getResult("x").catch((e) => e)) as ProviderError;
    expect(err.transient).toBe(false);
    expect(err.message).not.toContain("cle-secrete-123");
    const p401 = createSportsGameOddsProvider({ apiKey: "k", fetch: fakeFetch([{ status: 401, body: {} }]).f });
    await expect(p401.listBookmakers()).rejects.toThrow(/clé refusée/);
    const ok = createSportsGameOddsProvider({ apiKey: "k", fetch: fakeFetch([{ status: 200, body: { success: true, data: [events[0]] } }]).f });
    expect(await ok.getMarkets("fake-epl-ars-che", ["inconnu-all-game-ou-over"])).toEqual([]);
  });

  it("vérification de la clé : /account/usage", async () => {
    const good = fakeFetch([{ status: 200, body: { success: true, data: {} } }]);
    expect(await verifySportsGameOddsKey("k", good.f)).toMatchObject({ ok: true });
    expect(good.urls[0]).toBe("https://api.sportsgameodds.com/v2/account/usage");
    expect(await verifySportsGameOddsKey("k", fakeFetch([{ status: 401, body: {} }]).f)).toMatchObject({ ok: false, message: "clé refusée par SportsGameOdds" });
  });
});

describe("cache et quotas", () => {
  it("matchs 30 min, cotes 5 min", async () => {
    let now = new Date("2026-10-24T08:00:00Z");
    const fake = createFakeOddsProvider({ now: () => now });
    const cached = withOddsCache(fake, createMemoryOddsCache(() => now));
    const q = { sport: "SOCCER", leagues: ["EPL"], from: now, to: new Date(now.getTime() + 48 * 3_600_000) };
    await cached.listEvents(q);
    await cached.listEvents(q);
    expect(fake.calls.filter((c) => c === "listEvents")).toHaveLength(1);
    await cached.getMarkets("fake-epl-ars-che", ["shots_onGoal-all-game-ou-over"]);
    now = new Date(now.getTime() + 4 * 60_000);
    await cached.getMarkets("fake-epl-ars-che", ["shots_onGoal-all-game-ou-over"]);
    expect(fake.calls.filter((c) => c === "getMarkets")).toHaveLength(1);
    now = new Date(now.getTime() + 2 * 60_000);
    await cached.getMarkets("fake-epl-ars-che", ["shots_onGoal-all-game-ou-over"]);
    expect(fake.calls.filter((c) => c === "getMarkets")).toHaveLength(2);
    // Relecture avant l'envoi : jamais le cache.
    await cached.getMarketsFresh!("fake-epl-ars-che", ["shots_onGoal-all-game-ou-over"]);
    expect(fake.calls).toContain("getMarketsFresh");
    now = new Date(now.getTime() + 31 * 60_000);
    await cached.listEvents({ ...q, from: now, to: new Date(now.getTime() + 48 * 3_600_000) });
    expect(fake.calls.filter((c) => c === "listEvents")).toHaveLength(2);
  });

  it("appels comptés dans AgentUsage, refus au plafond, alertes 80 / 100 % une fois", async () => {
    const prisma = createFakePrisma();
    const sent: string[] = [];
    const now = () => new Date("2026-10-24T08:00:00Z");
    const before = createOddsQuota({ prisma, now, admin: { send: async (h) => (sent.push(h), { messageId: 1 }) } }, 5);
    for (let i = 0; i < 5; i++) await before();
    await expect(before()).rejects.toBeInstanceOf(OddsQuotaError);
    await expect(before()).rejects.toBeInstanceOf(OddsQuotaError);
    const row = prisma._tables.agentUsage![0]!;
    expect(row).toMatchObject({ teamKey: "sports", provider: "odds", month: "2026-10", calls: 5 });
    expect(sent.filter((s) => s.includes("80 %"))).toHaveLength(1);
    expect(sent.filter((s) => s.includes("plafond"))).toHaveLength(1);
    expect(quotaAlertLevel(10, 10, { alerted80: true, alerted100: true })).toBeNull();
  });

  it("faux fournisseur : dates recalées, résultat 2 h après le coup d'envoi", async () => {
    let now = new Date(FAKE_ODDS_ANCHOR.getTime() + 86_400_000);
    const fake = createFakeOddsProvider({ now: () => now });
    const list = await fake.listEvents({ sport: "SOCCER", leagues: ["EPL"], from: now, to: new Date(now.getTime() + 48 * 3_600_000) });
    const ars = list.find((e) => e.eventId === "fake-epl-ars-che")!;
    expect(ars.startsAt.toISOString()).toBe("2026-10-26T14:00:00.000Z");
    expect((await fake.getResult("fake-epl-ars-che"))?.finalized).toBe(false);
    now = new Date(ars.startsAt.getTime() + 2 * 3_600_000);
    expect((await fake.getResult("fake-epl-ars-che"))?.finalized).toBe(true);
    fake.setOdds("fake-epl-ars-che", "shots_onGoal-all-game-ou-over", "sportaza", 2.5);
    const m = await fake.getMarkets("fake-epl-ars-che", ["shots_onGoal-all-game-ou-over"]);
    expect(m[0]!.byBookmaker.sportaza).toBe(2.5);
  });
});

describe("sélection sur les fixtures", () => {
  it("un pari par match, matchs trop proches, hors ligue et sans Sportaza écartés", async () => {
    const now = FAKE_ODDS_ANCHOR;
    const fake = createFakeOddsProvider({ now: () => now });
    const leagues = ["EPL", "LA_LIGA", "FR_LIGUE_1", "BUNDESLIGA", "IT_SERIE_A"];
    const types = ["shots_onGoal-all-game-ou-over", "shots_onGoal-home-game-ou-over"];
    const evs = await fake.listEvents({ sport: "SOCCER", leagues, from: now, to: new Date(now.getTime() + 48 * 3_600_000) });
    const markets = await fake.getMarketsMany!(evs.map((e) => e.eventId), types);
    const r = rankCandidates({
      events: evs,
      markets,
      criteria: { marketTypes: types, leagues, bookmakers: ["sportaza"], minOdds: 1.5, maxOdds: 3.5 },
      minMinutesBeforeKickoff: 30,
      minInterestScore: -0.05,
      minBookmakers: 2,
      recent: [],
      now,
      source: "fake",
    });
    const ids = r.candidates.map((c) => c.event.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("fake-epl-bri-ful");
    expect(ids).not.toContain("fake-mls-lag-mia");
    expect(ids).not.toContain("fake-ita-int-mil");
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < r.candidates.length; i++) expect(r.candidates[i - 1]!.score).toBeGreaterThanOrEqual(r.candidates[i]!.score);
    const best = r.candidates[0]!;
    expect(best.reasoning).toMatchObject({ source: "fake", targetBookmaker: "sportaza" });
    expect(best.reasoning.score).toBeCloseTo(best.reasoning.valueEdge + best.reasoning.adjustment, 4);
  });
});

describe("texte, réglages, passages", () => {
  it("post : chiffres du raisonnement seulement, jamais un mot interdit", () => {
    const text = betPostText({
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      league: "EPL",
      kickoffAt: new Date("2026-10-25T14:00:00Z"),
      marketId: "shots_onGoal-all-game-ou-over",
      marketLabel: "Tirs cadrés (total du match)",
      selectionLabel: "Plus de 8,5",
      bookmaker: "sportaza",
      odds: 2.1,
      reasoning: { consensusOdds: 1.93, bookmakers: 4, consensusProbability: 0.4945, recentAverage: 9.4, line: 8.5 },
      disclaimer: parseSportsSettings({}).disclaimer,
    });
    expect(text).toContain("Arsenal – Chelsea");
    expect(text).toContain("Premier League");
    expect(text).toContain("<b>2,10</b>");
    expect(text).toContain("cote de référence de 4 bookmakers (1,93)");
    expect(text).toContain("49 %");
    expect(text).toContain("9,4 tirs cadrés par match");
    expect(forbiddenWordsIn(text, parseSportsSettings({}).forbiddenWords)).toEqual([]);
    expect(reasoningSentences({ bookmaker: "sportaza", odds: 2, marketId: "x-all-game-ou-over", reasoning: null })).toEqual([]);
  });

  it("toujours validé : ligue ou marché nouveaux, cote hors fourchette, image de repli", () => {
    expect(sportsAlwaysValidateReason({ newLeague: false, newMarket: false, oddsOutOfRange: false, fallbackImage: false })).toBeNull();
    expect(sportsAlwaysValidateReason({ newLeague: true, league: "EPL", newMarket: false, oddsOutOfRange: true, fallbackImage: true })).toMatch(/image de repli.*ligue jamais utilisée \(EPL\).*hors de la fourchette/);
  });

  it("réglages : défauts et bornes", () => {
    expect(parseSportsSettings({})).toMatchObject({ runHours: [10, 15, 18], maxApiCallsPerMonth: 2000, kickoffTriggerHours: 2 });
    expect(parseSportsSettings({ sports: { runHours: [18, 9, 99], maxApiCallsPerMonth: 300 } })).toMatchObject({ runHours: [9, 18], maxApiCallsPerMonth: 300 });
  });

  it("passages : heures réglées, rattrapage court, passage avant un match", () => {
    // 10 h 05 à Paris (heure d'été).
    const now = new Date("2026-10-24T08:05:00Z");
    const d1 = duePassage({ day: "", done: [], triggers: [] }, now, [10, 15, 18]);
    expect(d1).toMatchObject({ due: true, reason: "passage de 10 h" });
    expect(duePassage(d1.next, now, [10, 15, 18]).due).toBe(false);
    const late = duePassage({ day: "", done: [], triggers: [] }, new Date("2026-10-24T19:30:00Z"), [10, 15]);
    expect(late.due).toBe(false);
    expect(late.next.done).toEqual([10, 15]);
    const trig = duePassage({ ...d1.next, triggers: [{ at: "2026-10-24T08:00:00Z", categoryId: "c1" }, { at: "2026-10-24T12:00:00Z", categoryId: "c2" }] }, now, [10, 15, 18]);
    expect(trig).toMatchObject({ due: true, categoryIds: ["c1"] });
    expect(trig.next.triggers).toHaveLength(1);
  });

  it("catégories par numéros", () => {
    expect(parseNumberList("1, 3 et 3", 6)).toEqual([1, 3]);
    expect(parseNumberList("7", 6)).toEqual([]);
  });
});
