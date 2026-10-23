/**
 * Base LOCALE seulement : fait passer une « mission de test » de l'équipe Dating de bout en bout (faux envoi
 * Telegram, faux fournisseur d'IA), validation accordée comme depuis le site. Sert aux captures et à la vérification
 * à la main de la rubrique Agents. Refuse toute base qui n'est pas sur localhost.
 */
import { prisma } from "@linkaffipro/db";
import {
  createFakeLlm,
  createTestMission,
  decideValidation,
  runNextStep,
  type AgentsDeps,
  type AgentsEnqueue,
} from "@linkaffipro/agents";

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Base locale seulement.");
  process.exit(1);
}

const pending: Array<{ missionId: string; index: number }> = [];
const enqueue: AgentsEnqueue = {
  async orchestrator() {},
  async step(_team, _agent, job) {
    pending.push({ missionId: job.missionId, index: job.index });
  },
};
const deps = {
  prisma,
  enqueue,
  providers: { llm: createFakeLlm() },
  admin: {
    async send(html: string) {
      console.log("[aperçu admin]", html.slice(0, 120).replace(/\n/g, " "));
      return { messageId: 1 };
    },
  },
} as AgentsDeps;

async function drain() {
  while (pending.length) {
    const j = pending.shift()!;
    await runNextStep(deps, j.missionId, j.index);
  }
}

async function main() {
  const test = await prisma.channel.findFirst({ where: { isTest: true, isActive: true } });
  if (!test) {
    const c = await prisma.channel.findFirstOrThrow({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
    await prisma.channel.update({ where: { id: c.id }, data: { isTest: true } });
    console.log(`canal « ${c.title} » marqué canal Test (local)`);
  }
  const r = await createTestMission(deps, "dating", null);
  if (!r.ok) throw new Error(r.reason);
  await drain();
  const m = await prisma.agentMission.findUniqueOrThrow({ where: { id: r.missionId } });
  console.log("mission", m.id, m.status);
  // `--en-attente` : laisse la validation ouverte (file des validations non vide).
  if (m.status === "WAITING_VALIDATION" && m.validationId && !process.argv.includes("--en-attente")) {
    const d = await decideValidation(deps, { validationId: m.validationId, decision: "approve", via: "SITE" });
    console.log("décision :", d.message);
    await drain();
  }
  const end = await prisma.agentMission.findUniqueOrThrow({ where: { id: r.missionId } });
  console.log("fin :", end.status, "post", end.postId);
  await prisma.$disconnect();
}

void main();
