/** Banc d'essai vidéo (phase 20) : refus clair sans clé, essais par réglage, résultats à l'admin, choix enregistré. */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createEngineKit } from "../testing/engine-kit";
import { saveSecret } from "../human/secrets";
import { respondToRequest, type HumanRequestRow } from "../human/respond";
import { createFakeVideoProvider } from "../providers/fake";
import { assetLoader } from "../providers/registry";
import type { VideoProvider } from "../providers/video";
import { benchConfigs, benchEstimate, runBench, startBench } from "./bench";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
});

function setup(wrap?: (v: VideoProvider) => VideoProvider) {
  const holder: { kit?: ReturnType<typeof createEngineKit> } = {};
  const fake = createFakeVideoProvider({ loadAsset: (id) => assetLoader(holder.kit!.prisma)(id) });
  const video = wrap ? wrap(fake) : fake;
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

  type BenchItemView = { status: string; jobId?: string; error?: string };
  const benchState = (kit: ReturnType<typeof createEngineKit>, id: string) =>
    kit.t("setting").find((x) => x.key === `agents.bench.${id}`)!.value as { items: BenchItemView[]; finishedAt?: string };

  it("redémarrage au milieu d'un passage : les essais déjà soumis ne sont jamais repayés", async () => {
    let calls = 0;
    let reached!: () => void;
    const third = new Promise<void>((r) => (reached = r));
    const kit = setup((v) => ({
      ...v,
      async startReplace(input) {
        calls++;
        // 3e soumission : le worker s'arrête net (promesse jamais tenue).
        if (calls === 3) {
          reached();
          return new Promise(() => {});
        }
        return v.startReplace(input);
      },
    }));
    await saveSecret(kit.deps, "providers.fal.apiKey", "fal-key-abcdefgh", { via: "SITE" });
    expect((await startBench(kit.deps, { personaId: "p1", count: 2 })).ok).toBe(true);
    const id = (kit.orchestrator[0] as { benchId: string }).benchId;
    void runBench(kit.deps, { benchId: id });
    await third;
    expect(benchState(kit, id).items.filter((i) => i.status === "running")).toHaveLength(2);
    // Relance après le redémarrage : seuls les 2 essais restants sont soumis.
    await runBench(kit.deps, { benchId: id });
    expect(calls).toBe(5);
    await runBench(kit.deps, { benchId: id });
    expect(benchState(kit, id).items.every((i) => i.status === "done")).toBe(true);
    expect(calls).toBe(5);
  });

  it("une erreur sur un essai n'arrête pas les autres", async () => {
    let calls = 0;
    const kit = setup((v) => ({
      ...v,
      async startReplace(input) {
        calls++;
        if (calls === 3) throw new Error("fal.ai : demande refusée (422)");
        return v.startReplace(input);
      },
    }));
    await saveSecret(kit.deps, "providers.fal.apiKey", "fal-key-abcdefgh", { via: "SITE" });
    await startBench(kit.deps, { personaId: "p1", count: 2 });
    const id = (kit.orchestrator[0] as { benchId: string }).benchId;
    await runBench(kit.deps, { benchId: id });
    expect(calls).toBe(4);
    expect(benchState(kit, id).items.map((i) => i.status)).toEqual(["running", "running", "failed", "running"]);
    await runBench(kit.deps, { benchId: id });
    expect(calls).toBe(4);
  });

  it("pause de l'équipe Rencontres : banc refusé au lancement, aucune soumission pendant la pause", async () => {
    let calls = 0;
    const kit = setup((v) => ({ ...v, startReplace: (input) => (calls++, v.startReplace(input)) }));
    await saveSecret(kit.deps, "providers.fal.apiKey", "fal-key-abcdefgh", { via: "SITE" });
    kit.prisma._model("agentTeamConfig").rows.push({ id: "cfg", teamKey: "dating", paused: true, enabled: true, settings: {}, monthlyBudgetCents: {} });
    const refused = await startBench(kit.deps, { personaId: "p1", count: 2 });
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/pause/);
    kit.t("agentTeamConfig")[0]!.paused = false;
    await startBench(kit.deps, { personaId: "p1", count: 2 });
    const id = (kit.orchestrator[0] as { benchId: string }).benchId;
    kit.t("agentTeamConfig")[0]!.paused = true;
    const r = await runBench(kit.deps, { benchId: id });
    expect(r).toMatchObject({ halted: true });
    expect(calls).toBe(0);
    expect(kit.orchestrator).toHaveLength(1);
  });
});
