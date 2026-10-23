import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Db from "@linkaffipro/db";

// Création du message programmé : remplacée par une version en mémoire (la vraie est testée en intégration).
vi.mock("@linkaffipro/db", async (importOriginal) => {
  const orig = await importOriginal<typeof Db>();
  return {
    ...orig,
    createAgentPost: vi.fn(async (db: { post: { create(a: unknown): Promise<{ id: string }> } }, input: Record<string, unknown>) => {
      const post = await db.post.create({
        data: {
          code: `P${Math.random().toString(36).slice(2, 8)}`,
          channelId: input.channelId,
          botId: "bot",
          status: "SCHEDULED",
          scheduledAt: input.scheduledAt,
          text: input.text,
          mediaAssetIds: input.mediaAssetIds,
          agentMissionId: input.agentMissionId,
          buttons: input.offer ? [[{ text: (input.offer as { buttonText: string }).buttonText, type: "OFFER" }]] : [],
        },
      });
      return { postId: post.id, botId: "bot", publisher: "BOT", trackingLinkId: null };
    }),
  };
});

import { createEngineKit } from "../testing/engine-kit";
import { createMission, createTestMission, continueMission, cancelMission } from "../missions/lifecycle";
import { decideValidation } from "../validation/requests";
import { runNextStep } from "./engine";
import { resumeMissions } from "../orchestrator/resume";
import { createFakeLlm } from "../providers/fake";

type Kit = ReturnType<typeof createEngineKit>;

async function setLevel(kit: Kit, level: 0 | 1 | 2, extra: Record<string, unknown> = {}) {
  await kit.prisma.agentTeamConfig.upsert({
    where: { teamKey: "casino" },
    create: { teamKey: "casino", autonomyLevel: level, ...extra },
    update: { autonomyLevel: level, ...extra },
  });
}

async function newMission(kit: Kit) {
  const r = await createMission(kit.deps, { teamKey: "casino", channelId: "real", createdBy: "GRAND_CHEF" });
  if (!r.ok) throw new Error(r.reason);
  return r.missionId;
}

