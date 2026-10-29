/**
 * Relecture de la phase 25, photos IA : coûts toujours comptés une fois (photo générée puis perdue, écartée par le
 * filtre), travail soumis relu à la reprise. Depuis le 29 octobre 2026, une ancienne mission « vidéo » devient une photo.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

import { createEngineKit } from "../../testing/engine-kit";
import { createMission } from "../../missions/lifecycle";
import { createFakeImageProvider } from "../../providers/fake";
import { PaidProviderError } from "../../providers/fal";
import { ProviderError } from "../../providers/http";
import { assetLoader } from "../../providers/registry";
import type { ImageProvider } from "../../providers/image";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
});

type Kit = ReturnType<typeof createEngineKit>;

function setup(providers: { image?: ImageProvider } = {}) {
  const kit = createEngineKit({ providers });
  const t = kit.prisma._model;
  t("persona").rows.push({ id: "p1", name: "Léa", referenceImageIds: ["ref"], loraUrl: "https://x/lea.safetensors", loraTrigger: "lea_v1", loraScale: 0.8, mediaNotes: "", isActive: true, createdAt: new Date() });
  t("mediaAsset").rows.push({ id: "ref", mimeType: "image/png", filename: "lea.png", size: 3, bytes: new Uint8Array([9, 9, 9]), personaId: "p1", kind: "REFERENCE", origin: "HUMAN", createdAt: new Date("2026-10-01") });
  t("channelAgentPlan").rows.push({ id: "plan", channelId: "real", teamKey: "dating", enabled: true, postsPerDay: 6, windowStart: "00:00", windowEnd: "24:00", minSpacingMinutes: 0, mix: { photo: 1 }, personaId: "p1", campaignId: null, themes: [] });
  t("agentTeamConfig").rows.push({ id: "cfg", teamKey: "dating", simulation: true, paused: false, autonomyLevel: 0, monthlyBudgetCents: {}, settings: {}, styleGuidelines: "", forbiddenWords: [], maxTextLength: 900, quietHours: [], consecutiveFailures: 0, enabled: true });
  return kit;
}

async function mission(kit: Kit, format: "video" | "photo") {
  const r = await createMission(kit.deps, { teamKey: "dating", channelId: "real", createdBy: "GRAND_CHEF", format });
  if (!r.ok) throw new Error(r.reason);
  return r.missionId;
}

const payload = (kit: Kit, id: string) => kit.mission(id).payload as Record<string, unknown>;
const spent = (kit: Kit, provider: string) => kit.t("agentUsage").filter((u) => u.provider === provider).reduce((s, u) => s + Number(u.cents ?? 0), 0);

/** Avance jusqu'à l'étape suivante et la joue. */
async function step(kit: Kit) {
  const next = kit.steps[0];
  if (next?.delayMs) kit.advance(next.delayMs);
  return kit.drain(1);
}

describe("photo : génération et téléchargement séparés", () => {
  const holder: { kit?: Kit } = {};
  const loadAsset = (aid: string) => assetLoader(holder.kit!.prisma)(aid);
  function paidImage(o: { failDownload?: number; nsfw?: boolean } = {}) {
    const base = createFakeImageProvider({ loadAsset });
    let downloadFailures = o.failDownload ?? 0;
    const calls = { generate: 0, download: 0 };
    const image: ImageProvider = {
      name: "fal",
      estimateCents: () => 4,
      async generate(input, gen) {
        calls.generate++;
        await gen?.onSubmitted?.({ requestId: `img-${calls.generate}`, statusUrl: "s", responseUrl: "r", cents: 4 });
        if (o.nsfw) throw new PaidProviderError("fal.ai : aucune photo utilisable (filtre de contenu ou résultat vide)", false, 4);
        const r = await base.generate(input);
        return { ...r, cents: 4 };
      },
      async download(url) {
        calls.download++;
        if (downloadFailures-- > 0) throw new ProviderError("fal.ai : téléchargement impossible (réseau)", true);
        return base.download(url);
      },
    };
    return { image, calls };
  }

  it("générée puis téléchargement en erreur passagère : une seule génération, coût compté une fois", async () => {
    const { image, calls } = paidImage({ failDownload: 1 });
    const kit = setup({ image });
    holder.kit = kit;
    const id = await mission(kit, "photo");
    await kit.drain(1);
    expect(await step(kit)).toEqual(["waiting"]);
    expect(payload(kit, id).photoJob).toMatchObject({ images: [expect.any(Object)], costCounted: true });
    expect(await step(kit)).toEqual(["next"]);
    expect(calls).toEqual({ generate: 1, download: 2 });
    expect(spent(kit, "image")).toBe(4);
    expect(kit.t("mediaAsset").find((a) => a.id === payload(kit, id).mediaAssetId)).toMatchObject({ kind: "PHOTO" });
  });

  it("écartée par le filtre de contenu de fal : coût compté, repli texte", async () => {
    const { image, calls } = paidImage({ nsfw: true });
    const kit = setup({ image });
    holder.kit = kit;
    const id = await mission(kit, "photo");
    await kit.drain(2);
    expect(calls.generate).toBe(1);
    expect(payload(kit, id).format).toBe("text");
    expect(spent(kit, "image")).toBe(4);
  });

  it("travail soumis puis attente dépassée : relu à la reprise, jamais resoumis", async () => {
    const base = createFakeImageProvider({ loadAsset });
    const calls = { submit: 0, resume: 0 };
    const image: ImageProvider = {
      name: "fal",
      estimateCents: () => 4,
      async generate(input, gen) {
        if (gen?.resume) {
          calls.resume++;
          return { ...(await base.generate(input)), cents: gen.resume.cents };
        }
        calls.submit++;
        await gen?.onSubmitted?.({ requestId: "img-1", statusUrl: "s", responseUrl: "r", cents: 4 });
        throw new ProviderError("fal.ai : photo toujours en cours après 180 s", true);
      },
      download: (url) => base.download(url),
    };
    const kit = setup({ image });
    holder.kit = kit;
    const id = await mission(kit, "photo");
    await kit.drain(1);
    expect(await step(kit)).toEqual(["waiting"]);
    expect(payload(kit, id).photoJob).toMatchObject({ job: { requestId: "img-1" } });
    expect(await step(kit)).toEqual(["next"]);
    expect(calls).toEqual({ submit: 1, resume: 1 });
    expect(spent(kit, "image")).toBe(4);
  });

  it("ancienne mission « vidéo » (vidéos IA retirées) : produite en photo, sans vidéo source", async () => {
    const { image, calls } = paidImage();
    const kit = setup({ image });
    holder.kit = kit;
    const id = await mission(kit, "video");
    await kit.drain(2);
    expect(calls.generate).toBe(1);
    expect(payload(kit, id)).toMatchObject({ format: "photo", sourceAssetId: null });
    expect(kit.t("mediaAsset").find((a) => a.id === payload(kit, id).mediaAssetId)).toMatchObject({ kind: "PHOTO" });
  });
});
