/**
 * Chef Dating (phase 20), sans base ni réseau : mélange du jour, chaîne photo / texte, replis, contrôle des photos,
 * « toujours validé ». Les vidéos IA ont été retirées le 29 octobre 2026 : une part de vidéos est ignorée.
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
import { createFakeImageProvider } from "../providers/fake";
import { assetLoader } from "../providers/registry";
import { countFallbacks, DATING_DEFAULT_MIX, datingMix, dayFormat, fallbackFormat } from "./dating-format";
import { alwaysValidateReason } from "../orchestrator/autonomy";
import { checkProducedMedia, parseDefect } from "../agents/controle/media-check";
import { budgetAllows } from "../agents/media-ia/budget";
import { buildPhotoPrompt } from "../agents/media-ia/prompt";
import { reportLine } from "../orchestrator/reports";
import type { MediaFormat } from "../agents/mediatheque/pick";

type KitOpts = Parameters<typeof createEngineKit>[0] & { mix?: Record<string, number>; level?: 0 | 1 | 2 };

function setup(o: KitOpts = {}) {
  const holder: { kit?: ReturnType<typeof createEngineKit> } = {};
  const lazyLoader = (id: string) => assetLoader(holder.kit!.prisma)(id);
  const image = o.providers?.image ?? createFakeImageProvider({ loadAsset: lazyLoader });
  const kit = createEngineKit({ ...o, providers: { ...o.providers, image } });
  holder.kit = kit;
  const t = kit.prisma._model;
  t("persona").rows.push({ id: "p1", name: "Léa", referenceImageIds: ["ref"], loraUrl: null, loraTrigger: null, loraScale: 0.8, mediaNotes: "tenue décontractée", isActive: true, createdAt: new Date() });
  t("mediaAsset").rows.push({ id: "ref", mimeType: "image/png", filename: "lea.png", size: 3, bytes: new Uint8Array([9, 9, 9]), personaId: "p1", kind: "REFERENCE", origin: "HUMAN", createdAt: new Date("2026-10-01") });
  t("channelAgentPlan").rows.push({ id: "plan", channelId: "real", teamKey: "dating", enabled: true, postsPerDay: 6, windowStart: "00:00", windowEnd: "24:00", minSpacingMinutes: 0, mix: o.mix ?? DATING_DEFAULT_MIX, personaId: "p1", campaignId: null, themes: [] });
  t("agentTeamConfig").rows.push({ id: "cfg", teamKey: "dating", simulation: true, paused: false, autonomyLevel: o.level ?? 0, monthlyBudgetCents: {}, settings: {}, styleGuidelines: "", forbiddenWords: [], maxTextLength: 900, quietHours: [], consecutiveFailures: 0, enabled: true });
  return { kit, image };
}

async function mission(kit: ReturnType<typeof createEngineKit>, format?: MediaFormat) {
  const r = await createMission(kit.deps, { teamKey: "dating", channelId: "real", createdBy: "GRAND_CHEF", ...(format ? { format } : {}) });
  if (!r.ok) throw new Error(r.reason);
  return r.missionId;
}

const payload = (kit: ReturnType<typeof createEngineKit>, id: string) => kit.mission(id).payload as Record<string, unknown>;
const steps = (kit: ReturnType<typeof createEngineKit>, id: string) => (kit.mission(id).steps as Array<{ agent: string; status: string }>).map((s) => `${s.agent}:${s.status}`);

describe("règles pures du Chef Dating", () => {
  it("mélange du jour : 3 photos, 1 texte sur 4 posts ; une part de vidéos est ignorée", () => {
    const got: MediaFormat[] = [];
    for (let i = 0; i < 4; i++) got.push(dayFormat(DATING_DEFAULT_MIX, got));
    expect(got.filter((f) => f === "photo")).toHaveLength(3);
    expect(got.filter((f) => f === "text")).toHaveLength(1);
    expect(dayFormat(null, [])).toBe(dayFormat(DATING_DEFAULT_MIX, []));
    // Ancien mélange 1 vidéo / 2 photos / 1 texte : vidéo retirée.
    expect(datingMix({ video: 1, photo: 2, text: 1 })).toEqual({ video: 0, photo: 2, text: 1 });
    expect(datingMix({ video: 3, photo: 0, text: 0 })).toEqual(DATING_DEFAULT_MIX);
    const old: MediaFormat[] = [];
    for (let i = 0; i < 6; i++) old.push(dayFormat({ video: 1, photo: 2, text: 1 }, old));
    expect(old).not.toContain("video");
  });
  it("repli photo → texte, compté pour le rapport", () => {
    expect(fallbackFormat("photo")).toBe("text");
    expect(fallbackFormat("text")).toBeNull();
    expect(countFallbacks([{ from: "photo" }, { from: "photo" }])).toEqual({ photo: 2 });
  });
  it("rapport du matin : replis comptés", () => {
    const line = reportLine({ label: "Dating", published: 3, waiting: 0, refused: 0, failed: 0, spentCents: 0, capCents: null, simulation: true, paused: false, fallbacks: { photo: 1 } });
    expect(line).toContain("1 photo remplacée par un texte");
    expect(line).not.toContain("vidéo");
  });
  it("toujours validé : 3 premières photos d'une persona, nouveau canal, doute du contrôle, quel que soit le niveau", () => {
    const base = { teamKey: "dating", personaName: "Léa", personaPhotosDone: 3, firstPostOfChannel: false };
    expect(alwaysValidateReason({ ...base, format: "photo" })).toBeNull();
    expect(alwaysValidateReason({ ...base, format: "photo", personaPhotosDone: 0 })).toMatch(/3 premières photos de Léa/);
    expect(alwaysValidateReason({ ...base, format: "text", firstPostOfChannel: true })).toMatch(/nouveau canal/);
    expect(alwaysValidateReason({ ...base, format: "photo", mediaDoubt: "doute (mains)" })).toMatch(/contrôle du média/);
    expect(alwaysValidateReason({ ...base, teamKey: "casino", format: "photo", personaPhotosDone: 0 })).toBeNull();
  });
  it("contrôle du média : JSON strict, illisible = doute ; budget jamais dépassé", () => {
    expect(parseDefect('{"defect":"non","reason":"ok"}')).toMatchObject({ defect: "non" });
    expect(parseDefect('```json\n{"defect":"oui","reason":"main à 6 doigts","frame":2}\n```')).toEqual({ defect: "oui", reason: "main à 6 doigts", frame: 2 });
    expect(parseDefect("je ne sais pas").defect).toBe("doute");
    expect(parseDefect('{"defect":"peut-être"}').defect).toBe("doute");
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

describe("chaîne photo en simulation (faux fournisseur)", () => {
  it("Médiathèque (sautée) → Média IA → Rédaction → Planification → Contrôle → validation « 3 premières photos » → Publication", async () => {
    const { kit } = setup({ level: 2 });
    const id = await mission(kit, "photo");
    const outcomes = await kit.drain();
    expect(outcomes[outcomes.length - 1]).toBe("validation");
    const p = payload(kit, id);
    expect(p).toMatchObject({ format: "photo", plannedFormat: "photo", personaId: "p1" });
    const photo = kit.t("mediaAsset").find((a) => a.id === p.mediaAssetId)!;
    expect(photo).toMatchObject({ kind: "PHOTO", origin: "AI", personaId: "p1", providerName: "fake" });
    expect(photo.tags).toContain("simulation");
    // Le contrôle a regardé la photo avec le modèle rapide.
    const judged = (kit.llm as ReturnType<typeof createFakeLlm>).calls.find((c) => c.user.includes("controle-media"))!;
    expect(judged.images).toHaveLength(1);
    const v = kit.t("agentValidation")[0]!;
    expect(String(v.reason)).toMatch(/3 premières photos de Léa/);
    expect(v.mediaAssetId).toBe(p.mediaAssetId);
    expect((await decideValidation(kit.deps, { validationId: String(v.id), decision: "approve", via: "TELEGRAM" })).ok).toBe(true);
    expect(await kit.drain()).toEqual(["done"]);
    expect(kit.t("post")[0]!).toMatchObject({ channelId: "test", mediaAssetIds: [p.mediaAssetId] });
    expect(kit.t("agentUsage").filter((u) => u.provider === "video")).toHaveLength(0);
  });

  it("ancienne mission « vidéo » et ancien mélange avec vidéos : produits en photo, aucune vidéo source", async () => {
    const { kit } = setup({ mix: { video: 1, photo: 0, text: 0 } });
    kit.t("mediaAsset").push({ id: "src0", mimeType: "video/mp4", filename: "s0.mp4", size: 3, bytes: new Uint8Array([1]), personaId: "p1", kind: "SOURCE", origin: "HUMAN", teamKey: "dating", createdAt: new Date("2026-10-01") });
    const id = await mission(kit, "video");
    await kit.drain();
    const p = payload(kit, id);
    expect(p.format).toBe("photo");
    expect(p.sourceAssetId).toBeNull();
    expect(kit.t("mediaUsage").some((u) => u.assetId === "src0")).toBe(false);
    const id2 = await mission(kit);
    await kit.drain(1);
    expect(payload(kit, id2).plannedFormat).not.toBe("video");
  });
});

describe("replis et budget", () => {
  it("plafond photo atteint → texte ; jamais d'appel payant au-delà", async () => {
    const image = { ...createFakeImageProvider(), name: "fal" as const, estimateCents: () => 4 };
    const { kit } = setup({ providers: { image } });
    kit.t("agentTeamConfig")[0]!.monthlyBudgetCents = { image: 2 };
    kit.t("persona")[0]!.loraUrl = "https://x/lea.safetensors";
    kit.t("persona")[0]!.loraTrigger = "lea_v1";
    const id = await mission(kit, "photo");
    await kit.drain();
    const p = payload(kit, id);
    expect(p.format).toBe("text");
    expect((p.fallbacks as Array<{ from: string; reason: string }>).map((f) => f.from)).toEqual(["photo"]);
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

describe("contrôle qualité des médias", () => {
  it("défaut vu par le modèle → validation avec l'image regardée envoyée à l'admin", async () => {
    const { kit } = setup({ level: 2, fake: { responses: { "controle-media": '{"defect":"oui","reason":"main déformée"}' } } });
    const id = await mission(kit, "photo");
    await kit.drain();
    const v = kit.t("agentValidation")[0]!;
    expect(String(v.reason)).toMatch(/défaut visible \(main déformée\)/);
    expect(kit.sent.some((s) => s.html.includes("Image regardée"))).toBe(true);
    expect(payload(kit, id).format).toBe("photo");
  });

  it("ancienne vidéo IA : refusée par le contrôle (jamais publiée)", async () => {
    const ctx = { prisma: { mediaAsset: { findUnique: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "video/mp4", origin: "AI", kind: "GENERATED" }) } } };
    const r = await checkProducedMedia({ payload: { mediaAssetId: "oldvid" } } as never, ctx as never);
    expect(r).toMatchObject({ kind: "technical", reason: expect.stringContaining("jamais publiée") });
  });

  it("niveau 2, persona rodée, canal connu : publié sans validation", async () => {
    const { kit } = setup({ level: 2 });
    for (let i = 0; i < 3; i++)
      kit.prisma._model("agentMission").rows.push({ id: `old${i}`, teamKey: "dating", channelId: "real", status: "DONE", payload: { format: "photo", personaId: "p1" }, steps: [], createdAt: new Date("2026-10-01") });
    await mission(kit, "photo");
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
