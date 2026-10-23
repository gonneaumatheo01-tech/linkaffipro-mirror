/**
 * Chef Dating (phase 20), sans base ni réseau : mélange du jour, chaîne vidéo / photo / texte, replis, médiathèque par
 * persona (30 jours, stock bas), attente asynchrone du fournisseur, contrôle des médias, « toujours validé ».
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Db from "@linkaffipro/db";

vi.mock("@linkaffipro/db", async (importOriginal) => {
  const orig = await importOriginal<typeof Db>();
  return {
    ...orig,
    createAgentPost: vi.fn(async (db: { post: { create(a: unknown): Promise<{ id: string }> } }, input: Record<string, unknown>) => {
      const post = await db.post.create({
        data: { channelId: input.channelId, botId: "bot", status: "SCHEDULED", scheduledAt: input.scheduledAt, text: input.text, mediaAssetIds: input.mediaAssetIds, agentMissionId: input.agentMissionId },
      });
      return { postId: post.id, botId: "bot", publisher: "BOT", trackingLinkId: null };
    }),
  };
});

import { createEngineKit } from "../testing/engine-kit";
import { createMission } from "../missions/lifecycle";
import { createTestPostMission } from "../missions/test-post";
import { decideValidation } from "../validation/requests";
import type { createFakeLlm} from "../providers/fake";
import { createFakeImageProvider, createFakeVideoProvider, type FakeMediaOptions } from "../providers/fake";
import { assetLoader } from "../providers/registry";
import { ProviderError } from "../providers/http";
import type { VideoProvider } from "../providers/video";
import type { FrameExtractor } from "../types";
import { countFallbacks, DATING_DEFAULT_MIX, dayFormat, fallbackFormat } from "./dating-format";
import { alwaysValidateReason } from "../orchestrator/autonomy";
import { shouldAskForSources } from "../agents/mediatheque/stock";
import { pollDelayMs, waitExpired } from "../agents/media-ia/video";
import { parseDefect, durationProblem } from "../agents/controle/media-check";
import { budgetAllows } from "../agents/media-ia/budget";
import { buildPhotoPrompt } from "../agents/media-ia/prompt";
import { reportLine } from "../orchestrator/reports";
import type { MediaFormat } from "../agents/mediatheque/pick";

const okFrames: FrameExtractor = async () => ({ frames: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])], durationSec: 10 });

type KitOpts = Parameters<typeof createEngineKit>[0] & { mix?: Record<string, number>; sources?: number; level?: 0 | 1 | 2; media?: FakeMediaOptions };

function setup(o: KitOpts = {}) {
  const holder: { kit?: ReturnType<typeof createEngineKit> } = {};
  const lazyLoader = (id: string) => assetLoader(holder.kit!.prisma)(id);
  const video = o.providers?.video ?? createFakeVideoProvider({ loadAsset: lazyLoader, now: () => holder.kit!.deps.now!(), ...o.media });
  const image = o.providers?.image ?? createFakeImageProvider({ loadAsset: lazyLoader });
  const kit = createEngineKit({ frames: okFrames, ...o, providers: { ...o.providers, video, image } });
  holder.kit = kit;
  const t = kit.prisma._model;
  t("persona").rows.push({ id: "p1", name: "Léa", referenceImageIds: ["ref"], loraUrl: null, loraTrigger: null, loraScale: 0.8, mediaNotes: "tenue décontractée", isActive: true, createdAt: new Date() });
  t("mediaAsset").rows.push({ id: "ref", mimeType: "image/png", filename: "lea.png", size: 3, bytes: new Uint8Array([9, 9, 9]), personaId: "p1", kind: "REFERENCE", origin: "HUMAN", createdAt: new Date("2026-10-01") });
  for (let i = 0; i < (o.sources ?? 5); i++)
    t("mediaAsset").rows.push({ id: `src${i}`, mimeType: "video/mp4", filename: `s${i}.mp4`, size: 3, bytes: new Uint8Array([i, 1, 2]), duration: 10, personaId: "p1", kind: "SOURCE", origin: "HUMAN", teamKey: "dating", createdAt: new Date(Date.UTC(2026, 9, 1 + i)) });
  t("channelAgentPlan").rows.push({ id: "plan", channelId: "real", teamKey: "dating", enabled: true, postsPerDay: 6, windowStart: "00:00", windowEnd: "24:00", minSpacingMinutes: 0, mix: o.mix ?? DATING_DEFAULT_MIX, personaId: "p1", campaignId: null, themes: [] });
  t("agentTeamConfig").rows.push({ id: "cfg", teamKey: "dating", simulation: true, paused: false, autonomyLevel: o.level ?? 0, monthlyBudgetCents: {}, settings: {}, styleGuidelines: "", forbiddenWords: [], maxTextLength: 900, quietHours: [], consecutiveFailures: 0, enabled: true });
  return { kit, video, image };
}

async function mission(kit: ReturnType<typeof createEngineKit>, format?: MediaFormat) {
  const r = await createMission(kit.deps, { teamKey: "dating", channelId: "real", createdBy: "GRAND_CHEF", ...(format ? { format } : {}) });
  if (!r.ok) throw new Error(r.reason);
  return r.missionId;
}

const payload = (kit: ReturnType<typeof createEngineKit>, id: string) => kit.mission(id).payload as Record<string, unknown>;
const steps = (kit: ReturnType<typeof createEngineKit>, id: string) => (kit.mission(id).steps as Array<{ agent: string; status: string }>).map((s) => `${s.agent}:${s.status}`);

describe("règles pures du Chef Dating", () => {
  it("mélange du jour : 1 vidéo, 2 photos, 1 texte sur 4 posts", () => {
    const got: MediaFormat[] = [];
    for (let i = 0; i < 4; i++) got.push(dayFormat(DATING_DEFAULT_MIX, got));
    expect(got.filter((f) => f === "video")).toHaveLength(1);
    expect(got.filter((f) => f === "photo")).toHaveLength(2);
    expect(got.filter((f) => f === "text")).toHaveLength(1);
    expect(dayFormat(null, [])).toBe(dayFormat(DATING_DEFAULT_MIX, []));
  });
  it("replis vidéo → photo → texte, comptés pour le rapport", () => {
    expect(fallbackFormat("video")).toBe("photo");
    expect(fallbackFormat("photo")).toBe("text");
    expect(fallbackFormat("text")).toBeNull();
    expect(countFallbacks([{ from: "video" }, { from: "photo" }, { from: "video" }])).toEqual({ video: 2, photo: 1 });
  });
  it("rapport du matin : replis comptés", () => {
    const line = reportLine({ label: "Dating", published: 3, waiting: 0, refused: 0, failed: 0, spentCents: 0, capCents: null, simulation: true, paused: false, fallbacks: { video: 2, photo: 1 } });
    expect(line).toContain("2 vidéos remplacées par une photo");
    expect(line).toContain("1 photo remplacée par un texte");
  });
  it("attente du fournisseur : 30 s puis 60 s, 15 minutes au plus", () => {
    expect(pollDelayMs(0)).toBe(30_000);
    expect(pollDelayMs(1)).toBe(60_000);
    expect(pollDelayMs(7)).toBe(60_000);
    const at = "2026-10-23T10:00:00.000Z";
    expect(waitExpired(at, new Date("2026-10-23T10:15:00Z"))).toBe(false);
    expect(waitExpired(at, new Date("2026-10-23T10:15:01Z"))).toBe(true);
  });
  it("toujours validé : 3 premières vidéos et photos d'une persona, nouveau canal, doute du contrôle, quel que soit le niveau", () => {
    const base = { teamKey: "dating", personaName: "Léa", personaVideosDone: 3, personaPhotosDone: 3, firstPostOfChannel: false };
    expect(alwaysValidateReason({ ...base, format: "video" })).toBeNull();
    expect(alwaysValidateReason({ ...base, format: "video", personaVideosDone: 2 })).toMatch(/3 premières vidéos de Léa/);
    expect(alwaysValidateReason({ ...base, format: "photo", personaPhotosDone: 0 })).toMatch(/3 premières photos/);
    expect(alwaysValidateReason({ ...base, format: "text", firstPostOfChannel: true })).toMatch(/nouveau canal/);
    expect(alwaysValidateReason({ ...base, format: "video", mediaDoubt: "doute (mains)" })).toMatch(/contrôle du média/);
    expect(alwaysValidateReason({ ...base, teamKey: "casino", format: "video", personaVideosDone: 0 })).toBeNull();
  });
  it("stock de sources : demande sous 3, une fois par jour", () => {
    expect(shouldAskForSources(2, undefined, "2026-10-23")).toBe(true);
    expect(shouldAskForSources(2, "2026-10-23", "2026-10-23")).toBe(false);
    expect(shouldAskForSources(2, "2026-10-22", "2026-10-23")).toBe(true);
    expect(shouldAskForSources(3, undefined, "2026-10-23")).toBe(false);
  });
  it("contrôle du média : JSON strict, illisible = doute ; bornes de durée ; budget jamais dépassé", () => {
    expect(parseDefect('{"defect":"non","reason":"ok"}')).toMatchObject({ defect: "non" });
    expect(parseDefect('```json\n{"defect":"oui","reason":"main à 6 doigts","frame":2}\n```')).toEqual({ defect: "oui", reason: "main à 6 doigts", frame: 2 });
    expect(parseDefect("je ne sais pas").defect).toBe("doute");
    expect(parseDefect('{"defect":"peut-être"}').defect).toBe("doute");
    expect(durationProblem(0.2, 15)).toMatch(/trop courte/);
    expect(durationProblem(30, 15)).toMatch(/trop longue/);
    expect(durationProblem(12, 15)).toBeNull();
    expect(budgetAllows(9_900, 10_000, 100)).toBe(true);
    expect(budgetAllows(9_901, 10_000, 100)).toBe(false);
    expect(budgetAllows(10_000, 10_000, 0)).toBe(true);
  });
  it("prompt photo : mot déclencheur en tête et consignes de la fiche", () => {
    const p = buildPhotoPrompt({ trigger: "lea_v1", mediaNotes: "robe bleue", seed: "m1" });
    expect(p.startsWith("lea_v1, ")).toBe(true);
    expect(p).toContain("robe bleue");
    expect(buildPhotoPrompt({ trigger: "x", seed: "m1" })).toBe(buildPhotoPrompt({ trigger: "x", seed: "m1" }));
  });
});

describe("chaîne vidéo en simulation (faux fournisseur)", () => {
  it("Médiathèque → Média IA (attente puis résultat) → Rédaction → Planification → Contrôle (3 images) → validation « 3 premières vidéos » → Publication", async () => {
    const { kit } = setup({ level: 2 });
    const id = await mission(kit, "video");
    const outcomes = await kit.drain();
    expect(outcomes).toEqual(["next", "waiting", "next", "next", "next", "validation"]);
    const p = payload(kit, id);
    expect(p).toMatchObject({ format: "video", plannedFormat: "video", sourceAssetId: "src0", personaId: "p1" });
    const generated = kit.t("mediaAsset").find((a) => a.id === p.mediaAssetId)!;
    expect(generated).toMatchObject({ kind: "GENERATED", origin: "AI", personaId: "p1", sourceAssetId: "src0", providerName: "fake", resolution: "580p" });
    expect(generated.tags).toContain("simulation");
    expect(generated.sha256).not.toBe(undefined);
    // Le contrôle a regardé 3 images avec le modèle rapide.
    const judged = (kit.llm as ReturnType<typeof createFakeLlm>).calls.find((c) => c.user.includes("controle-media"))!;
    expect(judged.images).toHaveLength(3);
    const v = kit.t("agentValidation")[0]!;
    expect(String(v.reason)).toMatch(/3 premières vidéos de Léa/);
    expect(v.mediaAssetId).toBe(p.mediaAssetId);
    // Accepté par le bouton ✅ → publication avec la vidéo, source comptée sur le canal visé.
    expect((await decideValidation(kit.deps, { validationId: String(v.id), decision: "approve", via: "TELEGRAM" })).ok).toBe(true);
    expect(await kit.drain()).toEqual(["done"]);
    const post = kit.t("post")[0]!;
    expect(post).toMatchObject({ channelId: "test", mediaAssetIds: [p.mediaAssetId] });
    expect(kit.t("mediaUsage").map((u) => `${u.assetId}@${u.channelId}`).sort()).toEqual([`${p.mediaAssetId}@test`, "src0@real"].sort());
    // Coût 0 en simulation : aucune dépense vidéo.
    expect(kit.t("agentUsage").filter((u) => u.provider === "video")).toHaveLength(0);
    // Délais de relecture : 30 s après la soumission.
    expect(kit.t("agentRun").filter((r) => r.agentKey === "media-ia")).toHaveLength(2);
  });

  it("attente : relectures à 30 s puis 60 s ; au-delà de 15 minutes → repli photo journalisé", async () => {
    const stuck: VideoProvider = { ...createFakeVideoProvider(), name: "fake", poll: async () => ({ status: "running" }) };
    const { kit } = setup({ providers: { video: stuck } });
    const id = await mission(kit, "video");
    const delays: number[] = [];
    for (let i = 0; i < 40 && kit.steps.length; i++) {
      const next = kit.steps[0]!;
      if (next.delayMs) {
        delays.push(next.delayMs);
        kit.advance(next.delayMs);
      }
      await kit.drain(1);
      if (payload(kit, id).format === "photo") break;
    }
    expect(delays.slice(0, 3)).toEqual([30_000, 60_000, 60_000]);
    const p = payload(kit, id);
    expect(p.format).toBe("photo");
    expect((p.fallbacks as Array<{ reason: string }>)[0]!.reason).toMatch(/15 minutes/);
    expect(kit.t("event").some((e) => e.type === "agents.dating.fallback")).toBe(true);
    expect(kit.t("mediaAsset").some((a) => a.kind === "PHOTO" && a.origin === "AI")).toBe(true);
  });

  it("fal échoue deux fois → Magic Hour pour la même mission", async () => {
    const falDown: VideoProvider = {
      ...createFakeVideoProvider(),
      name: "fal",
      startReplace: async () => {
        throw new ProviderError("fal.ai : demande refusée (422)", false, 422);
      },
    };
    const holder: { kit?: ReturnType<typeof createEngineKit> } = {};
    const mh = { ...createFakeVideoProvider({ loadAsset: (aid) => assetLoader(holder.kit!.prisma)(aid) }), name: "magichour" as const };
    const { kit } = setup({ providers: { video: falDown, videoFallback: mh } });
    holder.kit = kit;
    const id = await mission(kit, "video");
    await kit.drain(12);
    const p = payload(kit, id);
    expect(p.falFailures).toBe(2);
    expect(kit.t("mediaAsset").find((a) => a.id === p.mediaAssetId)).toMatchObject({ providerName: "magichour", kind: "GENERATED" });
  });
});

describe("replis et budget", () => {
  it("aucune vidéo source → post photo (image de la persona en simulation), repli journalisé et compté", async () => {
    const { kit } = setup({ sources: 0 });
    const id = await mission(kit, "video");
    await kit.drain();
    const p = payload(kit, id);
    expect(p.format).toBe("photo");
    expect(steps(kit, id).slice(0, 2)).toEqual(["mediatheque:SKIPPED", "media-ia:DONE"]);
    expect(kit.t("mediaAsset").find((a) => a.id === p.mediaAssetId)).toMatchObject({ kind: "PHOTO", origin: "AI", providerName: "fake" });
    expect(kit.t("event").filter((e) => e.type === "agents.dating.fallback")).toHaveLength(1);
    // Stock vide : demande des vidéos au client.
    expect(kit.t("humanRequest").find((r) => r.key === "media.dating.source.p1")).toMatchObject({ kind: "MEDIA" });
  });

  it("plafond vidéo atteint → photo ; plafond photo atteint → texte ; jamais d'appel payant au-delà", async () => {
    const pricey: VideoProvider = { ...createFakeVideoProvider(), name: "fal", estimateCents: () => 200 };
    const image = { ...createFakeImageProvider(), name: "fal" as const, estimateCents: () => 4 };
    const { kit } = setup({ providers: { video: pricey, image } });
    kit.t("agentTeamConfig")[0]!.monthlyBudgetCents = { video: 100, image: 2 };
    kit.t("persona")[0]!.loraUrl = "https://x/lea.safetensors";
    kit.t("persona")[0]!.loraTrigger = "lea_v1";
    const id = await mission(kit, "video");
    await kit.drain();
    const p = payload(kit, id);
    expect(p.format).toBe("text");
    expect((p.fallbacks as Array<{ from: string; reason: string }>).map((f) => f.from)).toEqual(["video", "photo"]);
    expect((p.fallbacks as Array<{ reason: string }>)[0]!.reason).toMatch(/plafond vidéo/);
    expect(image.calls).toHaveLength(0);
    expect(steps(kit, id)[1]).toBe("media-ia:DONE");
  });

  it("photo réelle sans LoRA → texte", async () => {
    const image = { ...createFakeImageProvider(), name: "fal" as const };
    const { kit } = setup({ providers: { image } });
    const id = await mission(kit, "photo");
    await kit.drain();
    expect(payload(kit, id).format).toBe("text");
    expect((payload(kit, id).fallbacks as Array<{ reason: string }>)[0]!.reason).toMatch(/LoRA/);
  });

  it("post texte : Médiathèque et Média IA sautées", async () => {
    const { kit } = setup();
    const id = await mission(kit, "text");
    await kit.drain();
    expect(steps(kit, id).slice(0, 3)).toEqual(["mediatheque:SKIPPED", "media-ia:SKIPPED", "redaction:DONE"]);
  });
});

describe("médiathèque par persona", () => {
  it("jamais la même source sur un canal avant 30 jours ; la moins récemment utilisée d'abord", async () => {
    const { kit } = setup({ sources: 2 });
    kit.prisma._model("mediaUsage").rows.push({ id: "u1", assetId: "src0", channelId: "real", usedAt: new Date("2026-10-13T10:00:00Z") });
    const id = await mission(kit, "video");
    await kit.drain(1);
    expect(payload(kit, id).sourceAssetId).toBe("src1");
    // Les deux utilisées récemment → repli photo.
    const { kit: k2 } = setup({ sources: 2 });
    for (const a of ["src0", "src1"]) k2.prisma._model("mediaUsage").rows.push({ id: a, assetId: a, channelId: "real", usedAt: new Date("2026-10-20T10:00:00Z") });
    const id2 = await mission(k2, "video");
    await k2.drain(1);
    expect(payload(k2, id2).format).toBe("photo");
    // Utilisée il y a plus de 30 jours : de nouveau possible.
    const { kit: k3 } = setup({ sources: 1 });
    k3.prisma._model("mediaUsage").rows.push({ id: "old", assetId: "src0", channelId: "real", usedAt: new Date("2026-09-01T10:00:00Z") });
    const id3 = await mission(k3, "video");
    await k3.drain(1);
    expect(payload(k3, id3).sourceAssetId).toBe("src0");
  });

  it("alerte « moins de 3 vidéos sources non utilisées » : une demande par jour et par persona", async () => {
    const { kit } = setup({ sources: 2 });
    const next = async () => {
      kit.steps.length = 0;
      await mission(kit, "video");
      await kit.drain(1);
    };
    await next();
    await next();
    const asked = () => kit.t("humanRequest").filter((r) => r.key === "media.dating.source.p1");
    expect(asked()).toHaveLength(1);
    expect(String(asked()[0]!.question)).toMatch(/#dating #source #lea/);
    asked()[0]!.status = "ANSWERED";
    await next();
    expect(asked()).toHaveLength(1);
    kit.advance(24 * 3600_000);
    await next();
    expect(asked()).toHaveLength(2);
  });
});

describe("contrôle qualité des médias", () => {
  it("défaut vu par le modèle → validation avec l'image regardée envoyée à l'admin", async () => {
    const { kit } = setup({ level: 2, fake: { responses: { "controle-media": '{"defect":"oui","reason":"main déformée","frame":3}' } } });
    const id = await mission(kit, "video");
    await kit.drain();
    const v = kit.t("agentValidation")[0]!;
    expect(String(v.reason)).toMatch(/défaut visible \(main déformée\)/);
    const frameMsg = kit.sent.find((s) => s.html.includes("Image regardée"))!;
    const frameId = (frameMsg.opts as { mediaAssetId: string }).mediaAssetId;
    expect(Array.from(kit.t("mediaAsset").find((a) => a.id === frameId)!.bytes as Uint8Array)).toEqual([3]);
    expect(payload(kit, id).format).toBe("video");
  });

  it("vidéo illisible → jamais publiée : repli photo et production reprise", async () => {
    const { kit } = setup({ frames: async () => null });
    const id = await mission(kit, "video");
    await kit.drain();
    const p = payload(kit, id);
    expect(p.format).toBe("photo");
    expect(p.technicalFailures).toBe(1);
    expect(kit.t("mediaAsset").find((a) => a.id === p.mediaAssetId)!.kind).toBe("PHOTO");
    expect(steps(kit, id)).toContain("media-ia:DONE");
    expect(kit.t("post")).toHaveLength(0);
  });

  it("niveau 2, persona rodée, canal connu : publié sans validation", async () => {
    const { kit } = setup({ level: 2 });
    for (let i = 0; i < 3; i++)
      kit.prisma._model("agentMission").rows.push({ id: `old${i}`, teamKey: "dating", channelId: "real", status: "DONE", payload: { format: "video", personaId: "p1" }, steps: [], createdAt: new Date("2026-10-01") });
    await mission(kit, "video");
    const out = await kit.drain();
    expect(out[out.length - 1]).toBe("done");
    expect(kit.t("agentValidation")).toHaveLength(0);
  });
});

describe("post de test", () => {
  beforeEach(() => vi.clearAllMocks());
  it("mission en simulation vers le canal Test avec la persona du plan Dating", async () => {
    const { kit } = setup();
    const r = await createTestPostMission(kit.deps, { teamKey: "dating", byUserId: "u1", format: "photo" });
    expect(r.ok).toBe(true);
    const m = kit.t("agentMission").find((x) => x.id === (r as { missionId: string }).missionId)!;
    expect(m).toMatchObject({ channelId: "test", isTest: true, createdBy: "HUMAN" });
    expect(m.payload).toMatchObject({ format: "photo", personaId: "p1" });
    await kit.drain();
    expect(kit.t("mediaAsset").some((a) => a.kind === "PHOTO" && a.origin === "AI")).toBe(true);
  });
});
