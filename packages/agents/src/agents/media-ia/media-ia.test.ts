/**
 * Relecture de la phase 25, médias IA : vidéo jamais abandonnée puis resoumise, travail relu chez son fournisseur,
 * coûts toujours comptés une fois (photo générée puis perdue, échec Magic Hour facturé, abandon), repère de soumission.
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
import { saveSecret } from "../../human/secrets";
import type { EngineDeps } from "../../missions/context";
import { fal, fixtureFetch, REQ_ID } from "../../providers/fixtures/http";
import { createMission } from "../../missions/lifecycle";
import { createFakeImageProvider, createFakeVideoProvider } from "../../providers/fake";
import { PaidProviderError } from "../../providers/fal";
import { ProviderError } from "../../providers/http";
import { assetLoader, FAL_SECRET_KEY, MAGICHOUR_SECRET_KEY, resolveMediaProviders } from "../../providers/registry";
import type { ImageProvider } from "../../providers/image";
import type { VideoPoll, VideoProvider } from "../../providers/video";
import type { FrameExtractor } from "../../types";
import { pausedAfter, waitExpired } from "./video";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
});

const okFrames: FrameExtractor = async () => ({ frames: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])], durationSec: 10 });
type Kit = ReturnType<typeof createEngineKit>;

function setup(providers: { video?: VideoProvider; videoFallback?: VideoProvider; image?: ImageProvider } = {}) {
  const kit = createEngineKit({ frames: okFrames, providers });
  const t = kit.prisma._model;
  t("persona").rows.push({ id: "p1", name: "Léa", referenceImageIds: ["ref"], loraUrl: "https://x/lea.safetensors", loraTrigger: "lea_v1", loraScale: 0.8, mediaNotes: "", isActive: true, createdAt: new Date() });
  t("mediaAsset").rows.push({ id: "ref", mimeType: "image/png", filename: "lea.png", size: 3, bytes: new Uint8Array([9, 9, 9]), personaId: "p1", kind: "REFERENCE", origin: "HUMAN", createdAt: new Date("2026-10-01") });
  for (let i = 0; i < 4; i++)
    t("mediaAsset").rows.push({ id: `src${i}`, mimeType: "video/mp4", filename: `s${i}.mp4`, size: 3, bytes: new Uint8Array([i, 1, 2]), duration: 10, personaId: "p1", kind: "SOURCE", origin: "HUMAN", teamKey: "dating", createdAt: new Date(Date.UTC(2026, 9, 1 + i)) });
  t("channelAgentPlan").rows.push({ id: "plan", channelId: "real", teamKey: "dating", enabled: true, postsPerDay: 6, windowStart: "00:00", windowEnd: "24:00", minSpacingMinutes: 0, mix: { video: 1 }, personaId: "p1", campaignId: null, themes: [] });
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

/** Fournisseur vidéo payant scripté : la soumission et les relectures sont comptées. */
function scriptedVideo(kit: () => Kit, name: VideoProvider["name"], states: Array<VideoPoll["status"] | VideoPoll>, o: { cents?: number; cancel?: boolean } = {}) {
  const base = createFakeVideoProvider({ loadAsset: (aid) => assetLoader(kit().prisma)(aid) });
  const calls = { start: 0, poll: 0, cancel: 0 };
  const provider: VideoProvider = {
    name,
    estimateCents: () => o.cents ?? 50,
    async startReplace(input) {
      calls.start++;
      const r = await base.startReplace(input);
      return { ...r, jobId: `${name}-job-${calls.start}`, estimatedCents: o.cents ?? 50 };
    },
    async poll(_jobId, ref) {
      const s = states[Math.min(calls.poll++, states.length - 1)]!;
      const st = typeof s === "string" ? { status: s } : s;
      return st.status === "done" ? { outputUrl: ref?.responseUrl, ...st } : st;
    },
    download: (url) => base.download(url),
    ...(o.cancel !== undefined ? { cancel: async () => (calls.cancel++, { cancelled: o.cancel! }) } : {}),
  };
  return { provider, calls };
}

/** Avance jusqu'à l'étape suivante et la joue. */
async function step(kit: Kit) {
  const next = kit.steps[0];
  if (next?.delayMs) kit.advance(next.delayMs);
  return kit.drain(1);
}