describe("mission POST de bout en bout (simulation)", () => {
  let kit: Kit;
  beforeEach(() => {
    kit = createEngineKit();
  });

  it("niveau 2 : toutes les étapes, post programmé sur le canal Test avec l'en-tête, mission DONE", async () => {
    await setLevel(kit, 2);
    const id = await newMission(kit);
    const outcomes = await kit.drain();
    // Moteur générique testé sur l'équipe Casino (la chaîne Dating de la phase 20 a ses propres tests).
    expect(outcomes).toEqual(["next", "next", "next", "next", "done"]);
    const m = kit.mission(id);
    expect(m.status).toBe("DONE");
    const steps = m.steps as Array<{ agent: string; status: string }>;
    expect(steps.map((s) => `${s.agent}:${s.status}`)).toEqual([
      // Équipe Casino (phase 22) : post texte faute de vidéo fournie, la Médiathèque n'a rien à faire.
      "mediatheque:SKIPPED",
      "redaction:DONE",
      "planification:DONE",
      "controle:DONE",
      "publication:DONE",
    ]);
    const posts = kit.t("post");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ channelId: "test", agentMissionId: id, status: "SCHEDULED" });
    expect(String(posts[0]!.text)).toMatch(/^\[SIMULATION équipe Casino → Rencontres VIP\]\n/);
    expect(m.postId).toBe(posts[0]!.id);
    expect(m.scheduledFor).toEqual(posts[0]!.scheduledAt);
    // Journal : un passage par agent réel, des événements sans texte de post.
    expect(kit.t("agentRun").map((r) => r.agentKey)).toEqual(["mediatheque", "redaction", "planification", "controle", "publication"]);
    const types = kit.t("event").map((e) => e.type);
    expect(types).toContain("agents.mission.created");
    expect(types).toContain("agents.mission.done");
    for (const e of kit.t("event")) expect(JSON.stringify(e.payload)).not.toContain("SIMULATION");
  });

  it("niveau 0 : validation demandée, puis Publier → publication et DONE", async () => {
    await setLevel(kit, 0);
    const id = await newMission(kit);
    expect((await kit.drain()).at(-1)).toBe("validation");
    expect(kit.mission(id).status).toBe("WAITING_VALIDATION");
    const v = kit.t("agentValidation")[0]!;
    expect(v).toMatchObject({ missionId: id, status: "PENDING" });
    expect(kit.sent[0]?.html).toContain("À valider");
    expect(kit.t("post")).toHaveLength(0);
    const r = await decideValidation(kit.deps, { validationId: String(v.id), decision: "approve", via: "TELEGRAM" });
    expect(r.ok).toBe(true);
    expect(await kit.drain()).toEqual(["done"]);
    expect(kit.mission(id).status).toBe("DONE");
    expect(kit.t("post")).toHaveLength(1);
  });

  it("niveau 0 : Corriger → texte de l'admin, repasse au Contrôle, publié sans nouvelle validation", async () => {
    await setLevel(kit, 0);
    const id = await newMission(kit);
    await kit.drain();
    const v = kit.t("agentValidation")[0]!;
    await decideValidation(kit.deps, { validationId: String(v.id), decision: "edit", editedText: "Ce soir, <b>ose</b> 🔥", via: "SITE" });
    expect(await kit.drain()).toEqual(["next", "done"]);
    expect(String(kit.t("post")[0]!.text)).toContain("Ce soir, <b>ose</b> 🔥");
    const steps = kit.mission(id).steps as Array<{ agent: string; status: string }>;
    expect(steps.slice(-3).map((s) => `${s.agent}:${s.status}`)).toEqual(["publication:SKIPPED", "controle:DONE", "publication:DONE"]);
  });

  it("Refuser → mission annulée, aucun post", async () => {
    await setLevel(kit, 0);
    const id = await newMission(kit);
    await kit.drain();
    const v = kit.t("agentValidation")[0]!;
    await decideValidation(kit.deps, { validationId: String(v.id), decision: "reject", rejectReason: "trop vague", via: "SITE" });
    expect(kit.mission(id).status).toBe("CANCELLED");
    expect(kit.t("post")).toHaveLength(0);
  });

  it("mission de test : canal Test, format texte, validation au niveau 0", async () => {
    const r = await createTestMission(kit.deps, "casino", "u1");
    expect(r.ok).toBe(true);
    await kit.drain();
    const m = kit.mission((r as { missionId: string }).missionId);
    expect(m).toMatchObject({ isTest: true, channelId: "test", status: "WAITING_VALIDATION", createdBy: "HUMAN" });
    expect((m.payload as { format: string }).format).toBe("text");
    expect(kit.t("auditLog").map((a) => a.action)).toContain("agents.mission.test_created");
  });

  it("équipe sans agents (sports) : aucune mission", async () => {
    const r = await createMission(kit.deps, { teamKey: "sports", channelId: "real", createdBy: "GRAND_CHEF" });
    expect(r.ok).toBe(false);
  });
});

