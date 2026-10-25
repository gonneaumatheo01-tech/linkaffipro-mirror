import { describe, expect, it } from "vitest";
import { mergeCutCandidates, planCuts, sourceSpanMs } from "./analyze";
import { createFakeMontageLlm, fakeMontageAiDeps } from "./ai-fakes";
import type { MontageInstructions } from "./contract";
import type { LlmRequest } from "../types";

const ins = (o: Partial<MontageInstructions> = {}): MontageInstructions => ({
  theme: "roulette",
  format: "VERTICAL_9_16",
  durationTarget: 15,
  pipPosition: "TOP_RIGHT",
  subtitles: true,
  overlayText: null,
  count: null,
  speed: null,
  rawText: "découpe en shorts de 15 secondes, thème roulette",
  ...o,
});

/** n images factices (JPEG minimal) : chemins et fichiers en mémoire. */
function frames(n: number) {
  const files: Record<string, Uint8Array> = {};
  const paths: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = `/tmp/montage/job/frames/f${String(i + 1).padStart(4, "0")}.jpg`;
    files[p] = new Uint8Array([0xff, 0xd8, 0xff, i % 255]);
    paths.push(p);
  }
  return { files, paths };
}

const reply = (shorts: Array<[number, number, number, string?]>) =>
  JSON.stringify({ shorts: shorts.map(([s, e, score, d]) => ({ start_seconds: s, end_seconds: e, score, description: d ?? `moment ${s}`, why: "gain" })) });

describe("planCuts", () => {
  it("lots de 20 images, Opus, horodatage de chaque image, fusion triée par score", async () => {
    const { files, paths } = frames(45); // 3 lots : 20, 20, 5 ; vidéo de 225 s
    const llm = createFakeMontageLlm([reply([[10, 25, 6], [60, 75, 9]]), reply([[100, 115, 8], [150, 165, 4]]), reply([[200, 215, 7]])]);
    const d = fakeMontageAiDeps({ llm, files });
    const plan = await planCuts(d, { framePaths: paths, everySec: 5, durationMs: 225_000, instructions: ins(), maxShorts: 20 });
    expect(llm.calls).toHaveLength(3);
    expect(llm.calls.map((c) => c.images?.length)).toEqual([20, 20, 5]);
    expect(llm.calls.every((c) => c.model === "claude-opus-5-5")).toBe(true);
    expect(llm.calls[1]!.user).toContain("Frame 21 = 1:40");
    expect(llm.calls[0]!.user).toContain("Frame 1 = 0:00, Frame 2 = 0:05");
    expect(llm.calls[0]!.system).toContain("monteur vidéo expert");
    expect(plan.map((p) => p.score)).toEqual([9, 8, 7, 6, 4]);
    expect(plan[0]).toMatchObject({ startMs: 60_000, endMs: 75_000, description: "moment 60" });
    expect(d.usage[0]).toMatchObject({ teamKey: "montage", cents: 3, calls: 3 });
  });

  it("nombre : au plus count, sinon maxShorts", async () => {
    const { files, paths } = frames(10);
    const many = reply([[0, 15, 5], [20, 35, 6], [40, 55, 7]]);
    const p1 = await planCuts(fakeMontageAiDeps({ llm: createFakeMontageLlm([many]), files }), { framePaths: paths, everySec: 5, durationMs: 60_000, instructions: ins({ count: 2 }), maxShorts: 20 });
    expect(p1.map((p) => p.score)).toEqual([7, 6]);
    const p2 = await planCuts(fakeMontageAiDeps({ llm: createFakeMontageLlm([many]), files }), { framePaths: paths, everySec: 5, durationMs: 60_000, instructions: ins(), maxShorts: 1 });
    expect(p2).toHaveLength(1);
  });

  it("sortie invalide de l'IA → erreur claire", async () => {
    const { files, paths } = frames(3);
    for (const bad of ["je ne sais pas", '{"moments": []}']) {
      const d = fakeMontageAiDeps({ llm: createFakeMontageLlm([bad]), files });
      await expect(planCuts(d, { framePaths: paths, everySec: 5, durationMs: 15_000, instructions: ins(), maxShorts: 5 })).rejects.toMatchObject({
        name: "MontageAiError",
        code: "invalid_output",
      });
    }
  });

  it("budget atteint → erreur AVANT l'appel", async () => {
    const { files, paths } = frames(3);
    const llm = createFakeMontageLlm([reply([[0, 15, 5]])]);
    const d = fakeMontageAiDeps({ llm, files, settings: { "montage.monthly_budget_cents": 500 }, usage: [{ teamKey: "montage", provider: "llm", month: "2026-10", cents: 500, calls: 9 }] });
    await expect(planCuts(d, { framePaths: paths, everySec: 5, durationMs: 15_000, instructions: ins(), maxShorts: 5 })).rejects.toMatchObject({ code: "budget" });
    expect(llm.calls).toHaveLength(0);
  });

  it("Opus en échec : aucun repli vers Haiku, erreur", async () => {
    const { files, paths } = frames(3);
    const models: string[] = [];
    const llm = createFakeMontageLlm([
      (req: LlmRequest) => {
        models.push(req.model);
        throw new Error("surcharge");
      },
    ]);
    const d = fakeMontageAiDeps({ llm, files });
    await expect(planCuts(d, { framePaths: paths, everySec: 5, durationMs: 15_000, instructions: ins(), maxShorts: 5 })).rejects.toMatchObject({ code: "ai_failed" });
    expect(models).toEqual(["claude-opus-5-5"]);
  });

  it("IA passée par `llm` (forme LlmProvider) acceptée ; l'interprète de Kevin (autre forme) ignoré", async () => {
    const { files, paths } = frames(3);
    const llm = createFakeMontageLlm([reply([[0, 15, 5]])]);
    const base = fakeMontageAiDeps({ files });
    const { montageLlm: _drop, ...rest } = base;
    void _drop;
    expect(await planCuts({ ...rest, llm }, { framePaths: paths, everySec: 5, durationMs: 15_000, instructions: ins(), maxShorts: 5 })).toHaveLength(1);
    const bossLike = { interpret: async () => ({}), write: async () => ({}) };
    await expect(planCuts({ ...rest, llm: bossLike }, { framePaths: paths, everySec: 5, durationMs: 15_000, instructions: ins(), maxShorts: 5 })).rejects.toMatchObject({ code: "no_ai" });
  });

  it("aucune IA → erreur claire (jamais de plan inventé)", async () => {
    const { files, paths } = frames(3);
    await expect(planCuts(fakeMontageAiDeps({ files }), { framePaths: paths, everySec: 5, durationMs: 15_000, instructions: ins(), maxShorts: 5 })).rejects.toMatchObject({ code: "no_ai" });
  });
});

