/** Banc d'essai vidéo (phase 20) : refus clair sans clé, essais par réglage, résultats à l'admin, choix enregistré. */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createEngineKit } from "../testing/engine-kit";
import { saveSecret } from "../human/secrets";
import { respondToRequest, type HumanRequestRow } from "../human/respond";
import { createFakeVideoProvider } from "../providers/fake";
import { assetLoader } from "../providers/registry";
import { benchConfigs, benchEstimate, runBench, startBench } from "./bench";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
});

function setup() {
  const holder: { kit?: ReturnType<typeof createEngineKit> } = {};
  const video = createFakeVideoProvider({ loadAsset: (id) => assetLoader(holder.kit!.prisma)(id) });
  const kit = createEngineKit({ providers: { video } });
  holder.kit = kit;
  const t = kit.prisma._model;
  t("persona").rows.push({ id: "p1", name: "Léa", referenceImageIds: ["ref"], createdAt: new Date() });
  t("mediaAsset").rows.push({ id: "ref", mimeType: "image/png", filename: "r.png", size: 1, bytes: new Uint8Array([1]), personaId: "p1", kind: "REFERENCE" });
  for (let i = 0; i < 4; i++)
    t("mediaAsset").rows.push({ id: `s${i}`, mimeType: "video/mp4", filename: `s${i}.mp4`, size: 1, bytes: new Uint8Array([i]), duration: 10, personaId: "p1", kind: "SOURCE", createdAt: new Date(Date.UTC(2026, 9, 10 - i)) });
  return kit;
}

describe("banc d'essai vidéo", () => {
  it("réglages selon les clés", () => {
    expect(benchConfigs({ fal: false, magichour: false })).toEqual([]);
    expect(benchConfigs({ fal: true, magichour: true }).map((c) => c.label)).toEqual(["fal.ai 580p", "fal.ai 720p", "Magic Hour (visage seulement)"]);
  });

  it("sans clé : rien n'est lancé, message clair", async () => {
    const kit = setup();
    const r = await startBench(kit.deps, { personaId: "p1" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/aucune clé fal\.ai/);
    expect(kit.orchestrator).toHaveLength(0);
  });

  it("avec la clé fal : 3 sources les plus anciennes × 2 réglages, résultats envoyés, question puis choix enregistré", async () => {
    const kit = setup();
    await saveSecret(kit.deps, "providers.fal.apiKey", "fal-key-abcdefgh", { via: "SITE" });
    expect((await benchEstimate(kit.deps, "p1")).ok).toBe(true);
    const r = await startBench(kit.deps, { personaId: "p1", count: 3 });
    expect(r.ok).toBe(true);
    const job = kit.orchestrator[0] as { type: string; benchId: string };
    expect(job.type).toBe("bench");
    await runBench(kit.deps, { benchId: job.benchId }); // soumissions
    await runBench(kit.deps, { benchId: job.benchId }); // résultats
    const state = kit.t("setting").find((s) => s.key === `agents.bench.${job.benchId}`)!.value as { items: Array<{ sourceAssetId: string; status: string }>; finishedAt?: string };
    expect(state.items).toHaveLength(6);
    expect([...new Set(state.items.map((i) => i.sourceAssetId))].sort()).toEqual(["s1", "s2", "s3"]);
    expect(state.items.every((i) => i.status === "done")).toBe(true);
    expect(state.finishedAt).toBeTruthy();
    expect(kit.sent.filter((s) => s.html.includes("Essai") && (s.opts as { mediaAssetId?: string })?.mediaAssetId)).toHaveLength(6);
    const req = kit.t("humanRequest").find((q) => String(q.key).startsWith("agents.bench.choice."))!;
    expect(req).toMatchObject({ kind: "CHOICE", options: ["fal.ai 580p", "fal.ai 720p"] });
    const answer = await respondToRequest(kit.deps, req as unknown as HumanRequestRow, "2", { via: "TELEGRAM" });
    expect(answer.message).toMatch(/fal\.ai 720p par défaut/);
    expect(kit.t("agentTeamConfig").find((c) => c.teamKey === "dating")!.settings).toMatchObject({ videoProvider: "fal", videoResolution: "720p" });
  });
});
