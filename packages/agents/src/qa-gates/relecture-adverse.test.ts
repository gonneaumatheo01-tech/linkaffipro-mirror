/**
 * Phase 30 — relecture adverse du QA Global : défauts trouvés et corrigés (chaque test échouait avant la correction).
 */
import { describe, expect, it } from "vitest";
import { createTestKit } from "../human/test-kit";
import { createFakeQaLlm } from "../qa/testing";
import { adminOnlyRequest } from "../human/access";
import { speakerMayAnswerRequest } from "../boss/catalog-read";
import { QA_DECISION_ACTION } from "./registry";
import { qaCheck, QA_MAX_PARTS } from "../qa/qa-global";
import { QA_ENGINE_CODES } from "../qa/codes";
import { runAdsReportNowImpl } from "../agents/ads/run";
import type { LlmProvider } from "../types";

describe("accord du client après 3 refus : réservé à l'admin", () => {
  const request = { kind: "CONFIRM", teamKey: "casino", onAnswer: { action: QA_DECISION_ACTION, contentType: "POST", contentId: "m1", hash: "h" } };
  it("la demande « Publier quand même » est réservée aux ADMIN (site) et jamais confiée à un membre du groupe", () => {
    expect(adminOnlyRequest(request)).toBe(true);
    const member = { kind: "member", telegramUserId: 42n, role: "MANAGER", firstName: "Léa" } as never;
    expect(speakerMayAnswerRequest(member, { ...request, assigneeTelegramId: 42n })).toBe(false);
    expect(speakerMayAnswerRequest({ kind: "admin" } as never, request)).toBe(true);
  });
});

describe("découpage borné", () => {
  it(`au-delà de ${QA_MAX_PARTS} sous-vérifications : sortie bloquée, aucun appel au modèle`, async () => {
    const kit = createTestKit(new Date("2026-10-26T08:00:00Z"));
    const qaLlm = createFakeQaLlm();
    const deps = { ...kit.deps, qaLlm };
    const huge = Array.from({ length: 12 }, (_, i) => `Paragraphe ${i} `.repeat(3000)).join("\n");
    const r = await qaCheck(deps, { contentType: "REPORT", contentId: "rep1", teamKey: "analystes", content: { title: "Rapport", text: huge } });
    expect(r.approved).toBe(false);
    expect(r.verdict).toBe("ERROR");
    expect(r.reasons.map((x) => x.code)).toContain(QA_ENGINE_CODES.tooLong);
    expect(qaLlm.calls).toHaveLength(0);
  });
});

describe("rapport pub rédigé par l'IA et seulement enregistré (« Rapport maintenant » sans envoi)", () => {
  it("vérifié quand même : refusé → c'est le rapport du code qui est archivé (il ressort par la commande « rapport »)", async () => {
    const kit = createTestKit(new Date("2026-10-26T08:00:00Z"));
    const qaLlm = createFakeQaLlm({ responses: [{ verdict: "REJECTED", reasons: [{ code: "HALLUCINATION", message: "Affirmation inventée.", severity: "critical" }] }] });
    (kit.deps as { qaLlm?: unknown }).qaLlm = qaLlm;
    const llm: LlmProvider = { async complete() { return { text: '{"lines":["Ligne inventee par le modele sans aucun chiffre."]}', costCents: 1 }; } };
    (kit.deps as { providers?: unknown }).providers = { llm };
    const r = await runAdsReportNowImpl(kit.deps, { kind: "daily", send: false });
    expect(r.ok).toBe(true);
    expect(qaLlm.calls.length).toBeGreaterThan(0);
    const row = kit.tables("insightReport").find((x) => x.teamKey === "ads")!;
    expect(String(row.content)).not.toContain("inventee par le modele");
  });
});