describe("mergeCutCandidates (fusion par le code)", () => {
  const base = { description: "d", why: "w" };
  it("bornes : hors vidéo retiré, débordement corrigé", () => {
    const out = mergeCutCandidates(
      [
        { ...base, startSec: 300, endSec: 315, score: 10 }, // après la fin
        { ...base, startSec: -5, endSec: 10, score: 9 }, // commence avant 0
        { ...base, startSec: 110, endSec: 130, score: 8 }, // dépasse la fin (120 s)
      ],
      { durationMs: 120_000, spanMs: 15_000, limit: 10 },
    );
    expect(out.map((c) => [c.startMs, c.endMs])).toEqual([
      [0, 15_000],
      [105_000, 120_000],
    ]);
  });

  it("durée cible : dans la tolérance gardée, hors tolérance recalée depuis le début", () => {
    const out = mergeCutCandidates(
      [
        { ...base, startSec: 10, endSec: 24, score: 9 }, // 14 s : gardé
        { ...base, startSec: 40, endSec: 80, score: 8 }, // 40 s → 15 s
        { ...base, startSec: 90, endSec: 92, score: 7 }, // 2 s → 15 s
      ],
      { durationMs: 200_000, spanMs: 15_000, limit: 10 },
    );
    expect(out.map((c) => [c.startMs, c.endMs])).toEqual([
      [10_000, 24_000],
      [40_000, 55_000],
      [90_000, 105_000],
    ]);
  });

  it("chevauchement : le meilleur score gagne ; tri par score ; limite", () => {
    const out = mergeCutCandidates(
      [
        { ...base, startSec: 10, endSec: 25, score: 6 },
        { ...base, startSec: 20, endSec: 35, score: 9 },
        { ...base, startSec: 34, endSec: 49, score: 7 },
        { ...base, startSec: 60, endSec: 75, score: 8 },
        { ...base, startSec: 80, endSec: 95, score: 5 },
      ],
      { durationMs: 200_000, spanMs: 15_000, limit: 2 },
    );
    expect(out.map((c) => [c.startMs / 1000, c.score])).toEqual([
      [20, 9],
      [60, 8],
    ]);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(out[i]!.endMs <= out[j]!.startMs || out[j]!.endMs <= out[i]!.startMs).toBe(true);
  });

  it("vitesse : la longueur prise dans la source suit la vitesse", () => {
    expect(sourceSpanMs({ durationTarget: 15, speed: 1.5 })).toBe(22_500);
    expect(sourceSpanMs({ durationTarget: 200, speed: null })).toBe(90_000);
  });

  it("vidéo plus courte que la durée visée : un seul short de toute la vidéo ; trop courte : rien", () => {
    expect(mergeCutCandidates([{ ...base, startSec: 0, endSec: 15, score: 5 }], { durationMs: 8_000, spanMs: 15_000, limit: 3 })).toMatchObject([{ startMs: 0, endMs: 8_000 }]);
    expect(mergeCutCandidates([{ ...base, startSec: 0, endSec: 15, score: 5 }], { durationMs: 3_000, spanMs: 15_000, limit: 3 })).toEqual([]);
  });
});
