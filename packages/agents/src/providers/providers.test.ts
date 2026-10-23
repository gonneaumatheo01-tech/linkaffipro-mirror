/** Fournisseurs de médias (phase 20) : coûts, clients fal.ai et Magic Hour sur réponses enregistrées, vérificateurs, choix. */
import { describe, expect, it } from "vitest";
import { USD_TO_EUR } from "@linkaffipro/ai";
import { billedMegapixels, falImageCents, falVideoCents, magicHourCents, magicHourCredits } from "./costs";
import { createFalClient, createFalImageProvider, createFalVideoProvider, falAppPath } from "./fal";
import { createMagicHourVideoProvider } from "./magichour";
import { pickVideoProviderName, mediaSettings } from "./registry";
import { falKeyVerifier, magicHourKeyVerifier } from "./verifiers";
import { fal, fixtureFetch, magichour, REQ_ID } from "./fixtures/http";
import { createFakeImageProvider, createFakeVideoProvider, FAKE_TEST_IMAGE_URL } from "./fake";

const KEY = "fal-secret-key-123456";
const file = (name: string, mimeType: string) => ({ bytes: new Uint8Array([1, 2, 3]), mimeType, filename: name });

describe("coûts estimés", () => {
  it("fal vidéo : (durée × fps ÷ 16) × tarif de la résolution, en centimes d'euro arrondis au supérieur", () => {
    // 12 s à 30 images/s en 720p : 22,5 « secondes » × 0,08 $ = 1,80 $.
    expect(falVideoCents(12, 30, "720p")).toBe(Math.ceil(1.8 * USD_TO_EUR * 100));
    expect(falVideoCents(12, 30, "580p")).toBe(Math.ceil(1.35 * USD_TO_EUR * 100));
    expect(falVideoCents(10, 16, "480p")).toBe(Math.ceil(0.4 * USD_TO_EUR * 100));
    // fps inconnu : 30 par prudence ; durée nulle : 0.
    expect(falVideoCents(12, null, "720p")).toBe(falVideoCents(12, 30, "720p"));
    expect(falVideoCents(0, 30, "720p")).toBe(0);
  });
  it("fal photo : 0,035 $ par mégapixel arrondi au supérieur", () => {
    expect(billedMegapixels(1024, 1024)).toBe(1);
    expect(billedMegapixels(768, 1024)).toBe(1);
    expect(billedMegapixels(1536, 1024)).toBe(2);
    expect(falImageCents(1, "portrait")).toBe(Math.ceil(0.035 * USD_TO_EUR * 100));
    expect(falImageCents(4, "square")).toBe(Math.ceil(0.14 * USD_TO_EUR * 100));
  });
  it("Magic Hour : crédits estimés (une image = un crédit) × prix réglable du crédit", () => {
    expect(magicHourCredits(12, 30)).toBe(360);
    expect(magicHourCents(360)).toBe(Math.ceil(360 * 0.12));
    expect(magicHourCents(360, 0.05)).toBe(18);
  });
});

