/**
 * Phase 23 : une journée de l'équipe Paris sportifs sur base réelle, horloge injectée. Faux fournisseur de cotes
 * (fixtures SportsGameOdds recalées sur l'horloge) et faux fournisseur de captures (image PNG, cote lue = cote
 * retenue ; un match « bloqué » par le site). Canal Paris en simulation : tout part sur le canal Test.
 * Vérifié : passage de 10 h → 4 paris retenus (un par match) ; 2 publiés tout de suite sur le canal Test avec leur
 * capture ; 1 écarté au Contrôle pour cote bougée (journalisé, jamais publié) ; 1 image de repli soumise à
 * validation ; puis, après les matchs, résultats réglés (`settle`) et bilan calculé.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  betSummary,
  createFakeLlm,
  createFakeOddsProvider,
  decideValidation,
  FAKE_ODDS_ANCHOR,
  fallbackPng,
  runCycle,
  runNextStep,
  runSportsSettle,
  type AgentStepJob,
  type CaptureRequest,
  type CaptureResult,
  type EngineDeps,
} from "@linkaffipro/agents";
import { processScheduler } from "../../src/processors/scheduler";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import { createBotAndChannel, fakeJob, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";

// 24 octobre 2026, 10 h à Paris : heure de passage du Chef Paris.
let now = new Date(FAKE_ODDS_ANCHOR);
const steps: Array<{ agent: string; job: AgentStepJob }> = [];
const adminSent: string[] = [];
let nextMsg = 7000;
const odds = createFakeOddsProvider({ now: () => now });
let blockedTeam = "";
const captures: CaptureRequest[] = [];
const screenshot = {
  name: "fake",
  async capture(req: CaptureRequest): Promise<CaptureResult> {
    captures.push(req);
    if (req.homeTeam === blockedTeam) return { ok: false, kind: "geo_blocked", message: "site indisponible dans ce pays" };
    return { ok: true, png: fallbackPng(320, 200), readOdds: req.expectedOdds, pageUrl: "https://www.sportaza.example/match" };
  },
  async testConnection(): Promise<CaptureResult> {
    return { ok: true, png: fallbackPng(10, 10), readOdds: 0, pageUrl: "https://www.sportaza.example" };
  },
  async renderTemplate(): Promise<Uint8Array> {
    return fallbackPng(1080, 1080);
  },
};
const deps: EngineDeps = {
  prisma,
  now: () => now,
  enqueue: {
    async orchestrator() {},
    async step(_team, agent, job) {
      steps.push({ agent, job });
    },
  },
  admin: {
    async send(html) {
      adminSent.push(html);
      return { messageId: nextMsg++ };
    },
  },
  providers: { llm: createFakeLlm(), odds, screenshot },
};

async function drain(): Promise<string[]> {
  const out: string[] = [];
  while (steps.length) {
    const s = steps.shift()!;
    out.push(await runNextStep(deps, s.job.missionId, s.job.index));
  }
  return out;
}

describe("équipe Paris sportifs : une journée simulée (base réelle)", () => {
  let testChannelId = "";
  let sportsId = "";
  let categoryId = "";
  let calls: TelegramCall[] = [];

  beforeAll(async () => {
    await resetDb();
    await prisma.bettingPick.deleteMany();
    await prisma.setting.deleteMany({ where: { key: { startsWith: "agents." } } });
    for (const key of ["agents.dailyReportAsked", "agents.datingSetupAsked", "agents.algoSetupAsked", "agents.casinoSetupAsked", "agents.sportsSetupAsked"])
      await prisma.setting.create({ data: { key, value: "2026-10-01T00:00:00.000Z" } });
    // Rapport du jour déjà parti : la journée ne teste que les paris.
    await prisma.setting.create({ data: { key: "agents.report.lastDay", value: "2026-10-24" } });
    await prisma.betCategory.updateMany({ data: { active: false } });
    const { bot, channel } = await createBotAndChannel({ title: "Canal test" });
    testChannelId = channel.id;
    const real = await prisma.channel.create({
      data: { telegramChatId: -1005544332211n, title: "Paris VIP", type: "CHANNEL", language: "fr", vertical: "SPORTS", primaryBotId: bot.id },
    });
    sportsId = real.id;
    await prisma.agentTeamConfig.create({ data: { teamKey: "sports", simulation: true, autonomyLevel: 2, settings: { sports: { runHours: [10] } } } });
    const cat = await prisma.betCategory.upsert({
      where: { key: "it-tirs" },
      create: {
        key: "it-tirs",
        name: "Tirs cadrés (test)",
        marketTypes: ["shots_onGoal-all-game-ou-over", "shots_onGoal-home-game-ou-over"],
        leagues: ["EPL", "LA_LIGA", "FR_LIGUE_1", "BUNDESLIGA"],
        bookmakers: ["sportaza"],
        minOdds: 1.5,
        maxOdds: 3.5,
        picksPerDay: 4,
        channelIds: [real.id],
        active: true,
        sortOrder: 99,
      },
      update: { active: true, channelIds: [real.id], picksPerDay: 4 },
    });
    categoryId = cat.id;
    calls = installFakeTelegram((await apiForBot(bot.id)).api);
  });

  it("passage de 10 h : 4 paris retenus, un par match, raisonnement chiffré", async () => {
    await runCycle(deps);
    const missions = await prisma.agentMission.findMany({ where: { teamKey: "sports" } });
    expect(missions).toHaveLength(1);
    expect(missions[0]).toMatchObject({ kind: "BET", channelId: sportsId });
    // Étape Cotes seule : les paris existent, les missions sœurs sont créées.
    const first = steps.shift()!;
    expect(first.agent).toBe("cotes");
    expect(await runNextStep(deps, first.job.missionId, first.job.index)).toBe("next");
    const picks = await prisma.bettingPick.findMany({ orderBy: { interestScore: "desc" } });
    expect(picks).toHaveLength(4);
    expect(new Set(picks.map((p) => p.eventId)).size).toBe(4);
    expect(picks.every((p) => p.status === "PROPOSED" && p.bookmaker === "sportaza" && p.missionId)).toBe(true);
    expect(picks[0]!.reasoning).toMatchObject({ source: "fake", targetBookmaker: "sportaza" });
    expect(await prisma.agentMission.count({ where: { teamKey: "sports" } })).toBe(4);
  });

  it("chaîne : 2 publiés avec capture, 1 écarté pour cote bougée, 1 repli à valider", async () => {
    const picks = await prisma.bettingPick.findMany({ orderBy: { interestScore: "desc" } });
    const moved = picks[2]!;
    const blocked = picks[3]!;
    odds.setOdds(moved.eventId, moved.marketId, "sportaza", Math.round(moved.odds * 1.2 * 100) / 100);
    blockedTeam = blocked.homeTeam;
    await drain();
    // Ligue et marché jamais utilisés : validés comme le bouton ✅ (toujours validé, quel que soit le niveau).
    for (let round = 0; round < 3; round++) {
      const pending = await prisma.agentValidation.findMany({ where: { status: "PENDING" } });
      const toApprove = [];
      for (const v of pending) {
        const m = await prisma.agentMission.findUniqueOrThrow({ where: { id: v.missionId } });
        if ((m.payload as { pickId?: string }).pickId !== blocked.id) toApprove.push(v);
      }
      if (!toApprove.length) break;
      for (const v of toApprove) expect((await decideValidation(deps, { validationId: v.id, decision: "approve", via: "TELEGRAM" })).ok).toBe(true);
      await drain();
    }
    const after = await prisma.bettingPick.findMany();
    const by = (id: string) => after.find((p) => p.id === id)!;
    expect(by(picks[0]!.id).status).toBe("PUBLISHED");
    expect(by(picks[1]!.id).status).toBe("PUBLISHED");
    expect(by(moved.id)).toMatchObject({ status: "SKIPPED", skipReason: "odds_moved" });
    expect(by(blocked.id).status).toBe("PROPOSED");
    const skippedEvent = await prisma.event.findFirst({ where: { type: "agents.sports.pick_skipped" } });
    expect(skippedEvent).not.toBeNull();

    // Repli : image TEMPLATE, validation demandée avec le motif.
    const blockedMission = await prisma.agentMission.findUniqueOrThrow({ where: { id: by(blocked.id).missionId! } });
    expect(blockedMission.status).toBe("WAITING_VALIDATION");
    const validation = await prisma.agentValidation.findFirstOrThrow({ where: { missionId: blockedMission.id } });
    expect(validation.reason).toMatch(/image de repli/);
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: by(blocked.id).screenshotAssetId! }, select: { origin: true, kind: true } });
    expect(asset).toEqual({ origin: "TEMPLATE", kind: "SCREENSHOT" });
    // Site bloqué : la parade est demandée au client (adresse IP résidentielle ou Mac).
    expect(await prisma.humanRequest.count({ where: { key: "sports.captureWorkaround" } })).toBe(1);

    // Publiés : programmés « maintenant » sur le canal Test, capture jointe, en-tête de simulation.
    const posts = await prisma.post.findMany({ where: { id: { in: [by(picks[0]!.id).postId!, by(picks[1]!.id).postId!] } } });
    expect(posts).toHaveLength(2);
    for (const p of posts) {
      expect(p.channelId).toBe(testChannelId);
      expect(p.scheduledAt!.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(p.text.startsWith("[SIMULATION équipe Paris sportifs → Paris VIP]\n")).toBe(true);
      expect((p.mediaAssetIds as string[]).length).toBe(1);
      const shot = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: (p.mediaAssetIds as string[])[0]! }, select: { origin: true, kind: true } });
      expect(shot).toEqual({ origin: "HUMAN_SITE", kind: "SCREENSHOT" });
    }
    expect(by(picks[0]!.id).oddsAtSend).toBe(picks[0]!.odds);
    // Envoyés par le scheduler existant (bot simulé), en photo.
    await prisma.post.updateMany({ where: { id: { in: posts.map((p) => p.id) } }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await processScheduler(fakeJob({ type: "tick" as const }));
    for (const p of posts) await processTelegramSend(fakeJob({ type: "post" as const, postId: p.id }));
    expect(calls.filter((c) => c.method === "sendPhoto").length).toBeGreaterThanOrEqual(2);
    expect(await prisma.post.count({ where: { id: { in: posts.map((p) => p.id) }, status: "SENT" } })).toBe(2);
  });

  it("après les matchs : résultats réglés, résultat dans la fiche du post, bilan", async () => {
    // Le lendemain soir : tous les matchs des fixtures sont finis.
    now = new Date(FAKE_ODDS_ANCHOR.getTime() + 2 * 86_400_000);
    const r = await runSportsSettle(deps);
    expect(r.settled).toBe(2);
    // La validation du repli n'a pas eu de réponse avant le match : écartée.
    expect(r.expired).toBe(1);
    const published = await prisma.bettingPick.findMany({ where: { status: { in: ["WON", "LOST", "VOID"] } } });
    expect(published).toHaveLength(2);
    for (const p of published) {
      expect(p.settledAt).not.toBeNull();
      expect((p.result as { detail?: string }).detail).toBeTruthy();
    }
    const summary = await betSummary(prisma, { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z"), by: "category" });
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ key: categoryId, label: "Tirs cadrés (test)", published: 2 });
    expect(summary[0]!.won + summary[0]!.lost + summary[0]!.void).toBe(2);
    const byLeague = await betSummary(prisma, { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z"), by: "league" });
    expect(byLeague.reduce((s, x) => s + x.published, 0)).toBe(2);
    // Un second passage ne règle rien de plus.
    expect((await runSportsSettle(deps)).settled).toBe(0);
  });
});
