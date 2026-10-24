import { beforeEach, describe, expect, it, vi } from "vitest";

// Lectures de la page Inspiration : choix du bloc « eux / nous » (analyse gardée, calculée, ou chiffres bruts) et
// encart « Inspiré de » de la fiche canal. Base simulée ; moteur simulé (fonctions injectées).
const m = vi.hoisted(() => ({
  plan: null as { styleProfileId: string | null } | null,
  profile: null as { referenceChannelId: string; version: number } | null,
  refs: [] as Array<{ id: string; username: string | null; title: string | null; status: string }>,
  refWhere: null as unknown,
}));

vi.mock("@linkaffipro/db", () => ({
  prisma: {
    channelAgentPlan: { findUnique: vi.fn(async () => m.plan) },
    styleProfile: { findUnique: vi.fn(async () => m.profile) },
    referenceChannel: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        m.refWhere = args.where;
        return m.refs;
      }),
    },
  },
}));

import type { InspirationAnalysis } from "@linkaffipro/agents";
import { loadChannelInspiration, resolveComparison } from "./inspiration-queries";

const analysis: InspirationAnalysis = {
  referenceChannelId: "r1",
  universe: "casino",
  sampleSize: 40,
  rhythm: [{ key: "postsPerDay", label: "Posts par jour", value: 4, sampleSize: 40 }],
  form: [],
  content: [],
  results: [],
  peakSlots: ["19:00"],
  quotes: [],
  flagged: [],
};
const targets = [{ id: "c1", title: "Roulette" }];
const rawPosts = Array.from({ length: 5 }, (_, i) => ({
  postedAt: new Date(Date.UTC(2026, 9, 20 + i, 17)),
  length: 100,
  mediaKind: "photo",
  views: null,
  hasLink: false,
  hasButton: false,
  hasVipCall: false,
  hasOdds: false,
}));
const deps = () => ({}) as never;

beforeEach(() => {
  m.plan = null;
  m.profile = null;
  m.refs = [];
});

describe("bloc « eux / nous »", () => {
  it("analyse gardée avec ses comparaisons : aucun calcul", async () => {
    const analyzeReference = vi.fn();
    const b = await resolveComparison({
      referenceId: "r1",
      universe: "casino",
      stats: {
        ...analysis,
        comparisons: [{ channelId: "c1", channelTitle: "Roulette", ourSampleSize: 12, gaps: [{ key: "k", label: "Posts par jour", theirs: 4, ours: 1, matters: true }] }],
      },
      targets,
      rawPosts,
      engine: { analyzeReference },
      deps,
    });
    expect(b.kind).toBe("analysis");
    if (b.kind !== "analysis") return;
    expect(b.source).toBe("stored");
    expect(b.comparisons[0]!.gaps[0]!.ours).toBe(1);
    expect(analyzeReference).not.toHaveBeenCalled();
  });

  it("analyse gardée sans comparaison : comparée à l'affichage", async () => {
    const compareWithChannel = vi.fn(async () => ({ channelId: "c1", channelTitle: "", ourSampleSize: 9, gaps: [] }));
    const b = await resolveComparison({ referenceId: "r1", universe: "casino", stats: analysis, targets, rawPosts, engine: { compareWithChannel }, deps });
    expect(compareWithChannel).toHaveBeenCalledWith({}, expect.objectContaining({ referenceChannelId: "r1", universe: "casino" }), "c1");
    expect(b.kind === "analysis" && b.comparisons[0]!.channelTitle).toBe("Roulette");
  });

  it("pas d'analyse gardée : calculée par le moteur", async () => {
    const analyzeReference = vi.fn(async () => analysis);
    const compareWithChannel = vi.fn(async () => ({ channelId: "c1", channelTitle: "Roulette", ourSampleSize: 9, gaps: [] }));
    const b = await resolveComparison({ referenceId: "r1", universe: "casino", stats: {}, targets, rawPosts, engine: { analyzeReference, compareWithChannel }, deps });
    expect(b.kind === "analysis" && b.source).toBe("computed");
    expect(analyzeReference).toHaveBeenCalledWith({}, "r1");
  });

  it("moteur absent, en erreur ou trop peu de posts : chiffres bruts", async () => {
    const none = await resolveComparison({ referenceId: "r1", universe: "casino", stats: null, targets, rawPosts, engine: {}, deps });
    expect(none.kind).toBe("raw");
    expect(none.kind === "raw" && none.raw.count).toBe(5);
    expect(none.kind === "raw" && none.tooFew).toBe(true);
    const few = await resolveComparison({
      referenceId: "r1",
      universe: "casino",
      stats: null,
      targets,
      rawPosts,
      engine: { analyzeReference: vi.fn(async () => ({ tooFew: true as const, count: 5 })) },
      deps,
    });
    expect(few.kind).toBe("raw");
    const broken = await resolveComparison({
      referenceId: "r1",
      universe: "casino",
      stats: null,
      targets,
      rawPosts,
      engine: { analyzeReference: vi.fn(async () => Promise.reject(new Error("panne"))) },
      deps,
    });
    expect(broken.kind).toBe("raw");
  });
});

describe("encart « Inspiré de » de la fiche canal", () => {
  it("profil lu par la Rédaction d'abord, puis les références qui visent le canal", async () => {
    m.plan = { styleProfileId: "s1" };
    m.profile = { referenceChannelId: "r2", version: 3 };
    m.refs = [
      { id: "r1", username: null, title: "Club privé", status: "READY" },
      { id: "r2", username: "roulette_pro", title: "Roulette Pro", status: "READY" },
    ];
    const out = await loadChannelInspiration("c1");
    expect(out.map((r) => r.name)).toEqual(["@roulette_pro", "Club privé"]);
    expect(out[0]).toMatchObject({ styleInUse: true, profileVersion: 3 });
    expect(out[1]).toMatchObject({ styleInUse: false, profileVersion: null });
    expect(JSON.stringify(m.refWhere)).toContain('"array_contains":["c1"]');
    expect(JSON.stringify(m.refWhere)).toContain('"removedAt":null');
  });

  it("aucun profil ni référence : rien", async () => {
    expect(await loadChannelInspiration("c1")).toEqual([]);
  });
});