describe("vidéo : délai, pause et abandon", () => {
  it("règles pures : la pause ne compte pas dans les 15 minutes", () => {
    const submittedAt = "2026-10-23T08:00:00.000Z";
    const now = new Date("2026-10-23T08:17:00.000Z");
    const paused = pausedAfter({ submittedAt, lastPolledAt: "2026-10-23T08:00:30.000Z", polls: 1 }, now);
    expect(paused).toBeGreaterThan(15 * 60_000);
    expect(waitExpired(submittedAt, now)).toBe(true);
    expect(waitExpired(submittedAt, now, undefined, paused)).toBe(false);
    // Relectures régulières : aucune pause comptée.
    expect(pausedAfter({ submittedAt, lastPolledAt: "2026-10-23T08:16:00.000Z", polls: 5 }, now)).toBe(0);
  });

  it("en cours puis prêt après une pause de 16 minutes : un seul envoi, coût compté une fois", async () => {
    const holder: { kit?: Kit } = {};
    const { provider, calls } = scriptedVideo(() => holder.kit!, "fal", ["running", "done"], { cents: 50 });
    const kit = setup({ video: provider });
    holder.kit = kit;
    const id = await mission(kit, "video");
    await kit.drain(1); // médiathèque
    expect(await step(kit)).toEqual(["waiting"]); // soumission
    expect(await step(kit)).toEqual(["waiting"]); // en cours
    kit.steps[0]!.delayMs = 0;
    kit.advance(16 * 60_000); // pause de l'équipe
    expect(await step(kit)).toEqual(["next"]); // prêt
    expect(calls.start).toBe(1);
    expect(payload(kit, id)).toMatchObject({ format: "video" });
    expect(kit.t("mediaAsset").find((a) => a.id === payload(kit, id).mediaAssetId)).toMatchObject({ kind: "GENERATED" });
    expect(spent(kit, "video")).toBe(50);
  });

  it("toujours en cours après 15 minutes d'attente réelle : annulé chez fal, aucune nouvelle soumission, photo", async () => {
    const holder: { kit?: Kit } = {};
    const { provider, calls } = scriptedVideo(() => holder.kit!, "fal", ["running"], { cents: 50, cancel: false });
    const kit = setup({ video: provider });
    holder.kit = kit;
    const id = await mission(kit, "video");
    for (let i = 0; i < 40 && payload(kit, id).format === "video"; i++) await step(kit);
    expect(calls.start).toBe(1);
    expect(calls.cancel).toBe(1);
    expect(payload(kit, id).format).toBe("photo");
    // Annulation non confirmée : l'estimation est comptée.
    expect(spent(kit, "video")).toBe(50);
    await step(kit); // photo produite à la relecture
    expect(kit.t("mediaAsset").some((a) => a.kind === "PHOTO")).toBe(true);
    expect(calls.start).toBe(1);
  });

  it("annulation confirmée : rien n'est compté", async () => {
    const holder: { kit?: Kit } = {};
    const { provider } = scriptedVideo(() => holder.kit!, "fal", ["running"], { cents: 50, cancel: true });
    const kit = setup({ video: provider });
    holder.kit = kit;
    const id = await mission(kit, "video");
    for (let i = 0; i < 40 && payload(kit, id).format === "video"; i++) await step(kit);
    expect(payload(kit, id).format).toBe("photo");
    expect(spent(kit, "video")).toBe(0);
  });
});

