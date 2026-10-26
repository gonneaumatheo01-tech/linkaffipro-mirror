/**
 * Phase 21 : équipe Algorithme sur base réelle. Jeu de posts de test (canal Test, persona de test) → fiches
 * `PostInsight` (vues interpolées) → meilleurs horaires et fenêtres écrits → test A/B simulé jusqu'à sa clôture avec
 * gagnant → recommandation appliquée puis annulée (valeurs vérifiées) → rapport « Ce qui marche » généré et envoyé au
 * faux Telegram ; mission d'agent qui tire sa variante ; alertes de décrochage évaluées sans erreur.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  applyRecommendation,
  createFakeLlm,
  createMission,
  runAlgoNightly,
  runAlgoWeekly,
  runDropAlerts,
  startExperiment,
  undoRecommendation,
  type EngineDeps,
} from "@linkaffipro/agents";
import { approveAllQa, createBotAndChannel, resetDb } from "./helpers";

const adminSent: string[] = [];
const deps: EngineDeps = {
  prisma,
  enqueue: { async orchestrator() {}, async step() {} },
  admin: {
    async send(html) {
      adminSent.push(html);
      return { messageId: 1 };
    },
  },
  providers: { llm: createFakeLlm() },
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("équipe Algorithme : fiches, horaires, test A/B, réglage, rapport (base réelle)", () => {
  let channelId = "";
  let botId = "";
  let experimentId = "";

  beforeAll(async () => {
    await resetDb();
    // Phase 30 : QA Global simulé qui approuve (les verrous restent actifs).
    await approveAllQa(deps);
    await prisma.setting.deleteMany({ where: { OR: [{ key: { startsWith: "agents." } }, { key: { startsWith: "besthours." } }] } });
    await prisma.alert.deleteMany({ where: { kind: { startsWith: "agents_" } } });
    const { bot, channel } = await createBotAndChannel({ title: "Canal Test Algo" });
    channelId = channel.id;
    botId = bot.id;
    await prisma.channel.update({ where: { id: channelId }, data: { vertical: "DATING" } });
    const persona = await prisma.persona.create({ data: { name: "Persona test" } });
    await prisma.channelAgentPlan.create({
      data: { channelId, teamKey: "dating", enabled: true, postsPerDay: 3, windowStart: "09:00", windowEnd: "22:00", minSpacingMinutes: 60, mix: { video: 1, photo: 2, text: 1 }, personaId: persona.id },
    });
    const video = await prisma.mediaAsset.create({
      data: { filename: "v.mp4", mimeType: "video/mp4", size: 3, sha256: randomUUID(), bytes: Buffer.from("abc") },
    });
    const exp = await prisma.experiment.create({
      data: {
        teamKey: "dating",
        channelId,
        kind: "STYLE_LEGENDE",
        hypothesis: "question contre affirmation",
        variants: { A: { label: "question", style: "Termine par une question." }, B: { label: "affirmation", style: "Affirme." } },
        metric: "offer_ctr",
        minSamples: 20,
        status: "RUNNING",
        startedAt: new Date(Date.now() - 20 * DAY),
        endsAt: new Date(Date.now() + DAY),
      },
    });
    experimentId = exp.id;
    // 48 posts sur 30 jours : vidéos à 19 h (Paris) qui font cliquer, textes à 12 h qui cliquent peu ; la moitié
    // dans le test A/B (A clique 2,5 fois plus que B).
    const base = Date.now() - 30 * DAY;
    for (let i = 0; i < 48; i++) {
      const isVideo = i % 2 === 0;
      const day = new Date(base + Math.floor(i / 2) * DAY);
      const sentAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), isVideo ? 17 : 10, 0, 0));
      const inTest = i < 40;
      const variant = inTest ? (Math.floor(i / 2) % 2 === 0 ? "A" : "B") : null;
      const post = await prisma.post.create({
        data: {
          code: `al${i}${randomUUID().slice(0, 6)}`,
          channelId,
          botId,
          status: "SENT",
          sentAt,
          text: isVideo ? "Ce soir 🔥 tu viens ?" : "Un texte un peu plus long pour le canal, sans emoji.",
          mediaAssetIds: isVideo ? [video.id] : [],
          abGroupId: inTest ? `exp_${experimentId}` : null,
          abVariant: variant,
        },
      });
      const offerClicks = variant === "A" ? 25 : variant === "B" ? 10 : isVideo ? 30 : 5;
      await prisma.postStats.create({ data: { postId: post.id, views: 500, offerClicks, clicks: offerClicks, uniqueClickers: offerClicks, registrations: isVideo ? 2 : 0 } });
      await prisma.postViewSample.createMany({
        data: [
          { postId: post.id, at: new Date(sentAt.getTime() + HOUR), views: 60 },
          { postId: post.id, at: new Date(sentAt.getTime() + 3 * HOUR), views: 120 },
          { postId: post.id, at: new Date(sentAt.getTime() + 25 * HOUR), views: 200 },
        ],
      });
    }
  });

  let nightly: Awaited<ReturnType<typeof runAlgoNightly>>;

  it("nuit : fiches des posts, classements, meilleurs horaires et fenêtres", async () => {
    nightly = await runAlgoNightly(deps);
    expect(nightly.posts?.computed).toBe(48);
    const insights = await prisma.postInsight.findMany({ where: { channelId } });
    expect(insights).toHaveLength(48);
    const v = insights.find((x) => x.format === "VIDEO")!;
    expect(v).toMatchObject({ views1h: 60, views2h: 90, views24h: 196, viewsFinal: 500, hasButtons: false, emojiCount: 1, hourParis: expect.any(Number) });
    expect(insights.filter((x) => x.experimentId === experimentId)).toHaveLength(40);
    expect(insights.find((x) => x.format === "TEXT")!.personaId).toBeTruthy();
    const ranking = nightly.posts!.channels.find((c) => c.id === channelId)!;
    expect(ranking.dimensions.format.works).toEqual(["VIDEO"]);
    const best = await prisma.setting.findUniqueOrThrow({ where: { key: `besthours.${channelId}` } });
    const value = best.value as { source?: string; channelId: string; categories: Record<string, unknown>; windows?: unknown[] };
    expect(value.source).toBe("algo");
    expect(value.channelId).toBe(channelId);
    expect(Object.keys(value.categories)).toContain("all");
    const plan = await prisma.channelAgentPlan.findUniqueOrThrow({ where: { channelId } });
    expect((plan.suggestedWindows as unknown[]).length).toBeGreaterThan(0);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "besthours.source" } })).value).toBe("algo");
  });

  it("mission d'agent : variante du test tirée à la création", async () => {
    const r = await createMission(deps, { teamKey: "dating", channelId, createdBy: "HUMAN" });
    expect(r.ok).toBe(true);
    const m = await prisma.agentMission.findUniqueOrThrow({ where: { id: (r as { missionId: string }).missionId } });
    expect((m.payload as { experiment?: { id: string; variant: string } }).experiment).toMatchObject({ id: experimentId, variant: expect.stringMatching(/^[AB]$/) });
    await prisma.agentMission.update({ where: { id: m.id }, data: { status: "CANCELLED" } });
  });

  it("lundi : test clos avec gagnant, recommandations, rapport envoyé", async () => {
    await prisma.experiment.update({ where: { id: experimentId }, data: { endsAt: new Date(Date.now() - HOUR) } });
    const weekly = await runAlgoWeekly(deps, nightly);
    const exp = await prisma.experiment.findUniqueOrThrow({ where: { id: experimentId } });
    expect(exp).toMatchObject({ status: "CLOSED", winner: "A" });
    expect(exp.recommendationId).toBeTruthy();
    expect(weekly.closed[0]!.sentence).toContain("A gagne");
    // Niveau 0 : rien n'est appliqué seul.
    const recs = await prisma.recommendation.findMany({ where: { targetId: channelId } });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.status === "PROPOSED")).toBe(true);
    expect(recs.map((r) => r.field)).toEqual(expect.arrayContaining(["mix", "styleNotes"]));
    // Nouveaux tests proposés (le style de légende vient d'être tranché : pas relancé).
    const proposed = await prisma.experiment.findMany({ where: { channelId, status: "PROPOSED" } });
    expect(proposed.map((e) => e.kind)).not.toContain("STYLE_LEGENDE");
    expect((await startExperiment(deps, proposed[0]!.id)).ok).toBe(true);
    // Rapport : InsightReport par équipe + rapport complet, envoyé au faux Telegram.
    const report = await prisma.insightReport.findFirstOrThrow({ where: { teamKey: "algo" } });
    const stats = report.stats as { conversations?: unknown; conversationReview?: unknown; teams?: unknown[] };
    expect(Array.isArray(stats.conversations)).toBe(true);
    expect("conversationReview" in stats).toBe(true);
    expect(report.sentAt).toBeTruthy();
    expect(await prisma.insightReport.count({ where: { weekStart: report.weekStart } })).toBe(4);
    expect(adminSent.at(-1)).toContain("Ce qui marche");
    expect(adminSent.at(-1)).toContain("Rencontres");
    expect(weekly.synthese?.writtenBy).toBe("code");
  });

  it("recommandation appliquée puis annulée : valeurs vérifiées", async () => {
    const rec = await prisma.recommendation.findFirstOrThrow({ where: { targetId: channelId, field: "mix", status: "PROPOSED" } });
    const before = (await prisma.channelAgentPlan.findUniqueOrThrow({ where: { channelId } })).mix;
    const a = await applyRecommendation(deps, rec.id, { userId: null, via: "SITE" });
    expect(a).toMatchObject({ ok: true });
    const after = (await prisma.channelAgentPlan.findUniqueOrThrow({ where: { channelId } })).mix as { video: number };
    expect(after.video).toBeGreaterThan(25);
    expect((await prisma.recommendation.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe("APPLIED");
    expect(await prisma.auditLog.count({ where: { action: "agents.algo.recommendation_applied", entityId: rec.id } })).toBe(1);
    const u = await undoRecommendation(deps, rec.id, { userId: null, via: "SITE" });
    expect(u).toMatchObject({ ok: true });
    expect((await prisma.channelAgentPlan.findUniqueOrThrow({ where: { channelId } })).mix).toEqual(before);
    expect((await prisma.recommendation.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe("UNDONE");
    expect(await prisma.event.count({ where: { type: "agents.algo.recommendation_undone" } })).toBe(1);
  });

  it("alertes de décrochage : évaluées sans erreur", async () => {
    const r = await runDropAlerts(deps);
    expect(r.agents_channel_drop).toMatchObject({ detected: expect.any(Number) });
    expect(r.agents_persona_drop).not.toHaveProperty("error");
  });
});
