/**
 * Phase 20 : missions de l'équipe Dating (photo, texte, et une ancienne mission « vidéo » devenue photo depuis le
 * retrait des vidéos IA le 29 octobre 2026) pour une persona de test sur le canal Test, en simulation, avec le faux
 * fournisseur de photos, sur base réelle : photos rangées, validations « 3 premières photos » / « nouveau canal »
 * déclenchées puis acceptées (`decideValidation`, comme le bouton ✅), posts programmés puis envoyés par le scheduler
 * existant (bot de test simulé), coûts à 0, aucune vidéo source utilisée.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  createFakeImageProvider,
  createFakeLlm,
  createMission,
  decideValidation,
  runNextStep,
  type AgentStepJob,
  type EngineDeps,
} from "@linkaffipro/agents";
import { processScheduler } from "../../src/processors/scheduler";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import { approveAllQa, createBotAndChannel, fakeJob, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";

const steps: AgentStepJob[] = [];
const adminSent: string[] = [];
let nextMsg = 7000;
const loadAsset = async (id: string) => {
  const a = await prisma.mediaAsset.findUnique({ where: { id }, select: { bytes: true, mimeType: true, filename: true } });
  return a ? { bytes: new Uint8Array(a.bytes), mimeType: a.mimeType, filename: a.filename } : null;
};
const deps: EngineDeps = {
  prisma,
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
  providers: { llm: createFakeLlm(), image: createFakeImageProvider({ loadAsset }) },
};

async function drain(): Promise<string[]> {
  const out: string[] = [];
  while (steps.length) {
    const s = steps.shift()!;
    out.push(await runNextStep(deps, s.missionId, s.index));
  }
  return out;
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGN4VmFDEmIY1TCqYfhqAACh3JoQLIL4OAAAAABJRU5ErkJggg==", "base64");

describe("agents Dating : photo et texte en simulation (base réelle)", () => {
  let testChannelId = "";
  let botId = "";
  let calls: TelegramCall[] = [];
  const missions: Record<"video" | "photo" | "text", string> = { video: "", photo: "", text: "" };

  beforeAll(async () => {
    await resetDb();
    // Phase 30 : QA Global simulé qui approuve (les verrous restent actifs).
    await approveAllQa(deps);
    await prisma.setting.deleteMany({ where: { key: { startsWith: "agents." } } });
    const old = await prisma.mediaAsset.findMany({ where: { OR: [{ teamKey: "dating" }, { filename: { startsWith: "it-dating-" } }] }, select: { id: true } });
    await prisma.mediaAssetTelegramFile.deleteMany({ where: { assetId: { in: old.map((a) => a.id) } } });
    await prisma.mediaAsset.deleteMany({ where: { id: { in: old.map((a) => a.id) } } });

    const { bot, channel } = await createBotAndChannel({ title: "Canal test" });
    testChannelId = channel.id;
    botId = bot.id;
    const real = await prisma.channel.create({ data: { telegramChatId: -1009988776655n, title: "Rencontres Léa", type: "CHANNEL", language: "fr", vertical: "DATING", primaryBotId: bot.id } });
    const ref = await prisma.mediaAsset.create({
      data: { filename: "it-dating-ref.png", mimeType: "image/png", size: PNG.length, sha256: randomBytes(16).toString("hex"), bytes: PNG, kind: "REFERENCE", origin: "HUMAN", teamKey: "dating" },
    });
    const persona = await prisma.persona.create({ data: { name: "Léa Test", referenceImageIds: [ref.id], mediaNotes: "tenue décontractée" } });
    await prisma.mediaAsset.update({ where: { id: ref.id }, data: { personaId: persona.id } });
    for (let i = 0; i < 4; i++) {
      const bytes = randomBytes(64);
      await prisma.mediaAsset.create({
        data: { filename: `it-dating-src${i}.mp4`, mimeType: "video/mp4", size: bytes.length, sha256: randomBytes(16).toString("hex"), bytes, duration: 8, kind: "SOURCE", origin: "HUMAN", teamKey: "dating", personaId: persona.id },
      });
    }
    await prisma.channelAgentPlan.create({
      data: { channelId: real.id, teamKey: "dating", enabled: true, postsPerDay: 6, windowStart: "00:00", windowEnd: "24:00", minSpacingMinutes: 0, mix: { video: 1, photo: 2, text: 1 }, personaId: persona.id },
    });
    calls = installFakeTelegram((await apiForBot(botId)).api);
    for (const f of ["video", "photo", "text"] as const) {
      const r = await createMission(deps, { teamKey: "dating", channelId: real.id, createdBy: "GRAND_CHEF", format: f });
      if (!r.ok) throw new Error(r.reason);
      missions[f] = r.missionId;
    }
  });

  it("chaque mission produit son média puis attend la validation (3 premières photos, nouveau canal)", async () => {
    const out = await drain();
    expect(out.filter((o) => o === "validation")).toHaveLength(3);
    // Ancienne mission « vidéo » : produite en photo, sans vidéo source.
    const v = await prisma.agentMission.findUniqueOrThrow({ where: { id: missions.video } });
    const vp = v.payload as Record<string, unknown>;
    expect(v.status).toBe("WAITING_VALIDATION");
    expect(vp).toMatchObject({ format: "photo", sourceAssetId: null });
    const fromVideo = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: vp.mediaAssetId as string } });
    expect(fromVideo).toMatchObject({ kind: "PHOTO", origin: "AI", providerName: "fake" });
    expect(fromVideo.tags).toContain("simulation");
    const p = await prisma.agentMission.findUniqueOrThrow({ where: { id: missions.photo } });
    const photo = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: (p.payload as Record<string, unknown>).mediaAssetId as string } });
    expect(photo).toMatchObject({ kind: "PHOTO", origin: "AI" });
    const validations = await prisma.agentValidation.findMany({ orderBy: { number: "asc" } });
    expect(validations.find((x) => x.missionId === missions.photo)!.reason).toMatch(/3 premières photos de Léa Test/);
    expect(adminSent.filter((h) => h.includes("À valider"))).toHaveLength(3);
  });

  it("✅ sur les trois → posts programmés sur le canal Test avec leur média, coûts à 0", async () => {
    for (const v of await prisma.agentValidation.findMany({ where: { status: "PENDING" } }))
      expect((await decideValidation(deps, { validationId: v.id, decision: "approve", via: "TELEGRAM" })).ok).toBe(true);
    expect(await drain()).toEqual(["done", "done", "done"]);
    const posts = await prisma.post.findMany({ where: { agentMissionId: { in: Object.values(missions) } } });
    expect(posts).toHaveLength(3);
    for (const post of posts) {
      expect(post).toMatchObject({ channelId: testChannelId, status: "SCHEDULED" });
      expect(post.text.startsWith("[SIMULATION équipe Rencontres → Rencontres Léa]\n")).toBe(true);
    }
    const byMission = Object.fromEntries(posts.map((x) => [x.agentMissionId, x]));
    expect((byMission[missions.video]!.mediaAssetIds as string[]).length).toBe(1);
    expect((byMission[missions.photo]!.mediaAssetIds as string[]).length).toBe(1);
    expect(byMission[missions.text]!.mediaAssetIds).toEqual([]);
    const usage = await prisma.agentUsage.findMany({ where: { teamKey: "dating", provider: { in: ["video", "image"] } } });
    expect(usage.reduce((s, u) => s + u.cents, 0)).toBe(0);
    // Aucune vidéo source n'est utilisée (vidéos IA retirées).
    const sources = await prisma.mediaAsset.findMany({ where: { kind: "SOURCE", teamKey: "dating" }, select: { id: true } });
    expect(await prisma.mediaUsage.count({ where: { assetId: { in: sources.map((x) => x.id) } } })).toBe(0);
  });

  it("le scheduler existant envoie les photos et le texte (bot de test simulé)", async () => {
    const posts = await prisma.post.findMany({ where: { agentMissionId: { in: Object.values(missions) } } });
    await prisma.post.updateMany({ where: { id: { in: posts.map((p) => p.id) } }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    expect(await processScheduler(fakeJob({ type: "tick" as const }))).toMatchObject({ claimed: 3 });
    for (const p of posts) await processTelegramSend(fakeJob({ type: "post" as const, postId: p.id }));
    const methods = calls.map((c) => c.method);
    expect(methods).not.toContain("sendVideo");
    expect(methods).toContain("sendPhoto");
    expect(methods).toContain("sendMessage");
    const after = await prisma.post.findMany({ where: { id: { in: posts.map((p) => p.id) } } });
    expect(after.every((p) => p.status === "SENT")).toBe(true);
  });
});