describe("client fal.ai (réponses enregistrées)", () => {
  it("vidéo : envoi des fichiers sur le stockage, soumission, état, résultat ; adresses renvoyées réutilisées", async () => {
    const f = fixtureFetch([
      { method: "POST", match: /rest\.fal\.ai\/storage\/upload\/initiate/, body: fal.initiate },
      { method: "PUT", match: /storage\.fal\.ai\/upload/, body: {} },
      { method: "POST", match: "https://queue.fal.run/fal-ai/wan/v2.2-14b/animate/replace", body: fal.submit },
      { match: fal.submit.status_url, body: fal.inQueue, once: true },
      { match: fal.submit.status_url, body: fal.inProgress, once: true },
      { match: fal.submit.status_url, body: fal.completed },
      { match: fal.submit.response_url, body: fal.videoResult },
    ]);
    const video = createFalVideoProvider({ client: createFalClient({ apiKey: KEY, fetch: f.fetch }) });
    const start = await video.startReplace({
      sourceVideo: file("source.mp4", "video/mp4"),
      referenceImage: file("lea.jpg", "image/jpeg"),
      resolution: "580p",
      durationSec: 12,
    });
    expect(start).toEqual({ jobId: REQ_ID, estimatedCents: falVideoCents(12, null, "580p"), ref: { statusUrl: fal.submit.status_url, responseUrl: fal.submit.response_url } });
    const submit = f.calls.find((c) => c.url.endsWith("/animate/replace"))!;
    expect(submit.headers.Authorization).toBe(`Key ${KEY}`);
    expect(submit.body).toMatchObject({ video_url: fal.initiate.file_url, image_url: fal.initiate.file_url, resolution: "580p", video_quality: "high" });
    expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(2);
    expect(await video.poll(REQ_ID, start.ref)).toEqual({ status: "queued" });
    expect(await video.poll(REQ_ID, start.ref)).toEqual({ status: "running" });
    expect(await video.poll(REQ_ID, start.ref)).toEqual({ status: "done", outputUrl: fal.videoResult.video.url });
  });
  it("sans adresses gardées, l'état est relu chez propriétaire/app (jamais le chemin complet du modèle)", async () => {
    expect(falAppPath("fal-ai/wan/v2.2-14b/animate/replace")).toBe("fal-ai/wan");
    const f = fixtureFetch([{ match: `https://queue.fal.run/fal-ai/wan/requests/${REQ_ID}/status`, body: fal.inProgress }]);
    const video = createFalVideoProvider({ client: createFalClient({ apiKey: KEY, fetch: f.fetch }) });
    expect((await video.poll(REQ_ID)).status).toBe("running");
  });
  it("COMPLETED avec erreur → échec ; 429 et 5xx → passager ; 4xx → échec clair ; la clé n'apparaît jamais", async () => {
    const run = async (status: number, body: unknown) => {
      const f = fixtureFetch([{ match: fal.submit.status_url, status, body }]);
      return createFalVideoProvider({ client: createFalClient({ apiKey: KEY, fetch: f.fetch }) }).poll(REQ_ID, { statusUrl: fal.submit.status_url });
    };
    expect(await run(200, fal.completedWithError)).toMatchObject({ status: "failed", error: expect.stringContaining("Video decoding failed") });
    expect(await run(429, fal.rateLimited)).toMatchObject({ status: "running", transient: true });
    expect(await run(503, fal.serverError)).toMatchObject({ status: "running", transient: true });
    const denied = await run(401, { detail: `bad key ${KEY}` });
    expect(denied).toMatchObject({ status: "failed" });
    expect(denied.error).toContain("clé refusée");
    expect(denied.error).not.toContain(KEY);
  });
  it("soumission refusée (422) : erreur non passagère avec le détail", async () => {
    const f = fixtureFetch([
      { method: "POST", match: /upload\/initiate/, body: fal.initiate },
      { method: "PUT", match: /storage\.fal\.ai/, body: {} },
      { method: "POST", match: /animate\/replace$/, status: 422, body: fal.validation },
    ]);
    const video = createFalVideoProvider({ client: createFalClient({ apiKey: KEY, fetch: f.fetch }) });
    await expect(
      video.startReplace({ sourceVideo: file("s.mp4", "video/mp4"), referenceImage: file("r.jpg", "image/jpeg"), resolution: "720p", durationSec: 5 }),
    ).rejects.toMatchObject({ transient: false, message: expect.stringContaining("field required") });
  });
  it("stockage : repli sur rest.alpha.fal.ai si l'hôte officiel est indisponible", async () => {
    const f = fixtureFetch([
      { method: "POST", match: /^https:\/\/rest\.fal\.ai\//, status: 502, body: fal.serverError },
      { method: "POST", match: /^https:\/\/rest\.alpha\.fal\.ai\//, body: fal.initiate },
      { method: "PUT", match: /storage\.fal\.ai/, body: {} },
    ]);
    expect(await createFalClient({ apiKey: KEY, fetch: f.fetch }).upload(file("lora.safetensors", "application/octet-stream"))).toBe(fal.initiate.file_url);
  });
  it("photo Flux + LoRA : prompt, LoRA et taille envoyés, image signalée par le filtre écartée", async () => {
    const routes = (result: unknown) =>
      fixtureFetch([
        { method: "POST", match: "https://queue.fal.run/fal-ai/flux-lora", body: fal.imageSubmit },
        { match: fal.imageSubmit.status_url, body: fal.inProgress, once: true },
        { match: fal.imageSubmit.status_url, body: fal.completed },
        { match: fal.imageSubmit.response_url, body: result },
      ]);
    const f = routes(fal.imageResult);
    const image = createFalImageProvider({ client: createFalClient({ apiKey: KEY, fetch: f.fetch }), sleep: async () => {} });
    const res = await image.generate({ loraUrl: "https://x/lea.safetensors", triggerWord: "lea_trigger", loraScale: 0.8, prompt: "lea_trigger, selfie", count: 1, aspect: "portrait" });
    expect(res).toEqual({ images: [{ url: fal.imageResult.images[0]!.url, width: 768, height: 1024 }], cents: falImageCents(1, "portrait") });
    expect(f.calls[0]!.body).toMatchObject({ prompt: "lea_trigger, selfie", image_size: "portrait_4_3", num_images: 1, loras: [{ path: "https://x/lea.safetensors", scale: 0.8 }], output_format: "jpeg" });
    const nsfw = createFalImageProvider({ client: createFalClient({ apiKey: KEY, fetch: routes(fal.imageNsfw).fetch }), sleep: async () => {} });
    await expect(nsfw.generate({ loraUrl: "u", triggerWord: "t", prompt: "t", count: 1, aspect: "portrait" })).rejects.toMatchObject({ transient: false });
  });
});

describe("client Magic Hour (réponses enregistrées)", () => {
  it("envoi des fichiers, création du travail, états, résultat et coût réel en crédits", async () => {
    const f = fixtureFetch([
      { method: "POST", match: "https://api.magichour.ai/v1/files/upload-urls", body: magichour.uploadUrls("video.mp4"), once: true },
      { method: "POST", match: "https://api.magichour.ai/v1/files/upload-urls", body: magichour.uploadUrls("image.jpg"), once: true },
      { method: "PUT", match: /videos\.magichour\.ai\/upload/, body: {} },
      { method: "POST", match: "https://api.magichour.ai/v1/face-swap", body: magichour.created },
      { match: /video-projects\/cm6pvghix/, body: magichour.queued, once: true },
      { match: /video-projects\/cm6pvghix/, body: magichour.rendering, once: true },
      { match: /video-projects\/cm6pvghix/, body: magichour.complete },
    ]);
    const mh = createMagicHourVideoProvider({ apiKey: "mh-secret-key-0000", fetch: f.fetch });
    const start = await mh.startReplace({ sourceVideo: file("s.mp4", "video/mp4"), referenceImage: file("r.jpg", "image/jpeg"), resolution: "580p", durationSec: 12 });
    expect(start).toEqual({ jobId: magichour.created.id, estimatedCents: magicHourCents(450) });
    const create = f.calls.find((c) => c.url.endsWith("/v1/face-swap"))!;
    expect(create.headers.Authorization).toBe("Bearer mh-secret-key-0000");
    expect(create.body).toMatchObject({
      start_seconds: 0,
      end_seconds: 12,
      assets: { video_source: "file", video_file_path: "api-assets/id/video.mp4", image_file_path: "api-assets/id/image.jpg", face_swap_mode: "all-faces" },
    });
    expect((await mh.poll(start.jobId)).status).toBe("queued");
    expect((await mh.poll(start.jobId)).status).toBe("running");
    expect(await mh.poll(start.jobId)).toEqual({ status: "done", outputUrl: magichour.complete.downloads[0]!.url, actualCents: magicHourCents(360) });
  });
  it("erreur du travail → échec avec le motif ; 5xx et 429 → passager ; 401 → échec", async () => {
    const run = async (status: number, body: unknown) =>
      createMagicHourVideoProvider({ apiKey: "mh-secret-key-0000", fetch: fixtureFetch([{ match: /video-projects/, status, body }]).fetch }).poll("x");
    expect(await run(200, magichour.error)).toMatchObject({ status: "failed", error: expect.stringContaining("No faces detected") });
    expect(await run(500, {})).toMatchObject({ status: "running", transient: true });
    expect(await run(429, {})).toMatchObject({ status: "running", transient: true });
    expect(await run(401, magichour.unauthorized)).toMatchObject({ status: "failed" });
  });
});

describe("vérification des clés (appel gratuit)", () => {
  it("fal : 401 / 403 refusée, 404 acceptée, réseau coupé = à réessayer ; jamais la clé dans le message", async () => {
    const check = (status: number) => falKeyVerifier(fixtureFetch([{ match: /flux-lora\/requests\/0{8}-/, status, body: {} }]).fetch)(KEY);
    expect(await check(404)).toEqual({ ok: true, message: "clé acceptée par fal.ai" });
    expect((await check(401)).ok).toBe(false);
    expect((await check(403)).ok).toBe(false);
    const down = await falKeyVerifier(fixtureFetch([{ match: /fal/, throws: "ECONNRESET" }]).fetch)(KEY);
    expect(down.ok).toBe(false);
    for (const r of [await check(401), down]) expect(r.message).not.toContain(KEY);
    const f = fixtureFetch([{ match: /flux-lora/, status: 404, body: {} }]);
    await falKeyVerifier(f.fetch)(KEY);
    expect(f.calls[0]!.headers.Authorization).toBe(`Key ${KEY}`);
  });
  it("Magic Hour : 401 refusée, 404 acceptée", async () => {
    const check = (status: number) => magicHourKeyVerifier(fixtureFetch([{ match: /video-projects\/inexistant/, status, body: magichour.notFound }]).fetch)("mh-key-12345678");
    expect((await check(404)).ok).toBe(true);
    expect((await check(401)).ok).toBe(false);
  });
});

describe("choix du fournisseur et faux fournisseur", () => {
  it("clé fal → fal ; sans clé → faux ; Magic Hour si choisi ou après deux échecs fal, seulement avec sa clé", () => {
    const p = (o: Partial<Parameters<typeof pickVideoProviderName>[0]>) =>
      pickVideoProviderName({ falKey: false, magicHourKey: false, preferred: "fal", falFailures: 0, ...o });
    expect(p({})).toBe("fake");
    expect(p({ falKey: true })).toBe("fal");
    expect(p({ falKey: true, falFailures: 2 })).toBe("fal");
    expect(p({ falKey: true, magicHourKey: true, falFailures: 1 })).toBe("fal");
    expect(p({ falKey: true, magicHourKey: true, falFailures: 2 })).toBe("magichour");
    expect(p({ falKey: true, magicHourKey: true, preferred: "magichour" })).toBe("magichour");
    expect(p({ preferred: "magichour" })).toBe("fake");
  });
  it("réglages : 580p par défaut, 15 s au plus", () => {
    expect(mediaSettings({ settings: {} })).toMatchObject({ resolution: "580p", maxVideoSeconds: 15, videoProvider: "fal" });
    expect(mediaSettings({ settings: { videoResolution: "720p", videoProvider: "magichour", maxVideoSeconds: 20 } })).toMatchObject({ resolution: "720p", videoProvider: "magichour", maxVideoSeconds: 20 });
    expect(mediaSettings({ settings: { videoResolution: "1080p" } }).resolution).toBe("580p");
  });
  it("faux vidéo : la source revient telle quelle après le délai simulé, coût 0 ; fausse photo : image de référence ou de test", async () => {
    let now = new Date("2026-10-23T10:00:00Z");
    const video = createFakeVideoProvider({ delayMs: 60_000, now: () => now });
    const src = file("source.mp4", "video/mp4");
    const start = await video.startReplace({ sourceVideo: src, referenceImage: file("r.png", "image/png"), resolution: "580p", durationSec: 10 });
    expect(start.estimatedCents).toBe(0);
    expect((await video.poll(start.jobId, start.ref)).status).toBe("running");
    now = new Date(now.getTime() + 61_000);
    const done = await video.poll(start.jobId, start.ref);
    expect(done).toMatchObject({ status: "done", actualCents: 0 });
    expect((await video.download(done.outputUrl!)).bytes).toEqual(src.bytes);
    const image = createFakeImageProvider();
    expect((await image.generate({ loraUrl: "", triggerWord: "", prompt: "", count: 1, aspect: "portrait" })).images[0]!.url).toBe(FAKE_TEST_IMAGE_URL);
    expect((await image.generate({ loraUrl: "", triggerWord: "", prompt: "", count: 1, aspect: "portrait", referenceAssetId: "ref1" })).images[0]!.url).toBe("fake://media-asset/ref1");
  });
});
