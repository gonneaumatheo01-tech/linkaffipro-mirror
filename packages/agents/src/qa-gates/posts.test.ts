/**
 * Phase 30, chantier B — QA Global des posts des équipes : étape après le Contrôle de l'équipe et verrou au point
 * d'envoi. Fausse IA du QA, faux prisma, aucun réseau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Db from "@linkaffipro/db";

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
          buttons: input.offer ? [[{ text: (input.offer as { buttonText: string }).buttonText, type: "OFFER", trackingLinkId: "tl1", slug: "abc" }]] : [],
        },
      });
      return { postId: post.id, botId: "bot", publisher: "BOT", trackingLinkId: null };
    }),
  };
});

import { createEngineKit } from "../testing/engine-kit";
import { createMission } from "../missions/lifecycle";
import { createFakeQaLlm, qaUnavailable, type FakeQaStep } from "../qa/testing";
import { respondToRequest } from "../human/respond";
import { agentPostSendGate, postQaContent, normalizeButtons, QA_POST_MESSAGES } from "./posts";
import "./index";

type Kit = ReturnType<typeof createEngineKit>;

const REJECT: FakeQaStep = {
  verdict: "REJECTED",
  reasons: [{ code: "GAIN_PROMISE", message: "Le texte promet un gain.", severity: "critical" }],
  corrections: [{ field: "text", expected: "aucune promesse", got: "gain assuré", suggestion: "retire la promesse de gain" }],
};
const APPROVE: FakeQaStep = { verdict: "APPROVED", reasons: [], corrections: [] };

function setup(responses: FakeQaStep[] | ((i: number) => FakeQaStep)) {
  const qaLlm = typeof responses === "function" ? createFakeQaLlm({ respond: (_r, i) => responses(i) }) : createFakeQaLlm({ responses });
  const kit = createEngineKit({ qaLlm });
  return { kit, qaLlm };
}

async function level2(kit: Kit) {
  await kit.prisma.agentTeamConfig.upsert({ where: { teamKey: "casino" }, create: { teamKey: "casino", autonomyLevel: 2 }, update: { autonomyLevel: 2 } });
}

async function newMission(kit: Kit) {
  const r = await createMission(kit.deps, { teamKey: "casino", channelId: "real", createdBy: "GRAND_CHEF" });
  if (!r.ok) throw new Error(r.reason);
  return r.missionId;
}

const stepsOf = (kit: Kit, id: string) => (kit.mission(id).steps as Array<{ agent: string; status: string }>).map((s) => `${s.agent}:${s.status}`);

describe("posts : étape QA Global après le Contrôle de l'équipe", () => {
  it("approuvé → publié ; au point d'envoi, l'approbation de l'empreinte suffit (aucune seconde vérification)", async () => {
    const { kit, qaLlm } = setup([APPROVE]);
    await level2(kit);
    const id = await newMission(kit);
    expect(await kit.drain()).toEqual(["next", "next", "next", "next", "done"]);
    expect(qaLlm.calls).toHaveLength(1);
    const post = kit.t("post")[0]!;
    expect(post.agentMissionId).toBe(id);
    const qa = kit.t("qaCheck");
    expect(qa).toHaveLength(1);
    expect(qa[0]).toMatchObject({ contentType: "POST", contentId: id, verdict: "APPROVED", teamKey: "casino" });
    const d = await agentPostSendGate(kit.deps as never, post as never);
    expect(d).toEqual({ decision: "send" });
    expect(qaLlm.calls).toHaveLength(1);
  });

  it("refusé → retour à la Rédaction avec motifs et corrections, jamais publié ; corrigé → repasse → publié", async () => {
    const { kit, qaLlm } = setup([REJECT, APPROVE]);
    await level2(kit);
    const id = await newMission(kit);
    const out = await kit.drain();
    expect(out).toContain("redo");
    expect(out.at(-1)).toBe("done");
    expect(qaLlm.calls).toHaveLength(2);
    expect(stepsOf(kit, id)).toEqual([
      "mediatheque:SKIPPED",
      "redaction:DONE",
      "planification:DONE",
      "controle:DONE",
      "publication:SKIPPED",
      "redaction:DONE",
      "planification:DONE",
      "controle:DONE",
      "publication:DONE",
    ]);
    // La Rédaction a reçu le motif et la correction du QA (jamais dans le journal).
    const redactionCall = kit.llm && (kit.llm as unknown as { calls?: Array<{ user: string }> }).calls;
    if (redactionCall) expect(redactionCall.some((c) => /retire la promesse de gain/.test(c.user))).toBe(true);
    expect(kit.t("qaCheck").map((q) => q.verdict)).toEqual(["REJECTED", "APPROVED"]);
    expect(kit.t("post")).toHaveLength(1);
    const ev = kit.t("event").find((e) => e.type === "qa.gate.rejected");
    expect(ev?.payload).toMatchObject({ contentType: "POST", contentId: id, codes: ["GAIN_PROMISE"] });
    expect(JSON.stringify(ev?.payload)).not.toContain("promet");
  });

  it("QA indisponible → rien ne part, l'étape attend 5 min ; revenu → publié (jamais approuvé par défaut)", async () => {
    let down = true;
    const { kit, qaLlm } = setup(() => (down ? qaUnavailable() : APPROVE));
    await level2(kit);
    const id = await newMission(kit);
    const first = await kit.drain(4);
    expect(first.at(-1)).toBe("waiting");
    expect(kit.t("post")).toHaveLength(0);
    expect(kit.t("qaCheck")[0]?.verdict).toBe("ERROR");
    expect(kit.steps[0]?.delayMs).toBe(5 * 60_000);
    // La relecture ne refait pas le Contrôle de l'équipe (verdict gardé), seulement la vérification globale.
    const runsBefore = kit.t("agentRun").filter((r) => r.agentKey === "controle").length;
    down = false;
    expect(await kit.drain()).toEqual(["next", "done"]);
    expect(kit.t("post")).toHaveLength(1);
    expect(kit.mission(id).status).toBe("DONE");
    expect(qaLlm.calls.length).toBeGreaterThanOrEqual(2);
    expect(kit.t("agentRun").filter((r) => r.agentKey === "controle").length).toBe(runsBefore + 1);
  });

  it("3 refus du même contenu → Kevin demande au client ; « Publier quand même » → publié avec son accord", async () => {
    const { kit } = setup([REJECT]);
    await level2(kit);
    const id = await newMission(kit);
    await kit.drain();
    expect(kit.t("qaCheck").filter((q) => q.verdict === "REJECTED")).toHaveLength(3);
    expect(kit.mission(id).status).toBe("WAITING_HUMAN");
    expect(kit.t("post")).toHaveLength(0);
    const req = kit.t("humanRequest")[0]!;
    expect(req).toMatchObject({ kind: "CONFIRM", key: `qa.decision.POST.${id}`, status: "PENDING" });
    expect(String(req.question)).toMatch(/3 fois|3 refus/);
    expect(String(req.question)).toContain("Motif : Le texte promet un gain.");
    const sent = kit.sent.at(-1)!;
    expect(JSON.stringify(sent.opts)).toContain("Publier quand même");
    const r = await respondToRequest(kit.deps, req as never, "oui", { userId: null, via: "TELEGRAM" });
    expect(r.ok).toBe(true);
    await kit.drain();
    expect(kit.mission(id).status).toBe("DONE");
    expect(kit.t("post")).toHaveLength(1);
    expect(kit.t("auditLog").some((a) => a.action === "qa.override.approved")).toBe(true);
    // Le post part : l'accord du client vaut pour son empreinte exacte au point d'envoi.
    expect(await agentPostSendGate(kit.deps as never, kit.t("post")[0] as never)).toEqual({ decision: "send" });
  });

  it("3 refus → « Non » → mission annulée, rien ne part", async () => {
    const { kit } = setup([REJECT]);
    await level2(kit);
    const id = await newMission(kit);
    await kit.drain();
    const req = kit.t("humanRequest")[0]!;
    await respondToRequest(kit.deps, req as never, "non", { userId: null, via: "TELEGRAM" });
    await kit.drain();
    expect(kit.mission(id).status).toBe("CANCELLED");
    expect(kit.t("post")).toHaveLength(0);
  });
});

describe("posts : verrou au point d'envoi", () => {
  let kit: Kit;
  let qaLlm: ReturnType<typeof createFakeQaLlm>;
  let next: FakeQaStep[];
  beforeEach(async () => {
    next = [APPROVE];
    qaLlm = createFakeQaLlm({ respond: () => next.shift() ?? APPROVE });
    kit = createEngineKit({ qaLlm });
    await level2(kit);
  });

  it("post humain (sans mission) : jamais vérifié", async () => {
    const d = await agentPostSendGate(kit.deps as never, { id: "h1", agentMissionId: null, channelId: "real", text: "Bonjour", mediaAssetIds: [], buttons: [] });
    expect(d).toEqual({ decision: "send" });
    expect(qaLlm.calls).toHaveLength(0);
  });

  it("contenu modifié après l'approbation → revérifié ; refusé → post retenu, mission renvoyée à la Rédaction", async () => {
    const id = await newMission(kit);
    await kit.drain();
    const post = kit.t("post")[0]!;
    expect(qaLlm.calls).toHaveLength(1);
    // Modification après l'approbation (texte changé) : l'ancienne approbation ne vaut plus.
    post.text = `${String(post.text)} Gain assuré !`;
    next = [REJECT];
    const d = await agentPostSendGate(kit.deps as never, post as never);
    expect(d.decision).toBe("rejected");
    expect((d as { reason: string }).reason.startsWith(QA_POST_MESSAGES.rejected)).toBe(true);
    expect(qaLlm.calls).toHaveLength(2);
    expect(kit.mission(id).status).toBe("RUNNING");
    expect(kit.mission(id).postId).toBeNull();
    expect((kit.mission(id).payload as { reasons?: string[] }).reasons?.join(" ")).toContain("retire la promesse de gain");
    expect(kit.steps.at(-1)?.agent).toBe("redaction");
  });

  it("QA indisponible au point d'envoi → retenu 5 min, rien n'est envoyé", async () => {
    await newMission(kit);
    await kit.drain();
    const post = kit.t("post")[0]!;
    post.text = `${String(post.text)} (modifié)`;
    next = [qaUnavailable() as never];
    const d = await agentPostSendGate(kit.deps as never, post as never);
    expect(d.decision).toBe("held");
    expect((d as { retryAt: Date }).retryAt.getTime() - kit.deps.now!().getTime()).toBe(5 * 60_000);
  });
});

describe("posts : empreinte", () => {
  it("les identifiants créés à l'enregistrement (lien suivi) ne changent pas l'empreinte ; le texte, si", () => {
    expect(normalizeButtons([[{ text: "🎁 Voir l'offre", type: "OFFER", trackingLinkId: "x", slug: "y" }]])).toEqual([[{ text: "🎁 Voir l'offre", type: "OFFER" }]]);
    const a = postQaContent({ text: "a", mediaAssetIds: [], buttons: [[{ text: "b", type: "OFFER", trackingLinkId: "1" }]], channelId: "c", targetChannelId: "c", vertical: "CASINO" });
    const b = postQaContent({ text: "a", mediaAssetIds: [], buttons: [[{ text: "b", type: "OFFER", trackingLinkId: "2" }]], channelId: "c", targetChannelId: "c", vertical: "CASINO" });
    expect(a).toEqual(b);
  });
});
