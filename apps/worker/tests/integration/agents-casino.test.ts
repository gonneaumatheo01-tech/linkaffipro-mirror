/**
 * Phase 22 : une semaine de l'équipe Casino sur base réelle, horloge injectée, jour par jour. 4 vidéos de test
 * déposées dans la médiathèque (même rangement que le dépôt par le bot : `storeLibraryMedia`, légende
 * « #casino #roulette » / « #casino #bonus ») ; un canal casino en simulation (tout part sur le canal Test) ; chaque
 * jour le passage du Grand Chef crée le plan du jour, les validations « toujours » sont acceptées comme le bouton ✅,
 * les posts programmés sont envoyés par le scheduler existant (bot simulé). Vérifié : mélange 2 vidéos / 1 image /
 * 1 texte, rotation (aucune vidéo reprise sur le canal), replis quand le stock s'épuise, demande groupée envoyée une
 * seule fois, posts envoyés, rapport quotidien avec les replis.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  createFakeLlm,
  decideValidation,
  respondToRequest,
  runCycle,
  runNextStep,
  storeLibraryMedia,
  type AgentStepJob,
  type EngineDeps,
  type HumanRequestRow,
} from "@linkaffipro/agents";
import { processScheduler } from "../../src/processors/scheduler";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import { createBotAndChannel, fakeJob, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";

const DAY = 86_400_000;
// Lundi 2 novembre 2026, 8 h 30 à Paris (heure d'hiver).
const START = new Date("2026-11-02T07:30:00Z");
let now = START;
const steps: AgentStepJob[] = [];
const adminSent: string[] = [];
let nextMsg = 9000;
const deps: EngineDeps = {
  prisma,
  now: () => now,
  enqueue: {
    async orchestrator() {},
    async step(_team, _agent, job) {
      steps.push(job);
    },
  },
  admin: {
    async send(html) {
      adminSent.push(html);
      return { messageId: nextMsg++ };
    },
  },
  providers: { llm: createFakeLlm() },
};

async function drain(): Promise<string[]> {
  const out: string[] = [];
  while (steps.length) {
    const s = steps.shift()!;
    out.push(await runNextStep(deps, s.missionId, s.index));
  }
  return out;
}

/** L'admin passe les questions de mise en route (« plus tard ») : seule la demande groupée reste à voir. */
async function skipSetupQuestions(): Promise<void> {
  for (;;) {
    const r = (await prisma.humanRequest.findFirst({
      where: { key: { startsWith: "media.casino.setup." }, status: { in: ["QUEUED", "PENDING"] } },
      orderBy: { createdAt: "asc" },
    })) as HumanRequestRow | null;
    if (!r) return;
    await respondToRequest(deps, r, "plus tard", { via: "TELEGRAM", userId: null });
  }
}

