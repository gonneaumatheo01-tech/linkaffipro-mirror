/**
 * Phase 30, chantier B — QA Global des shorts : après le QC Montage, avant l'aperçu au client. Faux moteur, fausse IA
 * du QA, faux Telegram ; aucun réseau, aucun binaire.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createChainKit, INSTRUCTIONS } from "../montage/chain-kit.test-util";
import { approvePlan, createMontageJob } from "../montage/pipeline";
import { createLongVideoAsset } from "../montage/source";
import { handleMontageCallback } from "../montage/feedback";
import { createFakeQaLlm, qaUnavailable, type FakeQaStep } from "../qa/testing";
import { respondToRequest } from "../human/respond";
import { shortQaContent } from "./shorts";
import "./index";

type Kit = Awaited<ReturnType<typeof createChainKit>>;
let kits: Kit[] = [];
afterEach(async () => {
  for (const k of kits) await k.dispose();
  kits = [];
});

const SUB_ERROR: FakeQaStep = {
  verdict: "REJECTED",
  reasons: [{ code: "SUBTITLE_ERROR", message: "Sous-titre faux : « martindale » au lieu de « martingale ».", severity: "critical" }],
  corrections: [{ field: "subtitlesSrt", expected: "martingale", got: "martindale", suggestion: "corrige le mot" }],
};
const APPROVE: FakeQaStep = { verdict: "APPROVED", reasons: [], corrections: [] };

async function kitWith(responses: FakeQaStep[] | (() => FakeQaStep)) {
  const k = await createChainKit();
  kits.push(k);
  (k.deps as { qaLlm?: unknown }).qaLlm = typeof responses === "function" ? createFakeQaLlm({ respond: responses }) : createFakeQaLlm({ responses });
  return k;
}

async function oneShort(k: Kit) {
  const src = await createLongVideoAsset(k.deps, { chatId: "4242", messageId: 77, fileId: "kevin-src", fileUniqueId: `src-${Math.random()}`, fileName: "live.mp4", mimeType: "video/mp4", sizeBytes: 2048, durationSec: 60, width: 1920, height: 1080, createdById: null });
  if (!src.ok) throw new Error(src.reason);
  const { jobId } = await createMontageJob(k.deps, { sourceAssetId: src.assetId, instructions: INSTRUCTIONS, chatId: "4242", instructionsMsgId: 78, createdById: null });
  await k.drain();
  await approvePlan(k.deps, jobId, [{ kind: "remove", index: 2 }, { kind: "remove", index: 3 }]);
  return jobId;
}

describe("shorts : QA Global avant l'aperçu", () => {
  it("approuvé → aperçu envoyé (une vérification par short)", async () => {
    const k = await kitWith([APPROVE]);
    const jobId = await oneShort(k);
    await k.drain();
    expect(k.clips(jobId)[0]!.status).toBe("PREVIEW_SENT");
    expect(k.hookCalls.preview).toBe(1);
    const qa = k.tables("qaCheck");
    expect(qa).toHaveLength(1);
    expect(qa[0]).toMatchObject({ contentType: "SHORT", contentId: k.clips(jobId)[0]!.id, verdict: "APPROVED", teamKey: "montage" });
  });

  it("refusé → QC_FAILED puis retour à l'Habillage (REDO) ; corrigé → repasse → aperçu ; jamais d'aperçu avant", async () => {
    const k = await kitWith([SUB_ERROR, APPROVE]);
    const jobId = await oneShort(k);
    await k.drain();
    const clip = k.clips(jobId)[0]!;
    expect(clip.redoCount).toBe(1);
    expect(clip.status).toBe("PREVIEW_SENT");
    expect(k.hookCalls.preview).toBe(1);
    expect(k.fake.renders).toHaveLength(2);
    expect(String(clip.clientFeedback)).toContain("martingale");
    expect(k.tables("qaCheck").map((q) => q.verdict)).toEqual(["REJECTED", "APPROVED"]);
    expect(k.tables("event").some((e) => e.type === "qa.short.redo")).toBe(true);
  });

  it("QA indisponible → rien n'est montré, l'aperçu est relu 5 min plus tard", async () => {
    let down = true;
    const k = await kitWith(() => (down ? (qaUnavailable() as never) : APPROVE));
    const jobId = await oneShort(k);
    await k.drain(30);
    expect(k.hookCalls.preview).toBe(0);
    expect(k.clips(jobId)[0]!.status).not.toBe("PREVIEW_SENT");
    const retry = (k.deps.montage!.enqueue as unknown as { mock: { calls: Array<[unknown, { jobId?: string; delayMs?: number }]> } }).mock.calls.at(-1)!;
    expect(retry[1].delayMs).toBe(5 * 60_000);
    expect(retry[1].jobId).toMatch(/-preview-v0-qa\d+$/);
    down = false;
    await k.drain();
    expect(k.hookCalls.preview).toBe(1);
  });

  it("3 refus → le client tranche ; « Publier quand même » → l'aperçu part avec son accord", async () => {
    const k = await kitWith([SUB_ERROR]);
    const jobId = await oneShort(k);
    await k.drain();
    const clip = k.clips(jobId)[0]!;
    expect(k.tables("qaCheck").filter((q) => q.verdict === "REJECTED")).toHaveLength(3);
    expect(clip.status).toBe("QC_FAILED");
    expect(k.hookCalls.preview).toBe(0);
    const req = k.tables("humanRequest")[0]!;
    expect(req).toMatchObject({ kind: "CONFIRM", key: `qa.decision.SHORT.${clip.id}` });
    await respondToRequest(k.deps, req as never, "oui", { userId: null, via: "TELEGRAM" });
    await k.drain();
    expect(k.clips(jobId)[0]!.status).toBe("PREVIEW_SENT");
    expect(k.hookCalls.preview).toBe(1);
  });

  it("« Me le montrer » sur un short retenu : jamais montré sans l'approbation du QA (il repasse au contrôle d'abord)", async () => {
    const k = await kitWith([SUB_ERROR]);
    const jobId = await oneShort(k);
    await k.drain();
    const clip = k.clips(jobId)[0]!;
    expect(clip.status).toBe("QC_FAILED");
    expect(clip.assetId).toBeTruthy();
    const r = await handleMontageCallback(k.deps as never, { data: `msq:${clip.id}:keep`, fromTelegramId: 4242n, chatId: "4242" });
    expect(r.video).toBeUndefined();
    expect(String(r.reply)).toContain("contrôle qualité");
    expect(k.clips(jobId)[0]!.status).toBe("QC");
    expect(k.queue.some((q) => q.job.type === "montage.preview")).toBe(true);
    expect(shortQaContent({ clip: clip as never, asset: { width: 1080, height: 1920, size: 10 } })).toMatchObject({ resolution: "1080x1920", assetId: clip.assetId });
  });
});