describe("vidéo : fournisseur du travail et coûts d'échec", () => {
  it("préférence passée à Magic Hour pendant une vidéo fal en cours : le travail est relu chez fal (clé présente)", async () => {
    const kit = setup();
    await saveSecret(kit.deps, FAL_SECRET_KEY, "fal-key-abcdefgh", { via: "SITE" });
    await saveSecret(kit.deps, MAGICHOUR_SECRET_KEY, "mh-key-abcdefgh", { via: "SITE" });
    kit.t("agentTeamConfig")[0]!.settings = { videoProvider: "magichour" };
    const f = fixtureFetch([
      { match: fal.submit.status_url, body: fal.completed },
      { match: fal.submit.response_url, body: fal.videoResult },
      { match: fal.videoResult.video.url, bytes: new Uint8Array([7, 7, 7]), headers: { "content-type": "video/mp4" } },
    ]);
    (kit.deps as EngineDeps).fetch = f.fetch;
    const media = await resolveMediaProviders({ prisma: kit.prisma as never, settings: { settings: { videoProvider: "magichour" } } });
    expect(media.video.name).toBe("magichour");
    expect(media.byName.fal?.name).toBe("fal");
    const id = await mission(kit, "video");
    await kit.drain(1);
    const row = kit.t("agentMission").find((m) => m.id === id)!;
    row.payload = { ...(row.payload as object), sourceAssetId: "src0", mediaJob: { provider: "fal", jobId: REQ_ID, ref: { statusUrl: fal.submit.status_url, responseUrl: fal.submit.response_url }, submittedAt: kit.deps.now!().toISOString(), estimatedCents: 60, resolution: "580p", sourceAssetId: "src0", durationSec: 10, polls: 0 } };
    expect(await step(kit)).toEqual(["next"]);
    expect(f.calls.every((c) => c.url.includes("fal"))).toBe(true);
    expect(kit.t("mediaAsset").find((a) => a.id === payload(kit, id).mediaAssetId)).toMatchObject({ providerName: "fal", kind: "GENERATED" });
    expect(spent(kit, "video")).toBe(60);
  });

  it("échec Magic Hour facturé : le coût est compté avant le repli photo", async () => {
    const holder: { kit?: Kit } = {};
    const mh = scriptedVideo(() => holder.kit!, "magichour", [{ status: "failed", error: "Magic Hour : échec", actualCents: 42 }], { cents: 40 });
    const kit = setup({ video: mh.provider });
    holder.kit = kit;
    const id = await mission(kit, "video");
    for (let i = 0; i < 6 && payload(kit, id).format === "video"; i++) await step(kit);
    expect(payload(kit, id).format).toBe("photo");
    expect(spent(kit, "video")).toBe(42);
  });

  it("repère de soumission : posé avant l'appel payant ; une reprise après plantage ne resoumet pas", async () => {
    const holder: { kit?: Kit } = {};
    const seen: unknown[] = [];
    const { provider, calls } = scriptedVideo(() => holder.kit!, "fal", ["running"], { cents: 50 });
    const crashing: VideoProvider = {
      ...provider,
      async startReplace(input) {
        seen.push((holder.kit!.t("agentMission")[0]!.payload as Record<string, unknown>).videoSubmitting);
        await provider.startReplace(input);
        throw new Error("plantage simulé du worker");
      },
    };
    const kit = setup({ video: crashing });
    holder.kit = kit;
    const id = await mission(kit, "video");
    await kit.drain(1);
    // Plantage : l'étape lève hors de la prise en charge des erreurs (simulé en effaçant la sortie du `catch`).
    const row = kit.t("agentMission").find((m) => m.id === id)!;
    row.payload = { ...(row.payload as object), videoSubmitting: { at: kit.deps.now!().toISOString(), provider: "fal", estimatedCents: 50 } };
    expect(await step(kit)).toEqual(["waiting"]);
    expect(calls.start).toBe(0);
    expect(payload(kit, id)).toMatchObject({ format: "photo", videoSubmitting: null });
    expect(spent(kit, "video")).toBe(50);
    expect(seen).toEqual([]);
  });

  it("le repère est bien écrit en base avant l'appel payant puis effacé", async () => {
    const holder: { kit?: Kit } = {};
    const seen: unknown[] = [];
    const { provider } = scriptedVideo(() => holder.kit!, "fal", ["running"], { cents: 50 });
    const spy: VideoProvider = {
      ...provider,
      async startReplace(input) {
        seen.push((holder.kit!.t("agentMission")[0]!.payload as Record<string, unknown>).videoSubmitting);
        return provider.startReplace(input);
      },
    };
    const kit = setup({ video: spy });
    holder.kit = kit;
    const id = await mission(kit, "video");
    await kit.drain(1);
    await step(kit);
    expect(seen[0]).toMatchObject({ provider: "fal", estimatedCents: 50 });
    expect(payload(kit, id).videoSubmitting).toBeNull();
    expect(payload(kit, id).mediaJob).toMatchObject({ provider: "fal", jobId: "fal-job-1" });
  });
});

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
});