describe("missions reprenables et idempotentes", () => {
  it("une étape rejouée ou un ancien index est ignoré ; jamais deux posts", async () => {
    const kit = createEngineKit();
    await setLevel(kit, 2);
    const id = await newMission(kit);
    await kit.drain();
    expect(await runNextStep(kit.deps, id, 0)).toBe("ignored");
    expect(await runNextStep(kit.deps, id, 5)).toBe("ignored");
    expect(kit.t("post")).toHaveLength(1);
  });

  it("Publication relancée après une coupure (postId déjà posé) : le message existant est gardé", async () => {
    const kit = createEngineKit();
    await setLevel(kit, 2);
    const id = await newMission(kit);
    // Jusqu'au contrôle seulement.
    await kit.drain(4);
    expect(kit.steps).toHaveLength(1);
    const pub = kit.steps.shift()!;
    await runNextStep(kit.deps, id, pub.job.index);
    expect(kit.t("post")).toHaveLength(1);
    // La mission est remise à l'étape Publication comme si l'écriture finale avait été perdue.
    const row = kit.t("agentMission").find((m) => m.id === id)!;
    row.status = "RUNNING";
    row.currentStep = pub.job.index;
    (row.steps as Array<{ status: string }>)[pub.job.index]!.status = "RUNNING";
    expect(await runNextStep(kit.deps, id, pub.job.index)).toBe("done");
    expect(kit.t("post")).toHaveLength(1);
  });

  it("balayage `resume` : mission sans activité depuis 15 min → étape courante ré-enfilée, reprise à l'étape suivante", async () => {
    const kit = createEngineKit();
    await setLevel(kit, 2);
    const id = await newMission(kit);
    await kit.drain(1); // médiathèque
    kit.steps.length = 0; // tâche perdue
    kit.advance(16 * 60_000);
    const r = await resumeMissions(kit.deps);
    expect(r.requeued).toBe(1);
    expect(kit.steps[0]).toMatchObject({ agent: "redaction", job: { missionId: id, index: 1 } });
    await kit.drain();
    expect(kit.mission(id).status).toBe("DONE");
  });

  it("validation décidée mais reprise interrompue : le balayage reprend la mission", async () => {
    const kit = createEngineKit();
    await setLevel(kit, 0);
    const id = await newMission(kit);
    await kit.drain();
    const v = kit.t("agentValidation")[0]!;
    v.status = "APPROVED";
    kit.t("agentMission").find((m) => m.id === id)!.payload = { ...(kit.mission(id).payload as object), approved: true };
    kit.advance(11 * 60_000);
    expect((await resumeMissions(kit.deps)).continued).toBe(1);
    await kit.drain();
    expect(kit.mission(id).status).toBe("DONE");
  });

  it("continueMission et cancelMission ignorent une mission terminée", async () => {
    const kit = createEngineKit();
    await setLevel(kit, 2);
    const id = await newMission(kit);
    await kit.drain();
    await continueMission(kit.deps, id, { reason: "x" });
    await cancelMission(kit.deps, id, { reason: "x" });
    expect(kit.mission(id).status).toBe("DONE");
    expect(kit.steps).toHaveLength(0);
  });
});

describe("Contrôle qualité : refaire une fois puis valider", () => {
  it("texte qui parle d'IA → Rédaction refaite avec le motif, toujours refusé → validation humaine", async () => {
    const llm = createFakeLlm({
      responses: { redaction: JSON.stringify({ text: "Notre IA t'a trouvé une surprise", hook: "x", topic: "ia" }) },
    });
    const kit = createEngineKit({ llm });
    await setLevel(kit, 2);
    const id = await newMission(kit);
    const out = await kit.drain();
    expect(out).toContain("redo");
    expect(out.at(-1)).toBe("validation");
    const m = kit.mission(id);
    expect(m.status).toBe("WAITING_VALIDATION");
    expect((m.payload as { redone: boolean }).redone).toBe(true);
    // Le second passage de Rédaction a reçu le motif du refus.
    const redactions = llm.calls.filter((c) => c.user.startsWith("Tâche : redaction"));
    expect(redactions).toHaveLength(2);
    expect(redactions[1]!.user).toContain("refusé");
    expect(kit.t("agentValidation")[0]!.reason).toContain("refusé deux fois");
    expect(kit.t("post")).toHaveLength(0);
  });

  it("l'avis de l'IA « non » ne publie jamais : refaire puis valider même au niveau 2", async () => {
    const llm = createFakeLlm({ responses: { controle: JSON.stringify({ verdict: "non", reason: "trop robotique" }) } });
    const kit = createEngineKit({ llm });
    await setLevel(kit, 2);
    const id = await newMission(kit);
    await kit.drain();
    expect(kit.mission(id).status).toBe("WAITING_VALIDATION");
  });
});

