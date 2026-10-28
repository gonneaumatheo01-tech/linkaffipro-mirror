import { describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import { interpretAnswer } from "../human/answer";
import { deadlineOf, sweepHumanRequests } from "../human/site";
import { voiceCheck } from "../boss/voice";
import type { AgentContext, Mission } from "../types";
import type { PickRow } from "./data";
import { humanOddsCaptureStep, humanOddsDeadline, humanOddsQuestion, receiveHumanOddsInput } from "./human-odds";
import { HUMAN_ODDS_DONE, humanOddsKey, isHumanOddsPick, parseHumanOddsText, readOddsNumber } from "./human-odds-text";

const ACTOR = { userId: null, via: "TELEGRAM" as const };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("paris par capture : lecture de la réponse (pur)", () => {
  it("lit la cote écrite par l'équipe", () => {
    expect(readOddsNumber("1,85")).toBe(1.85);
    expect(readOddsNumber("cote 2")).toBe(2);
    expect(readOddsNumber("@1.72 sur Celsius")).toBe(1.72);
    expect(readOddsNumber("plus de 7,5 à 1,85")).toBe(1.85);
    expect(readOddsNumber("voilà")).toBeNull();
    expect(readOddsNumber("7,5 ou 8,5")).toBeNull();
    expect(readOddsNumber("0,5")).toBeNull();
  });

  it("reconnaît « pas dispo » et ses variantes", () => {
    expect(parseHumanOddsText("pas dispo")).toEqual({ kind: "unavailable" });
    expect(parseHumanOddsText("Il est pas disponible sur Celsius")).toEqual({ kind: "unavailable" });
    expect(parseHumanOddsText("indispo")).toEqual({ kind: "unavailable" });
    expect(parseHumanOddsText("1,90")).toEqual({ kind: "odds", odds: 1.9 });
    expect(parseHumanOddsText("")).toBeNull();
  });

  it("la demande ne se ferme que par le code (capture ET cote) ou par « pas dispo »", () => {
    const target = { kind: "MEDIA" as const, key: humanOddsKey("p1"), expected: { count: 1 } };
    expect(interpretAnswer(target, HUMAN_ODDS_DONE)).toMatchObject({ type: "answer" });
    expect(interpretAnswer(target, "pas dispo")).toMatchObject({ type: "answer", value: "pas dispo" });
    expect(interpretAnswer(target, "1,85")).toMatchObject({ type: "invalid" });
    expect(interpretAnswer(target, "plus tard")).toEqual({ type: "skip" });
  });

  it("question dans la voix de Kevin, échéance avant le coup d'envoi", () => {
    const kickoffAt = new Date("2026-10-28T20:00:00Z");
    const deadline = humanOddsDeadline(kickoffAt, 30);
    expect(deadline.getTime()).toBeLessThan(kickoffAt.getTime() - 30 * 60_000);
    const q = humanOddsQuestion({ homeTeam: "Arsenal", awayTeam: "Chelsea", league: "EPL", kickoffAt, marketLabel: "Tirs cadrés (match)", selectionLabel: "Plus de 8,5", site: "Celsius", deadline });
    expect(q).toContain("Celsius");
    expect(q).toContain("pas dispo");
    const check = voiceCheck(q);
    expect(check.problems).toEqual([]);
    expect(isHumanOddsPick({ oddsLevel: "human-pending" })).toBe(true);
    expect(isHumanOddsPick({ oddsLevel: "api+dom" })).toBe(false);
  });

  it("phrases de Kevin pendant l'échange : sans formule ni vouvoiement", () => {
    for (const t of [
      "Ce pari n'est plus à préparer, je l'ai retiré de la liste.",
      "D'accord, je laisse tomber ce pari.",
      "Noté, pas proposé chez Celsius : je laisse tomber ce pari.",
      "La cote 1,25 sort de la fourchette de la catégorie (1,50 à 3,50). Vérifie-la et renvoie la bonne cote, ou réponds « pas dispo ».",
      "Reçu : capture et cote 1,85. Je prépare le post.",
      "Capture reçue. Quelle est la cote exacte affichée sur Celsius ? (ex. 1,85)",
      "Cote notée : 1,85. Envoie-moi maintenant la capture du pari sur Celsius.",
    ])
      expect(voiceCheck(t).problems).toEqual([]);
  });
});

async function setup(kickoff = "2026-10-28T20:00:00Z") {
  const kit = createTestKit(new Date("2026-10-28T09:00:00Z"));
  const category = await kit.prisma.betCategory.create({
    data: { key: "tirs-cadres", name: "Tirs cadrés", minOdds: 1.5, maxOdds: 3.5, minMinutesBeforeKickoff: 30, active: true } as never,
  });
  const missionRow = await kit.prisma.agentMission.create({ data: { teamKey: "sports", status: "RUNNING", kind: "BET", steps: [], currentStep: 0, payload: {} } as never });
  const pick = (await kit.prisma.bettingPick.create({
    data: {
      missionId: (missionRow as { id: string }).id,
      categoryId: (category as { id: string }).id,
      eventId: "apifootball:9001",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      league: "EPL",
      kickoffAt: new Date(kickoff),
      marketId: "shots_onGoal-all-game-ou-over",
      marketLabel: "Tirs cadrés (match)",
      selectionLabel: "Plus de 8,5",
      line: 8.5,
      bookmaker: "celsius",
      odds: 1.95,
      oddsLevel: "human-pending",
      reasoning: { source: "stats", targetLabel: "Celsius" },
      status: "PROPOSED",
    } as never,
  })) as unknown as PickRow;
  const mission = { ...(missionRow as object), payload: { pickId: pick.id } } as unknown as Mission;
  const ctx = kit.deps as unknown as AgentContext;
  return { kit, pick, mission, ctx };
}

const req = (kit: ReturnType<typeof createTestKit>, pickId: string) => kit.tables("humanRequest").find((r) => r.key === humanOddsKey(pickId))!;
const pickOf = (kit: ReturnType<typeof createTestKit>, id: string) => kit.tables("bettingPick").find((r) => r.id === id)!;

describe("paris par capture : de la question au pari prêt", () => {
  it("demande la capture et la cote, puis les reçoit (photo puis cote) et prépare le pari", async () => {
    const { kit, pick, mission, ctx } = await setup();
    const asked = await humanOddsCaptureStep(mission, ctx, pick, "Celsius");
    expect(asked).toMatchObject({ ok: true, goTo: "capture" });
    expect(req(kit, pick.id)).toMatchObject({ kind: "MEDIA", status: "PENDING" });
    expect(kit.sent.at(-1)!.html).toContain("Celsius");
    expect(deadlineOf(req(kit, pick.id).onAnswer)).not.toBeNull();
    expect(kit.tables("agentMission")[0]).toMatchObject({ status: "WAITING_HUMAN" });

    // Un message sans rapport n'est pas pris.
    expect(await receiveHumanOddsInput(kit.deps, { text: "salut", actor: ACTOR })).toEqual({ handled: false });
    // Photo sans légende : rangée, Kevin demande la cote.
    const a = await receiveHumanOddsInput(kit.deps, { image: { bytes: PNG, mimeType: "image/png" }, actor: ACTOR });
    expect(a).toMatchObject({ handled: true });
    expect(a.reply).toContain("cote exacte");
    expect(kit.tables("mediaAsset")).toHaveLength(1);
    expect(kit.tables("mediaAsset")[0]).toMatchObject({ kind: "SCREENSHOT", origin: "HUMAN_SITE", teamKey: "sports" });
    // La cote : la demande se ferme, la mission reprend.
    const b = await receiveHumanOddsInput(kit.deps, { text: "1,85", actor: ACTOR });
    expect(b).toMatchObject({ handled: true, closed: true });
    expect(req(kit, pick.id)).toMatchObject({ status: "ANSWERED" });
    expect(kit.tables("agentMission")[0]!.status).not.toBe("WAITING_HUMAN");

    // L'étape Capture rejouée pose la capture et la cote de l'équipe sur le pari.
    const done = await humanOddsCaptureStep(mission, ctx, pick, "Celsius");
    expect(done.ok).toBe(true);
    expect(done.output).toMatchObject({ mediaAssetId: kit.tables("mediaAsset")[0]!.id, capture: { status: "captured", readOdds: 1.85, via: "human" } });
    expect(pickOf(kit, pick.id)).toMatchObject({ odds: 1.85, oddsAtSend: 1.85, oddsLevel: "human", screenshotAssetId: kit.tables("mediaAsset")[0]!.id });
  });

  it("photo avec la cote en légende : tout est reçu d'un coup", async () => {
    const { kit, pick, mission, ctx } = await setup();
    await humanOddsCaptureStep(mission, ctx, pick, "Celsius");
    const r = await receiveHumanOddsInput(kit.deps, { text: "cote 2,10", image: { bytes: PNG, mimeType: "image/jpeg" }, actor: ACTOR });
    expect(r).toMatchObject({ handled: true, closed: true });
    expect(r.reply).toContain("2,10");
  });

  it("cote hors fourchette : redemandée une fois, puis pari écarté", async () => {
    const { kit, pick, mission, ctx } = await setup();
    await humanOddsCaptureStep(mission, ctx, pick, "Celsius");
    await receiveHumanOddsInput(kit.deps, { image: { bytes: PNG, mimeType: "image/png" }, actor: ACTOR });
    const first = await receiveHumanOddsInput(kit.deps, { text: "1,25", actor: ACTOR });
    expect(first).toMatchObject({ handled: true });
    expect(first.closed).toBeUndefined();
    expect(first.reply).toContain("fourchette");
    const second = await receiveHumanOddsInput(kit.deps, { text: "1,25", actor: ACTOR });
    expect(second).toMatchObject({ handled: true, closed: true });
    const step = await humanOddsCaptureStep(mission, ctx, pick, "Celsius");
    expect(step.summary).toContain("pari écarté");
    expect(pickOf(kit, pick.id)).toMatchObject({ status: "SKIPPED" });
  });

  it("« pas dispo » : pari écarté, jamais publié", async () => {
    const { kit, pick, mission, ctx } = await setup();
    await humanOddsCaptureStep(mission, ctx, pick, "Celsius");
    const r = await receiveHumanOddsInput(kit.deps, { text: "pas dispo", actor: ACTOR });
    expect(r).toMatchObject({ handled: true, closed: true });
    const step = await humanOddsCaptureStep(mission, ctx, pick, "Celsius");
    expect(step.summary).toContain("pas proposé chez Celsius");
    expect(pickOf(kit, pick.id)).toMatchObject({ status: "SKIPPED", skipReason: "pari pas proposé chez Celsius (réponse de l'équipe)" });
  });

  it("échéance dépassée : la demande expire au balayage et le pari est écarté", async () => {
    const { kit, pick, mission, ctx } = await setup();
    await humanOddsCaptureStep(mission, ctx, pick, "Celsius");
    kit.advance(11 * 3_600_000);
    await sweepHumanRequests(kit.deps);
    expect(req(kit, pick.id)).toMatchObject({ status: "EXPIRED" });
    const step = await humanOddsCaptureStep(mission, ctx, pick, "Celsius");
    expect(step.summary).toContain("à temps");
    expect(pickOf(kit, pick.id)).toMatchObject({ status: "SKIPPED" });
  });

  it("trop près du coup d'envoi pour attendre : pari écarté sans poser la question", async () => {
    const { kit, pick, mission, ctx } = await setup("2026-10-28T09:40:00Z");
    const step = await humanOddsCaptureStep(mission, ctx, pick, "Celsius");
    expect(step.summary).toContain("coup d'envoi trop proche");
    expect(kit.tables("humanRequest")).toHaveLength(0);
  });
});
