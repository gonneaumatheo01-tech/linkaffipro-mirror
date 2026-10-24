/**
 * Relecture adverse de la phase 25 (équipe Paris sportifs), sur base en mémoire et faux fournisseurs :
 * cote du texte = cote vérifiée, plafond d'appels sans pause d'équipe, plusieurs canaux (annulation et résultats sur
 * tous les posts), lignes en quart jamais retenues, paris de test hors quota du jour, réglage en pause, nouveautés
 * comptées sur les vrais canaux seulement, noms d'équipes absents, compteur d'appels atomique.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Db from "@linkaffipro/db";

// Création du message programmé : version en mémoire (la vraie est testée en intégration).
vi.mock("@linkaffipro/db", async (importOriginal) => {
  const orig = await importOriginal<typeof Db>();
  return {
    ...orig,
    createAgentPost: vi.fn(async (db: { post: { create(a: unknown): Promise<{ id: string }> } }, input: Record<string, unknown>) => {
      const post = await db.post.create({
        data: { channelId: input.channelId, botId: "bot", status: "SCHEDULED", scheduledAt: input.scheduledAt, text: input.text, mediaAssetIds: input.mediaAssetIds, agentMissionId: input.agentMissionId, buttons: [] },
      });
      return { postId: post.id, botId: "bot", publisher: "BOT", trackingLinkId: null };
    }),
  };
});

import { createEngineKit } from "../testing/engine-kit";
import { createFakePrisma } from "../testing/fake-prisma";
import { createFakeOddsProvider, FAKE_ODDS_ANCHOR } from "../providers/fake-odds";
import { createFakeScreenshotProvider } from "../providers/screenshot/fake";
import { createOddsQuota, OddsQuotaError } from "../providers/odds-quota";
import { mapEvent, type SgoEvent } from "../providers/sportsgameodds-map";
import type { OddsProvider, OddsSelection } from "../providers/odds";
import { rankCandidates } from "../agents/cotes/select";
import { isQuarterLine } from "../rules/bets";
import { cancelMission } from "../missions/lifecycle";
import { decideValidation } from "../validation/requests";
import { createBetMission } from "./missions";
import { noveltyOf, picksToday, toCategory } from "./data";
import { runSportsSettle } from "./settle";
import { textWithOdds } from "./steps";
import { parseSportsSettings } from "./settings";
import { ensurePickImage } from "./pick-image";
import type { AgentContext, Mission } from "../types";

const CATEGORY = {
  id: "cat1",
  key: "tirs",
  name: "Tirs cadrés",
  sport: "SOCCER",
  marketTypes: ["shots_onGoal-all-game-ou-over", "shots_onGoal-home-game-ou-over"],
  leagues: ["EPL", "LA_LIGA", "FR_LIGUE_1", "BUNDESLIGA"],
  bookmakers: ["sportaza"],
  minOdds: 1.5,
  maxOdds: 3.5,
  picksPerDay: 1,
  channelIds: ["paris1", "paris2"],
  campaignId: null,
  minMinutesBeforeKickoff: 30,
  maxOddsDriftPct: 5,
  active: true,
  sortOrder: 0,
  createdAt: new Date("2026-10-01T00:00:00Z"),
};

function sportsKit(o: { odds?: OddsProvider; picksPerDay?: number } = {}) {
  // Faux fournisseur (ou fournisseur imposé par le test, qui n'est alors pas modifié).
  const odds = (o.odds ?? createFakeOddsProvider({ now: () => FAKE_ODDS_ANCHOR })) as ReturnType<typeof createFakeOddsProvider>;
  const kit = createEngineKit({ start: FAKE_ODDS_ANCHOR, providers: { odds, screenshot: createFakeScreenshotProvider() } as never });
  const t = kit.prisma._tables;
  t.channel!.push(
    { id: "paris1", title: "Paris VIP", vertical: "SPORTS", isTest: false, isActive: true, language: "fr", telegramChatId: -1003n },
    { id: "paris2", title: "Paris Pro", vertical: "SPORTS", isTest: false, isActive: true, language: "fr", telegramChatId: -1004n },
  );
  for (const c of t.channel!) c.isActive ??= true;
  (t.betCategory ??= []).push({ ...CATEGORY, picksPerDay: o.picksPerDay ?? 1 });
  (t.agentTeamConfig ??= []).push({ id: "cfg-sports", teamKey: "sports", simulation: false, autonomyLevel: 2, paused: false, enabled: true, consecutiveFailures: 0, settings: {} });
  return { kit, odds, t };
}

async function approveAll(kit: ReturnType<typeof createEngineKit>) {
  for (let round = 0; round < 5; round++) {
    const pending = (kit.t("agentValidation") as Array<{ id: string; status: string }>).filter((v) => v.status === "PENDING");
    if (!pending.length) return;
    for (const v of pending) expect((await decideValidation(kit.deps, { validationId: v.id, decision: "approve", via: "TELEGRAM" })).ok).toBe(true);
    await kit.drain();
  }
}

describe("pari sur deux canaux : cote vérifiée dans le texte, annulation et résultats sur tous les posts", () => {
  let s: ReturnType<typeof sportsKit>;
  beforeEach(() => {
    s = sportsKit();
  });

  async function publishOne(): Promise<{ pickId: string; missionId: string }> {
    const { kit, odds, t } = s;
    const r = await createBetMission(kit.deps, { category: toCategory(CATEGORY), createdBy: "GRAND_CHEF", oddsSource: "fake" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    // Étape Cotes : le pari est retenu ; on fixe sa cote retenue à 2,00 et la cote du site, relue au Contrôle, à 1,91.
    expect(await kit.drain(1)).toEqual(["next"]);
    const pick = t.bettingPick![0]!;
    pick.odds = 2;
    odds.setOdds(String(pick.eventId), String(pick.marketId), "sportaza", 1.91);
    await kit.drain();
    await approveAll(kit);
    return { pickId: String(pick.id), missionId: r.missionId };
  }

  it("retenue 2,00, relue 1,91 (tolérée) : texte publié « 1,91 » sur les deux canaux", async () => {
    const { pickId } = await publishOne();
    const pick = s.t.bettingPick!.find((p) => p.id === pickId)!;
    expect(pick.status).toBe("PUBLISHED");
    expect(Number(pick.oddsAtSend)).toBeCloseTo(1.91, 2);
    const posts = s.t.post!;
    expect(posts.map((p) => p.channelId).sort()).toEqual(["paris1", "paris2"]);
    for (const p of posts) {
      expect(String(p.text)).toContain("<b>1,91</b>");
      expect(String(p.text)).not.toContain("<b>2,00</b>");
    }
  });

  it("annulation de la mission : les deux posts programmés sont annulés", async () => {
    const { missionId } = await publishOne();
    const m = s.kit.mission(missionId);
    m.status = "RUNNING"; // annulation tardive (après la Publication)
    await cancelMission(s.kit.deps, missionId, { reason: "test" });
    expect(s.t.post!.map((p) => p.status)).toEqual(["CANCELLED", "CANCELLED"]);
  });

  it("résultat du match : les fiches des deux posts reçoivent le résultat", async () => {
    await publishOne();
    for (const p of s.t.post!) (s.t.postInsight ??= []).push({ id: `ins-${String(p.id)}`, postId: p.id, betResult: null });
    s.kit.setNow(new Date(FAKE_ODDS_ANCHOR.getTime() + 3 * 86_400_000));
    // Faux fournisseur recalé sur la nouvelle heure : résultat disponible.
    const r = await runSportsSettle({ ...s.kit.deps, providers: { odds: createFakeOddsProvider({ now: () => new Date(FAKE_ODDS_ANCHOR.getTime() + 3 * 86_400_000), shiftMs: 0 }) } } as never);
    expect(r.settled).toBe(1);
    const results = s.t.postInsight!.map((x) => x.betResult);
    expect(results).toHaveLength(2);
    expect(results.every((x) => x === "WON" || x === "LOST" || x === "VOID")).toBe(true);
  });
});

describe("plafond d'appels aux cotes au Contrôle", () => {
  it("3 contrôles au plafond : paris écartés « plafond d'appels atteint », équipe jamais mise en pause", async () => {
    const base = createFakeOddsProvider({ now: () => FAKE_ODDS_ANCHOR });
    const capped: OddsProvider = Object.assign(Object.create(null), base, {
      async getMarketsFresh(): Promise<OddsSelection[]> {
        throw new OddsQuotaError(2000, 2000);
      },
    });
    const { kit, t } = sportsKit({ odds: capped, picksPerDay: 3 });
    const r = await createBetMission(kit.deps, { category: toCategory({ ...CATEGORY, picksPerDay: 3 }), createdBy: "GRAND_CHEF", oddsSource: "fake" });
    expect(r.ok).toBe(true);
    await kit.drain();
    const picks = t.bettingPick!;
    expect(picks).toHaveLength(3);
    for (const p of picks) expect(p).toMatchObject({ status: "SKIPPED", skipReason: "plafond d'appels atteint" });
    expect(t.agentMission!.every((m) => m.status === "CANCELLED")).toBe(true);
    expect(t.agentTeamConfig!.find((c) => c.teamKey === "sports")).toMatchObject({ paused: false, consecutiveFailures: 0 });
  });

  it("compteur atomique : deux appels simultanés à max − 1, un seul passe", async () => {
    const prisma = createFakePrisma({ agentUsage: [{ id: "u1", teamKey: "sports", provider: "odds", month: "2026-10", cents: 0, calls: 4, alerted80: true, alerted100: false }] });
    const before = createOddsQuota({ prisma, now: () => new Date("2026-10-24T08:00:00Z") }, 5);
    const results = await Promise.allSettled([before(), before()]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected" && x.reason instanceof OddsQuotaError)).toHaveLength(1);
    expect(prisma._tables.agentUsage![0]!.calls).toBe(5);
  });
});

describe("lignes asiatiques en quart", () => {
  it("plus de 2,25 (2 buts), plus de 2,75 (3 buts), handicap −0,25 (nul) : jamais sélectionnés", () => {
    const now = new Date("2026-10-24T08:00:00Z");
    const event = { eventId: "e1", leagueId: "EPL", homeTeam: "Arsenal", awayTeam: "Chelsea", startsAt: new Date("2026-10-25T14:00:00Z") };
    const sel = (marketId: string, line: number): OddsSelection => ({ marketId, marketLabel: "", selectionLabel: "", line, byBookmaker: { sportaza: 2.6, a: 1.9, b: 1.9, c: 1.9 }, fairOdds: null });
    const markets = new Map([["e1", [sel("points-all-game-ou-over", 2.25), sel("points-all-game-ou-over", 2.75), sel("points-home-game-sp-home", -0.25)]]]);
    const r = rankCandidates({
      events: [event],
      markets,
      criteria: { marketTypes: ["points-all-game-ou-over", "points-home-game-sp-home"], leagues: [], bookmakers: ["sportaza"], minOdds: 1.5, maxOdds: 3.5 },
      minMinutesBeforeKickoff: 30,
      minInterestScore: -1,
      minBookmakers: 2,
      recent: [],
      now,
      source: "fake",
    });
    expect(r.candidates).toEqual([]);
    expect(r.rejected["ligne asiatique en quart"]).toBe(3);
    // Témoin : la même sélection sur une ligne en demi est bien retenue.
    const half = rankCandidates({ ...{ events: [event], markets: new Map([["e1", [sel("points-all-game-ou-over", 2.5)]]]) }, criteria: { marketTypes: ["points-all-game-ou-over"], leagues: [], bookmakers: ["sportaza"], minOdds: 1.5, maxOdds: 3.5 }, minMinutesBeforeKickoff: 30, minInterestScore: -1, minBookmakers: 2, recent: [], now, source: "fake" });
    expect(half.candidates).toHaveLength(1);
    expect([2, 2.5, -1, null].map(isQuarterLine)).toEqual([false, false, false, false]);
    expect([2.25, 2.75, -0.25, -1.75].map(isQuarterLine)).toEqual([true, true, true, true]);
  });
});

describe("quota du jour, pause, nouveautés, texte, noms d'équipes, cote lue", () => {
  it("les paris des missions de test n'entament pas le quota du jour", async () => {
    const now = new Date("2026-10-24T10:00:00Z");
    const prisma = createFakePrisma({
      agentMission: [{ id: "mt", isTest: true }, { id: "mr", isTest: false }],
      bettingPick: [
        { id: "p1", categoryId: "c", missionId: "mt", status: "PUBLISHED", createdAt: now },
        { id: "p2", categoryId: "c", missionId: "mt", status: "PROPOSED", createdAt: now },
        { id: "p3", categoryId: "c", missionId: "mr", status: "PUBLISHED", createdAt: now },
      ],
    });
    expect(await picksToday(prisma, "c", now)).toBe(1);
  });

  it("équipe en pause ou pause générale : aucun règlement", async () => {
    const prisma = createFakePrisma({
      agentTeamConfig: [{ id: "x", teamKey: "sports", paused: true, enabled: true, settings: {} }],
      bettingPick: [{ id: "p1", status: "PUBLISHED", kickoffAt: new Date("2026-10-01T00:00:00Z"), eventId: "e", marketId: "m", reasoning: { source: "fake" } }],
    });
    const deps = { prisma, now: () => new Date("2026-10-24T10:00:00Z"), enqueue: { orchestrator: async () => undefined, step: async () => undefined } } as never;
    expect(await runSportsSettle(deps)).toMatchObject({ checked: 0, settled: 0, halted: "équipe en pause" });
    prisma._tables.agentTeamConfig![0]!.paused = false;
    (prisma._tables.setting ??= []).push({ key: "agents.pausedAll", value: true });
    expect(await runSportsSettle(deps)).toMatchObject({ checked: 0, halted: "pause générale" });
    expect(prisma._tables.bettingPick![0]!.status).toBe("PUBLISHED");
  });

  it("nouveautés : un pari publié en simulation (canal Test) ne compte pas", async () => {
    const prisma = createFakePrisma({
      channel: [{ id: "test", isTest: true }, { id: "vrai", isTest: false }],
      post: [{ id: "pt", channelId: "test" }, { id: "pv", channelId: "vrai" }],
      bettingPick: [{ id: "old", league: "EPL", marketId: "m1", missionId: null, postId: "pt", status: "WON" }],
    });
    expect(await noveltyOf(prisma, { id: "new", league: "EPL", marketId: "m1" })).toEqual({ newLeague: true, newMarket: true });
    prisma._tables.bettingPick!.push({ id: "old2", league: "EPL", marketId: "m1", missionId: null, postId: "pv", status: "LOST" });
    expect(await noveltyOf(prisma, { id: "new", league: "EPL", marketId: "m1" })).toEqual({ newLeague: false, newMarket: false });
  });

  it("texte remis à la cote : réécrit s'il vient du code, cote remplacée s'il a été corrigé par le client", () => {
    const pick = {
      id: "p",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      league: "EPL",
      kickoffAt: new Date("2026-10-25T14:00:00Z"),
      marketId: "shots_onGoal-all-game-ou-over",
      marketLabel: "Tirs cadrés",
      selectionLabel: "Plus de 8,5",
      bookmaker: "sportaza",
      odds: 2,
      reasoning: {},
    } as never;
    const s = parseSportsSettings({});
    const fromCode = textWithOdds({}, pick, s, 2);
    expect(fromCode.text).toContain("<b>2,00</b>");
    const moved = textWithOdds({ text: fromCode.text, textOdds: 2 }, pick, s, 1.91);
    expect(moved).toMatchObject({ changed: true });
    expect(moved.text).toContain("<b>1,91</b>");
    expect(textWithOdds({ text: fromCode.text, textOdds: 2 }, pick, s, 2.001).changed).toBe(false);
    const edited = textWithOdds({ text: "Mon texte : cote 2,00 chez Sportaza", textOdds: 2 }, pick, s, 1.91);
    expect(edited.text).toBe("Mon texte : cote 1,91 chez Sportaza");
  });

  it("noms d'équipes absents chez le fournisseur : match ignoré", () => {
    const e = { eventID: "x", leagueID: "EPL", status: { startsAt: "2026-10-25T14:00:00Z" }, teams: { home: { names: { long: "Arsenal" } }, away: {} } } as unknown as SgoEvent;
    expect(mapEvent(e)).toBeNull();
    expect(mapEvent({ ...e, teams: { home: { names: { long: "Arsenal" } }, away: { names: { short: "CHE" } } } } as SgoEvent)).toMatchObject({ homeTeam: "Arsenal", awayTeam: "CHE" });
  });

  it("Rédaction : cote lue par l'agent Capture (`payload.capture.readOdds`) reprise", async () => {
    const prisma = createFakePrisma({ mediaAsset: [{ id: "a1", origin: "HUMAN_SITE" }] });
    const ctx = { prisma, providers: {} } as unknown as AgentContext;
    const mission = { id: "m", payload: { screenshotAssetId: "a1", capture: { status: "captured", readOdds: 2.3 } } } as unknown as Mission;
    expect(await ensurePickImage(ctx, mission, { id: "p", screenshotAssetId: null } as never)).toEqual({ kind: "screenshot", assetId: "a1", readOdds: 2.3 });
  });
});