describe("pause", () => {
  it("3 missions échouées de suite → équipe en pause automatique + message à l'admin", async () => {
    const llm = createFakeLlm({ failFirst: 100 });
    const kit = createEngineKit({ llm });
    await setLevel(kit, 2, { monthlyBudgetCents: { llm: 0 } });
    for (let i = 0; i < 3; i++) {
      await newMission(kit);
      await kit.drain();
    }
    const team = kit.t("agentTeamConfig").find((t) => t.teamKey === "casino")!;
    expect(team).toMatchObject({ paused: true, pausedReason: "3 missions échouées de suite", consecutiveFailures: 3 });
    expect(kit.t("agentMission").filter((m) => m.status === "FAILED")).toHaveLength(3);
    expect(kit.sent.some((s) => s.html.includes("mise en pause"))).toBe(true);
    // Une étape a été réessayée une fois avant l'échec : 2 appels par mission.
    expect(llm.calls).toHaveLength(6);
    // Équipe en pause : plus aucune mission.
    expect((await createMission(kit.deps, { teamKey: "casino", channelId: "real", createdBy: "GRAND_CHEF" })).ok).toBe(false);
  });

  it("équipe en pause : l'étape attend ; reprise → elle repart", async () => {
    const kit = createEngineKit();
    await setLevel(kit, 2);
    const id = await newMission(kit);
    await kit.prisma.agentTeamConfig.update({ where: { teamKey: "casino" }, data: { paused: true } });
    expect(await kit.drain()).toEqual(["halted"]);
    expect(kit.mission(id).status).toBe("PENDING");
    await kit.prisma.agentTeamConfig.update({ where: { teamKey: "casino" }, data: { paused: false } });
    kit.advance(16 * 60_000);
    await resumeMissions(kit.deps);
    await kit.drain();
    expect(kit.mission(id).status).toBe("DONE");
  });

  it("pause générale : rien ne s'exécute ni ne se crée", async () => {
    const kit = createEngineKit();
    await setLevel(kit, 2);
    const id = await newMission(kit);
    await kit.prisma.setting.create({ data: { key: "agents.pausedAll", value: true } });
    expect(await kit.drain()).toEqual(["halted"]);
    expect((await createMission(kit.deps, { teamKey: "casino", channelId: "real", createdBy: "GRAND_CHEF" })).ok).toBe(false);
    expect(kit.mission(id).status).toBe("PENDING");
  });
});

describe("plafonds", () => {
  const paidLlm = () => {
    const fake = createFakeLlm({ costCents: 60 });
    return { complete: fake.complete.bind(fake), name: "payant" };
  };

  it("plafond atteint → BLOCKED_BUDGET avec un motif clair, avant tout appel", async () => {
    const kit = createEngineKit({ llm: paidLlm() });
    await setLevel(kit, 2, { monthlyBudgetCents: { llm: 100 } });
    await kit.prisma.agentUsage.create({ data: { teamKey: "casino", provider: "llm", month: "2026-10", cents: 100, calls: 3 } });
    const r = await createMission(kit.deps, { teamKey: "casino", channelId: "real", createdBy: "GRAND_CHEF" });
    expect(r).toEqual({ ok: false, status: "BLOCKED_BUDGET", reason: expect.stringContaining("Plafond mensuel IA texte") });
    expect(kit.t("agentMission")[0]).toMatchObject({ status: "BLOCKED_BUDGET" });
  });

  it("dépense enregistrée ; plafond atteint en cours de mission → étape suivante bloquée ; alertes 80 et 100 % une fois", async () => {
    const kit = createEngineKit({ llm: paidLlm() });
    await setLevel(kit, 2, { monthlyBudgetCents: { llm: 100 } });
    const id = await newMission(kit);
    await kit.drain();
    // Rédaction 60 c (pas d'alerte), Contrôle 60 c → 120 c ≥ 100 : alerte 100 % ; Publication gratuite.
    const usage = kit.t("agentUsage")[0]!;
    expect(usage).toMatchObject({ cents: 120, calls: 2, alerted100: true });
    expect(kit.sent.filter((s) => s.html.includes("plafond atteint"))).toHaveLength(1);
    expect(kit.mission(id).costCents).toBe(120);
    // Mission suivante : refusée avant la Rédaction.
    const r = await createMission(kit.deps, { teamKey: "casino", channelId: "real", createdBy: "GRAND_CHEF" });
    expect(r.ok).toBe(false);
    expect(kit.sent.filter((s) => s.html.includes("plafond atteint"))).toHaveLength(1);
  });

  it("alerte 80 % seule, une seule fois", async () => {
    const kit = createEngineKit({ llm: paidLlm() });
    await setLevel(kit, 2, { monthlyBudgetCents: { llm: 140 } });
    await newMission(kit);
    await kit.drain();
    expect(kit.sent.filter((s) => s.html.includes("80 %"))).toHaveLength(1);
    expect(kit.t("agentUsage")[0]).toMatchObject({ alerted80: true, alerted100: false });
  });
});
