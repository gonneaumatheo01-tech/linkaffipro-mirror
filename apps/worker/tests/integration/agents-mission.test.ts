/**
 * Phase 19 : mission « post texte » de bout en bout sur base réelle, en simulation : Grand Chef (plan du jour) → Chef
 * Dating → Médiathèque → Rédaction (faux LLM) → Planification → Contrôle → validation (décision simulée comme le bouton
 * ✅) → Publication → `Post` programmé sur le canal Test → envoi par le scheduler existant (bot de test simulé) →
 * mission DONE, `Event` et `AuditLog` présents, rapport quotidien généré.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@linkaffipro/db";
import {
  createFakeLlm,
  decideValidation,
  runCycle,
  runNextStep,
  sendDailyReport,
  type AgentStepJob,
  type EngineDeps,
} from "@linkaffipro/agents";
import { processScheduler } from "../../src/processors/scheduler";
import { processTelegramSend } from "../../src/processors/telegram-send";
import { apiForBot } from "../../src/sending/api";
import { capturedJobs, createBotAndChannel, fakeJob, installFakeTelegram, resetDb, type TelegramCall } from "./helpers";

const steps: AgentStepJob[] = [];
const adminSent: string[] = [];
let nextMsg = 9000;
const deps: EngineDeps = {
  prisma,
  enqueue: {
    async orchestrator() {},
    async step(_team, _agent, job) {
      if (!steps.some((s) => s.missionId === job.missionId && s.index === job.index)) steps.push(job);
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

async function drain() {
  const out: string[] = [];
  while (steps.length) {
    const s = steps.shift()!;
    out.push(await runNextStep(deps, s.missionId, s.index));
  }
  return out;
}

describe("agents : mission texte de bout en bout sur le canal Test (base réelle)", () => {
  let channelId = "";
  let botId = "";
  let missionId = "";
  let calls: TelegramCall[] = [];

  beforeAll(async () => {
    await resetDb();
    await prisma.setting.deleteMany({ where: { key: { startsWith: "agents." } } });
    const { bot, channel } = await createBotAndChannel({ title: "Canal test" });
    channelId = channel.id;
    botId = bot.id;
    // Plan de l'équipe Dating sur le canal Test (fenêtre de toute la journée, aucun espacement).
    await prisma.channelAgentPlan.create({
      data: { channelId, teamKey: "dating", enabled: true, postsPerDay: 1, windowStart: "00:00", windowEnd: "24:00", minSpacingMinutes: 0 },
    });
    calls = installFakeTelegram((await apiForBot(botId)).api);
  });

  it("le Grand Chef crée la mission du jour et le Chef Dating enchaîne jusqu'à la validation", async () => {
    const cycle = await runCycle(deps);
    expect(cycle.plan).toMatchObject({ created: 1 });
    const teams = await prisma.agentTeamConfig.findMany();
    expect(teams.map((t) => t.teamKey).sort()).toEqual(["algo", "casino", "dating", "sports"]);
    expect(teams.every((t) => t.simulation && t.autonomyLevel === 0)).toBe(true);
    const m = await prisma.agentMission.findFirstOrThrow({ where: { channelId } });
    missionId = m.id;
    expect(m).toMatchObject({ teamKey: "dating", createdBy: "GRAND_CHEF", status: "PENDING" });
    // Phase 20 : post texte → Médiathèque et Média IA sautées par les agents eux-mêmes.
    expect(await drain()).toEqual(["next", "next", "next", "next", "validation"]);
    const waiting = await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(waiting.status).toBe("WAITING_VALIDATION");
    expect(waiting.scheduledFor).toBeInstanceOf(Date);
    const v = await prisma.agentValidation.findFirstOrThrow({ where: { missionId } });
    expect(v.status).toBe("PENDING");
    expect(adminSent.some((h) => h.includes(`À valider n°${v.number}`))).toBe(true);
    // Une seconde passe du Grand Chef ne crée rien de plus ce jour-là.
    expect((await runCycle(deps)).plan).toMatchObject({ created: 0 });
  });

  it("✅ Publier → Publication : Post programmé sur le canal Test avec l'en-tête de simulation, mission DONE", async () => {
    const v = await prisma.agentValidation.findFirstOrThrow({ where: { missionId } });
    const r = await decideValidation(deps, { validationId: v.id, decision: "approve", via: "TELEGRAM" });
    expect(r.ok).toBe(true);
    expect(await drain()).toEqual(["done"]);
    const m = await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(m.status).toBe("DONE");
    const post = await prisma.post.findUniqueOrThrow({ where: { id: m.postId! } });
    expect(post).toMatchObject({ channelId, botId, status: "SCHEDULED", agentMissionId: missionId, publisher: "BOT" });
    expect(post.text.startsWith("[SIMULATION équipe Rencontres → Canal test]\n")).toBe(true);
    // Rejouer l'étape ne crée jamais un second message.
    await runNextStep(deps, missionId, 5);
    expect(await prisma.post.count({ where: { agentMissionId: missionId } })).toBe(1);
  });

  it("le scheduler existant envoie le message (bot de test simulé)", async () => {
    const m = await prisma.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    await prisma.post.update({ where: { id: m.postId! }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    expect(await processScheduler(fakeJob({ type: "tick" as const }))).toMatchObject({ claimed: 1 });
    const job = capturedJobs("telegram-send").find((j) => j.data.postId === m.postId);
    expect(job).toBeDefined();
    await processTelegramSend(fakeJob({ type: "post" as const, postId: m.postId! }));
    const sent = calls.find((c) => c.method === "sendMessage");
    expect(String(sent?.payload.text)).toContain("[SIMULATION équipe Rencontres → Canal test]");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: m.postId! } })).status).toBe("SENT");
  });

  it("journal complet et rapport quotidien", async () => {
    const types = (await prisma.event.findMany({ where: { type: { startsWith: "agents." } } })).map((e) => e.type);
    for (const t of ["agents.mission.created", "agents.step.done", "agents.validation.requested", "agents.validation.approved", "agents.mission.done"])
      expect(types).toContain(t);
    const runs = await prisma.agentRun.findMany({ where: { missionId }, orderBy: { startedAt: "asc" } });
    expect(runs.map((r) => r.agentKey)).toEqual(["mediatheque", "media-ia", "redaction", "planification", "controle", "publication"]);
    expect(runs.every((r) => r.status === "OK")).toBe(true);
    const v = await prisma.agentValidation.findFirstOrThrow({ where: { missionId } });
    const audit = await prisma.auditLog.findMany({ where: { action: "agents.validation.approved", entityId: v.id } });
    expect(audit).toHaveLength(1);
    const report = await sendDailyReport(deps, { force: true });
    expect(report.recorded).toBe(true);
    const ev = await prisma.event.findFirstOrThrow({ where: { type: "agents.report.daily" }, orderBy: { occurredAt: "desc" } });
    const lines = (ev.payload as { lines: string[] }).lines;
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Rencontres : /);
  });
});
