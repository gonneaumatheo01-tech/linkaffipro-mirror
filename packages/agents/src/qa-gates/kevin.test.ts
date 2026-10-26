/**
 * Phase 30, chantier B — QA Global des réponses de Kevin rédigées par l'IA : refusée → régénérée → envoyée ; 3 refus →
 * phrase fixe ; QA indisponible → jamais la réponse non vérifiée ; textes fixes et accusés courts jamais retenus.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import { answerQuestion } from "../boss/answer";
import { createFakeBossLlm } from "../boss/llm";
import { resetVoiceRotation, voiceCheck } from "../boss/voice";
import { QA_GATE_VARIANTS, QA_PAUSED_TEXT, QA_RESPONSE_HELD_TEXT } from "../boss/qa-gate-texts";
import { bossFastPath } from "../boss/fast";
import { createFakeQaLlm, qaUnavailable, type FakeQaStep } from "../qa/testing";
import type { BossDeps } from "../boss/contract";
import { qaKevinLine, qaKevinReply } from "./kevin";

const BAD = "Tu as une demande urgente qui attend depuis ce matin, réponds-y vite stp.";
const GOOD = "Aucune demande ne t'attend pour le moment, tout est à jour de mon côté.";
const APPROVE: FakeQaStep = { verdict: "APPROVED", reasons: [], corrections: [] };
const HALLU: FakeQaStep = { verdict: "REJECTED", reasons: [{ code: "HALLUCINATION", message: "Aucune demande dans les données.", severity: "critical" }], corrections: [{ field: "response", expected: "aucune demande", got: "une demande urgente", suggestion: "dis qu'il n'y a aucune demande" }] };

beforeEach(() => resetVoiceRotation());

function kitWith(qa: (user: string, i: number) => FakeQaStep) {
  const kit = createTestKit();
  const qaLlm = createFakeQaLlm({ respond: (req, i) => qa(req.user, i) });
  (kit.deps as { qaLlm?: unknown }).qaLlm = qaLlm;
  return { kit, qaLlm };
}

describe("réponses de Kevin rédigées par l'IA", () => {
  it("refusée → régénérée avec les corrections (même rédacteur) → revérifiée → envoyée", async () => {
    const { kit, qaLlm } = kitWith((user) => (user.includes("demande urgente") ? HALLU : APPROVE));
    const llm = createFakeBossLlm([], { writer: (user) => (user.includes("CORRECTIONS DEMANDÉES") ? GOOD : BAD) });
    const r = await answerQuestion({ ...kit.deps, llm, qaTurnId: "turn-1" } as BossDeps, { topic: "demandes", question: "J'ai des demandes en attente ?" });
    expect(r.reply).toBe(GOOD);
    expect(r.checked).toBe("ia");
    expect(qaLlm.calls).toHaveLength(2);
    expect(llm.calls.write.some((c) => c.user.includes("dis qu'il n'y a aucune demande"))).toBe(true);
    expect(kit.tables("qaCheck").map((q) => [q.contentType, q.contentId, q.verdict])).toEqual([
      ["KEVIN_RESPONSE", "turn-1", "REJECTED"],
      ["KEVIN_RESPONSE", "turn-1", "APPROVED"],
    ]);
  });

  it("toujours refusée → 3 tentatives au plus, puis la phrase fixe honnête (journalisée)", async () => {
    const { kit, qaLlm } = kitWith(() => HALLU);
    const llm = createFakeBossLlm([], { writer: () => BAD });
    const r = await answerQuestion({ ...kit.deps, llm, qaTurnId: "turn-2" } as BossDeps, { topic: "demandes", question: "J'ai des demandes ?" });
    expect(r.reply).toBe(QA_RESPONSE_HELD_TEXT);
    expect(qaLlm.calls).toHaveLength(3);
    expect(kit.tables("event").some((e) => e.type === "qa.kevin.held")).toBe(true);
  });

  it("QA indisponible → jamais la réponse non vérifiée : phrase « en pause » (une fois par heure) + lignes du code", async () => {
    const { kit } = kitWith(() => qaUnavailable() as never);
    const llm = createFakeBossLlm([], { writer: () => GOOD });
    const r1 = await answerQuestion({ ...kit.deps, llm, qaTurnId: "t3" } as BossDeps, { topic: "demandes", question: "Des demandes ?" });
    expect(r1.reply.startsWith(QA_PAUSED_TEXT)).toBe(true);
    expect(r1.reply).not.toContain(GOOD);
    const r2 = await answerQuestion({ ...kit.deps, llm, qaTurnId: "t4" } as BossDeps, { topic: "demandes", question: "Et maintenant ?" });
    expect(r2.reply).not.toContain(QA_PAUSED_TEXT);
    expect(r2.reply).not.toContain(GOOD);
    kit.advance(61 * 60_000);
    const r3 = await answerQuestion({ ...kit.deps, llm, qaTurnId: "t5" } as BossDeps, { topic: "demandes", question: "Et là ?" });
    expect(r3.reply.startsWith(QA_PAUSED_TEXT)).toBe(true);
  });

  it("message court (< 50 caractères) : jamais vérifié", async () => {
    const { kit, qaLlm } = kitWith(() => HALLU);
    const r = await qaKevinReply(kit.deps, { contentId: "x", question: "ok ?", dataConsulted: null, draft: "C'est noté ✅" });
    expect(r).toMatchObject({ text: "C'est noté ✅", status: "short" });
    expect(qaLlm.calls).toHaveLength(0);
  });

  it("textes fixes du code (chemin rapide) : jamais retenus par le QA", async () => {
    const { kit, qaLlm } = kitWith(() => HALLU);
    const r = await bossFastPath(kit.deps, { text: "aide", messageId: 9, source: "text" });
    expect(r.handled).toBe(true);
    expect(qaLlm.calls).toHaveLength(0);
  });

  it("ligne lissée par l'IA : refusée → le brouillon du code", async () => {
    const { kit } = kitWith(() => HALLU);
    const text = await qaKevinLine(kit.deps, { contentId: "l1", question: "récap", dataConsulted: {}, aiText: "Je lance 3 posts sur Casino VIP demain matin, tout est calé de mon côté.", codeText: "3 posts sur Casino VIP demain." });
    expect(text).toBe("3 posts sur Casino VIP demain.");
  });

  it("phrases fixes du QA : charte de Kevin respectée", () => {
    for (const list of Object.values(QA_GATE_VARIANTS))
      for (const t of list) expect(voiceCheck(t.replace("{label}", "un post sur Casino VIP").replace("{motif}", "promesse de gain"), { allowLong: true }).problems, t).toEqual([]);
  });
});