describe("équipe Casino : une semaine simulée sur le canal Test (base réelle)", () => {
  let testChannelId = "";
  let casinoId = "";
  let calls: TelegramCall[] = [];
  const videos: string[] = [];
  const days: Array<{ day: number; missions: string[] }> = [];

  beforeAll(async () => {
    await resetDb();
    await prisma.setting.deleteMany({ where: { key: { startsWith: "agents." } } });
    await prisma.alert.deleteMany({ where: { kind: "agents_media_low" } });
    const old = await prisma.mediaAsset.findMany({ where: { OR: [{ teamKey: "casino" }, { filename: { startsWith: "it-casino-" } }] }, select: { id: true } });
    await prisma.mediaAssetTelegramFile.deleteMany({ where: { assetId: { in: old.map((a) => a.id) } } });
    await prisma.mediaAsset.deleteMany({ where: { id: { in: old.map((a) => a.id) } } });
    // Questions des autres équipes déjà posées : la file des demandes ne contient que celles du casino.
    for (const key of ["agents.dailyReportAsked", "agents.datingSetupAsked", "agents.algoSetupAsked"])
      await prisma.setting.create({ data: { key, value: "2026-10-01T00:00:00.000Z" } });

    const { bot, channel } = await createBotAndChannel({ title: "Canal test" });
    testChannelId = channel.id;
    const real = await prisma.channel.create({
      data: { telegramChatId: -1007766554433n, title: "Casino VIP", type: "CHANNEL", language: "fr", vertical: "CASINO", primaryBotId: bot.id },
    });
    casinoId = real.id;
    await prisma.channelAgentPlan.create({
      data: {
        channelId: real.id,
        teamKey: "casino",
        enabled: true,
        postsPerDay: 4,
        windowStart: "09:00",
        windowEnd: "23:00",
        minSpacingMinutes: 60,
        mix: { video: 2, photo: 1, text: 1 },
        themes: [
          { theme: "roulette", weight: 2 },
          { theme: "bonus", weight: 1 },
        ],
      },
    });
    await prisma.agentTeamConfig.create({ data: { teamKey: "casino", simulation: true, autonomyLevel: 2 } });

    for (const [i, theme] of ["roulette", "roulette", "bonus", "bonus"].entries()) {
      const bytes = randomBytes(64);
      const r = await storeLibraryMedia(deps, {
        bytes,
        mimeType: "video/mp4",
        filename: `it-casino-${i}.mp4`,
        duration: 8,
        caption: `#casino #${theme}`,
        botId: bot.id,
        telegramFileId: `file-${i}`,
        fileUniqueId: `uniq-${i}`,
      });
      expect(r.ok).toBe(true);
      if (r.ok) videos.push(r.assetId);
    }
    calls = installFakeTelegram((await apiForBot(bot.id)).api);
  });

  it("dépôt : 4 vidéos rangées par thème, fournies par le client", async () => {
    const rows = await prisma.mediaAsset.findMany({ where: { id: { in: videos } } });
    expect(rows.map((r) => r.theme).sort()).toEqual(["bonus", "bonus", "roulette", "roulette"]);
    expect(rows.every((r) => r.teamKey === "casino" && r.origin === "HUMAN")).toBe(true);
  });

  it("7 jours : plan du jour, validations acceptées, posts programmés puis envoyés", { timeout: 300_000 }, async () => {
    for (let d = 0; d < 7; d++) {
      now = new Date(START.getTime() + d * DAY);
      const before = new Set((await prisma.agentMission.findMany({ select: { id: true } })).map((m) => m.id));
      await runCycle(deps);
      await skipSetupQuestions();
      await drain();
      for (let round = 0; round < 3; round++) {
        const pending = await prisma.agentValidation.findMany({ where: { status: "PENDING" } });
        if (!pending.length) break;
        for (const v of pending) expect((await decideValidation(deps, { validationId: v.id, decision: "approve", via: "TELEGRAM" })).ok).toBe(true);
        await drain();
      }
      const created = (await prisma.agentMission.findMany({ where: { teamKey: "casino" }, select: { id: true } })).map((m) => m.id).filter((id) => !before.has(id));
      days.push({ day: d, missions: created });
      // Fin de journée : les posts programmés partent (le scheduler lit l'heure réelle).
      const posts = await prisma.post.findMany({ where: { agentMissionId: { in: created }, status: "SCHEDULED" } });
      await prisma.post.updateMany({ where: { id: { in: posts.map((p) => p.id) } }, data: { scheduledAt: new Date(Date.now() - 1000) } });
      await processScheduler(fakeJob({ type: "tick" as const }));
      for (const p of posts) await processTelegramSend(fakeJob({ type: "post" as const, postId: p.id }));
      // 9 h 30 : rapport de la veille.
      now = new Date(now.getTime() + 60 * 60_000);
      await runCycle(deps);
    }
    const missions = await prisma.agentMission.findMany({ where: { teamKey: "casino" } });
    expect(missions).toHaveLength(28);
    expect(missions.every((m) => m.status === "DONE")).toBe(true);
    const posts = await prisma.post.findMany({ where: { agentMissionId: { in: missions.map((m) => m.id) } } });
    expect(posts).toHaveLength(28);
    expect(posts.every((p) => p.channelId === testChannelId && p.status === "SENT")).toBe(true);
    expect(posts.every((p) => p.text.startsWith("[SIMULATION équipe Casino → Casino VIP]\n"))).toBe(true);
    const methods = calls.map((c) => c.method);
    expect(methods).toContain("sendVideo");
    expect(methods).toContain("sendMessage");
    // Jamais l'agent Média IA dans la chaîne casino.
    for (const m of missions) expect((m.steps as Array<{ agent: string }>).some((s) => s.agent === "media-ia")).toBe(false);
  });

  it("mélange respecté chaque jour : 2 vidéos, 1 image, 1 texte voulus", async () => {
    for (const d of days) {
      const rows = await prisma.agentMission.findMany({ where: { id: { in: d.missions } } });
      const planned = rows.map((r) => (r.payload as { plannedFormat?: string }).plannedFormat).sort();
      expect(planned).toEqual(["photo", "text", "video", "video"]);
    }
  });

  it("rotation : chaque vidéo une seule fois sur le canal, comptée sur le canal visé ; thème du jour pondéré", async () => {
    const usages = await prisma.mediaUsage.findMany({ where: { assetId: { in: videos } } });
    expect(usages).toHaveLength(4);
    expect(new Set(usages.map((u) => u.assetId)).size).toBe(4);
    expect(usages.every((u) => u.channelId === casinoId)).toBe(true);
    const dayThemes: string[] = [];
    for (const d of days) {
      const m = await prisma.agentMission.findFirstOrThrow({ where: { id: { in: d.missions } } });
      dayThemes.push(String((m.payload as { dayTheme?: string }).dayTheme));
    }
    expect(dayThemes.filter((t) => t === "roulette").length).toBeGreaterThan(dayThemes.filter((t) => t === "bonus").length);
    expect(dayThemes.filter((t) => t === "bonus").length).toBeGreaterThanOrEqual(2);
  });

  it("replis quand le stock s'épuise : journalisés, jamais une vidéo inventée", async () => {
    const events = await prisma.event.findMany({ where: { type: "agents.casino.fallback" } });
    const payloads = events.map((e) => e.payload as { from: string; to: string });
    // Aucune image fournie : chaque image voulue devient un texte ; plus de vidéo à partir du 3e jour.
    expect(payloads.filter((p) => p.from === "photo" && p.to === "text")).toHaveLength(7);
    expect(payloads.filter((p) => p.from === "video" && p.to === "text").length).toBeGreaterThanOrEqual(10);
    const media = await prisma.agentMission.findMany({ where: { teamKey: "casino" } });
    const used = media.map((m) => (m.payload as { mediaAssetId?: string | null }).mediaAssetId).filter(Boolean);
    expect(used.sort()).toEqual([...videos].sort());
  });

  it("demande groupée : un seul message, mot-clé exact", async () => {
    const reqs = await prisma.humanRequest.findMany({ where: { key: { startsWith: "media.casino.2" } } });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.question).toContain("#casino #roulette");
    expect(reqs[0]!.question).toContain("#casino #bonus");
    const sent = adminSent.filter((h) => h.includes("Il manque des vidéos casino"));
    // Envoyée une fois ; le balayage des demandes y ajoute au plus son rappel unique.
    expect(sent.filter((h) => !h.includes("Rappel"))).toHaveLength(1);
    expect(sent.filter((h) => h.includes("Rappel")).length).toBeLessThanOrEqual(1);
    expect(reqs[0]!.expected).toMatchObject({ channelIds: [casinoId] });
    const alert = await prisma.alert.findMany({ where: { kind: "agents_media_low", resolvedAt: null } });
    expect(alert).toHaveLength(1);
  });

  it("rapport quotidien : une ligne Casino par jour, replis comptés", async () => {
    const reports = await prisma.event.findMany({ where: { type: "agents.report.daily" }, orderBy: { occurredAt: "asc" } });
    expect(reports.length).toBeGreaterThanOrEqual(6);
    const lines = reports.map((r) => ((r.payload as { lines: string[] }).lines ?? []).find((l) => l.startsWith("Casino")) ?? "");
    expect(lines.some((l) => /posts? texte faute de vidéos : roulette/.test(l))).toBe(true);
    expect(lines.some((l) => /faute d'images/.test(l))).toBe(true);
  });
});
